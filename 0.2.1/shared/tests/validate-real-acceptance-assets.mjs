// validate-real-acceptance-assets.mjs
// 饮食管家 B 真实环境验收资产验证器（Task 16 交付）。
//
// 职责：在真实验收执行前，静态校验 scenarios.json / evidence.schema.json /
// run-real-acceptance.ps1 / runbook 的结构一致性与安全白名单，确保执行器
// 只会读取允许的 SQLite 表和列，且证据结构满足不可变候选绑定要求。
//
// 用法：
//   node shared/tests/validate-real-acceptance-assets.mjs            # 正向校验
//   node shared/tests/validate-real-acceptance-assets.mjs --self-test # 变异自检
//   node shared/tests/validate-real-acceptance-assets.mjs --mutation=<name>
//
// 成功：stdout 输出 `REAL_ACCEPTANCE_ASSETS|PASS|...`，退出码 0。
// 失败：stderr 输出 `REAL_ACCEPTANCE_ASSETS|FAIL|<code>`，退出码 1。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '..', '..');

const SCENARIOS_PATH = resolve(REPOSITORY_ROOT, 'shared', 'real-acceptance', 'scenarios.json');
const EVIDENCE_SCHEMA_PATH = resolve(REPOSITORY_ROOT, 'shared', 'real-acceptance', 'evidence.schema.json');
const RUNNER_PATH = resolve(REPOSITORY_ROOT, 'shared', 'real-acceptance', 'run-real-acceptance.ps1');
const RUNBOOK_PATH = resolve(REPOSITORY_ROOT, 'docs', 'acceptance', '0.1.1-real-environment-runbook.md');

const SCENARIOS_SCHEMA_VERSION = 'diet-manager/real-acceptance-scenarios/v1';

const EXPECTED_CATEGORIES = Object.freeze([
  'meal', 'zero_write', 'nutrition', 'inventory', 'correction', 'query', 'reliability', 'reply',
]);

const EXPECTED_OUTCOME_STATUSES = Object.freeze([
  'committed', 'committed_with_issues', 'needs_clarification', 'ignored', 'failed',
]);

// 白名单：执行器允许读取的表及其可查询列。任何未列出的表/列都被拒绝，防止
// 验收断言退化为任意 SQL 读取。
const ALLOWLISTED_TABLES = Object.freeze({
  event_records: ['event_type', 'fact_kind', 'meal_slot', 'lifecycle_status', 'result_status', 'conversation_id'],
  meal_items: ['event_id', 'normalized_name', 'item_type'],
  products: ['normalized_name', 'product_type'],
  inventory_batches: ['product_id'],
  inventory_batch_projections: ['quantity_status', 'seal_status', 'expiry_status', 'effective_status'],
  inventory_transactions: ['direction', 'reason_code', 'product_id'],
  nutrition_profiles: ['subject_id', 'coverage_status', 'source_type'],
  nutrition_snapshots: ['coverage_status', 'source_type'],
  goal_versions: ['user_id'],
  daily_progress_snapshots: ['date', 'coverage_status'],
  issues: ['issue_code', 'issue_type', 'status'],
  correction_events: ['operation'],
  command_envelopes: ['state', 'result_status'],
  envelope_finalizations: ['result_status'],
  mixed_item_results: ['status'],
});

const EVIDENCE_REQUIRED_FIELDS = Object.freeze([
  'schema_version', 'candidate_zip_sha256', 'source_commit', 'package_version',
  'node_version', 'openclaw_version', 'official_data_root', 'openclaw_state_root',
  'started_at', 'completed_at', 'scenario_results', 'secret_value_count',
]);

function fail(code) {
  throw new Error(code);
}

