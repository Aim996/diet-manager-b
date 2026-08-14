import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { aAdapter } from "../adapters/a.ts";
import { createBAdapter, mapSharedKindToBStorage } from "../adapters/b.ts";
import type { CaseExecutionInput } from "../adapters/types.ts";
import {
  compareExactJson,
  formatHarnessReport,
  runAcceptanceHarness,
} from "../run-all.ts";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const acceptanceRoot = resolve(testsDirectory, "..");
const manifestPath = resolve(acceptanceRoot, "harness-manifest.json");

const expectedContracts = [
  {
    contract_id: "diet-manager/contract-v2",
    path: "shared/business-contract.md",
    sha256: "632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E",
  },
  {
    contract_id: "diet-manager/receipt-date-contract-v2",
    path: "shared/contracts/receipt-and-date-contract.md",
    sha256: "F33E34D6B9EA9B1212208D75C5025FA86BB07923248E3B4929A1EF0BB7A375DD",
  },
  {
    contract_id: "diet-manager/issue-correction-contract-v2",
    path: "shared/contracts/issue-correction-contract.md",
    sha256: "41E4A18D4D72644641D66A58F918616EBB0A6189E7F0BE1E836741E057298FDB",
  },
  {
    contract_id: "diet-manager/storage-mapping-v1",
    path: "shared/contracts/storage-mapping.md",
    sha256: "6BEAC0DD2126A680DAD995E9889388BE980DEBE557D05CF1ADAF4F47B77D5A47",
  },
  {
    contract_id: "diet-manager/nutrition-source-capability-v1",
    path: "shared/contracts/source-capability-contract.md",
    sha256: "270C0E75181DB46707C39ACEC08CCBE8AE72CAD2C9269F24A46A1E9114585655",
  },
] as const;

test("freezes the shared harness manifest", () => {
  assert.equal(existsSync(manifestPath), true, "HARNESS_MANIFEST_MISSING");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    harness_id: string;
    version: string;
    selected_route: string;
    contracts: Array<{ contract_id: string; path: string; sha256: string }>;
    case_catalog: { path: string; case_set_id: string; version: string; case_count: number; sha256: string };
    fixture_catalog: { path: string; fixture_catalog_id: string; version: string; sha256: string };
    b_slice_input_catalog: { path: string; input_catalog_id: string; version: string; case_count: number; sha256: string };
    g2_b_slice_matrix: { path: string; matrix_id: string; expected_count: number; sha256: string };
    route_policy: { b_mode: string; a_mode: string; c_mode: string };
    required_case_ids: string[];
    kind_mappings: Array<{ direction: string; from: string; to: string }>;
    report_policy: Record<string, boolean>;
  };

  assert.equal(manifest.harness_id, "diet-manager/shared-acceptance-harness-v1");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.selected_route, "B");
  assert.deepEqual(manifest.contracts, expectedContracts);
  assert.deepEqual(manifest.case_catalog, {
    path: "shared/acceptance-cases/cases.json",
    case_set_id: "diet-manager/core-acceptance-cases-v1",
    version: "1.7.0",
    case_count: 73,
    sha256: "0F7E7DC6E26A49638F4E64B1DC26DE6800176C055D10A9754EFD790579EC2F28",
  });
  assert.deepEqual(manifest.fixture_catalog, {
    path: "shared/acceptance-cases/fixtures/core-v1.json",
    fixture_catalog_id: "diet-manager/core-fixtures-v1",
    version: "1.5.0",
    sha256: "5C189AB033DD12B9DDB6A5D87FA975EBD37F904CB5CF4FC51E4A3CF0B02B7DBA",
  });
  assert.deepEqual(manifest.b_slice_input_catalog, {
    path: "shared/acceptance-cases/b-slice-inputs.json",
    input_catalog_id: "diet-manager/b-slice-case-inputs/v1",
    version: "1.0.0",
    case_count: 9,
    sha256: "73228B1B718502BE486420AD68475CA2482C793E4CF44EF6ABF9ADB29DB1283C",
  });
  assert.deepEqual(manifest.g2_b_slice_matrix, {
    path: "shared/acceptance-cases/g2-b-slice-matrix.json",
    matrix_id: "diet-manager/g2-b-slice-matrix/v1",
    expected_count: 17,
    sha256: "C6FE8A220D30D0C4B21E53D172F578B545847692096F984B14F8C0C72B8B99AF",
  });
  assert.deepEqual(manifest.route_policy, {
    b_mode: "selected_execution_adapter",
    a_mode: "read_only_no_writer",
    c_mode: "merged_into_b_no_adapter",
  });
  assert.deepEqual(manifest.required_case_ids, [
    "CASE-STORAGE-001",
    "CASE-STORAGE-007",
    "CASE-EFFECT-001",
    "CASE-EFFECT-003",
  ]);
  assert.deepEqual(manifest.kind_mappings, [
    {
      direction: "shared_fixture_to_b_storage",
      from: "nutritious_drink",
      to: "nutrition_drink",
    },
  ]);
  assert.deepEqual(manifest.report_policy, {
    adapters_receive_oracle: false,
    adapters_may_rewrite_oracle: false,
    backend_pending_is_product_pass: false,
    technical_log_counts_as_record: false,
  });

  const projectRoot = resolve(acceptanceRoot, "..", "..");
  const locked = [
    ...manifest.contracts.map((entry) => ({ path: entry.path, sha256: entry.sha256 })),
    { path: manifest.case_catalog.path, sha256: manifest.case_catalog.sha256 },
    { path: manifest.fixture_catalog.path, sha256: manifest.fixture_catalog.sha256 },
    { path: manifest.b_slice_input_catalog.path, sha256: manifest.b_slice_input_catalog.sha256 },
    { path: manifest.g2_b_slice_matrix.path, sha256: manifest.g2_b_slice_matrix.sha256 },
  ];
  for (const entry of locked) {
    const bytes = readFileSync(resolve(projectRoot, entry.path));
    const actual = createHash("sha256").update(bytes).digest("hex").toUpperCase();
    assert.equal(actual, entry.sha256, `HARNESS_HASH_INVALID:${entry.path}`);
  }

  const cases = JSON.parse(
    readFileSync(resolve(projectRoot, manifest.case_catalog.path), "utf8"),
  ) as { case_set_id: string; version: string; cases: Array<{ id: string }> };
  assert.equal(cases.case_set_id, manifest.case_catalog.case_set_id);
  assert.equal(cases.version, manifest.case_catalog.version);
  assert.equal(cases.cases.length, manifest.case_catalog.case_count);
  const caseIds = new Set(cases.cases.map((entry) => entry.id));
  for (const caseId of manifest.required_case_ids) {
    assert.equal(caseIds.has(caseId), true, `HARNESS_REQUIRED_CASE_MISSING:${caseId}`);
  }
});

