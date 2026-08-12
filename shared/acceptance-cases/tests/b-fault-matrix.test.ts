import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const acceptanceRoot = resolve(testsDirectory, "..");
const projectRoot = resolve(acceptanceRoot, "..", "..");
const matrixPath = resolve(acceptanceRoot, "b-fault-matrix.json");
const manifestPath = resolve(acceptanceRoot, "harness-manifest.json");

const CASE_ORDER = [
  "CASE-EFFECT-001",
  "CASE-EFFECT-002",
  "CASE-EFFECT-003",
  "CASE-STORAGE-005",
  "CASE-STORAGE-006",
  "CASE-STORAGE-007",
  "CASE-INVENTORY-006",
] as const;

const EXPECTED_FAULT_IDS = [
  "effect_bundle_nutrition_snapshot_write",
  "effect_bundle_late_write",
  "envelope_finalize_write",
  "migration_candidate_publish",
  "terminal_response_lost",
  "idempotency_identity_conflict",
  "preview_revision_stale",
] as const;

const EXPECTED_ASSERTION_PATHS: Record<(typeof CASE_ORDER)[number], string[]> = {
  "CASE-EFFECT-001": [
    "/oracle/failure",
    "/oracle/state_after_restart",
    "/oracle/same_key_retry",
    "/forbidden",
  ],
  "CASE-EFFECT-002": [
    "/effect_bundle/late_failure_full_rollback",
    "/restart/effects_pending",
    "/same_token_retry/missing_effect_only",
    "/forbidden",
  ],
  "CASE-EFFECT-003": [
    "/oracle/failure",
    "/oracle/state_after_restart",
    "/oracle/same_key_retry",
    "/forbidden",
  ],
  "CASE-STORAGE-005": [
    "/migration/failure_keeps_final_unpublished",
    "/migration/failure_keeps_user_version_unadvanced",
    "/scope_limitation",
  ],
  "CASE-STORAGE-006": [
    "/oracle/original_result",
    "/oracle/later_unrelated_write",
    "/oracle/same_key_retry",
    "/forbidden",
  ],
  "CASE-STORAGE-007": [
    "/oracle/idempotency/conflicts",
    "/oracle/idempotency/business_write_count",
    "/forbidden",
  ],
  "CASE-INVENTORY-006": [
    "/preview/data_revision_stale_zero_write",
    "/preview/caller_state_untrusted",
    "/scope_limitation",
  ],
};

const FAULT_KEYS = [
  "fault_id",
  "operation_kind",
  "fault_point",
  "expected_error_code",
  "failed_state",
  "outbox_state",
  "restart",
  "same_token_retry",
  "forbidden",
  "assertion_paths",
] as const;

const ALLOWED_FAILED_STATES = new Set([
  "effects_pending",
  "effects_stable",
  "migration_rejected",
  "terminal_frozen",
  "idempotency_conflict",
  "stale_revision_rejected",
]);

type Fault = {
  fault_id: string;
  operation_kind: string;
  fault_point: string;
  expected_error_code: string;
  failed_state: string;
  outbox_state: string;
  restart: Record<string, unknown>;
  same_token_retry: Record<string, unknown>;
  forbidden: string[];
  assertion_paths: string[];
};

