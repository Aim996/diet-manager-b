import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  renameSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const routeRoot = resolve(projectRoot, "version-b-lite-plugin");
const mapPath = resolve(projectRoot, "shared", "selected-route-map.json");
const matrixPath = resolve(projectRoot, "docs", "work-items", "X-GATE-002-matrix.json");
const planPath = resolve(projectRoot, "总功能开发计划0.4.md");
const tracePath = resolve(projectRoot, "shared", "traceability", "tasks.json");
const manifestPath = resolve(routeRoot, "openclaw.plugin.json");
const skillPath = resolve(routeRoot, "skills", "diet-manager-b", "SKILL.md");
const distEntryPath = resolve(routeRoot, "dist", "index.js");

const expectedContract = Object.freeze({
  path: "shared/business-contract.md",
  id: "diet-manager/contract-v2",
  version: 2,
  sha256: "632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E",
  last_change_commit: "a6559f9728c46fbbddc30d5e187d824ad83493ff",
});
const expectedTaskTemplates = Object.freeze([
  ["SEL-CORE-001", ["version-b-lite-plugin/src/domain/core-service.ts", "version-b-lite-plugin/tests/acceptance/core.test.ts"]],
  ["SEL-PANTRY-001", ["version-b-lite-plugin/src/domain/inventory-service.ts", "version-b-lite-plugin/src/storage/inventory-repository.ts"]],
  ["SEL-NUTR-001", ["version-b-lite-plugin/src/nutrition/nutrition-service.ts", "version-b-lite-plugin/src/nutrition/source-client.ts"]],
  ["SEL-FACTEFFECT-001", ["version-b-lite-plugin/src/orchestration/fact-effect-finalize.ts", "version-b-lite-plugin/src/projections/progress-contribution.ts"]],
  ["SEL-ISSUE-001", ["version-b-lite-plugin/src/issues/issue-service.ts", "version-b-lite-plugin/src/issues/prompt-options.ts"]],
  ["SEL-CORR-001", ["version-b-lite-plugin/src/corrections/correction-service.ts", "version-b-lite-plugin/tests/acceptance/correction.test.ts"]],
  ["SEL-PROGRESS-001", ["version-b-lite-plugin/src/projections/progress-projector.ts", "version-b-lite-plugin/tests/acceptance/progress.test.ts"]],
  ["SEL-QUERY-001", ["version-b-lite-plugin/src/queries/report-service.ts", "version-b-lite-plugin/tests/acceptance/query.test.ts"]],
  ["SEL-RECEIPT-001", ["version-b-lite-plugin/src/receipt/renderer.ts", "version-b-lite-plugin/tests/golden/receipts.test.ts"]],
  ["SEL-RELIABILITY-001", ["version-b-lite-plugin/tests/reliability/fault-matrix.test.ts", "shared/tests/validate-zero-diff.ps1"]],
  ["SEL-INSTALL-001", ["scripts/install.ps1", "docs/install-support-matrix.md"]],
  ["SEL-MIGRATE-001", ["version-b-lite-plugin/src/storage/migrate.ts", "version-b-lite-plugin/tests/migration/migration.test.ts"]],
  ["SEL-BACKUP-001", ["scripts/backup.ps1", "scripts/restore.ps1", "scripts/uninstall.ps1"]],
  ["SEL-EXPORT-BASE-001", ["version-b-lite-plugin/src/export/baseline-export.ts", "version-b-lite-plugin/tests/export/baseline.test.ts"]],
  ["SEL-RELEASE-001", ["release/0.1/candidate-manifest.json", "scripts/release-0.1.ps1"]],
  ["SEL-TEMPLATE-001", ["version-b-lite-plugin/src/templates/personal-dish-service.ts", "version-b-lite-plugin/tests/acceptance/template.test.ts"]],
  ["SEL-REVIEW-001", ["version-b-lite-plugin/src/review/review-service.ts", "version-b-lite-plugin/tests/acceptance/review.test.ts"]],
  ["SEL-LIFE-001", ["version-b-lite-plugin/src/lifecycle/lifecycle-service.ts", "version-b-lite-plugin/tests/acceptance/lifecycle.test.ts"]],
  ["SEL-EXPORT-001", ["version-b-lite-plugin/src/export/rich-export.ts", "version-b-lite-plugin/tests/export/rich.test.ts"]],
  ["SEL-UPGRADE-002", ["version-b-lite-plugin/src/storage/upgrade-0.2.ts", "version-b-lite-plugin/tests/migration/upgrade-0.2.test.ts"]],
  ["SEL-RELEASE-002", ["release/0.2/candidate-manifest.json", "scripts/release-0.2.ps1"]],
]);
const expectedPrerequisites = Object.freeze([
  {
    task_id: "X-GATE-001",
    result_key: "decision",
    result: "pass_b_safety",
    commit_key: "closure_commit",
    commit: "40f7b608f72935becd7628dd89ef4cf7f515c05b",
    evidence_id: null,
  },
  {
    task_id: "B-SLICE-001",
    result_key: "result",
    result: "PASS",
    commit_key: "candidate_commit",
    commit: "c8e6bcef39d0f98452432c3331095d963b9b9778",
    evidence_id: "EV-20260812-031",
  },
  {
    task_id: "B-FAULT-001",
    result_key: "result",
    result: "DONE_WITH_CONCERNS",
    commit_key: "candidate_commit",
    commit: "552feee374fe3463f296bd4a110af11747a7ee29",
    evidence_id: "EV-20260812-032",
  },
  {
    task_id: "SH-TRACE-001",
    result_key: "result",
    result: "PASS",
    commit_key: "closure_commit",
    commit: "846dbbc718197b3fc59787124a2ac3b18d1b55f8",
    evidence_id: "EV-20260813-034",
  },
]);
const expectedExistingInputs = Object.freeze([
  projectRoot,
  routeRoot,
  planPath,
  resolve(projectRoot, expectedContract.path),
  resolve(projectRoot, "shared", "tests", "validate-traceability.mjs"),
  tracePath,
  resolve(projectRoot, "docs", "work-items", "X-GATE-001-matrix.json"),
  resolve(projectRoot, "docs", "evidence", "EV-20260812-031-b-slice-001.md"),
  resolve(projectRoot, "docs", "evidence", "EV-20260812-032-b-fault-001.md"),
  resolve(projectRoot, "docs", "evidence", "EV-20260813-034-sh-trace-001-doc-0.4.md"),
  resolve(routeRoot, "src", "contracts.ts"),
  resolve(routeRoot, "src", "index.ts"),
  manifestPath,
  skillPath,
  resolve(projectRoot, "shared", "tests", "validate-x-gate-002.mjs"),
  matrixPath,
]);

