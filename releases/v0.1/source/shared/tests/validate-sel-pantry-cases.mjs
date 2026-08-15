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
const DOMAIN_FIXTURES = Object.freeze({
  'CASE-PURCHASE-001': 'domain-purchase-milk-2x12x250-v1',
  'CASE-PURCHASE-003': 'domain-purchase-default-location-v1',
  'CASE-PURCHASE-007': 'domain-purchase-exact-identity-reuse-v1',
  'CASE-INVENTORY-001': 'domain-inventory-unique-milk-v1',
  'CASE-INVENTORY-002': 'domain-inventory-multi-batch-fefo-v1',
  'CASE-INVENTORY-003': 'domain-inventory-multiple-products-v1',
  'CASE-INVENTORY-005': 'domain-inventory-unit-incompatible-rice-v1',
  'CASE-INVENTORY-004': 'domain-inventory-insufficient-milk-v1',
  'CASE-INVENTORY-009': 'domain-inventory-expired-and-fresh-v1',
  'CASE-MEAL-004': 'domain-meal-company-apple-v1',
  'CASE-MEAL-005': 'domain-meal-explicit-inventory-skip-v1',
  'CASE-PURCHASE-002': 'domain-purchase-eggs-outer-only-v1',
  'CASE-PURCHASE-005': 'domain-purchase-unreliable-expiry-v1',
  'CASE-PURCHASE-006': 'domain-purchase-multi-product-v1',
  'CASE-PURCHASE-008': 'domain-purchase-identity-ambiguous-v1',
  'CASE-PURCHASE-009': 'domain-purchase-partially-opened-v1',
  'CASE-PURCHASE-010': 'domain-inventory-location-correction-v1',
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

const string = Object.freeze({ type: 'string' });
const number = Object.freeze({ type: 'number' });
const boolean = Object.freeze({ type: 'boolean' });
const nil = Object.freeze({ type: 'null' });
const array = (item, { min = 0, unique = false } = {}) => ({ type: 'array', item, min, unique });
const object = (required, optional = {}, { minKeys = 0 } = {}) => ({ type: 'object', required, optional, minKeys });
const expectedImmutableIds = object({}, {
  product_ids: array(string, { min: 1, unique: true }),
  batch_ids: array(string, { min: 1, unique: true }),
  event_ids: array(string, { min: 1, unique: true }),
}, { minKeys: 1 });
const root = (fields) => object({ fixture_id: string, scenario_type: string, received_at: string, ...fields }, { expected_immutable_ids: expectedImmutableIds });

const productId = object({ product_id: string });
const milkIdentity = object({ product_id: string, brand: string, flavour: string, specification: string });
const historicalBatch = object({ batch_id: string, product_id: string, quantity: number, nutrition_profile_version: number });
const batchWithExpiry = object({ batch_id: string, product_id: string, quantity: number, unit: string, expires_at: string });
const batchWithoutExpiry = object({ batch_id: string, product_id: string, quantity: number, unit: string });

const FIXTURE_SCHEMAS = Object.freeze({
  purchase_default_location: root({ configured_home_default: object({ location: string, rule_version: string }) }),
  purchase_exact_identity_reuse: root({ existing_products: array(milkIdentity, { min: 1 }), historical_batches: array(historicalBatch, { min: 1 }) }),
  inventory_unique_product: root({ existing_batches: array(batchWithExpiry, { min: 1 }) }),
  inventory_multi_batch_fefo_fifo: root({ existing_batches: array(batchWithExpiry, { min: 2 }) }),
  inventory_unit_incompatible: root({ existing_batches: array(batchWithoutExpiry, { min: 1 }), nutrition_amount_evidence: object({ min_g: number, max_g: number }) }),
  inventory_insufficient: root({ existing_batches: array(batchWithoutExpiry, { min: 1 }) }),
  inventory_expired_and_fresh: root({ existing_batches: array(batchWithExpiry, { min: 2 }) }),
  meal_outside_context: root({ profiles: array(object({ profile_id: string, product_id: string }), { min: 1 }), context: object({ scene: string, home_inventory_available: boolean }) }),
  meal_explicit_inventory_skip: root({ profiles: array(object({ profile_id: string, product_id: string }), { min: 1 }), directive: object({ raw_text: string, action: string }) }),
  purchase_outer_only: root({ explicit_package: object({ outer_count: number, outer_unit: string, inner_count: nil, capacity: nil, total: nil }) }),
  purchase_unreliable_expiry: root({ existing_products: array(productId, { min: 1 }), expiration: object({ reliability: string, explicit_expires_at: nil }) }),
  purchase_multi_product: root({ existing_products: array(productId, { min: 3 }) }),
  purchase_identity_ambiguous: root({ existing_products: array(object({ product_id: string, normalized_name: string }), { min: 2 }) }),
  purchase_partially_opened: root({ existing_products: array(object({ product_id: string, unit: string }), { min: 1 }), explicit_opening: object({ previously_unopened: boolean, partial_use: boolean }) }),
  inventory_location_correction: root({ existing_batches: array(object({ batch_id: string, product_id: string, location: string, expires_at: string }), { min: 1 }), correction: object({ new_location: string, idempotency_key: string }) }),
});
const FIXTURE_SCENARIO_TYPES = Object.freeze({
  'domain-purchase-default-location-v1': 'purchase_default_location',
  'domain-purchase-exact-identity-reuse-v1': 'purchase_exact_identity_reuse',
  'domain-inventory-unique-milk-v1': 'inventory_unique_product',
  'domain-inventory-multi-batch-fefo-v1': 'inventory_multi_batch_fefo_fifo',
  'domain-inventory-unit-incompatible-rice-v1': 'inventory_unit_incompatible',
  'domain-inventory-insufficient-milk-v1': 'inventory_insufficient',
  'domain-inventory-expired-and-fresh-v1': 'inventory_expired_and_fresh',
  'domain-meal-company-apple-v1': 'meal_outside_context',
  'domain-meal-explicit-inventory-skip-v1': 'meal_explicit_inventory_skip',
  'domain-purchase-eggs-outer-only-v1': 'purchase_outer_only',
  'domain-purchase-unreliable-expiry-v1': 'purchase_unreliable_expiry',
  'domain-purchase-multi-product-v1': 'purchase_multi_product',
  'domain-purchase-identity-ambiguous-v1': 'purchase_identity_ambiguous',
  'domain-purchase-partially-opened-v1': 'purchase_partially_opened',
  'domain-inventory-location-correction-v1': 'inventory_location_correction',
});

function fixtureSchemaFail(fixtureId, kind, key) {
  fail(`SEL_PANTRY_FIXTURE_SCHEMA_${kind}:${fixtureId}:${key}`);
}

function validateFixtureSchema(value, schema, fixtureId, key = '$') {
  if (schema.type === 'string' || schema.type === 'number' || schema.type === 'boolean') {
    if (typeof value !== schema.type) fixtureSchemaFail(fixtureId, 'TYPE', key);
    return;
  }
  if (schema.type === 'null') {
    if (value !== null) fixtureSchemaFail(fixtureId, 'TYPE', key);
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < schema.min) fixtureSchemaFail(fixtureId, 'TYPE', key);
    if (schema.unique && new Set(value).size !== value.length) fixtureSchemaFail(fixtureId, 'VALUE', key);
    value.forEach((entry, index) => validateFixtureSchema(entry, schema.item, fixtureId, `${key}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fixtureSchemaFail(fixtureId, 'TYPE', key);
  const declared = { ...schema.required, ...schema.optional };
  if (Object.keys(value).length < schema.minKeys) fixtureSchemaFail(fixtureId, 'TYPE', key);
  for (const declaredKey of Object.keys(schema.required)) if (!(declaredKey in value)) fixtureSchemaFail(fixtureId, 'MISSING', `${key}.${declaredKey}`);
  for (const [childKey, childValue] of Object.entries(value)) {
    const childSchema = declared[childKey];
    if (!childSchema) fixtureSchemaFail(fixtureId, 'KEY', key === '$' ? childKey : `${key}.${childKey}`);
    validateFixtureSchema(childValue, childSchema, fixtureId, key === '$' ? childKey : `${key}.${childKey}`);
  }
}

function validateSelectedFixture(fixture) {
  if (FIXTURE_SCENARIO_TYPES[fixture.fixture_id] !== fixture.scenario_type) fixtureSchemaFail(fixture.fixture_id, 'SCENARIO', 'scenario_type');
  const schema = FIXTURE_SCHEMAS[fixture.scenario_type];
  if (!schema) fixtureSchemaFail(fixture.fixture_id, 'SCENARIO', 'scenario_type');
  validateFixtureSchema(fixture, schema, fixture.fixture_id);
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
  if (catalog.version !== '1.7.0') fail('SEL_PANTRY_CATALOG_VERSION_DRIFT');
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
    if (entry.setup.domain_scenario_fixture !== DOMAIN_FIXTURES[entry.id]) fail(`SEL_PANTRY_FIXTURE_DRIFT:${entry.id}`);
    const fixture = fixtures.domain_scenarios.find(({ fixture_id }) => fixture_id === entry.setup.domain_scenario_fixture);
    if (FIXTURE_SCENARIO_TYPES[fixture.fixture_id]) validateSelectedFixture(fixture);
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

function assertAccepted(label, mutate) {
  const catalog = clone(readJson(CATALOG_PATH));
  const fixtures = clone(readJson(FIXTURES_PATH));
  const expected = [...EXPECTED];
  mutate({ catalog, fixtures, expected });
  try {
    validate(catalog, fixtures, expected);
  } catch (error) {
    fail(`SEL_PANTRY_SELF_TEST_REJECTED:${label}:${error.message}`);
  }
}

function selfTest() {
  assertMutation('missing ID', ({ catalog }) => { catalog.cases = catalog.cases.filter(({ id }) => id !== 'CASE-PURCHASE-003'); }, 'SEL_PANTRY_CASE_MISSING:CASE-PURCHASE-003');
  assertMutation('extra ID', ({ expected }) => { expected.push('CASE-EXTRA-001'); }, 'SEL_PANTRY_EXPECTED_ID_EXTRA');
  assertMutation('reordered brief ID', ({ expected }) => { [expected[0], expected[1]] = [expected[1], expected[0]]; }, 'SEL_PANTRY_EXPECTED_ID_ORDER');
  assertMutation('duplicate ID', ({ catalog }) => { catalog.cases.push(clone(catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003'))); }, 'SEL_PANTRY_CASE_DUPLICATE_ID');
  assertMutation('unknown fixture', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').setup.domain_scenario_fixture = 'unknown-fixture'; }, 'SEL_PANTRY_FIXTURE_UNKNOWN:CASE-PURCHASE-003');
  assertMutation('known fixture drift', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').setup.domain_scenario_fixture = 'domain-purchase-multi-product-v1'; }, 'SEL_PANTRY_FIXTURE_DRIFT:CASE-PURCHASE-003');
  assertMutation('missing assertion pointer', ({ catalog }) => { delete catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').oracle.receipt.inferred_fields_labeled; }, 'SEL_PANTRY_ASSERTION_MISSING:CASE-PURCHASE-003:/oracle/receipt/inferred_fields_labeled');
  assertMutation('extra case key', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').untrusted = true; }, 'SEL_PANTRY_CASE_SHAPE:CASE-PURCHASE-003');
  assertMutation('wrong stage', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').stage = 'PRODUCT-9.9'; }, 'SEL_PANTRY_CASE_STAGE:CASE-PURCHASE-003');
  assertMutation('empty forbidden', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').forbidden = []; }, 'SEL_PANTRY_FORBIDDEN_EMPTY:CASE-PURCHASE-003');
  assertMutation('unknown forbidden token', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').forbidden.push('unknown_forbidden'); }, 'SEL_PANTRY_FORBIDDEN_UNKNOWN:CASE-PURCHASE-003:unknown_forbidden');
  assertMutation('changed source text', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-003').source_text = 'changed'; }, 'SEL_PANTRY_SOURCE_DRIFT:CASE-PURCHASE-003');
  assertMutation('unknown-to-zero Oracle', ({ catalog }) => { catalog.cases.find(({ id }) => id === 'CASE-PURCHASE-002').oracle.quantity_equation.total = 0; }, 'SEL_PANTRY_UNKNOWN_ZERO');
  assertMutation('catalog version drift', ({ catalog }) => { catalog.version = '1.5.0'; }, 'SEL_PANTRY_CATALOG_VERSION_DRIFT');
  assertMutation('fixture semantic key', ({ fixtures }) => { fixtures.domain_scenarios.find(({ fixture_id }) => fixture_id === 'domain-purchase-multi-product-v1').product_order = ['milk', 'egg', 'apple']; }, 'SEL_PANTRY_FIXTURE_SCHEMA_KEY:domain-purchase-multi-product-v1:product_order');
  assertAccepted('fixture expected immutable IDs', ({ fixtures }) => { fixtures.domain_scenarios.find(({ fixture_id }) => fixture_id === 'domain-purchase-multi-product-v1').expected_immutable_ids = { product_ids: ['fixture-product-milk-whole-250'], batch_ids: ['fixture-batch-milk-immutable-001'], event_ids: ['fixture-event-immutable-001'] }; });
  console.log('SEL_PANTRY_CASES|SELF_TEST|PASS|mutations=15|controls=1');
}

try {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    validate();
    console.log('SEL_PANTRY_CASES|PASS|cases=17|catalog=1.7.0|fixtures=17');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
