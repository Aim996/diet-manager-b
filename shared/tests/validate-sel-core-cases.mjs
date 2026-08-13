import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '..', '..');
const PLAN_PATH = resolve(REPOSITORY_ROOT, '总功能开发计划0.4.md');
const CASES_PATH = resolve(REPOSITORY_ROOT, 'shared', 'acceptance-cases', 'cases.json');
const FIXTURES_PATH = resolve(
  REPOSITORY_ROOT,
  'shared',
  'acceptance-cases',
  'fixtures',
  'core-v1.json',
);

const EXPECTED = Object.freeze([
  'CASE-MEAL-001', 'CASE-MEAL-021', 'CASE-MEAL-017', 'CASE-MEAL-009',
  'CASE-WATER-001', 'CASE-SCOPE-001', 'CASE-MEAL-002', 'CASE-PURCHASE-004',
  'CASE-RECEIPT-002', 'CASE-MEAL-010', 'CASE-MEAL-011', 'CASE-MEAL-012',
  'CASE-MEAL-013', 'CASE-MEAL-014', 'CASE-MEAL-015', 'CASE-MEAL-016',
  'CASE-MEAL-018', 'CASE-MEAL-019', 'CASE-MEAL-020', 'CASE-WATER-003',
  'CASE-WATER-004',
]);

const EXACT_CASE_KEYS = Object.freeze([
  'id', 'requirement_ids', 'stage', 'source_text', 'setup', 'oracle', 'forbidden',
]);

const REQUIRED_ORACLE_FIELDS = Object.freeze({
  'CASE-MEAL-001': ['command', 'parsing', 'fact_commit', 'finalization'],
  'CASE-MEAL-021': ['command', 'parsing', 'fact_commit', 'finalization'],
  'CASE-MEAL-017': ['command', 'parsing', 'fact_commit'],
  'CASE-MEAL-009': ['command', 'parsing', 'fact_commit'],
  'CASE-WATER-001': ['command', 'fact_commit', 'finalization'],
  'CASE-SCOPE-001': ['command', 'parsing', 'factual_query', 'business_effects'],
  'CASE-MEAL-002': ['command', 'parsing', 'fact_commit'],
  'CASE-PURCHASE-004': ['command', 'parsing', 'fact_commit'],
  'CASE-RECEIPT-002': ['receipt', 'quick_options'],
  'CASE-MEAL-010': ['command', 'parsing', 'fact_commit'],
  'CASE-MEAL-011': ['command', 'parsing', 'business_effects'],
  'CASE-MEAL-012': ['command', 'parsing', 'fact_commit'],
  'CASE-MEAL-013': ['command', 'parsing', 'business_effects'],
  'CASE-MEAL-014': ['command', 'parsing', 'fact_commit'],
  'CASE-MEAL-015': ['command', 'parsing', 'business_effects'],
  'CASE-MEAL-016': ['command', 'parsing', 'business_effects'],
  'CASE-MEAL-018': ['command', 'parsing', 'fact_commit'],
  'CASE-MEAL-019': ['command', 'parsing', 'fact_commit'],
  'CASE-MEAL-020': ['command', 'parsing', 'fact_commit'],
  'CASE-WATER-003': ['command', 'parsing', 'fact_commit'],
  'CASE-WATER-004': ['command', 'parsing', 'fact_commit'],
});

function fail(code) {
  throw new Error(code);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`SEL_CORE_${label}_JSON_INVALID`);
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertExactStrings(actual, expected, code) {
  if (!Array.isArray(actual) || actual.length !== expected.length) fail(code);
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      fail(`${code}:index=${index}:expected=${expected[index]}:actual=${String(actual[index])}`);
    }
  }
}

function planCaseIds() {
  const line = readFileSync(PLAN_PATH, 'utf8')
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith('| `SEL-CORE-001` |') && candidate.includes('C['));
  if (line === undefined) fail('SEL_CORE_PLAN_ROW_MISSING');
  const match = line.match(/C\[([^\]]+)\]/u);
  if (match === null) fail('SEL_CORE_PLAN_CASE_LIST_MISSING');
  return match[1].split(',').map((value) => value.trim());
}

function fixtureIds(fixtures) {
  if (!isPlainObject(fixtures)) fail('SEL_CORE_FIXTURE_CATALOG_SHAPE_INVALID');
  const result = new Set();
  for (const [groupName, group] of Object.entries(fixtures)) {
    if (!Array.isArray(group)) continue;
    for (const entry of group) {
      if (!isPlainObject(entry) || typeof entry.fixture_id !== 'string') {
        fail(`SEL_CORE_FIXTURE_SHAPE_INVALID:${groupName}`);
      }
      if (result.has(entry.fixture_id)) fail(`SEL_CORE_FIXTURE_ID_DUPLICATE:${entry.fixture_id}`);
      result.add(entry.fixture_id);
    }
  }
  return result;
}