function fail(code, detail = "") {
  throw new Error(`${code}${detail ? `:${detail}` : ""}`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}

function exactKeys(value, keys, code) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), code);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function atomicWriteNew(path, value) {
  if (existsSync(path)) fail("X_GATE_OUTPUT_ALREADY_EXISTS", path);
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, stableJson(value), { encoding: "utf8", flag: "wx" });
    if (readFileSync(temporary, "utf8") !== stableJson(value)) fail("X_GATE_ATOMIC_WRITE_VERIFY", path);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function isWithin(root, path) {
  const child = relative(root, path);
  return child === "" || (!child.startsWith("..\\") && child !== ".." && !isAbsolute(child));
}

function assertCanonicalAbsolute(path, root, code) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path) fail(code, "not_canonical_absolute");
  if (!isWithin(root, path)) fail(code, "outside_root");
}

function assertOrdinaryExisting(path) {
  if (!existsSync(path)) fail("X_GATE_INPUT_MISSING", path);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) fail("X_GATE_INPUT_REPARSE", path);
  if (!stat.isFile() && !stat.isDirectory()) fail("X_GATE_INPUT_NOT_ORDINARY", path);
  if (realpathSync.native(path) !== path) fail("X_GATE_INPUT_NONCANONICAL_REALPATH", path);
}

