import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { aAdapter } from "./adapters/a.ts";
import { createBAdapter } from "./adapters/b.ts";
import { clonePlainJson } from "./adapters/runtime.ts";
import type {
  BCaseDriver,
  CaseExecutionInput,
  ContractHash,
  JsonValue,
} from "./adapters/types.ts";

interface HarnessManifest {
  readonly harness_id: string;
  readonly version: string;
  readonly selected_route: "B";
  readonly contracts: readonly {
    readonly contract_id: string;
    readonly path: string;
    readonly sha256: string;
  }[];
  readonly case_catalog: {
    readonly path: string;
    readonly case_set_id: string;
    readonly version: string;
    readonly case_count: number;
    readonly sha256: string;
  };
  readonly fixture_catalog: {
    readonly path: string;
    readonly fixture_catalog_id: string;
    readonly version: string;
    readonly sha256: string;
  };
  readonly route_policy: {
    readonly b_mode: string;
    readonly a_mode: string;
    readonly c_mode: string;
  };
}

interface AcceptanceCase {
  readonly id: string;
  readonly requirement_ids: readonly string[];
  readonly stage: string;
  readonly source_text: string;
  readonly setup: Record<string, JsonValue>;
  readonly oracle: JsonValue;
  readonly forbidden: readonly string[];
}

interface CaseCatalog {
  readonly case_set_id: string;
  readonly version: string;
  readonly cases: readonly AcceptanceCase[];
}

interface FixtureCatalog {
  readonly fixture_catalog_id: string;
  readonly version: string;
  readonly environments: readonly Record<string, JsonValue>[];
  readonly goals: readonly Record<string, JsonValue>[];
  readonly query_views: readonly Record<string, JsonValue>[];
  readonly domain_scenarios: readonly Record<string, JsonValue>[];
  readonly ops_security_scenarios: readonly Record<string, JsonValue>[];
}

export interface ExactComparison {
  readonly matched: boolean;
  readonly mismatch_path: string | null;
  readonly reason: string | null;
}

interface RouteResultRow {
  readonly execution_status: "executed" | "not_executed";
  readonly outcome_status: "not_applicable" | "succeeded" | "failed";
  readonly reason_code: string | null;
  readonly business_writes: number;
}

interface BRouteResultRow extends RouteResultRow {
  readonly comparison: "not_compared" | "matched" | "mismatched";
  readonly mismatch_path: string | null;
}

interface CaseReportRow {
  readonly case_id: string;
  readonly a: RouteResultRow;
  readonly b: BRouteResultRow;
}

export interface HarnessReport {
  readonly report_id: "diet-manager/shared-acceptance-harness-report-v1";
  readonly version: "1.0.0";
  readonly protocol_status: "passed";
  readonly product_status:
    | "backend_pending"
    | "acceptance_passed"
    | "acceptance_failed";
  readonly selected_route: "B";
  readonly catalog: {
    readonly case_set_id: string;
    readonly version: string;
    readonly case_count: number;
    readonly sha256: string;
  };
  readonly contracts: readonly ContractHash[];
  readonly route_policy: {
    readonly b_mode: string;
    readonly a_mode: string;
    readonly c_mode: string;
  };
  readonly summary: {
    readonly case_count: number;
    readonly a_degraded: number;
    readonly a_business_writes: number;
    readonly b_backend_pending: number;
    readonly b_executed: number;
    readonly b_compared: number;
    readonly b_matched: number;
    readonly b_mismatched: number;
    readonly b_business_writes: number;
    readonly c_independent_adapters: 0;
  };
  readonly results: readonly CaseReportRow[];
}

const acceptanceRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(acceptanceRoot, "..", "..");

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function verifyFileHash(relativePath: string, expectedSha256: string): Buffer {
  const bytes = readFileSync(resolve(projectRoot, relativePath));
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`HARNESS_HASH_INVALID:${relativePath}`);
  }
  return bytes;
}

function readFrozenJson(relativePath: string, expectedSha256: string): unknown {
  const bytes = verifyFileHash(relativePath, expectedSha256);
  return JSON.parse(bytes.toString("utf8"));
}

