import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '..', '..');
const PLAN_PATH = resolve(REPOSITORY_ROOT, '总功能开发计划0.4.md');
const CASES_PATH = resolve(REPOSITORY_ROOT, 'shared', 'acceptance-cases', 'cases.json');
const BRIEF_PATH = resolve(REPOSITORY_ROOT, 'docs', 'work-items', 'SEL-CORE-001-brief.md');
const MANIFEST_PATH = resolve(REPOSITORY_ROOT, 'shared', 'acceptance-cases', 'harness-manifest.json');
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

const EXPECTED_ASSERTION_PATHS = Object.freeze({
  'CASE-MEAL-001': ['/oracle/command', '/oracle/parsing/items', '/oracle/fact_commit/meal_event'],
  'CASE-MEAL-021': ['/oracle/command', '/oracle/parsing/items', '/oracle/fact_commit/meal_event'],
  'CASE-MEAL-017': ['/oracle/command', '/oracle/parsing/subject', '/oracle/parsing/items', '/oracle/fact_commit/meal_event'],
  'CASE-MEAL-009': ['/oracle/command', '/oracle/parsing/items', '/oracle/parsing/excluded_items', '/oracle/fact_commit/meal_event'],
  'CASE-WATER-001': ['/oracle/command', '/oracle/fact_commit/water_event'],
  'CASE-SCOPE-001': ['/oracle/command', '/oracle/parsing', '/oracle/factual_query', '/oracle/business_effects'],
  'CASE-MEAL-002': ['/oracle/command', '/oracle/parsing/items', '/oracle/parsing/occurred_time', '/oracle/parsing/purchase_evidence', '/oracle/fact_commit/meal_event'],
  'CASE-PURCHASE-004': ['/oracle/parsing/time_anchors'],
  'CASE-RECEIPT-002': ['/oracle/receipt/explicit_fields_unlabeled', '/oracle/receipt/inferred_fields_labeled'],
  'CASE-MEAL-010': ['/oracle/command', '/oracle/parsing/completion_evidence', '/oracle/parsing/items', '/oracle/fact_commit/meal_event'],
  'CASE-MEAL-011': ['/oracle/command', '/oracle/parsing', '/oracle/business_effects'],
  'CASE-MEAL-012': ['/oracle/command', '/oracle/parsing/items', '/oracle/parsing/occurred_time', '/oracle/fact_commit/meal_event'],
  'CASE-MEAL-013': ['/oracle/command', '/oracle/parsing', '/oracle/business_effects'],
  'CASE-MEAL-014': ['/oracle/command', '/oracle/parsing/items', '/oracle/parsing/occurred_time', '/oracle/fact_commit/meal_event'],
  'CASE-MEAL-015': ['/oracle/command', '/oracle/parsing', '/oracle/business_effects'],
  'CASE-MEAL-016': ['/oracle/command', '/oracle/parsing', '/oracle/business_effects'],
  'CASE-MEAL-018': ['/oracle/command', '/oracle/parsing/subject', '/oracle/parsing/items', '/oracle/fact_commit/meal_event'],
  'CASE-MEAL-019': ['/oracle/command', '/oracle/parsing/subject', '/oracle/parsing/items', '/oracle/parsing/group_amount_evidence', '/oracle/fact_commit/meal_event'],
  'CASE-MEAL-020': ['/oracle/command', '/oracle/parsing/items', '/oracle/parsing/context', '/oracle/fact_commit/meal_event'],
  'CASE-WATER-003': ['/oracle/command', '/oracle/parsing/items', '/oracle/parsing/liquid_classification', '/oracle/fact_commit/meal_event'],
  'CASE-WATER-004': ['/oracle/command', '/oracle/parsing/items', '/oracle/parsing/liquid_classification', '/oracle/fact_commit/meal_event'],
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

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
}

function parseBriefAuthorities(text) {
  const assertionPaths = {};
  const setupFixtureBindings = {};
  let section = null;
  let caseId = null;
  for (const line of text.split(/\r?\n/u)) {
    if (line === 'case_assertion_paths:') {
      section = 'assertion_paths';
      caseId = null;
      continue;
    }
    if (line === 'setup_fixture_bindings:') {
      section = 'setup_fixture_bindings';
      caseId = null;
      continue;
    }
    if (line === 'full_case_set: none') {
      section = null;
      caseId = null;
      continue;
    }
    if (section === null) continue;
    const caseMatch = line.match(/^  (CASE-[A-Z0-9-]+):$/u);
    if (caseMatch !== null) {
      caseId = caseMatch[1];
      const target = section === 'assertion_paths' ? assertionPaths : setupFixtureBindings;
      if (Object.hasOwn(target, caseId)) fail(`SEL_CORE_BRIEF_CASE_DUPLICATE:${section}:${caseId}`);
      target[caseId] = section === 'assertion_paths' ? [] : {};
      continue;
    }
    if (caseId === null) fail(`SEL_CORE_BRIEF_${section.toUpperCase()}_INVALID`);
    if (section === 'assertion_paths') {
      const pathMatch = line.match(/^    - (\/oracle(?:\/[A-Za-z0-9_~-]+)+)$/u);
      if (pathMatch === null) fail(`SEL_CORE_BRIEF_ASSERTION_PATH_INVALID:${caseId}`);
      assertionPaths[caseId].push(pathMatch[1]);
      continue;
    }
    const bindingMatch = line.match(/^    ([a-z0-9_]+_fixture): (null|[A-Za-z0-9_-]+)$/u);
    if (bindingMatch === null) fail(`SEL_CORE_BRIEF_SETUP_FIXTURE_BINDING_INVALID:${caseId}`);
    const [, key, rawValue] = bindingMatch;
    if (Object.hasOwn(setupFixtureBindings[caseId], key)) {
      fail(`SEL_CORE_BRIEF_SETUP_FIXTURE_BINDING_DUPLICATE:${caseId}:${key}`);
    }
    setupFixtureBindings[caseId][key] = rawValue === 'null' ? null : rawValue;
  }
  return { assertionPaths, setupFixtureBindings };
}

function validateBriefAuthorities(authorities, knownFixtureIds) {
  assertExactStrings(
    Object.keys(authorities.assertionPaths),
    EXPECTED,
    'SEL_CORE_BRIEF_ASSERTION_CASE_IDS_INVALID',
  );
  assertExactStrings(
    Object.keys(authorities.setupFixtureBindings),
    EXPECTED,
    'SEL_CORE_BRIEF_SETUP_CASE_IDS_INVALID',
  );
  for (const id of EXPECTED) {
    assertExactStrings(
      authorities.assertionPaths[id],
      EXPECTED_ASSERTION_PATHS[id],
      `SEL_CORE_BRIEF_ASSERTION_PATHS_INVALID:${id}`,
    );
    const bindings = authorities.setupFixtureBindings[id];
    if (!isPlainObject(bindings) || Object.keys(bindings).length === 0) {
      fail(`SEL_CORE_BRIEF_SETUP_FIXTURE_BINDINGS_INVALID:${id}`);
    }
    for (const [key, fixtureId] of Object.entries(bindings)) {
      if (fixtureId !== null && !knownFixtureIds.has(fixtureId)) {
        fail(`SEL_CORE_BRIEF_FIXTURE_REFERENCE_INVALID:${id}:${key}:${fixtureId}`);
      }
    }
  }
}

function valueAtJsonPointer(value, pointer) {
  let cursor = value;
  for (const rawSegment of pointer.slice(1).split('/')) {
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isPlainObject(cursor) && !Array.isArray(cursor)) return { found: false };
    if (!Object.hasOwn(cursor, segment)) return { found: false };
    cursor = cursor[segment];
  }
  return { found: true, value: cursor };
}