function git(...args) {
  return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", windowsHide: true }).trim();
}

function validateTraceIdentity(traceIdentity, trace) {
  exactKeys(traceIdentity, ["plan_path", "plan_sha256", "generator_sha256", "requirements", "cases", "tasks", "governance", "evidence"], "X_GATE_TRACE_IDENTITY_SHAPE");
  assert.equal(traceIdentity.plan_path, "总功能开发计划0.4.md", "X_GATE_TRACE_PLAN_PATH");
  assert.equal(traceIdentity.plan_sha256, sha256(planPath), "X_GATE_TRACE_PLAN_STALE");
  assert.equal(traceIdentity.plan_sha256, trace.generated_from.plan.sha256, "X_GATE_TRACE_MAP_PLAN_DRIFT");
  assert.equal(traceIdentity.generator_sha256, trace.generated_from.generator.sha256, "X_GATE_TRACE_GENERATOR_DRIFT");
  assert.deepEqual(
    [traceIdentity.requirements, traceIdentity.cases, traceIdentity.tasks, traceIdentity.governance, traceIdentity.evidence],
    [74, 153, 63, 69, 34],
    "X_GATE_TRACE_COUNTS",
  );
}

function validateRuntimeIdentity(runtime, manifest, skill) {
  assert.deepEqual(runtime.contract, { id: expectedContract.id, version: expectedContract.version, sha256: expectedContract.sha256 }, "X_GATE_RUNTIME_CONTRACT");
  assert.deepEqual(runtime.parameters?.["x-diet-manager-contract"], runtime.contract, "X_GATE_TOOL_SCHEMA_CONTRACT");
  assert.deepEqual(runtime.configSchema?.["x-diet-manager-contract"], runtime.contract, "X_GATE_CONFIG_SCHEMA_CONTRACT");
  assert.deepEqual(manifest.configSchema, runtime.configSchema, "X_GATE_MANIFEST_RUNTIME_CONFIG_DRIFT");
  assert.deepEqual(Object.keys(manifest.configSchema.properties ?? {}), ["official_data_root"], "X_GATE_CONFIG_KEYS");
  assert.deepEqual(manifest.configSchema.required, ["official_data_root"], "X_GATE_CONFIG_REQUIRED");
  assert.equal(manifest.configSchema.additionalProperties, false, "X_GATE_CONFIG_ADDITIONAL_PROPERTIES");
  assert.equal(manifest.configSchema.properties.official_data_root.type, "string", "X_GATE_CONFIG_ROOT_TYPE");
  assert.equal(manifest.configSchema.properties.official_data_root["x-diet-manager-root-semantics"], "backend_owned_existing_absolute_runtime_root", "X_GATE_CONFIG_ROOT_SEMANTICS");
  for (const token of [
    `contract_id=${expectedContract.id}`,
    `contract_version=${expectedContract.version}`,
    `contract_sha256=${expectedContract.sha256}`,
    "只有工具返回 `committed=true` 才能告诉用户“已记录”",
    "技术日志可以说明失败原因，但不属于饮食记录",
    "`official_data_root` 只由后端配置和管理",
  ]) {
    if (!skill.includes(token)) fail("X_GATE_SKILL_BINDING", token);
  }
}

