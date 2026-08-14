import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOG_PATH = path.join(ROOT, 'shared', 'acceptance-cases', 'cases.json');
const FIXTURES_PATH = path.join(ROOT, 'shared', 'acceptance-cases', 'fixtures', 'core-v1.json');
const BRIEF_PATH = path.join(ROOT, 'docs', 'work-items', 'SEL-NUTR-001-brief.md');

export const EXPECTED_NUTRITION_CASE_IDS = Object.freeze([
  'CASE-NUTR-001', 'CASE-NUTR-002', 'CASE-NUTR-003', 'CASE-NUTR-004',
  'CASE-NUTR-005', 'CASE-NUTR-006', 'CASE-NUTR-008', 'CASE-NUTR-009',
  'CASE-MEAL-003', 'CASE-MEAL-006', 'CASE-MEAL-007', 'CASE-MEAL-008',
  'CASE-SOURCE-001', 'CASE-SOURCE-002', 'CASE-SOURCE-003',
]);

const SOURCE_TEXT = Object.freeze({
  'CASE-NUTR-001': '喝了一盒这个牛奶。',
  'CASE-NUTR-002': '早餐吃了一个鸡蛋、一碗米饭和一个苹果。',
  'CASE-NUTR-003': '午饭吃了蛋炒饭。',
  'CASE-NUTR-004': '喝了奇亚籽牛油果青瓜液体沙拉。',
  'CASE-NUTR-005': '今天又喝了一盒同款牛奶。',
  'CASE-NUTR-006': '吃了这个只标了蛋白质和能量的食品。',
  'CASE-NUTR-008': '吃了一个橙子。',
  'CASE-NUTR-009': '吃了200g米饭。',
  'CASE-MEAL-003': '午饭吃了半碗米饭',
  'CASE-MEAL-006': '午饭吃了米饭200g、鸡胸150g。',
  'CASE-MEAL-007': '午饭吃了一碗牛肉面。',
  'CASE-MEAL-008': '吃了一个肉夹馍套餐。',
  'CASE-SOURCE-001': '吃了一个苹果。',
  'CASE-SOURCE-002': '检查营养来源状态。',
  'CASE-SOURCE-003': '午饭吃了一个苹果。',
});

const DOMAIN_FIXTURES = Object.freeze({
  'CASE-NUTR-001': 'domain-nutrition-label-milk-v1',
  'CASE-NUTR-002': 'domain-nutrition-authoritative-basics-v1',
  'CASE-NUTR-003': 'domain-nutrition-common-dish-v1',
  'CASE-NUTR-004': 'domain-nutrition-unknown-custom-drink-v1',
  'CASE-NUTR-005': 'domain-nutrition-profile-history-v1',
  'CASE-NUTR-006': 'domain-nutrition-partial-fields-v1',
  'CASE-NUTR-008': 'domain-nutrition-orange-range-v1',
  'CASE-NUTR-009': 'domain-nutrition-explicit-rice-v1',
  'CASE-MEAL-003': 'domain-nutrition-bounded-rice-v1',
  'CASE-MEAL-006': 'domain-nutrition-explicit-meal-v1',
  'CASE-MEAL-007': 'domain-nutrition-beef-noodle-template-v1',
  'CASE-MEAL-008': 'domain-nutrition-unknown-combo-v1',
  'CASE-SOURCE-001': 'domain-source-tier-traversal-v1',
  'CASE-SOURCE-002': 'domain-source-doctor-health-v1',
  'CASE-SOURCE-003': 'domain-source-offline-degradation-v1',
});

const CASE_KEYS = Object.freeze(['forbidden', 'id', 'oracle', 'requirement_ids', 'setup', 'source_text', 'stage']);
const SETUP_KEYS = Object.freeze(['domain_scenario_fixture', 'environment_fixture', 'goals_fixture', 'prior_context', 'query_view_fixture']);
const FIXTURE_BASE_KEYS = Object.freeze(['fixture_id', 'received_at', 'scenario_type']);

