#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const projectRoot = realpathSync.native(resolve(dirname(thisFile), "..", ".."));
const routeRoot = resolve(projectRoot, "version-b-lite-plugin");
const planPath = resolve(projectRoot, "总功能开发计划0.4.md");
const templatePath = resolve(projectRoot, "shared", "selected-route-map.template.json");
const localMapPath = resolve(projectRoot, "shared", "selected-route-map.json");
const matrixPath = resolve(projectRoot, "docs", "work-items", "X-GATE-002-matrix.json");
const tracePath = resolve(projectRoot, "shared", "traceability", "tasks.json");
const manifestPath = resolve(routeRoot, "openclaw.plugin.json");
const skillPath = resolve(routeRoot, "skills", "diet-manager-b", "SKILL.md");
const distEntryPath = resolve(routeRoot, "dist", "index.js");
const sddRoot = resolve(projectRoot, ".superpowers", "sdd", "2026-08-13-product-0.1-usable-skill");
const openClawStateRoot = resolve(sddRoot, "xgate-openclaw-state");

const expectedContract = Object.freeze({
  path: "shared/business-contract.md",
  id: "diet-manager/contract-v2",
  version: 2,
  sha256: "632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E",
  last_change_commit: "a6559f9728c46fbbddc30d5e187d824ad83493ff",
});
const evidencePaths = Object.freeze({
  "EV-20260812-030": "docs/evidence/EV-20260812-030-x-gate-001.md",
  "EV-20260812-031": "docs/evidence/EV-20260812-031-b-slice-001.md",
  "EV-20260812-032": "docs/evidence/EV-20260812-032-b-fault-001.md",
  "EV-20260813-034": "docs/evidence/EV-20260813-034-sh-trace-001-doc-0.4.md",
  "EV-20260813-035": "docs/evidence/EV-20260813-035-sh-trace-001-refresh.md",
});
const requiredCheckIds = Object.freeze([
  "focused_foundation_contract_root_skill",
  "typescript_no_emit",
  "source_dist_parity",
  "openclaw_plugin_build_check",
  "openclaw_plugin_validate",
  "x_gate_001_regression",
  "trace_validate",
  "trace_self_test",
]);
const expectedPrerequisiteRequirements = Object.freeze([
  { task_id: "X-GATE-001", required_result: "pass_b_safety", commit: "40f7b608f72935becd7628dd89ef4cf7f515c05b", evidence_id: "EV-20260812-030" },
  { task_id: "B-SLICE-001", required_result: "PASS", commit: "c8e6bcef39d0f98452432c3331095d963b9b9778", evidence_id: "EV-20260812-031" },
  { task_id: "B-FAULT-001", required_result: "DONE_WITH_CONCERNS", commit: "552feee374fe3463f296bd4a110af11747a7ee29", evidence_id: "EV-20260812-032" },
  { task_id: "SH-TRACE-001", required_result: "PASS", commit: "96cba14646e2cee46ed45fe3711eb061f59b6c0e", evidence_id: "EV-20260813-035" },
]);
const expectedFormalArtifacts = Object.freeze([
  { path: "version-b-lite-plugin/dist/contracts.js", bytes: 2410, sha256: "C4AEF28FFC88C91D495AC0C9F2D756BA6B33A9994E9555067E05F08ED9BE7AC5" },
  { path: "version-b-lite-plugin/dist/index.js", bytes: 173, sha256: "AE609D468FEAB0D62192F3991C2F9A81B2A0514CD3A753576B73118ADA78DBBE" },
]);
const expectedFormalBuildRequirement = Object.freeze({
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
  artifacts: expectedFormalArtifacts,
});
const inputHashPaths = Object.freeze([
  "version-b-lite-plugin/src/contracts.ts",
  "version-b-lite-plugin/src/index.ts",
  "version-b-lite-plugin/openclaw.plugin.json",
  "version-b-lite-plugin/skills/diet-manager-b/SKILL.md",
  "version-b-lite-plugin/dist/contracts.js",
  "version-b-lite-plugin/dist/index.js",
]);

class GateError extends Error {
  constructor(code, detail = "") {
    super(`${code}${detail ? `:${detail}` : ""}`);
    this.code = code;
  }
}

function fail(code, detail = "") {
  throw new GateError(code, detail);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function sha256(path) {
  return sha256Bytes(readFileSync(path));
}

function exactKeys(value, expected, code) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), code);
}

function isWithin(root, path) {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function assertOrdinaryExisting(path) {
  if (!existsSync(path)) fail("X_GATE_INPUT_MISSING", path);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) fail("X_GATE_INPUT_REPARSE", path);
  if (!stat.isFile() && !stat.isDirectory()) fail("X_GATE_INPUT_NOT_ORDINARY", path);
  if (realpathSync.native(path) !== path) fail("X_GATE_INPUT_NONCANONICAL_REALPATH", path);
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    fail("X_GATE_GIT_FAILED", `${args.join(" ")}:${result.error?.message ?? result.stderr.trim()}`);
  }
  return result;
}

function normalizePlanPath(token) {
  let value;
  if (token.startsWith("<selected_route_root>/")) {
    value = `version-b-lite-plugin/${token.slice("<selected_route_root>/".length)}`;
  } else if (token.startsWith("<project_root>/")) {
    value = token.slice("<project_root>/".length);
  } else {
    fail("X_GATE_PLAN_PATH_TOKEN", token);
  }
  if (value.includes("\\") || isAbsolute(value) || value.split("/").includes("..")) {
    fail("X_GATE_PLAN_PATH_INVALID", value);
  }
  return value;
}

