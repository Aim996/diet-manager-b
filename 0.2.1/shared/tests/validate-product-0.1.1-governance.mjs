import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
for (const name of ["总功能开发计划.md", "总功能开发计划0.2.md", "总功能开发计划0.3.md", "总功能开发计划0.4.md"]) {
  assert.equal(existsSync(resolve(root, name)), false, "GOVERNANCE_ROOT_LEGACY_PLAN:" + name);
  assert.equal(existsSync(resolve(root, "docs", "archive", "legacy-plans", name)), true);
}
const ledger = JSON.parse(readFileSync(resolve(root, "docs", "work-items", "PRODUCT-0.1.1-ledger.json"), "utf8"));
assert.equal(ledger.product_version, "0.1.1");
assert.deepEqual(ledger.stages.map((stage) => stage.id), [0, 1, 2, 3, 4, 5]);
assert.ok(ledger.stages.every((stage) => ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "DONE"].includes(stage.status)));
assert.equal(ledger.stages.filter((stage) => stage.status === "IN_PROGRESS").length, 1);
for (const path of ["README.md", "START-HERE.md", "docs/开发进度.md"]) {
  const text = readFileSync(resolve(root, path), "utf8");
  assert.match(text, /饮食管家-开发约束与需求-v1\.0\.md/u);
  assert.doesNotMatch(text, /现行权威.{0,40}总功能开发计划0?\.?[234]?\.md/u);
}
