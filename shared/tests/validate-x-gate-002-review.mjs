import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  assert.equal(existsSync(localMapPath), true, "local gate map absent");
});

test("keeps matrix checks as portable requirements and exercises publish/plan mutations", () => {
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
  assert.equal(matrix.schema_version, "diet-manager/x-gate-002-matrix/v2");
  assert.ok(matrix.required_checks.length >= 6);
  for (const check of matrix.required_checks) assert.equal(Object.hasOwn(check, "result"), false, check.check_id);
  const output = execFileSync(node, [validatorPath, "--self-test"], { cwd: root, encoding: "utf8", timeout: 120_000 });
  assert.match(output, /collisions=1/u);
  assert.match(output, /plan_mutations=4/u);
  assert.match(output, /command_failures=1/u);
});
