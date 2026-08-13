import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOG_PATH = path.join(ROOT, 'shared', 'acceptance-cases', 'cases.json');
const FIXTURES_PATH = path.join(ROOT, 'shared', 'acceptance-cases', 'fixtures', 'core-v1.json');
const BRIEF_PATH = path.join(ROOT, 'docs', 'work-items', 'SEL-PANTRY-001-brief.md');

const EXPECTED = Object.freeze([
  'CASE-PURCHASE-001', 'CASE-PURCHASE-003', 'CASE-PURCHASE-007',
  'CASE-INVENTORY-001', 'CASE-INVENTORY-002', 'CASE-INVENTORY-003',
  'CASE-INVENTORY-005', 'CASE-INVENTORY-004', 'CASE-INVENTORY-009',
  'CASE-MEAL-004', 'CASE-MEAL-005', 'CASE-PURCHASE-002',
  'CASE-PURCHASE-005', 'CASE-PURCHASE-006', 'CASE-PURCHASE-008',
  'CASE-PURCHASE-009', 'CASE-PURCHASE-010',
]);

const FORBIDDEN_LAYERS = Object.freeze([
  'parser', 'identity', 'quantity', 'fact', 'effect', 'projection',
  'receipt', 'idempotency', 'privacy',
]);

const CASE_KEYS = Object.freeze(['id', 'requirement_ids', 'stage', 'source_text', 'setup', 'oracle', 'forbidden']);
const SOURCE_TEXT = Object.freeze({
  'CASE-PURCHASE-001': '买了两箱牛奶，每箱12盒，每盒250ml。',
  'CASE-PURCHASE-003': '买了鲜牛奶。',
  'CASE-PURCHASE-007': '又买了同品牌同口味同规格的250ml牛奶。',
  'CASE-INVENTORY-001': '喝了一盒这个牛奶。',
  'CASE-INVENTORY-002': '喝了两盒这个牛奶。',
  'CASE-INVENTORY-003': '早餐喝了一盒牛奶。',
  'CASE-INVENTORY-005': '吃了半碗米饭。',
  'CASE-INVENTORY-004': '喝了一盒这个牛奶。',
  'CASE-INVENTORY-009': '喝了一盒这个牛奶。',
  'CASE-MEAL-004': '在公司吃了一个苹果。',
  'CASE-MEAL-005': '吃了一个苹果，只记录，别扣库存。',
  'CASE-PURCHASE-002': '买了一袋鸡蛋。',
  'CASE-PURCHASE-005': '买了这个商品，包装上没有可靠保质期。',
  'CASE-PURCHASE-006': '买了牛奶、鸡蛋和苹果。',
  'CASE-PURCHASE-008': '买了这个牛奶。',
  'CASE-PURCHASE-009': '刚买的这瓶牛奶已经喝了一部分。',
  'CASE-PURCHASE-010': '更正：这批牛奶放在冷藏室，不是常温柜。',
});