export function parsePlanTaskPaths(planText) {
  const header = "### 29.6 B路线M5—M9交付物路径模板";
  const start = planText.indexOf(header);
  if (start < 0) fail("X_GATE_PLAN_SECTION_MISSING");
  const remainder = planText.slice(start + header.length);
  const next = remainder.search(/^### /mu);
  const section = next < 0 ? remainder : remainder.slice(0, next);
  const rows = [];
  const pattern = /^\| `([^`]+)` \| (.+) \|$/gmu;
  for (const match of section.matchAll(pattern)) {
    if (!match[1].startsWith("SEL-")) continue;
    const tokens = [...match[2].matchAll(/`(<(?:selected_route_root|project_root)>\/[^`]+)`/gu)].map((item) => item[1]);
    if (tokens.length === 0) fail("X_GATE_PLAN_TASK_PATH_EMPTY", match[1]);
    rows.push({ task_id: match[1], paths: tokens.map(normalizePlanPath) });
  }
  if (rows.length === 0) fail("X_GATE_PLAN_TABLE_EMPTY");
  if (new Set(rows.map((row) => row.task_id)).size !== rows.length) fail("X_GATE_PLAN_TASK_DUPLICATE");
  return rows;
}

function validateTemplate(template, planText) {
  exactKeys(template, ["schema_version", "gate_id", "selected_route", "project_root", "selected_route_root", "contract", "config", "task_paths", "forbidden_claims"], "X_GATE_TEMPLATE_SHAPE");
  assert.equal(template.schema_version, "diet-manager/selected-route-map-template/v1");
  assert.equal(template.gate_id, "X-GATE-002");
  assert.equal(template.selected_route, "B");
  assert.equal(template.project_root, ".");
  assert.equal(template.selected_route_root, "version-b-lite-plugin");
  assert.deepEqual(template.contract, expectedContract);
  assert.deepEqual(template.config, {
    key: "official_data_root",
    type: "string",
    required: true,
    semantics: "backend_owned_existing_absolute_runtime_root",
    gate_time_open_or_create: false,
  });
  assert.deepEqual(template.task_paths, parsePlanTaskPaths(planText), "X_GATE_TEMPLATE_PLAN_DRIFT");
  for (const task of template.task_paths) {
    for (const path of task.paths) {
      if (isAbsolute(path) || path.includes("\\") || path.split("/").includes("..")) fail("X_GATE_TEMPLATE_PATH_NONPORTABLE", path);
    }
  }
  assert.deepEqual(template.forbidden_claims, ["product_ready", "installable", "release", "G3"]);
}

function validateMatrix(matrix, template) {
  exactKeys(matrix, ["schema_version", "gate_id", "route", "scope", "decision_vocabulary", "portable_template", "local_map", "contract", "config_key", "prerequisite_requirements", "required_checks", "formal_build_provenance_requirement", "authorized_next_on_bind", "forbidden_claims"], "X_GATE_MATRIX_SHAPE");
  assert.equal(matrix.schema_version, "diet-manager/x-gate-002-matrix/v2");
  assert.equal(matrix.gate_id, "X-GATE-002");
  assert.equal(matrix.route, "B");
  assert.deepEqual(matrix.decision_vocabulary, ["bind_b_ready", "return_to_b_slice"]);
  assert.deepEqual(matrix.portable_template, { path: "shared/selected-route-map.template.json", root_semantics: "repository_relative" });
  assert.deepEqual(matrix.local_map, { path: "shared/selected-route-map.json", tracked: false, contains_machine_absolute_paths: true, publish: "same_volume_atomic_hard_link_no_replace" });
  assert.deepEqual(matrix.contract, expectedContract);
  assert.equal(matrix.config_key, "official_data_root");
  assert.deepEqual(matrix.prerequisite_requirements, expectedPrerequisiteRequirements, "X_GATE_PREREQUISITE_REQUIREMENTS");
  assert.deepEqual(matrix.required_checks.map((check) => check.check_id), requiredCheckIds);
  for (const check of matrix.required_checks) {
    exactKeys(check, ["check_id", "executor", "timeout_seconds"], "X_GATE_CHECK_REQUIREMENT_SHAPE");
    assert.equal(Number.isInteger(check.timeout_seconds) && check.timeout_seconds > 0 && check.timeout_seconds <= 120, true);
  }
  assert.deepEqual(matrix.formal_build_provenance_requirement, expectedFormalBuildRequirement, "X_GATE_FORMAL_BUILD_REQUIREMENT");
  assert.deepEqual(matrix.authorized_next_on_bind, ["SEL-CORE-001"]);
  assert.deepEqual(matrix.forbidden_claims, template.forbidden_claims);
}

function validateGitPolicy() {
  assert.equal(git(["ls-files", "--error-unmatch", "shared/selected-route-map.template.json"]).stdout.trim(), "shared/selected-route-map.template.json");
  assert.notEqual(git(["ls-files", "--error-unmatch", "shared/selected-route-map.json"], { allowFailure: true }).status, 0, "local map is tracked");
  assert.equal(git(["check-ignore", "-q", "shared/selected-route-map.json"], { allowFailure: true }).status, 0, "local map is not ignored");
}