function loadInputs(): {
  manifest: HarnessManifest;
  cases: CaseCatalog;
  fixtures: FixtureCatalog;
} {
  const manifest = readJson(resolve(acceptanceRoot, "harness-manifest.json")) as HarnessManifest;
  if (
    manifest.harness_id !== "diet-manager/shared-acceptance-harness-v1" ||
    manifest.version !== "1.0.0" ||
    manifest.selected_route !== "B"
  ) {
    throw new Error("HARNESS_MANIFEST_INVALID:identity");
  }
  for (const contract of manifest.contracts) {
    verifyFileHash(contract.path, contract.sha256);
  }
  const cases = readFrozenJson(
    manifest.case_catalog.path,
    manifest.case_catalog.sha256,
  ) as CaseCatalog;
  const fixtures = readFrozenJson(
    manifest.fixture_catalog.path,
    manifest.fixture_catalog.sha256,
  ) as FixtureCatalog;
  if (
    cases.case_set_id !== manifest.case_catalog.case_set_id ||
    cases.version !== manifest.case_catalog.version ||
    cases.cases.length !== manifest.case_catalog.case_count
  ) {
    throw new Error("HARNESS_CASE_CATALOG_INVALID:identity");
  }
  if (
    fixtures.fixture_catalog_id !== manifest.fixture_catalog.fixture_catalog_id ||
    fixtures.version !== manifest.fixture_catalog.version
  ) {
    throw new Error("HARNESS_FIXTURE_CATALOG_INVALID:identity");
  }
  return { manifest, cases, fixtures };
}

function fixtureById(
  fixtures: readonly Record<string, JsonValue>[],
  fixtureId: JsonValue | undefined,
  label: string,
): JsonValue {
  if (fixtureId === null || fixtureId === undefined) {
    return null;
  }
  if (typeof fixtureId !== "string" || fixtureId.length === 0) {
    throw new Error(`HARNESS_SETUP_INVALID:${label}`);
  }
  const matches = fixtures.filter((entry) => entry.fixture_id === fixtureId);
  if (matches.length !== 1) {
    throw new Error(`HARNESS_FIXTURE_REFERENCE_INVALID:${label}:${fixtureId}`);
  }
  return clonePlainJson(matches[0], `HARNESS_FIXTURE_INVALID:${label}`);
}

function assertNoReservedAuthority(value: JsonValue, path = "setup"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoReservedAuthority(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [name, child] of Object.entries(value)) {
    if (name === "oracle" || name === "forbidden") {
      throw new Error(`HARNESS_INPUT_AUTHORITY_LEAK:${path}.${name}`);
    }
    assertNoReservedAuthority(child, `${path}.${name}`);
  }
}

function resolvedSetup(
  candidate: AcceptanceCase,
  fixtures: FixtureCatalog,
): JsonValue {
  const setup = candidate.setup;
  const allowed = new Set([
    "environment_fixture",
    "goals_fixture",
    "query_view_fixture",
    "domain_scenario_fixture",
    "ops_security_fixture",
    "prior_context",
  ]);
  const extra = Object.keys(setup).filter((name) => !allowed.has(name));
  if (extra.length !== 0) {
    throw new Error(`HARNESS_SETUP_INVALID:properties:${extra.sort().join(",")}`);
  }
  const result = clonePlainJson(
    {
      environment: fixtureById(
        fixtures.environments,
        setup.environment_fixture,
        "environment_fixture",
      ),
      goals: fixtureById(fixtures.goals, setup.goals_fixture, "goals_fixture"),
      query_view: fixtureById(
        fixtures.query_views,
        setup.query_view_fixture,
        "query_view_fixture",
      ),
      domain_scenario: fixtureById(
        fixtures.domain_scenarios,
        setup.domain_scenario_fixture,
        "domain_scenario_fixture",
      ),
      ops_security_scenario: fixtureById(
        fixtures.ops_security_scenarios,
        setup.ops_security_fixture,
        "ops_security_fixture",
      ),
      prior_context: setup.prior_context ?? [],
    },
    `HARNESS_SETUP_INVALID:${candidate.id}`,
  );
  assertNoReservedAuthority(result);
  return result;
}

function executionInput(
  candidate: AcceptanceCase,
  manifest: HarnessManifest,
  fixtures: FixtureCatalog,
): CaseExecutionInput {
  return {
    case_id: candidate.id,
    requirement_ids: [...candidate.requirement_ids],
    stage: candidate.stage,
    source_text: candidate.source_text,
    setup: resolvedSetup(candidate, fixtures),
    contract_hashes: manifest.contracts.map((entry) => ({
      contract_id: entry.contract_id,
      sha256: entry.sha256,
    })),
  };
}