function fail(code) {
  throw new Error(code);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function pointerExists(value, pointer) {
  return pointer.split('/').slice(1).every((part) => {
    if (value === null || typeof value !== 'object' || !(part in value)) return false;
    value = value[part];
    return true;
  });
}

function assertionPathsFromBrief() {
  const brief = fs.readFileSync(BRIEF_PATH, 'utf8');
  const start = brief.indexOf('case_assertion_paths:');
  const section = brief.slice(start, brief.indexOf('full_case_set: none', start));
  const paths = new Map();
  let id = null;
  for (const line of section.split(/\r?\n/)) {
    const caseMatch = line.match(/^  (CASE-[A-Z]+-\d{3}):$/);
    if (caseMatch) {
      id = caseMatch[1];
      paths.set(id, []);
    }
    const pointer = line.match(/^    - (\/oracle\/.+)$/);
    if (pointer && id) paths.get(id).push(pointer[1]);
  }
  return paths;
}

function fixtureIds(fixtures) {
  return new Set(Object.values(fixtures).flatMap((entries) => Array.isArray(entries) ? entries.map(({ fixture_id }) => fixture_id).filter(Boolean) : []));
}

function forbiddenLayer(token) {
  const mapping = {
    collapsed_package_quantities: 'quantity', invented_expiry_date: 'projection', invented_user_fact: 'fact',
    unlabeled_location_inference: 'receipt', invented_user_statement: 'fact', merging_non_exact_variant: 'identity',
    deleting_identity_history: 'identity', duplicate_deduction: 'effect', template_amount_as_stock_evidence: 'quantity',
    different_product_auto_selection: 'identity', expired_first: 'projection', negative_stock: 'projection', negative_inventory: 'projection',
    automatic_inventory_selection: 'identity', fact_commit_rollback: 'fact', nutrition_grams_as_inventory_quantity: 'quantity',
    zero_invented: 'quantity', partial_deduction_without_authorization: 'effect', automatic_expired_selection: 'projection',
    expired_batch_deletion: 'projection', home_default_inventory_access: 'privacy', home_default_inventory_deduction: 'effect',
    ignoring_explicit_skip: 'parser', fact_rollback: 'fact', outer_amount_missing: 'quantity', inventing_eggs_per_bag: 'quantity',
    guessed_expiry: 'projection', guessed_expiry_days: 'projection', blended_product_batch: 'identity', duplicated_shared_issue: 'effect',
    silent_identity_reuse: 'identity', forced_option: 'identity', unbounded_list: 'identity', silent_opening_without_evidence: 'projection',
    rewriting_source_text: 'parser', physical_overwrite: 'effect', duplicated_correction: 'idempotency', stale_expiry: 'projection',
  };
  return mapping[token];
}

function fixtureOracleKey(value) {
  if (value === null || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:expected|assert|oracle|result|outcome|require)/i.test(key)) return key;
    const nested = fixtureOracleKey(child);
    if (nested) return nested;
  }
  return null;
}

