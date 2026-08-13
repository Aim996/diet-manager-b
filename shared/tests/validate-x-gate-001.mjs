import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const matrixPath = resolve(projectRoot, "docs", "work-items", "X-GATE-001-matrix.json");
const protectedPaths = new Set([
  "shared/contracts/data-model.md",
  "shared/schemas/domain.schema.json",
  "shared/schemas/fixtures/domain-cases.json",
  "shared/tests/validate-domain-schema.mjs",
  "shared/tests/validate-domain-schema.ps1",
]);
const expectedCases = [
  "CASE-STORAGE-001",
  "CASE-STORAGE-002",
  "CASE-STORAGE-004",
  "CASE-STORAGE-005",
  "CASE-STORAGE-006",
  "CASE-STORAGE-007",
  "CASE-EFFECT-003",
  "CASE-FOUNDATION-002",
  "CASE-INVENTORY-007",
  "CASE-PURCHASE-001",
  "CASE-QUERY-003",
  "CASE-INVENTORY-001",
  "CASE-INVENTORY-004",
];
const expectedChecks = [
  "typescript_no_emit",
  "typescript_build",
  "b_full_vitest_69",
  "repository_concurrency_recovery",
  "openclaw_plugin_local_no_model",
  "traceability_29_evidence_7_mutations",
  "protected_secret_official_residual_boundary",
];
const expectedDependencies = [
  ["B-STOR-001", "71cc68b7649604b76cb27b253a673347012ca4f0", "EV-20260812-027"],
  ["B-MERGE-C-001", "0184ac8eb53583db1e95a4c55fa146a0dfca58cf", "EV-20260812-028"],
  ["B-STOR-002", "d66c55ce5c734eaaa18625e8cf706a91c5eb8e9b", "EV-20260812-029"],
];

function fail(code, detail = "") {
  throw new Error(`${code}${detail ? `:${detail}` : ""}`);
}

function exactKeys(value, expected, code) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), code);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}

function git(...args) {
  return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", windowsHide: true }).trim();
}