function validateManifest(manifest, catalog, fixtures) {
  if (!isPlainObject(manifest)) fail('SEL_CORE_MANIFEST_SHAPE_INVALID');
  if (manifest.version !== '1.0.0') fail(`SEL_CORE_MANIFEST_VERSION_INVALID:${String(manifest.version)}`);
  const caseBinding = manifest.case_catalog;
  if (!isPlainObject(caseBinding)) fail('SEL_CORE_MANIFEST_CASE_BINDING_INVALID');
  if (caseBinding.path !== 'shared/acceptance-cases/cases.json') fail('SEL_CORE_MANIFEST_CASE_PATH_INVALID');
  if (caseBinding.version !== catalog.version) fail('SEL_CORE_MANIFEST_CASE_VERSION_INVALID');
  if (caseBinding.case_count !== catalog.cases.length) fail('SEL_CORE_MANIFEST_CASE_COUNT_INVALID');
  if (caseBinding.sha256 !== sha256(CASES_PATH)) fail('SEL_CORE_MANIFEST_CASE_SHA_INVALID');
  const fixtureBinding = manifest.fixture_catalog;
  if (!isPlainObject(fixtureBinding)) fail('SEL_CORE_MANIFEST_FIXTURE_BINDING_INVALID');
  if (fixtureBinding.path !== 'shared/acceptance-cases/fixtures/core-v1.json') {
    fail('SEL_CORE_MANIFEST_FIXTURE_PATH_INVALID');
  }
  if (fixtureBinding.version !== fixtures.version) fail('SEL_CORE_MANIFEST_FIXTURE_VERSION_INVALID');
  if (fixtureBinding.sha256 !== sha256(FIXTURES_PATH)) fail('SEL_CORE_MANIFEST_FIXTURE_SHA_INVALID');
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

function validateCase(candidate, knownFixtureIds, assertionPaths, setupFixtureBindings) {
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
  const actualFixtureKeys = Object.keys(candidate.setup).filter((name) => name.endsWith('_fixture'));
  const expectedFixtureKeys = Object.keys(setupFixtureBindings);
  const missingFixtureKey = expectedFixtureKeys.find((name) => !actualFixtureKeys.includes(name));
  if (missingFixtureKey !== undefined) {
    fail(`SEL_CORE_CASE_SETUP_FIXTURE_BINDING_INVALID:${id}:${missingFixtureKey}`);
  }
  const unexpectedFixtureKey = actualFixtureKeys.find((name) => !expectedFixtureKeys.includes(name));
  if (unexpectedFixtureKey !== undefined) {
    fail(`SEL_CORE_CASE_SETUP_FIXTURE_BINDING_INVALID:${id}:${unexpectedFixtureKey}`);
  }
  assertExactStrings(
    actualFixtureKeys,
    expectedFixtureKeys,
    `SEL_CORE_CASE_SETUP_FIXTURE_BINDING_INVALID:${id}`,
  );
  for (const [name, value] of Object.entries(candidate.setup)) {
    if (!name.endsWith('_fixture') || value === null) continue;
    if (typeof value !== 'string' || !knownFixtureIds.has(value)) {
      fail(`SEL_CORE_FIXTURE_REFERENCE_INVALID:${id}:${name}:${String(value)}`);
    }
  }
  for (const [name, expectedFixtureId] of Object.entries(setupFixtureBindings)) {
    if (candidate.setup[name] !== expectedFixtureId) {
      fail(`SEL_CORE_CASE_SETUP_FIXTURE_BINDING_INVALID:${id}:${name}`);
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
  for (const pointer of assertionPaths) {
    if (!valueAtJsonPointer(candidate, pointer).found) {
      fail(`SEL_CORE_CASE_ASSERTION_PATH_MISSING:${id}:${pointer}`);
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

function validateCandidate(catalog, fixtures, authorities) {
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
  validateBriefAuthorities(authorities, knownFixtureIds);
  for (const id of EXPECTED) {
    validateCase(
      rowsById.get(id)[0],
      knownFixtureIds,
      authorities.assertionPaths[id],
      authorities.setupFixtureBindings[id],
    );
  }
  return knownFixtureIds.size;
}

function expectMutation(name, catalog, fixtures, authorities, mutate, expectedPrefix) {
  const mutatedCatalog = cloneJson(catalog);
  const mutatedFixtures = cloneJson(fixtures);
  const mutatedAuthorities = cloneJson(authorities);
  mutate(mutatedCatalog, mutatedFixtures, mutatedAuthorities);
  try {
    validateCandidate(mutatedCatalog, mutatedFixtures, mutatedAuthorities);
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

function runSelfTests(catalog, fixtures, authorities) {
  const selected = (candidate, id) => candidate.cases.find((entry) => entry.id === id);
  const mutations = [
    ['remove_deep_oracle_path', (candidate) => {
      delete selected(candidate, 'CASE-MEAL-009').oracle.parsing.items;
    }, 'SEL_CORE_CASE_ASSERTION_PATH_MISSING:CASE-MEAL-009:/oracle/parsing/items'],
    ['remove_deep_excluded_oracle_path', (candidate) => {
      delete selected(candidate, 'CASE-MEAL-009').oracle.parsing.excluded_items;
    }, 'SEL_CORE_CASE_ASSERTION_PATH_MISSING:CASE-MEAL-009:/oracle/parsing/excluded_items'],
    ['remove_required_setup_fixture', (candidate) => {
      delete selected(candidate, 'CASE-MEAL-009').setup.environment_fixture;
    }, 'SEL_CORE_CASE_SETUP_FIXTURE_BINDING_INVALID:CASE-MEAL-009:environment_fixture'],
    ['swap_known_setup_fixture', (candidate) => {
      selected(candidate, 'CASE-MEAL-009').setup.environment_fixture = 'env-zh-cn-20260811-0100';
    }, 'SEL_CORE_CASE_SETUP_FIXTURE_BINDING_INVALID:CASE-MEAL-009:environment_fixture'],
    ['remove_brief_assertion_path', (_candidate, _fixtures, candidateAuthorities) => {
      candidateAuthorities.assertionPaths['CASE-MEAL-009'].splice(1, 1);
    }, 'SEL_CORE_BRIEF_ASSERTION_PATHS_INVALID:CASE-MEAL-009'],
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
  const requestedMutation = process.argv
    .find((argument) => argument.startsWith('--mutation='))
    ?.slice('--mutation='.length);
  const selectedMutations = requestedMutation === undefined
    ? mutations
    : mutations.filter(([name]) => name === requestedMutation);
  if (requestedMutation !== undefined && selectedMutations.length !== 1) {
    fail(`SEL_CORE_MUTATION_UNKNOWN:${requestedMutation}`);
  }
  for (const [name, mutate, prefix] of selectedMutations) {
    expectMutation(name, catalog, fixtures, authorities, mutate, prefix);
  }
  return selectedMutations.length;
}

try {
  const catalog = readJson(CASES_PATH, 'CASE_CATALOG');
  const fixtures = readJson(FIXTURES_PATH, 'FIXTURE_CATALOG');
  const manifest = readJson(MANIFEST_PATH, 'HARNESS_MANIFEST');
  const authorities = parseBriefAuthorities(readFileSync(BRIEF_PATH, 'utf8'));
  const fixtureCount = validateCandidate(catalog, fixtures, authorities);
  validateManifest(manifest, catalog, fixtures);
  const mutationCount = process.argv.includes('--self-test')
    ? runSelfTests(catalog, fixtures, authorities)
    : 0;
  process.stdout.write(
    `SEL_CORE_CASES|PASS|cases=${EXPECTED.length}|catalog=1.5.0|fixtures=${fixtureCount}|mutations=${mutationCount}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`SEL_CORE_CASES|FAIL|${message}\n`);
  process.exitCode = 1;
}
