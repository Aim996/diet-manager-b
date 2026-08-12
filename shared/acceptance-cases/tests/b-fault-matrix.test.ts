import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const acceptanceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(acceptanceRoot, "..", "..");
const matrixPath = resolve(acceptanceRoot, "b-fault-matrix.json");
const manifestPath = resolve(acceptanceRoot, "harness-manifest.json");

const CASE_ORDER = [
  "CASE-EFFECT-001", "CASE-EFFECT-002", "CASE-EFFECT-003",
  "CASE-STORAGE-005", "CASE-STORAGE-006", "CASE-STORAGE-007", "CASE-INVENTORY-006",
] as const;

const FAULT_ORDER = [
  ["CASE-EFFECT-001", "after_nutrition"],
  ["CASE-EFFECT-002", "after_inventory_write"],
  ["CASE-EFFECT-002", "after_issue_write"],
  ["CASE-EFFECT-002", "after_progress_contribution_prepared"],
  ["CASE-EFFECT-003", "after_finalization_row"],
  ["CASE-EFFECT-003", "after_envelope"],
  ["CASE-EFFECT-003", "after_idempotency"],
  ["CASE-EFFECT-003", "before_commit"],
  ["CASE-STORAGE-005", "after_schema"],
  ["CASE-STORAGE-005", "before_history"],
  ["CASE-STORAGE-005", "before_commit"],
  ["CASE-STORAGE-005", "unknown_existing_database"],
  ["CASE-STORAGE-005", "drifted_v1_index"],
  ["CASE-STORAGE-006", "after_commit_before_reply"],
  ["CASE-STORAGE-007", "changed_digest"],
  ["CASE-STORAGE-007", "changed_subject"],
  ["CASE-STORAGE-007", "changed_command"],
  ["CASE-INVENTORY-006", "preview_data_revision_changed"],
] as const;

const CASE_FAULT_COUNTS = [1, 3, 4, 5, 1, 3, 1] as const;
const ROW_KEYS = [
  "case_id", "fault_id", "operation_kind", "fault_point", "expected_error_code",
  "failed_state", "outbox_state", "observations", "restart", "same_token_retry",
  "diagnostic", "frozen_result", "forbidden", "assertion_paths",
] as const;
const OBSERVATION_KEYS = [
  "command_envelope", "outbox", "facts", "inventory_transactions", "nutrition_profiles",
  "nutrition_snapshots", "issues", "daily_progress_snapshots", "envelope_finalizations", "success_receipts",
] as const;
const COUNT_KEYS = ["count", "unchanged_from_pre_fault"] as const;
const RESTART_KEYS = ["sqlite_reopen_state", "only_unfinished_stage_may_change", "completed_effects_repeated"] as const;
const RETRY_KEYS = ["action", "business_writes", "completed_effects_repeated", "finalizations_added", "frozen_result_bytes_unchanged"] as const;
const DIAGNOSTIC_KEYS = ["stage", "error_code", "trace_id", "input_digest", "forbidden_content"] as const;