function fixtureById(fixtures, fixtureId) {
  const matches = Object.values(fixtures)
    .filter(Array.isArray)
    .flat()
    .filter((entry) => isPlainObject(entry) && entry.fixture_id === fixtureId);
  if (matches.length !== 1) fail(`SEL_CORE_FIXTURE_ID_INVALID:${fixtureId}`);
  return matches[0];
}

function assertExactJson(actual, expected, code) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code);
}

function validateOwnedFixtures(fixtures) {
  assertExactJson(
    fixtureById(fixtures, 'env-zh-cn-20260811-0100'),
    {
      fixture_id: 'env-zh-cn-20260811-0100',
      clock: '2026-08-11T01:00:00+08:00',
      timezone: 'Asia/Shanghai',
      locale: 'zh-CN',
      week_start: 'monday',
    },
    'SEL_CORE_OWNED_FIXTURE_INVALID:env-zh-cn-20260811-0100',
  );
  assertExactJson(
    fixtureById(fixtures, 'core-purchase-no-expiration-v1'),
    {
      fixture_id: 'core-purchase-no-expiration-v1',
      scenario_type: 'shelf_life_time_anchor',
      product: { normalized_name: 'fresh_milk', explicit_expires_at: null },
      time_anchors: {
        stocked_at: '2026-08-10T16:00:00+08:00',
        received_at: '2026-08-10T16:00:00+08:00',
        ingestion_at: null,
        timezone: 'Asia/Shanghai',
      },
      shelf_life_rule: {
        rule_version: 'diet-manager/fresh-milk-shelf-life-v1',
        days: 7,
        anchor_field: 'stocked_at',
      },
      expected: {
        estimated_expires_at: '2026-08-17T16:00:00+08:00',
        resolution_basis: 'stocked_at',
        must_not_anchor_to: 'ingestion_at',
      },
    },
    'SEL_CORE_OWNED_FIXTURE_INVALID:core-purchase-no-expiration-v1',
  );
}

function validateCase(candidate, knownFixtureIds) {
  if (!isPlainObject(candidate)) fail('SEL_CORE_CASE_SHAPE_INVALID:not_object');
  assertExactStrings(Object.keys(candidate), EXACT_CASE_KEYS, `SEL_CORE_CASE_KEYS_INVALID:${String(candidate.id)}`);
  const id = candidate.id;
  if (typeof id !== 'string' || !EXPECTED.includes(id)) fail(`SEL_CORE_CASE_ID_INVALID:${String(id)}`);
  if (
    !Array.isArray(candidate.requirement_ids)
    || candidate.requirement_ids.length === 0
    || candidate.requirement_ids.some((value) => typeof value !== 'string' || !/^REQ-[A-Z0-9-]+$/u.test(value))
    || new Set(candidate.requirement_ids).size !== candidate.requirement_ids.length
  ) {
    fail(`SEL_CORE_CASE_REQUIREMENTS_INVALID:${id}`);
  }
  if (candidate.stage !== 'PRODUCT-0.1') fail(`SEL_CORE_CASE_STAGE_INVALID:${id}`);
  if (typeof candidate.source_text !== 'string' || candidate.source_text.trim().length === 0) {
    fail(`SEL_CORE_CASE_SOURCE_INVALID:${id}`);
  }
  if (!isPlainObject(candidate.setup) || !Array.isArray(candidate.setup.prior_context)) {
    fail(`SEL_CORE_CASE_SETUP_INVALID:${id}`);
  }
  for (const [name, value] of Object.entries(candidate.setup)) {
    if (!name.endsWith('_fixture') || value === null) continue;
    if (typeof value !== 'string' || !knownFixtureIds.has(value)) {
      fail(`SEL_CORE_FIXTURE_REFERENCE_INVALID:${id}:${name}:${String(value)}`);
    }
  }
  if (!isPlainObject(candidate.oracle) || Object.keys(candidate.oracle).length === 0) {
    fail(`SEL_CORE_CASE_ORACLE_INVALID:${id}`);
  }
  for (const field of REQUIRED_ORACLE_FIELDS[id]) {
    if (!Object.hasOwn(candidate.oracle, field)) {
      fail(`SEL_CORE_CASE_ORACLE_FIELD_MISSING:${id}:${field}`);
    }
  }
  if (
    !Array.isArray(candidate.forbidden)
    || candidate.forbidden.length === 0
    || candidate.forbidden.some((value) => typeof value !== 'string' || !/^[a-z0-9_]+$/u.test(value))
    || new Set(candidate.forbidden).size !== candidate.forbidden.length
  ) {
    fail(`SEL_CORE_CASE_FORBIDDEN_INVALID:${id}`);
  }
}