function sampleInput(): CaseExecutionInput {
  return {
    case_id: "CASE-TEST-001",
    requirement_ids: ["REQ-TEST-001"],
    stage: "harness-test",
    source_text: "测试输入",
    setup: { product: { kind: "nutritious_drink" } },
    contract_hashes: [
      {
        contract_id: "diet-manager/contract-v2",
        sha256: "A".repeat(64),
      },
    ],
  };
}

test("A is an honest read-only degradation adapter", async () => {
  assert.deepEqual(await aAdapter.execute(sampleInput()), {
    case_id: "CASE-TEST-001",
    route: "A",
    execution_status: "not_executed",
    outcome_status: "not_applicable",
    reason_code: "read_only_no_plugin",
    business_writes: 0,
    observation: null,
  });
});

test("B without a driver is backend pending and writes nothing", async () => {
  assert.deepEqual(await createBAdapter().execute(sampleInput()), {
    case_id: "CASE-TEST-001",
    route: "B",
    execution_status: "not_executed",
    outcome_status: "not_applicable",
    reason_code: "backend_pending",
    business_writes: 0,
    observation: null,
  });
});

test("adapters reject Oracle fields before invoking dynamic getters", async () => {
  let getterCalls = 0;
  const input = sampleInput() as CaseExecutionInput & { oracle?: unknown };
  Object.defineProperty(input, "oracle", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return { should_not_be_seen: true };
    },
  });
  await assert.rejects(
    () => aAdapter.execute(input),
    /HARNESS_INPUT_INVALID:(?:properties|dynamic_property:oracle)/,
  );
  assert.equal(getterCalls, 0);
});