function valueKind(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function compareExactJson(
  actual: JsonValue,
  expected: JsonValue,
): ExactComparison {
  function mismatch(path: string, reason: string): ExactComparison {
    return { matched: false, mismatch_path: path, reason };
  }
  function visit(left: JsonValue, right: JsonValue, path: string): ExactComparison {
    if (valueKind(left) !== valueKind(right)) return mismatch(path, "type");
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
      return Object.is(left, right)
        ? { matched: true, mismatch_path: null, reason: null }
        : mismatch(path, "value");
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) return mismatch(path, "array_length");
      for (let index = 0; index < left.length; index += 1) {
        const result = visit(left[index], right[index], `${path}[${index}]`);
        if (!result.matched) return result;
      }
      return { matched: true, mismatch_path: null, reason: null };
    }
    if (Array.isArray(left) || Array.isArray(right)) return mismatch(path, "type");
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    for (const key of rightKeys) {
      if (!Object.hasOwn(left, key)) return mismatch(`${path}.${key}`, "missing_property");
    }
    for (const key of leftKeys) {
      if (!Object.hasOwn(right, key)) return mismatch(`${path}.${key}`, "extra_property");
    }
    for (const key of rightKeys) {
      const result = visit(left[key], right[key], `${path}.${key}`);
      if (!result.matched) return result;
    }
    return { matched: true, mismatch_path: null, reason: null };
  }
  return visit(
    clonePlainJson(actual, "HARNESS_COMPARISON_INVALID:actual"),
    clonePlainJson(expected, "HARNESS_COMPARISON_INVALID:expected"),
    "$",
  );
}

export async function runAcceptanceHarness(
  driver?: BCaseDriver,
): Promise<HarnessReport> {
  const { manifest, cases, fixtures } = loadInputs();
  const bAdapter = createBAdapter(driver);
  const rows: CaseReportRow[] = [];
  let aBusinessWrites = 0;
  let bBackendPending = 0;
  let bExecuted = 0;
  let bCompared = 0;
  let bMatched = 0;
  let bMismatched = 0;
  let bBusinessWrites = 0;
  for (const candidate of cases.cases) {
    const input = executionInput(candidate, manifest, fixtures);
    const a = await aAdapter.execute(input);
    const b = await bAdapter.execute(input);
    if (a.case_id !== candidate.id || b.case_id !== candidate.id) {
      throw new Error(`HARNESS_ADAPTER_CASE_ID_INVALID:${candidate.id}`);
    }
    aBusinessWrites += a.business_writes;
    bBusinessWrites += b.business_writes;
    let comparison: BRouteResultRow["comparison"] = "not_compared";
    let mismatchPath: string | null = null;
    if (b.execution_status === "not_executed") {
      if (b.reason_code !== "backend_pending" || b.business_writes !== 0) {
        throw new Error(`HARNESS_PENDING_RESULT_INVALID:${candidate.id}`);
      }
      bBackendPending += 1;
    } else {
      bExecuted += 1;
      bCompared += 1;
      const result = compareExactJson(b.observation, candidate.oracle);
      if (result.matched) {
        comparison = "matched";
        bMatched += 1;
      } else {
        comparison = "mismatched";
        mismatchPath = result.mismatch_path;
        bMismatched += 1;
      }
    }
    rows.push({
      case_id: candidate.id,
      a: {
        execution_status: a.execution_status,
        outcome_status: a.outcome_status,
        reason_code: a.reason_code,
        business_writes: a.business_writes,
      },
      b: {
        execution_status: b.execution_status,
        outcome_status: b.outcome_status,
        reason_code: b.reason_code,
        business_writes: b.business_writes,
        comparison,
        mismatch_path: mismatchPath,
      },
    });
  }
  const productStatus =
    driver === undefined
      ? "backend_pending"
      : bMismatched === 0 && bMatched === cases.cases.length
        ? "acceptance_passed"
        : "acceptance_failed";
  return Object.freeze({
    report_id: "diet-manager/shared-acceptance-harness-report-v1",
    version: "1.0.0",
    protocol_status: "passed",
    product_status: productStatus,
    selected_route: "B",
    catalog: Object.freeze({
      case_set_id: cases.case_set_id,
      version: cases.version,
      case_count: cases.cases.length,
      sha256: manifest.case_catalog.sha256,
    }),
    contracts: Object.freeze(
      manifest.contracts.map((entry) =>
        Object.freeze({ contract_id: entry.contract_id, sha256: entry.sha256 }),
      ),
    ),
    route_policy: Object.freeze({ ...manifest.route_policy }),
    summary: Object.freeze({
      case_count: cases.cases.length,
      a_degraded: rows.filter((entry) => entry.a.reason_code === "read_only_no_plugin").length,
      a_business_writes: aBusinessWrites,
      b_backend_pending: bBackendPending,
      b_executed: bExecuted,
      b_compared: bCompared,
      b_matched: bMatched,
      b_mismatched: bMismatched,
      b_business_writes: bBusinessWrites,
      c_independent_adapters: 0,
    }),
    results: Object.freeze(rows.map((entry) => Object.freeze(entry))),
  });
}

export function formatHarnessReport(report: HarnessReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (
  invokedPath !== null &&
  invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
) {
  try {
    process.stdout.write(formatHarnessReport(await runAcceptanceHarness()));
  } catch {
    process.stderr.write("SHARED_ACCEPTANCE_HARNESS|FAIL|HARNESS_RUNTIME_ERROR\n");
    process.exitCode = 1;
  }
}