function readJson(path, code) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`${code}:ENOENT`);
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${code}:JSON_INVALID`);
  }
}

function readText(path, code) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`${code}:ENOENT`);
    throw error;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOptionalBoolean(scenario, field) {
  const value = scenario[field];
  if (value !== undefined && typeof value !== 'boolean') {
    fail(`SCENARIO_FIELD_INVALID:${scenario.id}:${field}`);
  }
}

function assertScenario(scenario) {
  if (!isRecord(scenario)) fail('SCENARIO_SHAPE_INVALID');
  const { id, category, title, input, expected_outcome_status, database_assertions } = scenario;
  if (typeof id !== 'string' || !id.startsWith('REAL-0.1.1-')) {
    fail(`SCENARIO_ID_INVALID:${String(id)}`);
  }
  if (typeof category !== 'string' || !EXPECTED_CATEGORIES.includes(category)) {
    fail(`SCENARIO_CATEGORY_INVALID:${id}:${String(category)}`);
  }
  if (typeof title !== 'string' || title.trim().length === 0) {
    fail(`SCENARIO_TITLE_MISSING:${id}`);
  }
  if (typeof input !== 'string' || input.length === 0) {
    fail(`SCENARIO_INPUT_MISSING:${id}`);
  }
  if (typeof expected_outcome_status !== 'string' || !EXPECTED_OUTCOME_STATUSES.includes(expected_outcome_status)) {
    fail(`SCENARIO_OUTCOME_STATUS_INVALID:${id}:${String(expected_outcome_status)}`);
  }
  if (scenario.setup !== undefined) {
    if (!Array.isArray(scenario.setup) || scenario.setup.some((s) => typeof s !== 'string' || s.length === 0)) {
      fail(`SCENARIO_SETUP_INVALID:${id}`);
    }
  }
  if (scenario.restore_kind !== undefined &&
      !['same_root', 'portable'].includes(scenario.restore_kind)) {
    fail(`SCENARIO_RESTORE_KIND_INVALID:${id}:${String(scenario.restore_kind)}`);
  }
  for (const field of ['snapshot_equality', 'restart_gateway', 'reload_plugin', 'requires_fdc_key']) {
    assertOptionalBoolean(scenario, field);
  }
  if (!Array.isArray(database_assertions) || database_assertions.length === 0) {
    fail(`SCENARIO_ASSERTIONS_EMPTY:${id}`);
  }
  for (const assertion of database_assertions) {
    assertDatabaseAssertion(id, assertion);
  }
}

function assertDatabaseAssertion(id, assertion) {
  if (!isRecord(assertion)) fail(`ASSERTION_SHAPE_INVALID:${id}`);
  const { table, where, expect_delta, expect_count } = assertion;
  if (typeof table !== 'string' || !(table in ALLOWLISTED_TABLES)) {
    fail(`ASSERTION_TABLE_NOT_ALLOWLISTED:${id}:${String(table)}`);
  }
  if (!isRecord(where)) fail(`ASSERTION_WHERE_INVALID:${id}:${String(table)}`);
  const allowedColumns = ALLOWLISTED_TABLES[table];
  for (const [column, value] of Object.entries(where)) {
    if (!allowedColumns.includes(column)) {
      fail(`ASSERTION_COLUMN_NOT_ALLOWLISTED:${id}:${table}:${column}`);
    }
    if (isRecord(value)) {
      if (!('$neq' in value) || typeof value.$neq !== 'string') {
        fail(`ASSERTION_OPERATOR_INVALID:${id}:${table}:${column}`);
      }
    } else if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      fail(`ASSERTION_VALUE_INVALID:${id}:${table}:${column}`);
    }
  }
  const numericExpectations = [expect_delta, expect_count].filter((v) => v !== undefined);
  if (numericExpectations.length !== 1) {
    fail(`ASSERTION_EXPECTATION_INVALID:${id}:${table}`);
  }
  const expectation = numericExpectations[0];
  if (!Number.isSafeInteger(expectation) || expectation < 0) {
    fail(`ASSERTION_EXPECTATION_NOT_INTEGER:${id}:${table}`);
  }
}

function validateScenarios(catalog) {
  if (!isRecord(catalog)) fail('SCENARIOS_CATALOG_SHAPE_INVALID');
  if (catalog.schema_version !== SCENARIOS_SCHEMA_VERSION) {
    fail(`SCENARIOS_SCHEMA_VERSION_INVALID:${String(catalog.schema_version)}`);
  }
  if (!Array.isArray(catalog.scenarios) || catalog.scenarios.length === 0) {
    fail('SCENARIOS_LIST_EMPTY');
  }
  const seen = new Set();
  const categories = new Set();
  for (const scenario of catalog.scenarios) {
    assertScenario(scenario);
    if (seen.has(scenario.id)) fail(`SCENARIO_ID_DUPLICATE:${scenario.id}`);
    seen.add(scenario.id);
    categories.add(scenario.category);
  }
  if (categories.size !== EXPECTED_CATEGORIES.length ||
      EXPECTED_CATEGORIES.some((c) => !categories.has(c))) {
    fail('SCENARIOS_CATEGORY_COVERAGE_INCOMPLETE');
  }
  return catalog.scenarios.length;
}

function validateEvidenceSchema(schema) {
  if (!isRecord(schema)) fail('EVIDENCE_SCHEMA_SHAPE_INVALID');
  if (schema.$id !== 'diet-manager/real-acceptance-evidence/v1') {
    fail(`EVIDENCE_SCHEMA_ID_INVALID:${String(schema.$id)}`);
  }
  if (schema.type !== 'object') fail('EVIDENCE_SCHEMA_TYPE_INVALID');
  if (!Array.isArray(schema.required)) fail('EVIDENCE_SCHEMA_REQUIRED_MISSING');
  const required = new Set(schema.required);
  for (const field of EVIDENCE_REQUIRED_FIELDS) {
    if (!required.has(field)) fail(`EVIDENCE_SCHEMA_REQUIRED_FIELD_MISSING:${field}`);
  }
  if (schema.properties?.secret_value_count?.const !== 0) {
    fail('EVIDENCE_SCHEMA_SECRET_COUNT_CONST_INVALID');
  }
}

function validateRunner(text) {
  if (!text.includes('openclaw agent')) fail('RUNNER_AGENT_INVOCATION_MISSING');
  if (!text.includes('gateway') || !text.includes('health')) fail('RUNNER_GATEWAY_HEALTH_MISSING');
  if (!text.includes('.tmp')) fail('RUNNER_TMP_ROOT_MISSING');
  if (!text.includes('secret_value_count')) fail('RUNNER_SECRET_COUNT_MISSING');
}

function validateCandidate(catalog, schema, runnerText) {
  const scenarioCount = validateScenarios(catalog);
  validateEvidenceSchema(schema);
  validateRunner(runnerText);
  return scenarioCount;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

// 变异自检：证明验证器真的能抓住典型错误，而非恒真。
function runSelfTests(catalog, schema, runnerText) {
  const mutations = [
    ['version', (c) => { c.schema_version = 'wrong/v1'; }, 'SCENARIOS_SCHEMA_VERSION_INVALID'],
    ['category', (c) => { c.scenarios[0].category = 'bogus'; }, 'SCENARIO_CATEGORY_INVALID'],
    ['id', (c) => { c.scenarios[0].id = 'X-0.1.1-x'; }, 'SCENARIO_ID_INVALID'],
    ['empty_assertions', (c) => { c.scenarios[0].database_assertions = []; }, 'SCENARIO_ASSERTIONS_EMPTY'],
    ['bad_table', (c) => {
      c.scenarios[0].database_assertions[0].table = 'users';
    }, 'ASSERTION_TABLE_NOT_ALLOWLISTED'],
    ['bad_column', (c) => {
      c.scenarios[0].database_assertions[0].where = { secret: 'x' };
    }, 'ASSERTION_COLUMN_NOT_ALLOWLISTED'],
    ['duplicate_id', (c) => { c.scenarios[1].id = c.scenarios[0].id; }, 'SCENARIO_ID_DUPLICATE'],
  ];
  const requestedMutation = process.argv
    .find((a) => a.startsWith('--mutation='))
    ?.slice('--mutation='.length);
  const selected = requestedMutation === undefined
    ? mutations
    : mutations.filter(([name]) => name === requestedMutation);
  if (requestedMutation !== undefined && selected.length !== 1) {
    fail(`MUTATION_UNKNOWN:${requestedMutation}`);
  }
  let checks = 0;
  for (const [name, mutate, prefix] of selected) {
    const candidate = cloneJson(catalog);
    mutate(candidate);
    let caught = null;
    try {
      validateCandidate(candidate, schema, runnerText);
    } catch (error) {
      caught = error?.message ?? String(error);
    }
    if (!caught?.startsWith(prefix)) {
      fail(`SELF_TEST_UNCAUGHT:${name}:expected=${prefix}:actual=${caught}`);
    }
    checks += 1;
  }
  return checks;
}

try {
  const catalog = readJson(SCENARIOS_PATH, 'SCENARIOS');
  const schema = readJson(EVIDENCE_SCHEMA_PATH, 'EVIDENCE_SCHEMA');
  const runnerText = readText(RUNNER_PATH, 'RUNNER');
  readText(RUNBOOK_PATH, 'RUNBOOK');
  const scenarioCount = validateCandidate(catalog, schema, runnerText);
  const selfChecks = process.argv.includes('--self-test')
    ? runSelfTests(catalog, schema, runnerText)
    : 0;
  process.stdout.write(
    `REAL_ACCEPTANCE_ASSETS|PASS|scenarios=${scenarioCount}|categories=${EXPECTED_CATEGORIES.length}|self_checks=${selfChecks}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`REAL_ACCEPTANCE_ASSETS|FAIL|${message}\n`);
  process.exitCode = 1;
}