test("adapters reject Proxy input before invoking any Proxy trap", async () => {
  let trapCalls = 0;
  const input = new Proxy(sampleInput(), {
    getPrototypeOf(target) {
      trapCalls += 1;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      trapCalls += 1;
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, property) {
      trapCalls += 1;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  await assert.rejects(() => aAdapter.execute(input), /HARNESS_INPUT_INVALID:proxy/);
  assert.equal(trapCalls, 0);
});

test("B gives the driver an isolated recursively frozen input", async () => {
  const input = sampleInput();
  let delivered: CaseExecutionInput | undefined;
  const adapter = createBAdapter((candidate) => {
    delivered = candidate;
    assert.notEqual(candidate, input);
    assert.equal(Object.isFrozen(candidate), true);
    assert.equal(Object.isFrozen(candidate.setup), true);
    assert.throws(() => {
      (candidate.setup as { product: { kind: string } }).product.kind = "changed";
    }, TypeError);
    return {
      outcome_status: "succeeded",
      reason_code: null,
      business_writes: 1,
      observation: { accepted: true },
    };
  });
  assert.deepEqual(await adapter.execute(input), {
    case_id: "CASE-TEST-001",
    route: "B",
    execution_status: "executed",
    outcome_status: "succeeded",
    reason_code: null,
    business_writes: 1,
    observation: { accepted: true },
  });
  assert.ok(delivered);
  assert.equal(
    (input.setup as { product: { kind: string } }).product.kind,
    "nutritious_drink",
  );
});

test("B rejects failed execution with any dietary business write", async () => {
  const adapter = createBAdapter(() => ({
    outcome_status: "failed",
    reason_code: "storage_failed",
    business_writes: 1,
    observation: { technical_log_written: true },
  }));
  await assert.rejects(
    () => adapter.execute(sampleInput()),
    /HARNESS_DRIVER_OBSERVATION_INVALID:business_writes:failure_requires_zero/,
  );
});

test("B rejects report-facing reason text that could contain a machine path", async () => {
  const adapter = createBAdapter(() => ({
    outcome_status: "failed",
    reason_code: "C:\\private\\technical.log",
    business_writes: 0,
    observation: null,
  }));
  await assert.rejects(
    () => adapter.execute(sampleInput()),
    /HARNESS_DRIVER_OBSERVATION_INVALID:reason_code:safe_token/,
  );
});

test("B rejects dynamic driver observations before invoking getters", async () => {
  let getterCalls = 0;
  const adapter = createBAdapter(() => {
    const result = {
      outcome_status: "succeeded",
      reason_code: null,
      business_writes: 0,
      observation: null,
    } as Record<string, unknown>;
    Object.defineProperty(result, "observation", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return { hidden: true };
      },
    });
    return result as never;
  });
  await assert.rejects(
    () => adapter.execute(sampleInput()),
    /HARNESS_DRIVER_OBSERVATION_INVALID:dynamic_property:observation/,
  );
  assert.equal(getterCalls, 0);
});

test("kind compatibility mapping is one-way and leaves other values unchanged", () => {
  assert.equal(mapSharedKindToBStorage("nutritious_drink"), "nutrition_drink");
  assert.equal(mapSharedKindToBStorage("nutrition_drink"), "nutrition_drink");
  assert.equal(mapSharedKindToBStorage("solid"), "solid");
});

test("exact comparator rejects missing, extra, and reordered values", () => {
  assert.deepEqual(compareExactJson({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] }), {
    matched: true,
    mismatch_path: null,
    reason: null,
  });
  assert.equal(compareExactJson({ a: 1 }, { a: 1, b: 2 }).matched, false);
  assert.equal(compareExactJson({ a: 1, b: 2 }, { a: 1 }).matched, false);
  assert.equal(compareExactJson([1, 2], [2, 1]).matched, false);
});

test("default runner is deterministic, backend-pending, and Oracle-free", async () => {
  const first = await runAcceptanceHarness();
  const second = await runAcceptanceHarness();
  assert.deepEqual(first, second);
  assert.equal(first.protocol_status, "passed");
  assert.equal(first.product_status, "backend_pending");
  assert.equal(first.catalog.case_count, 73);
  assert.deepEqual(first.summary, {
    case_count: 73,
    a_degraded: 73,
    a_business_writes: 0,
    b_backend_pending: 73,
    b_executed: 0,
    b_compared: 0,
    b_matched: 0,
    b_mismatched: 0,
    b_business_writes: 0,
    c_independent_adapters: 0,
  });
  const text = formatHarnessReport(first);
  assert.equal(text, formatHarnessReport(second));
  assert.equal(text.includes('"oracle"'), false);
  assert.equal(text.includes('"forbidden"'), false);
  assert.equal(/[A-Za-z]:[\\/]/.test(text), false);
});

test("runner resolves setup but never delivers Oracle authority to B", async () => {
  const received: CaseExecutionInput[] = [];
  const report = await runAcceptanceHarness(async (input) => {
    received.push(input);
    return {
      outcome_status: "succeeded",
      reason_code: null,
      business_writes: 0,
      observation: { deliberately: "wrong" },
    };
  });
  assert.equal(received.length, 73);
  assert.deepEqual(Object.keys(received[0]).sort(), [
    "case_id",
    "contract_hashes",
    "requirement_ids",
    "setup",
    "source_text",
    "stage",
  ]);
  assert.deepEqual(Object.keys(received[0].setup as object).sort(), [
    "domain_scenario",
    "environment",
    "goals",
    "ops_security_scenario",
    "prior_context",
    "query_view",
  ]);
  assert.equal(report.product_status, "acceptance_failed");
  assert.equal(report.summary.b_executed, 73);
  assert.equal(report.summary.b_mismatched, 73);
});

test("runner can compare exact observations without exposing them in report", async () => {
  const cases = JSON.parse(
    readFileSync(resolve(acceptanceRoot, "cases.json"), "utf8"),
  ) as { cases: Array<{ id: string; oracle: unknown }> };
  const expected = new Map(cases.cases.map((entry) => [entry.id, entry.oracle]));
  const report = await runAcceptanceHarness((input) => ({
    outcome_status: "succeeded",
    reason_code: null,
    business_writes: 0,
    observation: expected.get(input.case_id) as never,
  }));
  assert.equal(report.product_status, "acceptance_passed");
  assert.equal(report.summary.b_compared, 73);
  assert.equal(report.summary.b_matched, 73);
  assert.equal(report.summary.b_mismatched, 0);
  const text = formatHarnessReport(report);
  assert.equal(text.includes("returned_exact_original_result"), false);
});

test("there is no independent C adapter", () => {
  assert.equal(existsSync(resolve(acceptanceRoot, "adapters", "c.ts")), false);
});
