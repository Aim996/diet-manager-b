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
  "command_envelope", "outbox", "facts", "effect_bundle_checkpoints", "inventory_transactions", "nutrition_profiles",
  "nutrition_snapshots", "issues", "daily_progress_snapshots", "envelope_finalizations", "success_receipts",
] as const;
const COUNT_KEYS = ["count", "unchanged_from_pre_fault"] as const;
const RESTART_KEYS = ["sqlite_reopen_state", "only_unfinished_stage_may_change", "completed_effects_repeated"] as const;
const RETRY_KEYS = ["action", "business_writes", "completed_effects_repeated", "finalizations_added", "frozen_result_bytes_unchanged", "post_retry"] as const;
const POST_RETRY_KEYS = ["outbox_terminal_count", "outbox_attempt_count", "fact_event_records", "fact_meal_items", "terminal_effect_bundle_count", "daily_progress_snapshot_count", "envelope_finalization_count", "success_receipt_count"] as const;
const DIAGNOSTIC_KEYS = ["stage", "error_code", "trace_id", "input_digest", "forbidden_content"] as const;

type Row = Record<string, unknown>;
type Matrix = {
  matrix_id: string;
  case_order: string[];
  fault_rows: Row[];
  case_assertion_paths: Record<string, string[]>;
  scope_limitations: Record<string, string>;
};