function validate(catalog = readJson(CATALOG_PATH), fixtures = readJson(FIXTURES_PATH), expected = EXPECTED) {
  const byId = new Map(catalog.cases.map((entry) => [entry.id, entry]));
  if (expected.length < EXPECTED.length) fail('SEL_PANTRY_EXPECTED_ID_MISSING');
  if (expected.length > EXPECTED.length) fail('SEL_PANTRY_EXPECTED_ID_EXTRA');
  if (expected.some((id, index) => id !== EXPECTED[index])) fail('SEL_PANTRY_EXPECTED_ID_ORDER');
  if (new Set(expected).size !== expected.length) fail('SEL_PANTRY_EXPECTED_ID_DUPLICATE');
  const selected = expected.map((id) => {
    const entry = byId.get(id);
    if (!entry) fail(`SEL_PANTRY_CASE_MISSING:${id}`);
    return entry;
  });
  if (catalog.version !== '1.6.0') fail('SEL_PANTRY_CATALOG_VERSION_DRIFT');
  if (byId.size !== catalog.cases.length) fail('SEL_PANTRY_CASE_DUPLICATE_ID');
  if (selected.length !== 17) fail('SEL_PANTRY_CASE_EXTRA_ID');
  const paths = assertionPathsFromBrief();
  const knownFixtures = fixtureIds(fixtures);
  for (const entry of selected) {
    if (Object.keys(entry).sort().join('|') !== [...CASE_KEYS].sort().join('|')) fail(`SEL_PANTRY_CASE_SHAPE:${entry.id}`);
    if (entry.stage !== 'PRODUCT-0.1') fail(`SEL_PANTRY_CASE_STAGE:${entry.id}`);
    if (entry.source_text !== SOURCE_TEXT[entry.id]) fail(`SEL_PANTRY_SOURCE_DRIFT:${entry.id}`);
    if (!entry.forbidden.length) fail(`SEL_PANTRY_FORBIDDEN_EMPTY:${entry.id}`);
    if (!knownFixtures.has(entry.setup.environment_fixture) || !knownFixtures.has(entry.setup.domain_scenario_fixture)) fail(`SEL_PANTRY_FIXTURE_UNKNOWN:${entry.id}`);
    const fixture = fixtures.domain_scenarios.find(({ fixture_id }) => fixture_id === entry.setup.domain_scenario_fixture);
    const oracleKey = fixtureOracleKey(fixture);
    if (oracleKey) fail(`SEL_PANTRY_FIXTURE_ORACLE_KEY:${fixture.fixture_id}:${oracleKey}`);
    for (const pointer of paths.get(entry.id) ?? []) if (!pointerExists(entry, pointer)) fail(`SEL_PANTRY_ASSERTION_MISSING:${entry.id}:${pointer}`);
    for (const token of entry.forbidden) if (!FORBIDDEN_LAYERS.includes(forbiddenLayer(token))) fail(`SEL_PANTRY_FORBIDDEN_UNKNOWN:${entry.id}:${token}`);
  }
  const outerOnly = byId.get('CASE-PURCHASE-002')?.oracle?.quantity_equation;
  if (outerOnly?.inner_count !== null || outerOnly?.capacity_per_inner !== null || outerOnly?.total !== null) fail('SEL_PANTRY_UNKNOWN_ZERO');
  return selected;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertMutation(label, mutate, expectedCode) {
  const catalog = clone(readJson(CATALOG_PATH));
  const fixtures = clone(readJson(FIXTURES_PATH));
  const expected = [...EXPECTED];
  mutate({ catalog, fixtures, expected });
  try {
    validate(catalog, fixtures, expected);
  } catch (error) {
    if (error.message.startsWith(expectedCode)) return;
    fail(`SEL_PANTRY_SELF_TEST_WRONG:${label}:${error.message}`);
  }
  fail(`SEL_PANTRY_SELF_TEST_ACCEPTED:${label}`);
}

function selfTest() {
  assertMutation('missing ID', ({ catalog }) => { catalog.cases = catalog.cases.filter(({ id }) => id !== 'CASE-PURCHASE-003'); }, 'SEL_PANTRY_CASE_MISSING:CASE-PURCHASE-003');
  assertMutation('extra ID', ({ expected }) => { expected.push('CASE-EXTRA-001'); }, 'SEL_PANTRY_EXPECTED_ID_EXTRA');
  assertMutation('reordered brief ID', ({ expected }) => { [expected[0], expected[1]] = [expected[1], expected[0]]; }, 'SEL_PANTRY_EXPECTED_ID_ORDER');
  assertMutation('duplicate ID', ({ catalog }) => { catalog.cases.push(clone(catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003'))); }, 'SEL_PANTRY_CASE_DUPLICATE_ID');
  assertMutation('unknown fixture', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').setup.domain_scenario_fixture = 'unknown-fixture'; }, 'SEL_PANTRY_FIXTURE_UNKNOWN:CASE-PURCHASE-003');
  assertMutation('missing assertion pointer', ({ catalog }) => { delete catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').oracle.receipt.inferred_fields_labeled; }, 'SEL_PANTRY_ASSERTION_MISSING:CASE-PURCHASE-003:/oracle/receipt/inferred_fields_labeled');
  assertMutation('extra case key', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').untrusted = true; }, 'SEL_PANTRY_CASE_SHAPE:CASE-PURCHASE-003');
  assertMutation('wrong stage', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').stage = 'PRODUCT-9.9'; }, 'SEL_PANTRY_CASE_STAGE:CASE-PURCHASE-003');
  assertMutation('empty forbidden', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').forbidden = []; }, 'SEL_PANTRY_FORBIDDEN_EMPTY:CASE-PURCHASE-003');
  assertMutation('unknown forbidden token', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').forbidden.push('unknown_forbidden'); }, 'SEL_PANTRY_FORBIDDEN_UNKNOWN:CASE-PURCHASE-003:unknown_forbidden');
  assertMutation('changed source text', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').source_text = 'changed'; }, 'SEL_PANTRY_SOURCE_DRIFT:CASE-PURCHASE-003');
  assertMutation('unknown-to-zero Oracle', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-002').oracle.quantity_equation.total = 0; }, 'SEL_PANTRY_UNKNOWN_ZERO');
  assertMutation('catalog version drift', ({ catalog }) => { catalog.version = '1.5.0'; }, 'SEL_PANTRY_CATALOG_VERSION_DRIFT');
  assertMutation('fixture Oracle key', ({ fixtures }) => { fixtures.domain_scenarios.find(({ fixture_id }) => fixture_id === 'domain-purchase-multi-product-v1').expected_product_order = ['milk', 'egg', 'apple']; }, 'SEL_PANTRY_FIXTURE_ORACLE_KEY:domain-purchase-multi-product-v1:expected_product_order');
  console.log('SEL_PANTRY_CASES|SELF_TEST|PASS|mutations=14');
}

try {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    validate();
    console.log('SEL_PANTRY_CASES|PASS|cases=17|catalog=1.6.0|fixtures=17');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