function validateCandidate(catalog, fixtures) {
  assertExactStrings(planCaseIds(), EXPECTED, 'SEL_CORE_PLAN_CASE_IDS_INVALID');
  if (!isPlainObject(catalog) || !Array.isArray(catalog.cases)) {
    fail('SEL_CORE_CASE_CATALOG_SHAPE_INVALID');
  }
  const rowsById = new Map();
  for (const candidate of catalog.cases) {
    if (!isPlainObject(candidate) || typeof candidate.id !== 'string' || !EXPECTED.includes(candidate.id)) continue;
    const rows = rowsById.get(candidate.id) ?? [];
    rows.push(candidate);
    rowsById.set(candidate.id, rows);
  }
  const missing = EXPECTED.filter((id) => !rowsById.has(id));
  if (missing.length !== 0) fail(`SEL_CORE_CASES_MISSING:${missing.join(',')}`);
  for (const id of EXPECTED) {
    if (rowsById.get(id).length !== 1) fail(`SEL_CORE_CASE_DUPLICATE:${id}`);
  }
  const actualOrder = catalog.cases
    .filter((candidate) => isPlainObject(candidate) && EXPECTED.includes(candidate.id))
    .map((candidate) => candidate.id);
  assertExactStrings(actualOrder, EXPECTED, 'SEL_CORE_CASE_ORDER_INVALID');
  if (catalog.version !== '1.5.0') fail(`SEL_CORE_CASE_CATALOG_VERSION_INVALID:${String(catalog.version)}`);
  if (fixtures.version !== '1.3.0') fail(`SEL_CORE_FIXTURE_CATALOG_VERSION_INVALID:${String(fixtures.version)}`);
  const knownFixtureIds = fixtureIds(fixtures);
  validateOwnedFixtures(fixtures);
  for (const id of EXPECTED) validateCase(rowsById.get(id)[0], knownFixtureIds);
  return knownFixtureIds.size;
}

function expectMutation(name, catalog, fixtures, mutate, expectedPrefix) {
  const mutatedCatalog = cloneJson(catalog);
  const mutatedFixtures = cloneJson(fixtures);
  mutate(mutatedCatalog, mutatedFixtures);
  try {
    validateCandidate(mutatedCatalog, mutatedFixtures);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith(expectedPrefix)) {
      fail(`SEL_CORE_MUTATION_WRONG_ERROR:${name}:expected=${expectedPrefix}:actual=${message}`);
    }
    process.stdout.write(`SEL_CORE_MUTATION|PASS|name=${name}|rejected=${message}\n`);
    return;
  }
  fail(`SEL_CORE_MUTATION_NOT_REJECTED:${name}`);
}

function runSelfTests(catalog, fixtures) {
  const selected = (candidate, id) => candidate.cases.find((entry) => entry.id === id);
  const mutations = [
    ['delete', (candidate) => {
      candidate.cases = candidate.cases.filter((entry) => entry.id !== 'CASE-MEAL-017');
    }, 'SEL_CORE_CASES_MISSING:CASE-MEAL-017'],
    ['add', (candidate) => {
      candidate.cases.push(cloneJson(selected(candidate, 'CASE-MEAL-001')));
    }, 'SEL_CORE_CASE_DUPLICATE:CASE-MEAL-001'],
    ['reorder', (candidate) => {
      const left = candidate.cases.findIndex((entry) => entry.id === 'CASE-MEAL-001');
      const right = candidate.cases.findIndex((entry) => entry.id === 'CASE-MEAL-021');
      [candidate.cases[left], candidate.cases[right]] = [candidate.cases[right], candidate.cases[left]];
    }, 'SEL_CORE_CASE_ORDER_INVALID'],
    ['change_id', (candidate) => {
      selected(candidate, 'CASE-MEAL-017').id = 'CASE-MEAL-999';
    }, 'SEL_CORE_CASES_MISSING:CASE-MEAL-017'],
    ['remove_oracle_field', (candidate) => {
      delete selected(candidate, 'CASE-MEAL-009').oracle.command;
    }, 'SEL_CORE_CASE_ORACLE_FIELD_MISSING:CASE-MEAL-009:command'],
    ['unknown_fixture', (candidate) => {
      selected(candidate, 'CASE-MEAL-009').setup.environment_fixture = 'fixture-does-not-exist';
    }, 'SEL_CORE_FIXTURE_REFERENCE_INVALID:CASE-MEAL-009:environment_fixture:fixture-does-not-exist'],
  ];
  for (const [name, mutate, prefix] of mutations) {
    expectMutation(name, catalog, fixtures, mutate, prefix);
  }
  return mutations.length;
}

try {
  const catalog = readJson(CASES_PATH, 'CASE_CATALOG');
  const fixtures = readJson(FIXTURES_PATH, 'FIXTURE_CATALOG');
  const fixtureCount = validateCandidate(catalog, fixtures);
  const mutationCount = process.argv.includes('--self-test') ? runSelfTests(catalog, fixtures) : 0;
  process.stdout.write(
    `SEL_CORE_CASES|PASS|cases=${EXPECTED.length}|catalog=1.5.0|fixtures=${fixtureCount}|mutations=${mutationCount}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`SEL_CORE_CASES|FAIL|${message}\n`);
  process.exitCode = 1;
}