type Row = Record<string, unknown>;
type Matrix = {
  matrix_id: string;
  case_order: string[];
  fault_rows: Row[];
  case_assertion_paths: Record<string, string[]>;
  scope_limitations: Record<string, string>;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function keys(value: unknown): string[] {
  assert.equal(typeof value, "object", "B_FAULT_OBJECT_REQUIRED");
  assert.notEqual(value, null, "B_FAULT_OBJECT_REQUIRED");
  assert.equal(Array.isArray(value), false, "B_FAULT_OBJECT_REQUIRED");
  return Object.keys(value as object);
}

function assertMatrix(matrix: Matrix): void {
  assert.equal(matrix.matrix_id, "diet-manager/b-fault-matrix/v1");
  assert.deepEqual(matrix.case_order, CASE_ORDER, "B_FAULT_CASE_ORDER_INVALID");
  assert.equal(matrix.fault_rows.length, FAULT_ORDER.length, "B_FAULT_ROW_COUNT_INVALID");
  assert.deepEqual(
    matrix.fault_rows.map((row) => [row.case_id, row.fault_point]),
    FAULT_ORDER,
    "B_FAULT_ORDER_INVALID",
  );
  assert.deepEqual(
    CASE_ORDER.map((caseId) => matrix.fault_rows.filter((row) => row.case_id === caseId).length),
    CASE_FAULT_COUNTS,
    "B_FAULT_CASE_FAULT_COUNT_INVALID",
  );
  const ids = matrix.fault_rows.map((row) => row.fault_id);
  assert.equal(new Set(ids).size, ids.length, "B_FAULT_DUPLICATE_ID");

  for (const row of matrix.fault_rows) {
    assert.deepEqual(keys(row), ROW_KEYS, `B_FAULT_ROW_KEYS_INVALID:${row.fault_id}`);
    assert.equal(typeof row.fault_id, "string", "B_FAULT_ID_MISSING");
    assert.equal(typeof row.operation_kind, "string", "B_FAULT_OPERATION_MISSING");
    assert.equal(typeof row.expected_error_code, "string", "B_FAULT_ERROR_MISSING");
    assert.notEqual(row.expected_error_code, "", "B_FAULT_ERROR_EMPTY");
    assert.deepEqual(keys(row.observations), OBSERVATION_KEYS, `B_FAULT_OBSERVATIONS_INVALID:${row.fault_id}`);
    assert.deepEqual(keys((row.observations as Record<string, unknown>).command_envelope), ["state", "result_status"]);
    assert.deepEqual(keys((row.observations as Record<string, unknown>).outbox), ["state", "attempt_count", "reason", "count"]);
    assert.deepEqual(keys((row.observations as Record<string, unknown>).facts), ["event_records", "meal_items", "effect_bundle_commits", "unchanged_from_pre_fault"]);
    for (const key of OBSERVATION_KEYS.slice(3)) {
      assert.deepEqual(keys((row.observations as Record<string, unknown>)[key]), COUNT_KEYS, `B_FAULT_COUNT_OBSERVATION_INVALID:${row.fault_id}:${key}`);
    }
    assert.deepEqual(keys(row.restart), RESTART_KEYS, `B_FAULT_RESTART_INVALID:${row.fault_id}`);
    assert.deepEqual(keys(row.same_token_retry), RETRY_KEYS, `B_FAULT_RETRY_INVALID:${row.fault_id}`);
    assert.deepEqual(keys(row.diagnostic), DIAGNOSTIC_KEYS, `B_FAULT_DIAGNOSTIC_INVALID:${row.fault_id}`);
    assert.deepEqual((row.diagnostic as Record<string, unknown>).forbidden_content, ["source_text", "sql", "secret", "absolute_path"]);
    assert.deepEqual(keys(row.frozen_result), ["present", "payload_bytes_unchanged", "returns_old_result_as_new"], `B_FAULT_FROZEN_RESULT_INVALID:${row.fault_id}`);
    assert.equal(Array.isArray(row.assertion_paths) && row.assertion_paths.length > 0, true, `B_FAULT_PATHS_MISSING:${row.fault_id}`);
  }

  for (const caseId of ["CASE-EFFECT-002", "CASE-STORAGE-005", "CASE-INVENTORY-006"]) {
    assert.equal(typeof matrix.scope_limitations[caseId], "string", `B_FAULT_SCOPE_LIMITATION_MISSING:${caseId}`);
    assert.notEqual(matrix.scope_limitations[caseId], "", `B_FAULT_SCOPE_LIMITATION_EMPTY:${caseId}`);
  }

  const effect001 = matrix.fault_rows[0];
  assert.deepEqual((effect001.observations as Record<string, unknown>).command_envelope, { state: "effects_pending", result_status: "facts_committed_effects_pending" });
  assert.deepEqual((effect001.observations as Record<string, unknown>).outbox, { state: "retryable_failed", attempt_count: 1, reason: "NUTRITION_EFFECT_WRITE_FAILED", count: 2 });
  const effect002 = matrix.fault_rows.slice(1, 4);
  for (const row of effect002) {
    assert.equal(row.expected_error_code, "effect_bundle_write_failed");
    assert.deepEqual((row.observations as Record<string, unknown>).outbox, { state: "retryable_failed", attempt_count: 1, reason: "MEAL_EFFECT_FAILED", count: 4 });
  }
  for (const row of matrix.fault_rows.slice(4, 8)) {
    assert.equal(row.expected_error_code, "envelope_finalize_write_failed");
    assert.deepEqual((row.observations as Record<string, unknown>).command_envelope, { state: "effects_stable", result_status: "effects_stable" });
    assert.deepEqual((row.observations as Record<string, unknown>).outbox, { state: "succeeded", attempt_count: 1, reason: null, count: 4 });
  }
}

function readMatrix(): Matrix {
  assert.equal(existsSync(matrixPath), true, "B_FAULT_MATRIX_MISSING");
  return JSON.parse(readFileSync(matrixPath, "utf8")) as Matrix;
}

test("freezes the exact eighteen-row B fault authority and both manifest bindings", () => {
  const matrix = readMatrix();
  assertMatrix(matrix);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    case_catalog: { path: string; sha256: string };
    b_fault_matrix: { path: string; matrix_id: string; case_count: number; fault_count: number; sha256: string };
  };
  assert.deepEqual(manifest.b_fault_matrix, {
    path: "shared/acceptance-cases/b-fault-matrix.json",
    matrix_id: "diet-manager/b-fault-matrix/v1",
    case_count: 7,
    fault_count: 18,
    sha256: manifest.b_fault_matrix.sha256,
  });
  for (const entry of [manifest.case_catalog, manifest.b_fault_matrix]) {
    const actual = createHash("sha256").update(readFileSync(resolve(projectRoot, entry.path))).digest("hex").toUpperCase();
    assert.equal(actual, entry.sha256, `B_FAULT_MANIFEST_HASH_INVALID:${entry.path}`);
  }
  const cases = JSON.parse(readFileSync(resolve(acceptanceRoot, "cases.json"), "utf8")) as {
    cases: Array<{ id: string; oracle?: { failure?: { envelope_status?: string }; state_after_restart?: { envelope_status?: string } } }>;
  };
  const effect003 = cases.cases.find((entry) => entry.id === "CASE-EFFECT-003");
  assert.equal(effect003?.oracle?.failure?.envelope_status, "effects_stable", "B_FAULT_CATALOG_FAILURE_STATE_INVALID");
  assert.equal(effect003?.oracle?.state_after_restart?.envelope_status, "effects_stable", "B_FAULT_CATALOG_RESTART_STATE_INVALID");
});