function validatePrerequisites(prerequisites, { checkRepository }) {
  assert.equal(prerequisites.length, expectedPrerequisites.length, "X_GATE_PREREQUISITE_COUNT");
  prerequisites.forEach((item, index) => {
    exactKeys(item, ["task_id", "result", "commit", "evidence_id", "evidence_path", "evidence_sha256"], "X_GATE_PREREQUISITE_SHAPE");
    const expected = expectedPrerequisites[index];
    assert.equal(item.task_id, expected.task_id, "X_GATE_PREREQUISITE_ORDER");
    assert.equal(item.result, expected.result, `X_GATE_PREREQUISITE_RESULT:${item.task_id}`);
    assert.equal(item.commit, expected.commit, `X_GATE_PREREQUISITE_COMMIT:${item.task_id}`);
    assert.equal(item.evidence_id, expected.evidence_id, `X_GATE_PREREQUISITE_EV:${item.task_id}`);
    if (expected.evidence_id === null) {
      assert.equal(item.evidence_path, null, "X_GATE_PREREQUISITE_EV_PATH");
      assert.equal(item.evidence_sha256, null, "X_GATE_PREREQUISITE_EV_SHA");
    } else {
      assert.equal(typeof item.evidence_path, "string", "X_GATE_PREREQUISITE_EV_PATH");
      assert.match(item.evidence_sha256, /^[A-F0-9]{64}$/u, "X_GATE_PREREQUISITE_EV_SHA");
      if (checkRepository) assert.equal(sha256(resolve(projectRoot, item.evidence_path)), item.evidence_sha256, `X_GATE_PREREQUISITE_EV_STALE:${item.task_id}`);
    }
    if (checkRepository) execFileSync("git", ["merge-base", "--is-ancestor", item.commit, "HEAD"], { cwd: projectRoot, windowsHide: true, stdio: "ignore" });
  });
}

function validateMap(map, sources, { checkRepository = true } = {}) {
  exactKeys(map, ["schema_version", "gate_id", "decision", "selected_route", "project_root", "selected_route_root", "contract", "config", "prerequisites", "trace_identity", "planned_path_semantics", "task_paths", "forbidden_claims"], "X_GATE_MAP_TOP_LEVEL_SHAPE");
  assert.equal(map.schema_version, "diet-manager/selected-route-map/v1");
  assert.equal(map.gate_id, "X-GATE-002");
  assert.equal(map.decision, "bind_b_ready");
  assert.equal(map.selected_route, "B");
  assert.equal(map.project_root, projectRoot);
  assert.equal(map.selected_route_root, routeRoot);
  assert.deepEqual(map.contract, expectedContract, "X_GATE_CONTRACT");
  assert.deepEqual(map.config, {
    key: "official_data_root",
    type: "string",
    required: true,
    semantics: "backend_owned_existing_absolute_runtime_root",
    gate_time_open_or_create: false,
  }, "X_GATE_CONFIG");
  validatePrerequisites(map.prerequisites, { checkRepository });
  validateTraceIdentity(map.trace_identity, sources.trace);
  assert.deepEqual(map.planned_path_semantics, {
    future_deliverables_may_be_absent: true,
    future_deliverables_are_not_probed_at_gate_time: true,
    current_inputs_must_exist_as_ordinary_non_reparse_objects: expectedExistingInputs,
  }, "X_GATE_PATH_SEMANTICS");

  assert.equal(map.task_paths.length, expectedTaskTemplates.length, "X_GATE_TASK_PATH_COUNT");
  map.task_paths.forEach((item, index) => {
    exactKeys(item, ["task_id", "paths"], "X_GATE_TASK_PATH_SHAPE");
    const [taskId, templates] = expectedTaskTemplates[index];
    assert.equal(item.task_id, taskId, "X_GATE_TASK_PATH_ORDER");
    assert.deepEqual(item.paths, templates.map((path) => resolve(projectRoot, path)), `X_GATE_TASK_PATHS:${taskId}`);
    for (const path of item.paths) assertCanonicalAbsolute(path, projectRoot, "X_GATE_PLANNED_PATH_INVALID");
  });
  assert.equal(new Set(map.task_paths.map((item) => item.task_id)).size, expectedTaskTemplates.length, "X_GATE_TASK_PATH_DUPLICATE");
  assert.deepEqual(map.forbidden_claims, ["product_ready", "installable", "release", "G3"], "X_GATE_FORBIDDEN_CLAIMS");
  validateRuntimeIdentity(sources.runtime, sources.manifest, sources.skill);
  if (checkRepository) for (const path of expectedExistingInputs) assertOrdinaryExisting(path);
}

