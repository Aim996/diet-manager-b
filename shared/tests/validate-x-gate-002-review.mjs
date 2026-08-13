import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const node = process.execPath;
const templatePath = resolve(root, "shared", "selected-route-map.template.json");
const localMapPath = resolve(root, "shared", "selected-route-map.json");
const matrixPath = resolve(root, "docs", "work-items", "X-GATE-002-matrix.json");
const validatorPath = resolve(root, "shared", "tests", "validate-x-gate-002.mjs");

test("ships a portable template while keeping the absolute map local", () => {
  assert.equal(existsSync(templatePath), true, "portable template absent");
  const template = JSON.parse(readFileSync(templatePath, "utf8"));
  assert.equal(template.schema_version, "diet-manager/selected-route-map-template/v1");
  assert.equal(template.selected_route_root, "version-b-lite-plugin");
  for (const task of template.task_paths) {
    for (const path of task.paths) assert.equal(isAbsolute(path), false, path);
  }
  assert.equal(execFileSync("git", ["ls-files", "--error-unmatch", "shared/selected-route-map.template.json"], { cwd: root, encoding: "utf8" }).trim(), "shared/selected-route-map.template.json");
  assert.throws(() => execFileSync("git", ["ls-files", "--error-unmatch", "shared/selected-route-map.json"], { cwd: root, stdio: "pipe" }));
  assert.match(execFileSync("git", ["check-ignore", "-v", "shared/selected-route-map.json"], { cwd: root, encoding: "utf8" }), /selected-route-map\.json/u);
});

test("freezes exact prerequisite and formal-build requirements", () => {
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
  assert.equal(matrix.schema_version, "diet-manager/x-gate-002-matrix/v2");
  assert.deepEqual(matrix.prerequisite_requirements, [
    { task_id: "X-GATE-001", required_result: "pass_b_safety", commit: "40f7b608f72935becd7628dd89ef4cf7f515c05b", evidence_id: "EV-20260812-030" },
    { task_id: "B-SLICE-001", required_result: "PASS", commit: "c8e6bcef39d0f98452432c3331095d963b9b9778", evidence_id: "EV-20260812-031" },
    { task_id: "B-FAULT-001", required_result: "DONE_WITH_CONCERNS", commit: "552feee374fe3463f296bd4a110af11747a7ee29", evidence_id: "EV-20260812-032" },
    { task_id: "SH-TRACE-001", required_result: "PASS", commit: "96cba14646e2cee46ed45fe3711eb061f59b6c0e", evidence_id: "EV-20260813-035" },
  ]);
  assert.deepEqual(matrix.formal_build_provenance_requirement, {
    execution_count: 1,
    command: "node_modules/typescript/bin/tsc -p tsconfig.json",
    node_version: "v24.15.0",
    started_at_utc: "2026-08-13T16:49:36.8876349Z",
    ended_at_utc: "2026-08-13T16:49:40.6122966Z",
    reexecution_forbidden_in_review_fix: true,
    reexecuted_during_review_fix: false,
    source_candidate_commit: "b4c5010f969408ec6cdf564e3eaec65d28abe82b",
    artifact_commit: "93d1fabcc2c90f42cb2ea295515d9636721b2c08",
    task9_final_commit: "01e2b7b9d681ddc6dc0bcd15970dfc6de1ad801c",
    artifacts: [
      { path: "version-b-lite-plugin/dist/contracts.js", bytes: 2410, sha256: "C4AEF28FFC88C91D495AC0C9F2D756BA6B33A9994E9555067E05F08ED9BE7AC5" },
      { path: "version-b-lite-plugin/dist/index.js", bytes: 173, sha256: "AE609D468FEAB0D62192F3991C2F9A81B2A0514CD3A753576B73118ADA78DBBE" },
    ],
  });
  assert.ok(matrix.required_checks.length >= 6);
  for (const check of matrix.required_checks) assert.equal(Object.hasOwn(check, "result"), false, check.check_id);
});

test("validates a published local map when present and exercises semantic mutations", () => {
  const result = spawnSync(node, [validatorPath], { cwd: root, encoding: "utf8", timeout: 120_000 });
  if (existsSync(localMapPath)) {
    assert.equal(result.status, 0);
    assert.match(result.stdout, /decision=bind_b_ready/u);
  } else {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /X_GATE_LOCAL_MAP_ABSENT/u);
  }
  const output = execFileSync(node, [validatorPath, "--self-test"], { cwd: root, encoding: "utf8", timeout: 120_000 });
  assert.match(output, /collisions=1/u);
  assert.match(output, /plan_mutations=4/u);
  assert.match(output, /command_failures=1/u);
  assert.match(output, /prerequisite_mutations=5/u);
  assert.match(output, /identity_mutations=18/u);
  assert.match(output, /state_reparse_mutations=1/u);
});