function validateRuntimeIdentity(runtimeModule, pluginMetadata, manifest, skill) {
  const runtimeContract = { id: expectedContract.id, version: expectedContract.version, sha256: expectedContract.sha256 };
  assert.deepEqual(runtimeModule.dietManagerContract, runtimeContract, "X_GATE_RUNTIME_CONTRACT");
  assert.deepEqual(runtimeModule.dietManagerParameters?.["x-diet-manager-contract"], runtimeContract, "X_GATE_TOOL_CONTRACT");
  assert.deepEqual(pluginMetadata?.configSchema?.["x-diet-manager-contract"], runtimeContract, "X_GATE_CONFIG_CONTRACT");
  assert.deepEqual(manifest.configSchema, pluginMetadata?.configSchema, "X_GATE_MANIFEST_RUNTIME_DRIFT");
  assert.deepEqual(Object.keys(manifest.configSchema.properties ?? {}), ["official_data_root"]);
  assert.deepEqual(manifest.configSchema.required, ["official_data_root"]);
  assert.equal(manifest.configSchema.additionalProperties, false);
  assert.equal(manifest.configSchema.properties.official_data_root["x-diet-manager-root-semantics"], "backend_owned_existing_absolute_runtime_root");
  for (const token of [
    `contract_id=${expectedContract.id}`,
    `contract_version=${expectedContract.version}`,
    `contract_sha256=${expectedContract.sha256}`,
    "只有工具返回 `committed=true` 才能告诉用户“已记录”",
    "技术日志可以说明失败原因，但不属于饮食记录",
    "`official_data_root` 只由后端配置和管理",
  ]) assert.equal(skill.includes(token), true, `X_GATE_SKILL_BINDING:${token}`);
}

function validateFormalBuildArtifacts(matrix) {
  const requirement = matrix.formal_build_provenance_requirement;
  git(["merge-base", "--is-ancestor", requirement.source_candidate_commit, requirement.artifact_commit]);
  git(["merge-base", "--is-ancestor", requirement.artifact_commit, requirement.task9_final_commit]);
  git(["merge-base", "--is-ancestor", requirement.task9_final_commit, "HEAD"]);
  const artifacts = requirement.artifacts.map((item) => {
    const path = resolve(projectRoot, item.path);
    const stat = statSync(path);
    assert.equal(stat.size, item.bytes, `X_GATE_FORMAL_BUILD_SIZE:${item.path}`);
    assert.equal(sha256(path), item.sha256, `X_GATE_FORMAL_BUILD_SHA:${item.path}`);
    const committed = git(["show", `${requirement.artifact_commit}:${item.path}`]).stdout;
    assert.equal(sha256Bytes(Buffer.from(committed, "utf8")), item.sha256, `X_GATE_FORMAL_BUILD_COMMIT_DRIFT:${item.path}`);
    return { ...item, mtime_utc: stat.mtime.toISOString() };
  });
  return {
    mode: "task9_exactly_once",
    execution_count: requirement.execution_count,
    command: requirement.command,
    node_version: requirement.node_version,
    started_at_utc: requirement.started_at_utc,
    ended_at_utc: requirement.ended_at_utc,
    source_candidate_commit: requirement.source_candidate_commit,
    artifact_commit: requirement.artifact_commit,
    task9_final_commit: requirement.task9_final_commit,
    reexecuted_during_review_fix: requirement.reexecuted_during_review_fix,
    artifacts,
  };
}

function commandReceipt(checkId, executorIdentity, executable, args, cwd, timeoutSeconds, env = process.env) {
  const started = new Date();
  const startedNs = process.hrtime.bigint();
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutSeconds * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const ended = new Date();
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const receipt = {
    check_id: checkId,
    executor: executorIdentity,
    args,
    cwd_relative: relative(projectRoot, cwd).replaceAll("\\", "/") || ".",
    timeout_seconds: timeoutSeconds,
    started_at_utc: started.toISOString(),
    ended_at_utc: ended.toISOString(),
    duration_ms: Number((process.hrtime.bigint() - startedNs) / 1_000_000n),
    exit_code: result.status,
    signal: result.signal,
    stdout_sha256: sha256Bytes(stdout),
    stderr_sha256: sha256Bytes(stderr),
    stdout_last_line: stdout.trim().split(/\r?\n/u).at(-1) ?? "",
  };
  if (result.error || result.status !== 0) fail("X_GATE_PREFLIGHT_FAILED", `${checkId}:${result.error?.message ?? stderr.trim()}`);
  return receipt;
}

function internalReceipt(checkId, details) {
  const now = new Date().toISOString();
  return {
    check_id: checkId,
    executor: "validator_internal_hash_and_runtime",
    args: [],
    cwd_relative: ".",
    timeout_seconds: 5,
    started_at_utc: now,
    ended_at_utc: now,
    duration_ms: 0,
    exit_code: 0,
    signal: null,
    stdout_sha256: sha256Bytes(stableJson(details)),
    stderr_sha256: sha256Bytes(""),
    stdout_last_line: "SOURCE_DIST_PARITY|PASS",
  };
}