const PATHS = {
  effect001: ["/oracle/failure", "/oracle/state_after_restart", "/oracle/same_key_retry", "/forbidden"],
  effect002: ["/effect_bundle/late_failure_full_rollback", "/restart/effects_pending", "/same_token_retry/missing_effect_only", "/forbidden"],
  effect003: ["/oracle/failure", "/oracle/state_after_restart", "/oracle/same_key_retry", "/forbidden"],
  storage005: ["/migration/failure_keeps_final_unpublished", "/migration/failure_keeps_user_version_unadvanced", "/scope_limitation"],
  storage006: ["/oracle/original_result", "/oracle/later_unrelated_write", "/oracle/same_key_retry", "/forbidden"],
  storage007: ["/oracle/idempotency/conflicts", "/oracle/idempotency/business_write_count", "/forbidden"],
  inventory006: ["/preview/data_revision_stale_zero_write", "/preview/caller_state_untrusted", "/scope_limitation"],
} as const;
const SCOPE_LIMITATIONS = {
  "CASE-EFFECT-002": "The matrix freezes the design-authoritative late EffectBundle rollback seams; it does not claim an executable public catalog case.",
  "CASE-STORAGE-005": "The matrix covers only current migration publication and rejection, not a full upgrade or backup-restore product.",
  "CASE-INVENTORY-006": "The matrix covers stale preview/revision rejection only, not a complete IssueResolution interaction.",
};
const count = (value: number, unchanged: boolean) => ({ count: value, unchanged_from_pre_fault: unchanged });
const postRetry = (values: readonly (number | null)[]) => ({ outbox_terminal_count: values[0], outbox_attempt_count: values[1], fact_event_records: values[2], fact_meal_items: values[3], terminal_effect_bundle_count: values[4], daily_progress_snapshot_count: values[5], envelope_finalization_count: values[6], success_receipt_count: values[7] });
function expectedRow(case_id: string, fault_id: string, operation_kind: string, fault_point: string, expected_error_code: string, failed_state: string, outbox_state: string, group: "effect001" | "effect002" | "effect003" | "migration" | "storage006" | "storage007" | "inventory006"): Row {
  const effect = group.startsWith("effect");
  const finalizer = group === "effect003";
  const migration = group === "migration";
  const existing = fault_point === "unknown_existing_database" || fault_point === "drifted_v1_index";
  const facts = finalizer ? { event_records: 1, meal_items: 1, effect_bundle_commits: 1, unchanged_from_pre_fault: true } : group === "storage006" ? { event_records: 0, meal_items: 0, effect_bundle_commits: 1, unchanged_from_pre_fault: true } : effect ? { event_records: 1, meal_items: 1, effect_bundle_commits: 0, unchanged_from_pre_fault: false } : { event_records: 0, meal_items: 0, effect_bundle_commits: 0, unchanged_from_pre_fault: existing || group === "storage007" };
  const checkpoint = finalizer || group === "storage006";
  const observations = {
    command_envelope: finalizer ? { state: "effects_stable", result_status: "effects_stable" } : effect ? { state: "effects_pending", result_status: "facts_committed_effects_pending" } : group === "storage006" || group === "storage007" ? { state: "finalized", result_status: "terminal" } : { state: "not_applicable", result_status: "not_applicable" },
    outbox: finalizer ? { state: "succeeded", attempt_count: 1, reason: null, count: 4 } : group === "effect001" ? { state: "retryable_failed", attempt_count: 1, reason: "NUTRITION_EFFECT_WRITE_FAILED", count: 2 } : group === "effect002" ? { state: "retryable_failed", attempt_count: 1, reason: "MEAL_EFFECT_FAILED", count: 4 } : { state: "not_applicable", attempt_count: 0, reason: null, count: 0 },
    facts,
    effect_bundle_checkpoints: count(checkpoint ? 1 : 0, checkpoint),
    inventory_transactions: count(finalizer ? 1 : 0, finalizer || existing || group === "storage006" || group === "storage007"),
    nutrition_profiles: count(finalizer ? 1 : 0, finalizer || existing || group === "storage006" || group === "storage007"),
    nutrition_snapshots: count(finalizer ? 1 : 0, finalizer || existing || group === "storage006" || group === "storage007"),
    issues: count(0, finalizer || existing || group === "storage006" || group === "storage007"),
    daily_progress_snapshots: count(0, existing || group === "storage006" || group === "storage007"),
    envelope_finalizations: count(group === "storage006" ? 1 : 0, existing || group === "storage006" || group === "storage007"),
    success_receipts: count(group === "storage006" ? 1 : 0, existing || group === "storage006" || group === "storage007"),
  };
  const retry = group === "effect001" ? postRetry([2, 2, 1, 1, 1, 1, 1, 1]) : group === "effect002" ? postRetry([4, 2, 1, 1, 1, 1, 1, 1]) : finalizer ? postRetry([4, 1, 1, 1, 1, 1, 1, 1]) : group === "storage006" ? postRetry([null, null, 0, 0, 1, 0, 1, 1]) : postRetry([null, null, 0, 0, 0, 0, 0, 0]);
  const pathKey = group === "migration" ? "storage005" : group;
  return {
    case_id, fault_id, operation_kind, fault_point, expected_error_code, failed_state, outbox_state, observations,
    restart: { sqlite_reopen_state: finalizer || effect ? "same_as_failure" : migration ? existing ? "existing_bytes_unchanged" : "candidate_absent" : group === "storage006" ? "terminal_payload_frozen" : group === "storage007" ? "original_terminal_unchanged" : "candidate_change_preserved", only_unfinished_stage_may_change: true, completed_effects_repeated: false },
    same_token_retry: { action: effect ? finalizer ? "finalize_only" : "retry_effect_bundle" : migration ? existing ? "reject_existing_identity" : "fresh_candidate_required" : group === "storage006" ? "return_exact_original_result" : group === "storage007" ? "reject_conflict" : "require_fresh_preview", business_writes: effect ? finalizer ? "finalizer_only" : "only_unfinished_stage" : "none", completed_effects_repeated: false, finalizations_added: effect ? 1 : 0, frozen_result_bytes_unchanged: true, post_retry: retry },
    diagnostic: { stage: effect ? finalizer ? "EnvelopeFinalize" : "EffectBundle" : migration ? existing ? "StorageOpen" : "StorageMigration" : group === "storage006" ? "EnvelopeFinalize" : group === "storage007" ? "Idempotency" : "PreviewAuthority", error_code: group === "effect001" ? "NUTRITION_EFFECT_WRITE_FAILED" : group === "effect002" ? "MEAL_EFFECT_FAILED" : finalizer ? "ENVELOPE_FINALIZE_FAILED" : migration ? existing ? "STORAGE_IDENTITY_INVALID" : "STORAGE_MIGRATION_FAILED" : group === "storage006" ? "ENVELOPE_FINALIZE_RESPONSE_LOST" : group === "storage007" ? "IDEMPOTENCY_CONFLICT" : "STALE_REVISION", trace_id: migration ? "not_applicable" : "required", input_digest: migration ? "not_applicable" : "required", forbidden_content: ["source_text", "sql", "secret", "absolute_path"] },
    frozen_result: { present: group === "storage006" || group === "storage007", payload_bytes_unchanged: true, returns_old_result_as_new: false, date_order: group === "storage006" ? ["2026-08-08", "2026-08-09"] : [], single_day_alias_present: group === "storage006" ? false : null },
    forbidden: group === "effect001" ? ["fact_commit_rollback", "half_effect_bundle"] : group === "effect002" ? ["partial_effect_bundle"] : finalizer ? ["duplicate_effect", "premature_receipt"] : migration ? [existing ? "existing_database_bytes_changed" : "candidate_database_published"] : group === "storage006" ? ["retry_recomputed_from_current_totals"] : group === "storage007" ? ["business_write_on_conflict"] : ["stale_selection_accepted"],
    assertion_paths: PATHS[pathKey],
  };
}
const EXPECTED_ROWS = [
  expectedRow("CASE-EFFECT-001", "effect-001-after-nutrition", "record_meal", "after_nutrition", "nutrition_effect_write_failed", "effects_pending", "retryable_failed", "effect001"),
  expectedRow("CASE-EFFECT-002", "effect-002-after-inventory-write", "record_meal", "after_inventory_write", "effect_bundle_write_failed", "effects_pending", "retryable_failed", "effect002"),
  expectedRow("CASE-EFFECT-002", "effect-002-after-issue-write", "record_meal", "after_issue_write", "effect_bundle_write_failed", "effects_pending", "retryable_failed", "effect002"),
  expectedRow("CASE-EFFECT-002", "effect-002-after-progress-contribution-prepared", "record_meal", "after_progress_contribution_prepared", "effect_bundle_write_failed", "effects_pending", "retryable_failed", "effect002"),
  ...["after_finalization_row", "after_envelope", "after_idempotency", "before_commit"].map((point) => expectedRow("CASE-EFFECT-003", `effect-003-${point.replaceAll("_", "-")}`, "record_meal", point, "envelope_finalize_write_failed", "effects_stable", "succeeded", "effect003")),
  expectedRow("CASE-STORAGE-005", "storage-005-after-schema", "migration_bootstrap", "after_schema", "storage_migration_failed", "migration_rejected", "not_applicable", "migration"),
  expectedRow("CASE-STORAGE-005", "storage-005-before-history", "migration_bootstrap", "before_history", "storage_migration_failed", "migration_rejected", "not_applicable", "migration"),
  expectedRow("CASE-STORAGE-005", "storage-005-before-commit", "migration_bootstrap", "before_commit", "storage_migration_failed", "migration_rejected", "not_applicable", "migration"),
  expectedRow("CASE-STORAGE-005", "storage-005-unknown-existing-database", "migration_bootstrap", "unknown_existing_database", "storage_identity_invalid", "migration_rejected", "not_applicable", "migration"),
  expectedRow("CASE-STORAGE-005", "storage-005-drifted-v1-index", "migration_bootstrap", "drifted_v1_index", "storage_identity_invalid", "migration_rejected", "not_applicable", "migration"),
  expectedRow("CASE-STORAGE-006", "storage-006-after-commit-before-reply", "record_multi_date", "after_commit_before_reply", "response_lost", "terminal_frozen", "not_applicable", "storage006"),
  ...["digest", "subject", "command"].map((kind) => expectedRow("CASE-STORAGE-007", `storage-007-changed-${kind}`, "record_meal", `changed_${kind}`, "idempotency_conflict", "idempotency_conflict", "not_applicable", "storage007")),
  expectedRow("CASE-INVENTORY-006", "inventory-006-preview-data-revision-changed", "confirm_inventory_selection", "preview_data_revision_changed", "stale_revision", "stale_revision_rejected", "not_applicable", "inventory006"),
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function firstDifference(actual: unknown, expected: unknown, path = "$ "): string | null {
  if (Object.is(actual, expected)) return null;
  if (typeof actual !== "object" || actual === null || typeof expected !== "object" || expected === null) return path;
  const actualKeys = Object.keys(actual as object);
  const expectedKeys = Object.keys(expected as object);
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) return `${path}.keys`;
  for (const key of actualKeys) {
    const difference = firstDifference((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${path}.${key}`);
    if (difference !== null) return difference;
  }
  return null;
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
    assert.deepEqual(keys((row.same_token_retry as Record<string, unknown>).post_retry), POST_RETRY_KEYS, `B_FAULT_POST_RETRY_INVALID:${row.fault_id}`);
    assert.deepEqual(keys(row.diagnostic), DIAGNOSTIC_KEYS, `B_FAULT_DIAGNOSTIC_INVALID:${row.fault_id}`);
    assert.deepEqual((row.diagnostic as Record<string, unknown>).forbidden_content, ["source_text", "sql", "secret", "absolute_path"]);
    assert.deepEqual(keys(row.frozen_result), ["present", "payload_bytes_unchanged", "returns_old_result_as_new", "date_order", "single_day_alias_present"], `B_FAULT_FROZEN_RESULT_INVALID:${row.fault_id}`);
    assert.equal(Array.isArray(row.assertion_paths) && row.assertion_paths.length > 0, true, `B_FAULT_PATHS_MISSING:${row.fault_id}`);
  }

  for (const caseId of ["CASE-EFFECT-002", "CASE-STORAGE-005", "CASE-INVENTORY-006"]) {
    assert.equal(typeof matrix.scope_limitations[caseId], "string", `B_FAULT_SCOPE_LIMITATION_MISSING:${caseId}`);
    assert.notEqual(matrix.scope_limitations[caseId], "", `B_FAULT_SCOPE_LIMITATION_EMPTY:${caseId}`);
  }
  assert.deepEqual(matrix.case_assertion_paths, {
    "CASE-EFFECT-001": PATHS.effect001,
    "CASE-EFFECT-002": PATHS.effect002,
    "CASE-EFFECT-003": PATHS.effect003,
    "CASE-STORAGE-005": PATHS.storage005,
    "CASE-STORAGE-006": PATHS.storage006,
    "CASE-STORAGE-007": PATHS.storage007,
    "CASE-INVENTORY-006": PATHS.inventory006,
  }, "B_FAULT_CASE_ASSERTION_PATHS_INVALID");
  assert.deepEqual(matrix.scope_limitations, SCOPE_LIMITATIONS, "B_FAULT_SCOPE_LIMITATIONS_INVALID");
  assert.equal(firstDifference(matrix.fault_rows, EXPECTED_ROWS), null, "B_FAULT_VALUES_INVALID");

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
    ["illegal state", (candidate) => { candidate.fault_rows[0].failed_state = "invented_state"; }],
    ["empty error code", (candidate) => { candidate.fault_rows[0].expected_error_code = ""; }],
    ["restart inner field missing", (candidate) => { delete (candidate.fault_rows[0].restart as Record<string, unknown>).sqlite_reopen_state; }],
    ["retry inner field missing", (candidate) => { delete (candidate.fault_rows[0].same_token_retry as Record<string, unknown>).action; }],
    ["frozen result omitted", (candidate) => { delete candidate.fault_rows[13].frozen_result; }],
    ["assertion path missing", (candidate) => { (candidate.fault_rows[0].assertion_paths as string[]).pop(); }],
    ["storage error drift", (candidate) => { candidate.fault_rows[8].expected_error_code = "wrong"; }],
    ["storage state drift", (candidate) => { candidate.fault_rows[8].failed_state = "effects_pending"; }],
    ["storage observation drift", (candidate) => { ((candidate.fault_rows[8].observations as Record<string, unknown>).facts as Record<string, unknown>).event_records = 1; }],
    ["storage retry drift", (candidate) => { ((candidate.fault_rows[8].same_token_retry as Record<string, unknown>).post_retry as Record<string, unknown>).success_receipt_count = 1; }],
    ["inventory checkpoint drift", (candidate) => { ((candidate.fault_rows[17].observations as Record<string, unknown>).effect_bundle_checkpoints as Record<string, unknown>).count = 1; }],
    ["storage006 date drift", (candidate) => { (candidate.fault_rows[13].frozen_result as Record<string, unknown>).date_order = []; }],
    ["storage006 alias drift", (candidate) => { (candidate.fault_rows[13].frozen_result as Record<string, unknown>).single_day_alias_present = true; }],
    ["diagnostic stage drift", (candidate) => { (candidate.fault_rows[0].diagnostic as Record<string, unknown>).stage = "wrong"; }],
    ["diagnostic error drift", (candidate) => { (candidate.fault_rows[0].diagnostic as Record<string, unknown>).error_code = "wrong"; }],
    ["diagnostic leaks path constraint", (candidate) => { (candidate.fault_rows[0].diagnostic as Record<string, unknown>).forbidden_content = []; }],
  ];
  for (const [name, mutate] of mutations) {
    const candidate = clone(matrix);
    mutate(candidate);
    assert.throws(() => assertMatrix(candidate), undefined, `B_FAULT_MUTATION_ACCEPTED:${name}`);
  }
});