function validateMatrix(matrix, map, { checkRepository = true } = {}) {
  exactKeys(matrix, ["schema_version", "gate_id", "route", "scope", "contract", "config_key", "prerequisites", "checks", "decision", "selected_route_map", "authorized_next", "forbidden_claims"], "X_GATE_MATRIX_TOP_LEVEL_SHAPE");
  assert.equal(matrix.schema_version, "diet-manager/x-gate-002-matrix/v1");
  assert.equal(matrix.gate_id, "X-GATE-002");
  assert.equal(matrix.route, "B");
  assert.equal(matrix.scope, "g2_b_ready_contract_root_path_binding_only");
  assert.deepEqual(matrix.contract, expectedContract);
  assert.equal(matrix.config_key, "official_data_root");
  validatePrerequisites(matrix.prerequisites, { checkRepository });
  assert.deepEqual(matrix.checks, [
    { check_id: "focused_foundation_contract_root_skill", result: "pass" },
    { check_id: "typescript_no_emit", result: "pass" },
    { check_id: "typescript_formal_build_once", result: "pass" },
    { check_id: "source_dist_parity", result: "pass" },
    { check_id: "openclaw_plugin_build_check_validate", result: "pass" },
    { check_id: "x_gate_001_regression", result: "pass" },
    { check_id: "trace_normal_self_test", result: "pass" },
  ], "X_GATE_MATRIX_CHECKS");
  assert.equal(matrix.decision, "bind_b_ready");
  assert.deepEqual(matrix.selected_route_map, {
    path: "shared/selected-route-map.json",
    sha256: sha256(mapPath),
  }, "X_GATE_MATRIX_MAP_IDENTITY");
  assert.deepEqual(matrix.authorized_next, ["SEL-CORE-001"]);
  assert.deepEqual(matrix.forbidden_claims, map.forbidden_claims);
}

function buildMap(sources) {
  return {
    schema_version: "diet-manager/selected-route-map/v1",
    gate_id: "X-GATE-002",
    decision: "bind_b_ready",
    selected_route: "B",
    project_root: projectRoot,
    selected_route_root: routeRoot,
    contract: expectedContract,
    config: {
      key: "official_data_root",
      type: "string",
      required: true,
      semantics: "backend_owned_existing_absolute_runtime_root",
      gate_time_open_or_create: false,
    },
    prerequisites: [
      {
        task_id: "X-GATE-001",
        result: "pass_b_safety",
        commit: "40f7b608f72935becd7628dd89ef4cf7f515c05b",
        evidence_id: null,
        evidence_path: null,
        evidence_sha256: null,
      },
      {
        task_id: "B-SLICE-001",
        result: "PASS",
        commit: "c8e6bcef39d0f98452432c3331095d963b9b9778",
        evidence_id: "EV-20260812-031",
        evidence_path: "docs/evidence/EV-20260812-031-b-slice-001.md",
        evidence_sha256: sha256(resolve(projectRoot, "docs/evidence/EV-20260812-031-b-slice-001.md")),
      },
      {
        task_id: "B-FAULT-001",
        result: "DONE_WITH_CONCERNS",
        commit: "552feee374fe3463f296bd4a110af11747a7ee29",
        evidence_id: "EV-20260812-032",
        evidence_path: "docs/evidence/EV-20260812-032-b-fault-001.md",
        evidence_sha256: sha256(resolve(projectRoot, "docs/evidence/EV-20260812-032-b-fault-001.md")),
      },
      {
        task_id: "SH-TRACE-001",
        result: "PASS",
        commit: "846dbbc718197b3fc59787124a2ac3b18d1b55f8",
        evidence_id: "EV-20260813-034",
        evidence_path: "docs/evidence/EV-20260813-034-sh-trace-001-doc-0.4.md",
        evidence_sha256: sha256(resolve(projectRoot, "docs/evidence/EV-20260813-034-sh-trace-001-doc-0.4.md")),
      },
    ],
    trace_identity: {
      plan_path: "总功能开发计划0.4.md",
      plan_sha256: sources.trace.generated_from.plan.sha256,
      generator_sha256: sources.trace.generated_from.generator.sha256,
      requirements: 74,
      cases: 153,
      tasks: 63,
      governance: 69,
      evidence: 34,
    },
    planned_path_semantics: {
      future_deliverables_may_be_absent: true,
      future_deliverables_are_not_probed_at_gate_time: true,
      current_inputs_must_exist_as_ordinary_non_reparse_objects: expectedExistingInputs,
    },
    task_paths: expectedTaskTemplates.map(([task_id, paths]) => ({
      task_id,
      paths: paths.map((path) => resolve(projectRoot, path)),
    })),
    forbidden_claims: ["product_ready", "installable", "release", "G3"],
  };
}