test("rejects exact B fault authority mutations", () => {
  const matrix = readMatrix();
  const mutations: Array<[string, (candidate: Matrix) => void]> = [
    ["case missing", (candidate) => candidate.case_order.pop()],
    ["case extra", (candidate) => candidate.case_order.push("CASE-EXTRA-001")],
    ["case reordered", (candidate) => candidate.case_order.reverse()],
    ["fault missing", (candidate) => candidate.fault_rows.pop()],
    ["fault extra", (candidate) => candidate.fault_rows.push(clone(candidate.fault_rows[0]))],
    ["fault reordered", (candidate) => candidate.fault_rows.reverse()],
    ["duplicate fault id", (candidate) => { candidate.fault_rows[1].fault_id = String(candidate.fault_rows[0].fault_id); }],
    ["empty error code", (candidate) => { candidate.fault_rows[0].expected_error_code = ""; }],
    ["restart inner field missing", (candidate) => { delete (candidate.fault_rows[0].restart as Record<string, unknown>).sqlite_reopen_state; }],
    ["retry inner field missing", (candidate) => { delete (candidate.fault_rows[0].same_token_retry as Record<string, unknown>).action; }],
    ["frozen result omitted", (candidate) => { delete candidate.fault_rows[13].frozen_result; }],
    ["diagnostic leaks path constraint", (candidate) => { (candidate.fault_rows[0].diagnostic as Record<string, unknown>).forbidden_content = []; }],
  ];
  for (const [name, mutate] of mutations) {
    const candidate = clone(matrix);
    mutate(candidate);
    assert.throws(() => assertMatrix(candidate), undefined, `B_FAULT_MUTATION_ACCEPTED:${name}`);
  }
});