function fail(code, detail = '') { throw new Error(detail ? `${code}:${detail}` : code); }
function exactKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) fail(code);
}
function pointerExists(value, pointer) {
  for (const part of pointer.split('/').slice(1)) {
    if (!value || typeof value !== 'object' || !(part in value)) return false;
    value = value[part];
  }
  return true;
}
function fixtureMap(fixtures) {
  const values = Object.values(fixtures).flatMap((value) => Array.isArray(value) ? value : []);
  const result = new Map();
  for (const fixture of values) {
    if (!fixture?.fixture_id || result.has(fixture.fixture_id)) fail('SEL_NUTR_FIXTURE_DUPLICATE', String(fixture?.fixture_id));
    result.set(fixture.fixture_id, fixture);
  }
  return result;
}
function assertionPathsFromBrief(briefText = fs.readFileSync(BRIEF_PATH, 'utf8')) {
  const start = briefText.indexOf('case_assertion_paths:');
  const end = briefText.indexOf('full_case_set: none', start);
  if (start < 0 || end < 0) fail('SEL_NUTR_BRIEF_PATHS_MISSING');
  const result = new Map();
  let current = null;
  for (const line of briefText.slice(start, end).split(/\r?\n/)) {
    const caseMatch = line.match(/^  (CASE-[A-Z]+-\d{3}):$/);
    if (caseMatch) { current = caseMatch[1]; result.set(current, []); continue; }
    const pathMatch = line.match(/^    - (\/oracle\/.+)$/);
    if (pathMatch && current) result.get(current).push(pathMatch[1]);
  }
  return result;
}

export function validateSelectedNutritionCases(catalog, fixtures, options = {}) {
  if (catalog?.version !== '1.7.0' || !Array.isArray(catalog.cases)) fail('SEL_NUTR_CATALOG_IDENTITY');
  if (fixtures?.version !== '1.5.0') fail('SEL_NUTR_FIXTURE_IDENTITY');
  const byId = new Map(catalog.cases.map((entry) => [entry.id, entry]));
  if (byId.size !== catalog.cases.length) fail('SEL_NUTR_CATALOG_DUPLICATE');
  const fixturesById = fixtureMap(fixtures);
  const pathsById = options.pathsById ?? assertionPathsFromBrief(options.briefText);
  if (JSON.stringify([...pathsById.keys()]) !== JSON.stringify(EXPECTED_NUTRITION_CASE_IDS)) fail('SEL_NUTR_BRIEF_ORDER');

  const selected = EXPECTED_NUTRITION_CASE_IDS.map((id) => {
    const entry = byId.get(id);
    if (!entry) fail('SEL_NUTR_CASE_MISSING', id);
    exactKeys(entry, CASE_KEYS, 'SEL_NUTR_CASE_KEYS');
    if (entry.stage !== 'PRODUCT-0.1' || entry.source_text !== SOURCE_TEXT[id] ||
        !Array.isArray(entry.requirement_ids) || entry.requirement_ids.length === 0 ||
        !Array.isArray(entry.forbidden) || entry.forbidden.length === 0 ||
        new Set(entry.forbidden).size !== entry.forbidden.length) fail('SEL_NUTR_CASE_AUTHORITY', id);
    exactKeys(entry.setup, SETUP_KEYS, 'SEL_NUTR_SETUP_KEYS');
    if (entry.setup.domain_scenario_fixture !== DOMAIN_FIXTURES[id] || !Array.isArray(entry.setup.prior_context)) {
      fail('SEL_NUTR_FIXTURE_BINDING', id);
    }
    const fixture = fixturesById.get(DOMAIN_FIXTURES[id]);
    if (!fixture || typeof fixture.scenario_type !== 'string' || typeof fixture.received_at !== 'string' ||
        Object.keys(fixture).length <= FIXTURE_BASE_KEYS.length) fail('SEL_NUTR_FIXTURE_MISSING', id);
    const paths = pathsById.get(id);
    if (!Array.isArray(paths) || paths.length === 0 || paths.some((pointer) => !pointerExists(entry, pointer))) {
      fail('SEL_NUTR_ORACLE_PATH_MISSING', id);
    }
    return structuredClone(entry);
  });
  return Object.freeze(selected.map((entry) => Object.freeze(entry)));
}