function expectedCommandShapes(matrix) {
  const checkById = Object.fromEntries(matrix.required_checks.map((check) => [check.check_id, check]));
  return {
    focused_foundation_contract_root_skill: { args: ["node_modules/vitest/vitest.mjs", "run", "tests/foundation.test.ts", "--maxWorkers=1", "--minWorkers=1", "--no-file-parallelism"], cwd_relative: "version-b-lite-plugin" },
    typescript_no_emit: { args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--noEmit"], cwd_relative: "version-b-lite-plugin" },
    source_dist_parity: { args: [], cwd_relative: "." },
    openclaw_plugin_build_check: { args: ["node_modules/openclaw/openclaw.mjs", "plugins", "build", "--check", "--root", ".", "--entry", "./dist/index.js"], cwd_relative: "version-b-lite-plugin" },
    openclaw_plugin_validate: { args: ["node_modules/openclaw/openclaw.mjs", "plugins", "validate", "--root", ".", "--entry", "./dist/index.js"], cwd_relative: "version-b-lite-plugin" },
    x_gate_001_regression: { args: ["shared/tests/validate-x-gate-001.mjs", "--self-test"], cwd_relative: "." },
    trace_validate: { args: ["shared/tests/validate-traceability.mjs"], cwd_relative: "." },
    trace_self_test: { args: ["shared/tests/validate-traceability.mjs", "--self-test"], cwd_relative: "." },
  };
}

function assertNonReparseChain(from, to) {
  const canonicalFrom = realpathSync.native(from);
  if (canonicalFrom !== from || !isWithin(canonicalFrom, to)) fail("X_GATE_STATE_ROOT_OUTSIDE");
  const remainder = relative(canonicalFrom, to).split(sep).filter(Boolean);
  let current = canonicalFrom;
  for (const component of remainder) {
    current = resolve(current, component);
    if (!existsSync(current)) break;
    const item = lstatSync(current);
    if (item.isSymbolicLink()) fail("X_GATE_STATE_CHAIN_REPARSE", current);
    if (!item.isDirectory()) fail("X_GATE_STATE_CHAIN_NOT_DIRECTORY", current);
    if (realpathSync.native(current) !== current) fail("X_GATE_STATE_CHAIN_NONCANONICAL", current);
  }
}

export function safeRemoveStateRoot(target = openClawStateRoot) {
  assertNonReparseChain(projectRoot, sddRoot);
  assertNonReparseChain(sddRoot, target);
  if (existsSync(target)) {
    assertNonReparseChain(sddRoot, target);
    const pending = [target];
    while (pending.length > 0) {
      const current = pending.pop();
      const item = lstatSync(current);
      if (item.isSymbolicLink()) fail("X_GATE_STATE_TREE_REPARSE", current);
      if (!item.isDirectory()) fail("X_GATE_STATE_TREE_NOT_DIRECTORY", current);
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const child = resolve(current, entry.name);
        const childItem = lstatSync(child);
        if (childItem.isSymbolicLink()) fail("X_GATE_STATE_TREE_REPARSE", child);
        if (childItem.isDirectory()) pending.push(child);
        else if (!childItem.isFile()) fail("X_GATE_STATE_TREE_NOT_ORDINARY", child);
      }
    }
    rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  if (existsSync(target)) fail("X_GATE_STATE_CLEANUP_FAILED");
}

function runPreflight(matrix, runtimeModule, pluginMetadata, manifest, skill) {
  if (process.version !== "v24.15.0") fail("X_GATE_NODE_VERSION", process.version);
  const checks = [];
  const node = process.execPath;
  const checkById = Object.fromEntries(matrix.required_checks.map((check) => [check.check_id, check]));
  checks.push(commandReceipt(
    "focused_foundation_contract_root_skill",
    checkById.focused_foundation_contract_root_skill.executor,
    node,
    ["node_modules/vitest/vitest.mjs", "run", "tests/foundation.test.ts", "--maxWorkers=1", "--minWorkers=1", "--no-file-parallelism"],
    routeRoot,
    checkById.focused_foundation_contract_root_skill.timeout_seconds,
  ));
  checks.push(commandReceipt(
    "typescript_no_emit",
    checkById.typescript_no_emit.executor,
    node,
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--noEmit"],
    routeRoot,
    checkById.typescript_no_emit.timeout_seconds,
  ));
  validateRuntimeIdentity(runtimeModule, pluginMetadata, manifest, skill);
  checks.push(internalReceipt("source_dist_parity", {
    contract: runtimeModule.dietManagerContract,
    dist_contracts_sha256: sha256(resolve(routeRoot, "dist", "contracts.js")),
    dist_index_sha256: sha256(resolve(routeRoot, "dist", "index.js")),
  }));

  safeRemoveStateRoot();
  mkdirSync(openClawStateRoot, { recursive: true });
  const openClawEnv = {
    ...process.env,
    OPENCLAW_STATE_DIR: openClawStateRoot,
    OPENCLAW_CONFIG_PATH: resolve(openClawStateRoot, "openclaw.json"),
    JITI_FS_CACHE: "false",
  };
  try {
    checks.push(commandReceipt(
      "openclaw_plugin_build_check",
      checkById.openclaw_plugin_build_check.executor,
      node,
      ["node_modules/openclaw/openclaw.mjs", "plugins", "build", "--check", "--root", ".", "--entry", "./dist/index.js"],
      routeRoot,
      checkById.openclaw_plugin_build_check.timeout_seconds,
      openClawEnv,
    ));
    checks.push(commandReceipt(
      "openclaw_plugin_validate",
      checkById.openclaw_plugin_validate.executor,
      node,
      ["node_modules/openclaw/openclaw.mjs", "plugins", "validate", "--root", ".", "--entry", "./dist/index.js"],
      routeRoot,
      checkById.openclaw_plugin_validate.timeout_seconds,
      openClawEnv,
    ));
  } finally {
    safeRemoveStateRoot();
  }
  checks.push(commandReceipt("x_gate_001_regression", checkById.x_gate_001_regression.executor, node, ["shared/tests/validate-x-gate-001.mjs", "--self-test"], projectRoot, checkById.x_gate_001_regression.timeout_seconds));
  checks.push(commandReceipt("trace_validate", checkById.trace_validate.executor, node, ["shared/tests/validate-traceability.mjs"], projectRoot, checkById.trace_validate.timeout_seconds));
  checks.push(commandReceipt("trace_self_test", checkById.trace_self_test.executor, node, ["shared/tests/validate-traceability.mjs", "--self-test"], projectRoot, checkById.trace_self_test.timeout_seconds));
  assert.deepEqual(checks.map((check) => check.check_id), requiredCheckIds);
  return checks;
}

function buildPrerequisiteReceipt(matrix, trace) {
  return matrix.prerequisite_requirements.map((item) => {
    git(["merge-base", "--is-ancestor", item.commit, "HEAD"]);
    const traceTask = trace.tasks.find((task) => task.id === item.task_id);
    if (!traceTask) fail("X_GATE_PREREQUISITE_TASK_MISSING", item.task_id);
    assert.deepEqual(traceTask.actual_evidence_ids, [item.evidence_id], `X_GATE_PREREQUISITE_EV:${item.task_id}`);
    const evidencePath = evidencePaths[item.evidence_id];
    if (!evidencePath) fail("X_GATE_EVIDENCE_PATH_UNKNOWN", item.evidence_id);
    const evidenceText = readFileSync(resolve(projectRoot, evidencePath), "utf8");
    assert.equal(evidenceText.includes(item.required_result), true, `X_GATE_PREREQUISITE_RESULT:${item.task_id}`);
    return {
      task_id: item.task_id,
      result: item.required_result,
      commit: item.commit,
      evidence_id: item.evidence_id,
      evidence_path: evidencePath,
      evidence_sha256: sha256(resolve(projectRoot, evidencePath)),
    };
  });
}

function validatePrerequisites(prerequisites, matrix, trace) {
  const fresh = buildPrerequisiteReceipt(matrix, trace);
  assert.deepEqual(prerequisites, fresh, "X_GATE_LOCAL_PREREQUISITE_DRIFT");
}

function buildTraceIdentity(trace) {
  assert.equal(trace.generated_from.plan.sha256, sha256(planPath), "X_GATE_TRACE_PLAN_STALE");
  return {
    plan_path: "总功能开发计划0.4.md",
    plan_sha256: trace.generated_from.plan.sha256,
    generator_sha256: trace.generated_from.generator.sha256,
    requirements: 74,
    cases: 153,
    tasks: 63,
    governance: 70,
    evidence: 36,
  };
}

function assertTracePrerequisiteReady(trace) {
  const traceTask = trace.tasks.find((task) => task.id === "SH-TRACE-001");
  if (traceTask?.status !== "已完成") {
    fail("X_GATE_TRACE_PREREQUISITE_PENDING", "decision=return_to_b_slice");
  }
}

function makeReceipt(template, matrix, trace, checks) {
  const body = {
    schema_version: "diet-manager/x-gate-002-verification-receipt/v1",
    generated_at_utc: new Date().toISOString(),
    base_commit: git(["rev-parse", "HEAD"]).stdout.trim(),
    validator_sha256: sha256(thisFile),
    template_sha256: sha256(templatePath),
    matrix_sha256: sha256(matrixPath),
    plan_sha256: sha256(planPath),
    trace_tasks_sha256: sha256(tracePath),
    input_hashes: Object.fromEntries(inputHashPaths.map((path) => [path, sha256(resolve(projectRoot, path))])),
    formal_build: validateFormalBuildArtifacts(matrix),
    checks,
  };
  return { ...body, receipt_sha256: sha256Bytes(stableJson(body)) };
}

function buildLocalMap(template, matrix, trace, receipt) {
  return {
    schema_version: "diet-manager/selected-route-map/v2",
    gate_id: "X-GATE-002",
    decision: "bind_b_ready",
    selected_route: "B",
    project_root: projectRoot,
    selected_route_root: routeRoot,
    portable_template: { path: "shared/selected-route-map.template.json", sha256: sha256(templatePath) },
    contract: clone(template.contract),
    config: clone(template.config),
    prerequisites: buildPrerequisiteReceipt(matrix, trace),
    trace_identity: buildTraceIdentity(trace),
    planned_path_semantics: {
      future_deliverables_may_be_absent: true,
      future_deliverables_are_not_probed_at_gate_time: true,
      local_map_is_ignored_and_not_release_bytes: true,
    },
    task_paths: template.task_paths.map((task) => ({ task_id: task.task_id, paths: task.paths.map((path) => resolve(projectRoot, path.replaceAll("/", sep))) })),
    verification_receipt: receipt,
    authorized_next_after_gate_closure: clone(matrix.authorized_next_on_bind),
    forbidden_claims: clone(template.forbidden_claims),
  };
}

function validateReceipt(receipt, matrix) {
  const { receipt_sha256, ...body } = receipt;
  assert.equal(receipt_sha256, sha256Bytes(stableJson(body)), "X_GATE_RECEIPT_SHA");
  assert.equal(receipt.schema_version, "diet-manager/x-gate-002-verification-receipt/v1");
  assert.equal(receipt.base_commit, git(["rev-parse", "HEAD"]).stdout.trim(), "X_GATE_RECEIPT_BASE_HEAD");
  assert.equal(receipt.validator_sha256, sha256(thisFile));
  assert.equal(receipt.template_sha256, sha256(templatePath));
  assert.equal(receipt.matrix_sha256, sha256(matrixPath));
  assert.equal(receipt.plan_sha256, sha256(planPath));
  assert.equal(receipt.trace_tasks_sha256, sha256(tracePath));
  assert.deepEqual(receipt.input_hashes, Object.fromEntries(inputHashPaths.map((path) => [path, sha256(resolve(projectRoot, path))])), "X_GATE_RECEIPT_INPUT_HASHES");
  assert.deepEqual(receipt.formal_build, validateFormalBuildArtifacts(matrix), "X_GATE_RECEIPT_FORMAL_BUILD");
  assert.deepEqual(receipt.checks.map((check) => check.check_id), requiredCheckIds);
  const requirements = Object.fromEntries(matrix.required_checks.map((check) => [check.check_id, check]));
  const expectedCommands = expectedCommandShapes(matrix);
  for (const check of receipt.checks) {
    const requirement = requirements[check.check_id];
    assert.equal(check.executor, requirement.executor, `X_GATE_RECEIPT_EXECUTOR:${check.check_id}`);
    assert.equal(check.timeout_seconds, requirement.timeout_seconds, `X_GATE_RECEIPT_TIMEOUT:${check.check_id}`);
    assert.deepEqual({ args: check.args, cwd_relative: check.cwd_relative }, expectedCommands[check.check_id], `X_GATE_RECEIPT_COMMAND:${check.check_id}`);
    assert.match(check.stdout_sha256, /^[A-F0-9]{64}$/u);
    assert.match(check.stderr_sha256, /^[A-F0-9]{64}$/u);
    assert.equal(check.exit_code, 0, `X_GATE_RECEIPT_CHECK_FAILED:${check.check_id}`);
  }
}

function validateLocalMap(map, template, matrix, trace) {
  assert.equal(map.schema_version, "diet-manager/selected-route-map/v2");
  assert.equal(map.gate_id, "X-GATE-002");
  assert.equal(map.decision, "bind_b_ready");
  assert.equal(map.selected_route, "B");
  assert.equal(map.project_root, projectRoot);
  assert.equal(map.selected_route_root, routeRoot);
  assert.deepEqual(map.portable_template, { path: "shared/selected-route-map.template.json", sha256: sha256(templatePath) });
  assert.deepEqual(map.contract, template.contract);
  assert.deepEqual(map.config, template.config);
  validatePrerequisites(map.prerequisites, matrix, trace);
  assert.deepEqual(map.trace_identity, buildTraceIdentity(trace));
  assert.deepEqual(map.task_paths, template.task_paths.map((task) => ({ task_id: task.task_id, paths: task.paths.map((path) => resolve(projectRoot, path.replaceAll("/", sep))) })));
  for (const task of map.task_paths) for (const path of task.paths) {
    if (!isAbsolute(path) || resolve(path) !== path || !isWithin(projectRoot, path)) fail("X_GATE_LOCAL_PATH_INVALID", path);
  }
  assert.deepEqual(map.forbidden_claims, template.forbidden_claims);
  validateReceipt(map.verification_receipt, matrix);
}

export function atomicPublishNew(path, value) {
  const parent = dirname(path);
  const temporary = resolve(parent, `.selected-route-map.publish-${process.pid}-${Date.now()}.json`);
  if (dirname(temporary) !== parent) fail("X_GATE_PUBLISH_CROSS_VOLUME");
  let fd;
  let linked = false;
  let ownedLink = false;
  let sourceIdentity;
  try {
    fd = openSync(temporary, "wx");
    writeFileSync(fd, stableJson(value), "utf8");
    fsyncSync(fd);
    sourceIdentity = fstatSync(fd);
    linkSync(temporary, path);
    linked = true;
    const publishedIdentity = lstatSync(path);
    if (!publishedIdentity.isFile() || publishedIdentity.isSymbolicLink()) fail("X_GATE_PUBLISH_NOT_ORDINARY");
    if (publishedIdentity.dev !== sourceIdentity.dev || publishedIdentity.ino !== sourceIdentity.ino) {
      fail("X_GATE_PUBLISH_IDENTITY_CHANGED");
    }
    ownedLink = true;
    if (readFileSync(path, "utf8") !== stableJson(value)) fail("X_GATE_PUBLISH_VERIFY");
    const verifiedIdentity = lstatSync(path);
    if (verifiedIdentity.dev !== sourceIdentity.dev || verifiedIdentity.ino !== sourceIdentity.ino) {
      ownedLink = false;
      fail("X_GATE_PUBLISH_IDENTITY_CHANGED");
    }
  } catch (error) {
    if (linked && ownedLink && existsSync(path)) {
      const current = lstatSync(path);
      if (current.dev === sourceIdentity.dev && current.ino === sourceIdentity.ino) unlinkSync(path);
    }
    if (error?.code === "EEXIST") fail("X_GATE_OUTPUT_ALREADY_EXISTS", path);
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function publishAfterPassingChecks(path, map) {
  if (map.verification_receipt.checks.some((check) => check.exit_code !== 0)) fail("X_GATE_PUBLISH_CHECK_FAILED");
  atomicPublishNew(path, map);
}

function expectFailure(fn, label) {
  let rejected = false;
  try { fn(); } catch { rejected = true; }
  assert.equal(rejected, true, `X_GATE_MUTATION_NOT_REJECTED:${label}`);
}

function resealReceipt(map) {
  const { receipt_sha256: _old, ...body } = map.verification_receipt;
  map.verification_receipt = { ...body, receipt_sha256: sha256Bytes(stableJson(body)) };
  return map;
}

function planSelfTests(planText, template) {
  const first = template.task_paths[0];
  const firstPlanTokens = first.paths.map((path) => path.startsWith("version-b-lite-plugin/") ? `<selected_route_root>/${path.slice("version-b-lite-plugin/".length)}` : `<project_root>/${path}`);
  const firstRow = `| \`${first.task_id}\` | ${firstPlanTokens.map((path) => `\`${path}\``).join("；")} |`;
  const reorderedRows = planText.split("\n");
  const firstIndex = reorderedRows.findIndex((line) => line.startsWith(`| \`${template.task_paths[0].task_id}\` |`));
  const secondIndex = reorderedRows.findIndex((line) => line.startsWith(`| \`${template.task_paths[1].task_id}\` |`));
  [reorderedRows[firstIndex], reorderedRows[secondIndex]] = [reorderedRows[secondIndex], reorderedRows[firstIndex]];
  const variants = [
    planText.replace(firstRow, `| \`${first.task_id}\` | \`${firstPlanTokens[0]}\` |`),
    planText.replace(firstRow, firstRow.replace(/ \|$/u, "；`<project_root>/extra.txt` |")),
    planText.replace(firstRow, `| \`${first.task_id}\` | ${[...firstPlanTokens].reverse().map((path) => `\`${path}\``).join("；")} |`),
    reorderedRows.join("\n"),
  ];
  for (const [index, mutation] of variants.entries()) {
    expectFailure(() => validateTemplate(template, mutation), `plan_${index}`);
  }
  return variants.length;
}

function publishSelfTests(map) {
  const collision = resolve(dirname(localMapPath), `.selected-route-map.collision-${process.pid}.json`);
  const failed = resolve(dirname(localMapPath), `.selected-route-map.failed-${process.pid}.json`);
  try {
    writeFileSync(collision, "sentinel", { encoding: "utf8", flag: "wx" });
    expectFailure(() => atomicPublishNew(collision, map), "publish_collision");
    assert.equal(readFileSync(collision, "utf8"), "sentinel");
    const bad = clone(map);
    bad.verification_receipt.checks[0].exit_code = 1;
    resealReceipt(bad);
    expectFailure(() => publishAfterPassingChecks(failed, bad), "failed_check_publish");
    assert.equal(existsSync(failed), false);
  } finally {
    if (existsSync(collision)) unlinkSync(collision);
    if (existsSync(failed)) unlinkSync(failed);
  }
  return { collisions: 1, failed_publish: 1 };
}

function prerequisiteSelfTests(map, template, matrix, trace) {
  const variants = [
    (value) => value.prerequisite_requirements.pop(),
    (value) => { value.prerequisite_requirements[0].required_result = "wrong"; },
    (value) => { value.prerequisite_requirements[0].commit = "0000000000000000000000000000000000000000"; },
    (value) => { value.prerequisite_requirements[0].evidence_id = "EV-20260812-031"; },
  ];
  for (const [index, mutate] of variants.entries()) {
    const changed = clone(matrix);
    mutate(changed);
    expectFailure(() => validateMatrix(changed, template), `prerequisite_requirement_${index}`);
  }
  const local = clone(map);
  local.prerequisites[0].result = "wrong";
  expectFailure(() => validateLocalMap(local, template, matrix, trace), "local_prerequisite_tamper");
  return 5;
}

function identitySelfTests(map, template, matrix, trace) {
  const mapMutations = [
    (value) => { value.contract.version = 999; },
    (value) => { value.selected_route = "A"; },
    (value) => { value.selected_route_root = resolve(projectRoot, "version-a-jsonl"); },
    (value) => { value.config.key = "other_root"; },
    (value) => { value.trace_identity.plan_sha256 = "0".repeat(64); },
    (value) => { value.forbidden_claims = ["product_ready"]; },
  ];
  for (const [index, mutate] of mapMutations.entries()) {
    const changed = clone(map);
    mutate(changed);
    expectFailure(() => validateLocalMap(changed, template, matrix, trace), `map_identity_${index}`);
  }
  const artifactMatrix = clone(matrix);
  artifactMatrix.formal_build_provenance_requirement.artifacts[0].sha256 = "0".repeat(64);
  expectFailure(() => validateMatrix(artifactMatrix, template), "formal_artifact_exact");
  const commandMatrix = clone(matrix);
  commandMatrix.formal_build_provenance_requirement.command = "node_modules/typescript/bin/tsc -p tsconfig.other.json";
  expectFailure(() => validateMatrix(commandMatrix, template), "formal_build_command_exact");
  const executionMatrix = clone(matrix);
  executionMatrix.formal_build_provenance_requirement.execution_count = 2;
  expectFailure(() => validateMatrix(executionMatrix, template), "formal_build_second_execution");
  const reexecutedMatrix = clone(matrix);
  reexecutedMatrix.formal_build_provenance_requirement.reexecuted_during_review_fix = true;
  expectFailure(() => validateMatrix(reexecutedMatrix, template), "formal_build_review_reexecution");
  const sourceMatrix = clone(matrix);
  sourceMatrix.formal_build_provenance_requirement.source_candidate_commit = "0".repeat(40);
  expectFailure(() => validateMatrix(sourceMatrix, template), "formal_build_source_candidate");
  const artifactCommitMatrix = clone(matrix);
  artifactCommitMatrix.formal_build_provenance_requirement.artifact_commit = "0".repeat(40);
  expectFailure(() => validateMatrix(artifactCommitMatrix, template), "formal_build_artifact_commit");
  const finalCommitMatrix = clone(matrix);
  finalCommitMatrix.formal_build_provenance_requirement.task9_final_commit = "0".repeat(40);
  expectFailure(() => validateMatrix(finalCommitMatrix, template), "formal_build_task9_final_commit");
  const receiptMutations = [
    (value) => { value.verification_receipt.base_commit = "0".repeat(40); },
    (value) => { value.verification_receipt.input_hashes["version-b-lite-plugin/src/contracts.ts"] = "0".repeat(64); },
    (value) => { value.verification_receipt.checks[0].executor = "wrong_executor"; },
    (value) => { value.verification_receipt.checks[0].args = ["wrong-command"]; },
    (value) => { value.verification_receipt.formal_build.source_candidate_commit = "0".repeat(40); },
  ];
  for (const [index, mutate] of receiptMutations.entries()) {
    const changed = clone(map);
    mutate(changed);
    resealReceipt(changed);
    expectFailure(() => validateLocalMap(changed, template, matrix, trace), `receipt_identity_${index}`);
  }
  return 18;
}

function stateReparseSelfTest() {
  const target = resolve(sddRoot, `.xgate-state-reparse-${process.pid}`);
  const owned = resolve(sddRoot, `.xgate-state-owned-${process.pid}`);
  try {
    mkdirSync(owned, { recursive: false });
    symlinkSync(owned, target, "junction");
    expectFailure(() => safeRemoveStateRoot(target), "state_root_reparse");
    assert.equal(existsSync(owned), true, "reparse rejection removed owned target");
  } finally {
    if (existsSync(target)) unlinkSync(target);
    if (existsSync(owned)) rmSync(owned, { recursive: true, force: true });
  }
  return 1;
}

function commandFailureSelfTest() {
  expectFailure(
    () => commandReceipt("expected_nonzero", "pinned_node_validator", process.execPath, ["-e", "process.exit(7)"], projectRoot, 5),
    "preflight_command_nonzero",
  );
  return 1;
}

function makeSelfTestMap(template, matrix, trace) {
  const shapes = expectedCommandShapes(matrix);
  const now = new Date().toISOString();
  const checks = matrix.required_checks.map((requirement) => ({
    check_id: requirement.check_id,
    executor: requirement.executor,
    args: shapes[requirement.check_id].args,
    cwd_relative: shapes[requirement.check_id].cwd_relative,
    timeout_seconds: requirement.timeout_seconds,
    started_at_utc: now,
    ended_at_utc: now,
    duration_ms: 0,
    exit_code: 0,
    signal: null,
    stdout_sha256: sha256Bytes(`self-test:${requirement.check_id}`),
    stderr_sha256: sha256Bytes(""),
    stdout_last_line: "SELF_TEST_FIXTURE|PASS",
  }));
  return buildLocalMap(template, matrix, trace, makeReceipt(template, matrix, trace, checks));
}

async function loadSources() {
  const [template, matrix, trace, manifest, skill, planText] = [
    JSON.parse(readFileSync(templatePath, "utf8")),
    JSON.parse(readFileSync(matrixPath, "utf8")),
    JSON.parse(readFileSync(tracePath, "utf8")),
    JSON.parse(readFileSync(manifestPath, "utf8")),
    readFileSync(skillPath, "utf8"),
    readFileSync(planPath, "utf8"),
  ];
  const runtimeModule = await import(`${pathToFileURL(distEntryPath).href}?xgate=${Date.now()}`);
  const pluginMetadata = runtimeModule.default?.[Symbol.for("openclaw.plugin-sdk.tool-plugin.metadata")];
  return { template, matrix, trace, manifest, skill, planText, runtimeModule, pluginMetadata };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  for (const arg of args) if (!["--self-test", "--preflight", "--publish"].includes(arg)) fail("X_GATE_ARGUMENT_INVALID", arg);
  if (args.has("--publish") !== args.has("--preflight")) fail("X_GATE_PREFLIGHT_PUBLISH_PAIR_REQUIRED");
  const sources = await loadSources();
  validateTemplate(sources.template, sources.planText);
  validateMatrix(sources.matrix, sources.template);
  validateGitPolicy();
  validateRuntimeIdentity(sources.runtimeModule, sources.pluginMetadata, sources.manifest, sources.skill);
  const existingInputs = [projectRoot, routeRoot, planPath, templatePath, matrixPath, thisFile, tracePath, manifestPath, skillPath, distEntryPath, resolve(routeRoot, "dist", "contracts.js"), resolve(projectRoot, expectedContract.path), ...Object.values(evidencePaths).map((path) => resolve(projectRoot, path))];
  for (const path of existingInputs) assertOrdinaryExisting(path);

  if (!args.has("--self-test")) assertTracePrerequisiteReady(sources.trace);

  if (args.has("--preflight")) {
    if (existsSync(localMapPath)) fail("X_GATE_OUTPUT_ALREADY_EXISTS", localMapPath);
    const checks = runPreflight(sources.matrix, sources.runtimeModule, sources.pluginMetadata, sources.manifest, sources.skill);
    const receipt = makeReceipt(sources.template, sources.matrix, sources.trace, checks);
    const map = buildLocalMap(sources.template, sources.matrix, sources.trace, receipt);
    validateLocalMap(map, sources.template, sources.matrix, sources.trace);
    publishAfterPassingChecks(localMapPath, map);
  }
  if (!args.has("--self-test") && !existsSync(localMapPath)) fail("X_GATE_LOCAL_MAP_ABSENT");
  const map = args.has("--self-test")
    ? makeSelfTestMap(sources.template, sources.matrix, sources.trace)
    : JSON.parse(readFileSync(localMapPath, "utf8"));
  validateLocalMap(map, sources.template, sources.matrix, sources.trace);

  let planMutations = 0;
  let collisions = 0;
  let failedPublish = 0;
  let commandFailures = 0;
  let prerequisiteMutations = 0;
  let identityMutations = 0;
  let stateReparseMutations = 0;
  if (args.has("--self-test")) {
    planMutations = planSelfTests(sources.planText, sources.template);
    const publish = publishSelfTests(map);
    collisions = publish.collisions;
    failedPublish = publish.failed_publish;
    commandFailures = commandFailureSelfTest();
    prerequisiteMutations = prerequisiteSelfTests(map, sources.template, sources.matrix, sources.trace);
    identityMutations = identitySelfTests(map, sources.template, sources.matrix, sources.trace);
    stateReparseMutations = stateReparseSelfTest();
    const mutated = clone(map);
    mutated.verification_receipt.checks[0].exit_code = 1;
    resealReceipt(mutated);
    expectFailure(() => validateLocalMap(mutated, sources.template, sources.matrix, sources.trace), "receipt_failed_check");
  }
  const reportedDecision = args.has("--self-test") ? "return_to_b_slice" : map.decision;
  process.stdout.write(`X_GATE_002|PASS|mode=${args.has("--preflight") ? "preflight_publish" : "validate"}|decision=${reportedDecision}|tasks=${map.task_paths.length}|paths=${map.task_paths.reduce((sum, task) => sum + task.paths.length, 0)}|plan_mutations=${planMutations}|collisions=${collisions}|failed_publish=${failedPublish}|command_failures=${commandFailures}|prerequisite_mutations=${prerequisiteMutations}|identity_mutations=${identityMutations}|state_reparse_mutations=${stateReparseMutations}\n`);
}

try {
  await main();
} catch (error) {
  if (error instanceof GateError || error instanceof assert.AssertionError) {
    process.stderr.write(`X_GATE_002|FAIL|${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