function buildMatrix(map) {
  return {
    schema_version: "diet-manager/x-gate-002-matrix/v1",
    gate_id: "X-GATE-002",
    route: "B",
    scope: "g2_b_ready_contract_root_path_binding_only",
    contract: expectedContract,
    config_key: "official_data_root",
    prerequisites: clone(map.prerequisites),
    checks: [
      { check_id: "focused_foundation_contract_root_skill", result: "pass" },
      { check_id: "typescript_no_emit", result: "pass" },
      { check_id: "typescript_formal_build_once", result: "pass" },
      { check_id: "source_dist_parity", result: "pass" },
      { check_id: "openclaw_plugin_build_check_validate", result: "pass" },
      { check_id: "x_gate_001_regression", result: "pass" },
      { check_id: "trace_normal_self_test", result: "pass" },
    ],
    decision: "bind_b_ready",
    selected_route_map: {
      path: "shared/selected-route-map.json",
      sha256: sha256(mapPath),
    },
    authorized_next: ["SEL-CORE-001"],
    forbidden_claims: clone(map.forbidden_claims),
  };
}

function expectMutationFailure(bundle, mutate, label) {
  const candidate = clone(bundle);
  mutate(candidate);
  let rejected = false;
  try {
    validateMap(candidate.map, candidate.sources, { checkRepository: false });
    validateMatrix(candidate.matrix, candidate.map, { checkRepository: false });
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, `X_GATE_MUTATION_NOT_REJECTED:${label}`);
}

