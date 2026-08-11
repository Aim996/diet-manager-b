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

test("freezes the shared harness manifest", () => {
  assert.equal(existsSync(manifestPath), true, "HARNESS_MANIFEST_MISSING");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    harness_id: string;
    version: string;
    selected_route: string;
    contracts: Array<{ contract_id: string; path: string; sha256: string }>;
    case_catalog: { path: string; case_set_id: string; version: string; case_count: number; sha256: string };
    fixture_catalog: { path: string; fixture_catalog_id: string; version: string; sha256: string };
    route_policy: { b_mode: string; a_mode: string; c_mode: string };
    required_case_ids: string[];
    kind_mappings: Array<{ direction: string; from: string; to: string }>;
    report_policy: Record<string, boolean>;
  };

  assert.equal(manifest.harness_id, "diet-manager/shared-acceptance-harness-v1");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.selected_route, "B");
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
  assert.equal(first.catalog.case_count, 27);
  assert.deepEqual(first.summary, {
    case_count: 27,
    a_degraded: 27,
    a_business_writes: 0,
    b_backend_pending: 27,
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
  assert.equal(received.length, 27);
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
  assert.equal(report.summary.b_executed, 27);
  assert.equal(report.summary.b_mismatched, 27);
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
  assert.equal(report.summary.b_compared, 27);
  assert.equal(report.summary.b_matched, 27);
  assert.equal(report.summary.b_mismatched, 0);
  const text = formatHarnessReport(report);
  assert.equal(text.includes("returned_exact_original_result"), false);
});

test("there is no independent C adapter", () => {
  assert.equal(existsSync(resolve(acceptanceRoot, "adapters", "c.ts")), false);
});