function validateMatrix(matrix, { checkRepository = true } = {}) {
  exactKeys(matrix, [
    "schema_version", "gate_id", "route", "scope", "candidate_implementation_commit",
    "closure_commit", "dependencies", "cases", "checks", "decision", "authorized_next",
    "forbidden_claims",
  ], "X_GATE_TOP_LEVEL_SHAPE");
  assert.equal(matrix.schema_version, "diet-manager/x-gate-001-matrix/v1");
  assert.equal(matrix.gate_id, "X-GATE-001");
  assert.equal(matrix.route, "B");
  assert.equal(matrix.scope, "g1_storage_responsibility_only");
  assert.equal(matrix.candidate_implementation_commit, "d66c55ce5c734eaaa18625e8cf706a91c5eb8e9b");
  assert.equal(matrix.closure_commit, "40f7b608f72935becd7628dd89ef4cf7f515c05b");

  assert.equal(matrix.dependencies.length, expectedDependencies.length, "X_GATE_DEPENDENCY_COUNT");
  matrix.dependencies.forEach((dependency, index) => {
    exactKeys(dependency, ["task_id", "implementation_commit", "evidence_id", "evidence_path", "evidence_sha256"], "X_GATE_DEPENDENCY_SHAPE");
    assert.deepEqual(
      [dependency.task_id, dependency.implementation_commit, dependency.evidence_id],
      expectedDependencies[index],
      "X_GATE_DEPENDENCY_IDENTITY",
    );
    if (!/^[A-F0-9]{64}$/.test(dependency.evidence_sha256)) fail("X_GATE_EVIDENCE_SHA_FORMAT", dependency.evidence_id);
    if (checkRepository) {
      const path = resolve(projectRoot, dependency.evidence_path);
      assert.equal(sha256(path), dependency.evidence_sha256, `X_GATE_EVIDENCE_SHA:${dependency.evidence_id}`);
      execFileSync("git", ["merge-base", "--is-ancestor", dependency.implementation_commit, "HEAD"], {
        cwd: projectRoot,
        windowsHide: true,
        stdio: "ignore",
      });
    }
  });

  assert.deepEqual(matrix.cases.map((item) => item.case_id), expectedCases, "X_GATE_CASE_SET_OR_ORDER");
  assert.equal(new Set(matrix.cases.map((item) => item.case_id)).size, expectedCases.length, "X_GATE_CASE_DUPLICATE");
  for (const item of matrix.cases) {
    exactKeys(item, ["case_id", "result", "evidence_ids", "oracle_refs", "proved"], "X_GATE_CASE_SHAPE");
    assert.equal(item.result, "pass", `X_GATE_CASE_RESULT:${item.case_id}`);
    if (!Array.isArray(item.evidence_ids) || item.evidence_ids.length === 0) fail("X_GATE_CASE_EVIDENCE_EMPTY", item.case_id);
    if (item.evidence_ids.some((id) => !["EV-20260812-027", "EV-20260812-028", "EV-20260812-029"].includes(id))) {
      fail("X_GATE_CASE_BORROWED_EVIDENCE", item.case_id);
    }
    if (!Array.isArray(item.oracle_refs) || item.oracle_refs.length === 0 || item.oracle_refs.some((value) => typeof value !== "string" || value.length < 12)) {
      fail("X_GATE_CASE_ORACLE_EMPTY", item.case_id);
    }
    if (typeof item.proved !== "string" || item.proved.length < 12) fail("X_GATE_CASE_PROOF_EMPTY", item.case_id);
  }

  assert.deepEqual(matrix.checks.map((item) => item.check_id), expectedChecks, "X_GATE_CHECK_SET_OR_ORDER");
  for (const check of matrix.checks) {
    exactKeys(check, ["check_id", "result"], "X_GATE_CHECK_SHAPE");
    assert.equal(check.result, "pass", `X_GATE_CHECK_RESULT:${check.check_id}`);
  }
  assert.equal(matrix.decision, "pass_b_safety");
  assert.deepEqual(matrix.authorized_next, ["B-SLICE-001"]);
  assert.deepEqual(matrix.forbidden_claims, ["G2", "G3", "installable", "product_ready", "complete_skill"]);

  if (checkRepository) {
    execFileSync("git", ["merge-base", "--is-ancestor", matrix.candidate_implementation_commit, "HEAD"], {
      cwd: projectRoot,
      windowsHide: true,
      stdio: "ignore",
    });
    execFileSync("git", ["merge-base", "--is-ancestor", matrix.closure_commit, "HEAD"], {
      cwd: projectRoot,
      windowsHide: true,
      stdio: "ignore",
    });
    const changed = new Set([
      ...git("diff", "--name-only", `${matrix.closure_commit}...HEAD`).split(/\r?\n/u).filter(Boolean),
      ...git("diff", "--name-only").split(/\r?\n/u).filter(Boolean),
      ...git("diff", "--cached", "--name-only").split(/\r?\n/u).filter(Boolean),
      ...git("ls-files", "--others", "--exclude-standard").split(/\r?\n/u).filter(Boolean),
    ]);
    for (const path of changed) {
      if (protectedPaths.has(path.replaceAll("\\", "/"))) fail("X_GATE_PROTECTED_PATH_CHANGED", path);
    }
    const publicEntry = git("show", `${matrix.closure_commit}:version-b-lite-plugin/src/index.ts`);
    if (!publicEntry.includes("foundation_not_implemented")) fail("X_GATE_PUBLIC_ENTRY_WRITE_ENABLED");
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectMutationFailure(matrix, mutate, label) {
  const candidate = clone(matrix);
  mutate(candidate);
  let rejected = false;
  try {
    validateMatrix(candidate, { checkRepository: false });
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, `X_GATE_MUTATION_NOT_REJECTED:${label}`);
}

const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
validateMatrix(matrix);

let mutations = 0;
if (process.argv.includes("--self-test")) {
  const variants = [
    ["missing_case", (value) => value.cases.pop()],
    ["failed_case", (value) => { value.cases[0].result = "fail"; }],
    ["borrowed_evidence", (value) => { value.cases[0].evidence_ids = ["EV-A-FAKE"]; }],
    ["failed_check", (value) => { value.checks[0].result = "fail"; }],
    ["wrong_decision", (value) => { value.decision = "return_to_b_storage"; }],
    ["extra_next", (value) => { value.authorized_next.push("X-GATE-002"); }],
  ];
  for (const [label, mutate] of variants) {
    expectMutationFailure(matrix, mutate, label);
    mutations += 1;
  }
}

console.log(`X_GATE_001|PASS|cases=${matrix.cases.length}|checks=${matrix.checks.length}|decision=${matrix.decision}|mutations=${mutations}`);