function expectFailure(code, action) {
  let observed = null;
  try { action(); } catch (error) { observed = String(error.message).split(':')[0]; }
  if (observed !== code) fail('SEL_NUTR_SELF_TEST_ACCEPTED', `${code}:${observed ?? 'none'}`);
}

function runSelfTests(catalog, fixtures) {
  const paths = assertionPathsFromBrief();
  validateSelectedNutritionCases(catalog, fixtures, { pathsById: paths });
  const cases = [
    ['SEL_NUTR_CASE_MISSING', (c) => { c.cases = c.cases.filter(({ id }) => id !== 'CASE-NUTR-003'); }],
    ['SEL_NUTR_CATALOG_DUPLICATE', (c) => { c.cases.push(structuredClone(c.cases[0])); }],
    ['SEL_NUTR_CASE_AUTHORITY', (c) => { c.cases.find(({ id }) => id === 'CASE-MEAL-003').source_text += '。'; }],
    ['SEL_NUTR_CASE_KEYS', (c) => { c.cases.find(({ id }) => id === 'CASE-NUTR-002').expected = true; }],
    ['SEL_NUTR_FIXTURE_BINDING', (c) => { c.cases.find(({ id }) => id === 'CASE-NUTR-006').setup.domain_scenario_fixture = 'wrong'; }],
    ['SEL_NUTR_CASE_AUTHORITY', (c) => { c.cases.find(({ id }) => id === 'CASE-SOURCE-001').forbidden = []; }],
  ];
  for (const [code, mutate] of cases) {
    const copy = structuredClone(catalog); mutate(copy);
    expectFailure(code, () => validateSelectedNutritionCases(copy, fixtures, { pathsById: paths }));
  }
  const missingFixture = structuredClone(fixtures);
  missingFixture.domain_scenarios = missingFixture.domain_scenarios.filter(({ fixture_id }) => fixture_id !== 'domain-nutrition-orange-range-v1');
  expectFailure('SEL_NUTR_FIXTURE_MISSING', () => validateSelectedNutritionCases(catalog, missingFixture, { pathsById: paths }));
  const wrongFixtureVersion = structuredClone(fixtures); wrongFixtureVersion.version = '1.4.0';
  expectFailure('SEL_NUTR_FIXTURE_IDENTITY', () => validateSelectedNutritionCases(catalog, wrongFixtureVersion, { pathsById: paths }));
  const missingPath = new Map(paths); missingPath.set('CASE-NUTR-001', ['/oracle/missing']);
  expectFailure('SEL_NUTR_ORACLE_PATH_MISSING', () => validateSelectedNutritionCases(catalog, fixtures, { pathsById: missingPath }));
  const reordered = new Map([...paths]);
  const first = reordered.get('CASE-NUTR-001'); reordered.delete('CASE-NUTR-001'); reordered.set('CASE-NUTR-001', first);
  expectFailure('SEL_NUTR_BRIEF_ORDER', () => validateSelectedNutritionCases(catalog, fixtures, { pathsById: reordered }));
  return 10;
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8'));
  if (process.argv.includes('--self-test')) {
    const mutations = runSelfTests(catalog, fixtures);
    process.stdout.write(`SEL_NUTR_CASES|SELF_TEST|PASS|mutations=${mutations}|controls=1\n`);
  } else {
    const selected = validateSelectedNutritionCases(catalog, fixtures);
    process.stdout.write(`SEL_NUTR_CASES|PASS|cases=${selected.length}|catalog=${catalog.version}|fixtures=${selected.length}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