type Matrix = {
  matrix_id: string;
  case_order: string[];
  cases: Array<{ case_id: string; faults: Fault[]; scope_limitation?: string }>;
  case_assertion_paths: Record<string, string[]>;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertMatrix(matrix: Matrix): void {
  assert.equal(matrix.matrix_id, "diet-manager/b-fault-matrix/v1");
  assert.deepEqual(matrix.case_order, CASE_ORDER, "B_FAULT_CASE_ORDER_INVALID");
  assert.deepEqual(
    matrix.cases.map((entry) => entry.case_id),
    CASE_ORDER,
    "B_FAULT_CASE_ROWS_INVALID",
  );
  assert.deepEqual(
    matrix.cases.map((entry) => entry.faults.length),
    [1, 1, 1, 1, 1, 1, 1],
    "B_FAULT_CASE_FAULT_COUNT_INVALID",
  );
  const faults = matrix.cases.map((entry) => entry.faults[0]);
  assert.deepEqual(
    faults.map((fault) => fault.fault_id),
    EXPECTED_FAULT_IDS,
    "B_FAULT_ORDER_INVALID",
  );
  assert.deepEqual(matrix.case_assertion_paths, EXPECTED_ASSERTION_PATHS, "B_FAULT_ASSERTION_PATHS_INVALID");

  for (const [index, fault] of faults.entries()) {
    assert.deepEqual(Object.keys(fault), FAULT_KEYS, `B_FAULT_ROW_KEYS_INVALID:${CASE_ORDER[index]}`);
    assert.equal(fault.operation_kind.length > 0, true, `B_FAULT_OPERATION_KIND_MISSING:${CASE_ORDER[index]}`);
    assert.equal(fault.fault_point.length > 0, true, `B_FAULT_POINT_MISSING:${CASE_ORDER[index]}`);
    assert.equal(fault.expected_error_code.length > 0, true, `B_FAULT_ERROR_CODE_MISSING:${CASE_ORDER[index]}`);
    assert.equal(ALLOWED_FAILED_STATES.has(fault.failed_state), true, `B_FAULT_STATE_INVALID:${CASE_ORDER[index]}`);
    assert.equal(fault.outbox_state.length > 0, true, `B_FAULT_OUTBOX_STATE_MISSING:${CASE_ORDER[index]}`);
    assert.equal(Object.keys(fault.restart).length > 0, true, `B_FAULT_RESTART_MISSING:${CASE_ORDER[index]}`);
    assert.equal(Object.keys(fault.same_token_retry).length > 0, true, `B_FAULT_RETRY_MISSING:${CASE_ORDER[index]}`);
    assert.equal(fault.forbidden.length > 0, true, `B_FAULT_FORBIDDEN_MISSING:${CASE_ORDER[index]}`);
    assert.deepEqual(fault.assertion_paths, EXPECTED_ASSERTION_PATHS[CASE_ORDER[index]], `B_FAULT_PATHS_INVALID:${CASE_ORDER[index]}`);
  }

  for (const caseId of ["CASE-EFFECT-002", "CASE-STORAGE-005", "CASE-INVENTORY-006"] as const) {
    const row = matrix.cases.find((entry) => entry.case_id === caseId);
    assert.equal(typeof row?.scope_limitation, "string", `B_FAULT_SCOPE_LIMITATION_MISSING:${caseId}`);
    assert.equal((row?.scope_limitation?.length ?? 0) > 0, true, `B_FAULT_SCOPE_LIMITATION_EMPTY:${caseId}`);
  }
}

function readMatrix(): Matrix {
  assert.equal(existsSync(matrixPath), true, "B_FAULT_MATRIX_MISSING");
  return JSON.parse(readFileSync(matrixPath, "utf8")) as Matrix;
}

test("freezes the seven-case B fault authority and manifest binding", () => {
  const matrix = readMatrix();
  assertMatrix(matrix);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    b_fault_matrix?: { path: string; matrix_id: string; case_count: number; sha256: string };
  };
  assert.deepEqual(manifest.b_fault_matrix?.path, "shared/acceptance-cases/b-fault-matrix.json");
  assert.equal(manifest.b_fault_matrix?.matrix_id, "diet-manager/b-fault-matrix/v1");
  assert.equal(manifest.b_fault_matrix?.case_count, CASE_ORDER.length);
  const bytes = readFileSync(resolve(projectRoot, manifest.b_fault_matrix!.path));
  const actual = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  assert.equal(actual, manifest.b_fault_matrix?.sha256, "B_FAULT_MATRIX_HASH_INVALID");

  const cases = JSON.parse(readFileSync(resolve(acceptanceRoot, "cases.json"), "utf8")) as {
    cases: Array<{ id: string; oracle?: { failure?: { envelope_status?: string } } }>;
  };
  const effect003 = cases.cases.find((entry) => entry.id === "CASE-EFFECT-003");
  assert.equal(effect003?.oracle?.failure?.envelope_status, "effects_stable");
});

test("rejects B fault authority mutations", () => {
  const matrix = readMatrix();
  const mutations: Array<[string, (candidate: Matrix) => void]> = [
    ["case missing", (candidate) => candidate.case_order.pop()],
    ["case extra", (candidate) => candidate.case_order.push("CASE-EXTRA-001")],
    ["case reordered", (candidate) => candidate.case_order.reverse()],
    ["fault missing", (candidate) => candidate.cases[0].faults.pop()],
    ["fault extra", (candidate) => candidate.cases[0].faults.push(clone(candidate.cases[0].faults[0]))],
    ["fault reordered", (candidate) => {
      const first = candidate.cases[0].faults[0];
      candidate.cases[0].faults[0] = candidate.cases[1].faults[0];
      candidate.cases[1].faults[0] = first;
    }],
    ["illegal state", (candidate) => { candidate.cases[0].faults[0].failed_state = "invented_state"; }],
    ["empty error code", (candidate) => { candidate.cases[0].faults[0].expected_error_code = ""; }],
    ["restart missing", (candidate) => { candidate.cases[0].faults[0].restart = {}; }],
    ["retry missing", (candidate) => { candidate.cases[0].faults[0].same_token_retry = {}; }],
    ["assertion path missing", (candidate) => candidate.cases[0].faults[0].assertion_paths.pop()],
  ];

  for (const [name, mutate] of mutations) {
    const candidate = clone(matrix);
    mutate(candidate);
    assert.throws(() => assertMatrix(candidate), undefined, `B_FAULT_MUTATION_ACCEPTED:${name}`);
  }
});