const runtimeModule = await import(`${pathToFileURL(distEntryPath).href}?xgate=${Date.now()}`);
const pluginMetadata = runtimeModule.default?.[Symbol.for("openclaw.plugin-sdk.tool-plugin.metadata")];
const sources = {
  trace: JSON.parse(readFileSync(tracePath, "utf8")),
  manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
  skill: readFileSync(skillPath, "utf8"),
  runtime: {
    contract: runtimeModule.dietManagerContract,
    parameters: runtimeModule.dietManagerParameters,
    configSchema: pluginMetadata?.configSchema,
  },
};
const writeMode = process.argv.includes("--write");
if (writeMode) {
  if (existsSync(mapPath) || existsSync(matrixPath)) fail("X_GATE_OUTPUT_ALREADY_EXISTS");
  validateRuntimeIdentity(sources.runtime, sources.manifest, sources.skill);
  validateTraceIdentity({
    plan_path: "总功能开发计划0.4.md",
    plan_sha256: sources.trace.generated_from.plan.sha256,
    generator_sha256: sources.trace.generated_from.generator.sha256,
    requirements: 74,
    cases: 153,
    tasks: 63,
    governance: 69,
    evidence: 34,
  }, sources.trace);
  for (const path of expectedExistingInputs.filter((value) => value !== matrixPath)) assertOrdinaryExisting(path);
  const created = [];
  try {
    const generatedMap = buildMap(sources);
    validateMap(generatedMap, sources, { checkRepository: false });
    atomicWriteNew(mapPath, generatedMap);
    created.push(mapPath);
    const generatedMatrix = buildMatrix(generatedMap);
    validateMatrix(generatedMatrix, generatedMap, { checkRepository: false });
    atomicWriteNew(matrixPath, generatedMatrix);
    created.push(matrixPath);
  } catch (error) {
    for (const path of created.reverse()) if (existsSync(path)) rmSync(path, { force: true });
    throw error;
  }
}
if (!existsSync(mapPath)) fail("X_GATE_SELECTED_ROUTE_MAP_ABSENT");
if (!existsSync(matrixPath)) fail("X_GATE_MATRIX_ABSENT");
const map = JSON.parse(readFileSync(mapPath, "utf8"));
const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
validateMap(map, sources);
validateMatrix(matrix, map);

let mutations = 0;
if (process.argv.includes("--self-test")) {
  const bundle = { map, matrix, sources };
  const variants = [
    ["missing_task", (value) => value.map.task_paths.pop()],
    ["extra_task", (value) => value.map.task_paths.push(clone(value.map.task_paths[0]))],
    ["reordered_task", (value) => value.map.task_paths.reverse()],
    ["changed_route", (value) => { value.map.selected_route = "A"; }],
    ["changed_root", (value) => { value.map.selected_route_root = value.map.project_root; }],
    ["changed_config", (value) => { value.map.config.key = "data_root"; }],
    ["changed_contract", (value) => { value.map.contract.version = 3; }],
    ["changed_candidate", (value) => { value.map.prerequisites[1].commit = "0".repeat(40); }],
    ["changed_ev", (value) => { value.map.prerequisites[2].evidence_id = "EV-FAKE"; }],
    ["changed_decision", (value) => { value.map.decision = "return_to_b_slice"; }],
    ["relative_path", (value) => { value.map.task_paths[0].paths[0] = "relative.ts"; }],
    ["escaped_path", (value) => { value.map.task_paths[0].paths[0] = resolve(value.map.project_root, "..", "escaped.ts"); }],
    ["outside_root", (value) => { value.map.project_root = resolve(value.map.project_root, "version-b-lite-plugin"); }],
    ["missing_current_input", (value) => { value.map.planned_path_semantics.current_inputs_must_exist_as_ordinary_non_reparse_objects[0] = resolve(projectRoot, "missing-input"); }],
    ["skill_contract_drift", (value) => { value.sources.skill = value.sources.skill.replace(expectedContract.id, "diet-manager/contract-v1"); }],
    ["runtime_contract_drift", (value) => { value.sources.runtime.contract.version = 1; }],
    ["schema_contract_drift", (value) => { value.sources.runtime.parameters["x-diet-manager-contract"].sha256 = "0".repeat(64); }],
    ["manifest_contract_drift", (value) => { value.sources.manifest.configSchema["x-diet-manager-contract"].version = 1; }],
    ["stale_trace", (value) => { value.map.trace_identity.plan_sha256 = "0".repeat(64); }],
    ["premature_claim", (value) => { value.map.forbidden_claims.pop(); }],
  ];
  for (const [label, mutate] of variants) {
    expectMutationFailure(bundle, mutate, label);
    mutations += 1;
  }
}

console.log(`X_GATE_002|PASS|mode=${writeMode ? "write" : "validate"}|decision=${map.decision}|tasks=${map.task_paths.length}|paths=${map.task_paths.reduce((sum, item) => sum + item.paths.length, 0)}|mutations=${mutations}`);
