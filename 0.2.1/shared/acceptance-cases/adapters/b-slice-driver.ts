import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

// The acceptance harness executes the freshly built plugin artifact while using source-only types.
// @ts-expect-error The intentionally declaration-free dist artifact is verified by the plugin build.
import { deriveDomainId } from "../../../version-b-lite-plugin/dist/domain/identity.js";
// @ts-expect-error The intentionally declaration-free dist artifact is verified by the plugin build.
import { createDietDomainService } from "../../../version-b-lite-plugin/dist/domain/service.js";
import type { DietDomainService } from "../../../version-b-lite-plugin/src/domain/service.ts";
import type {
  AddInventoryOperation,
  DomainEnvelopeInput,
  MealItemInput,
  NutritionSourceCandidate,
  NutritionVector,
  StructuredAmount,
} from "../../../version-b-lite-plugin/src/domain/types.ts";
// @ts-expect-error The intentionally declaration-free dist artifact is verified by the plugin build.
import { openDietDatabase } from "../../../version-b-lite-plugin/dist/storage/database.js";
import type { BCaseDriver, DriverObservation, JsonValue } from "./types.ts";

export const G2_B_SLICE_CASE_IDS = Object.freeze([
  "CASE-MIXED-001",
  "CASE-CORR-001",
  "CASE-QUERY-001",
  "CASE-EFFECT-001",
  "CASE-MEAL-006",
  "CASE-NUTR-008",
  "CASE-MEAL-003",
  "CASE-MEAL-004",
  "CASE-INVENTORY-003",
  "CASE-INVENTORY-004",
  "CASE-NUTR-001",
  "CASE-NUTR-002",
  "CASE-NUTR-005",
  "CASE-STORAGE-001",
  "CASE-RECEIPT-001",
  "CASE-RECEIPT-003",
  "CASE-PROGRESS-010",
] as const);

export type G2BSliceCaseId = typeof G2_B_SLICE_CASE_IDS[number];

interface BSliceCaseInputAuthority {
  readonly requirement_ids: readonly string[];
  readonly stage: string;
  readonly source_text: string;
  readonly setup: JsonValue;
}

const manifestAuthority = JSON.parse(
  readFileSync(new URL("../harness-manifest.json", import.meta.url), "utf8"),
) as {
  readonly contracts: ReadonlyArray<Readonly<{ contract_id: string; sha256: string }>>;
  readonly case_catalog: Readonly<{
    case_set_id: string; version: string; case_count: number; sha256: string;
  }>;
  readonly fixture_catalog: Readonly<{
    fixture_catalog_id: string; version: string; sha256: string;
  }>;
  readonly b_slice_input_catalog: Readonly<{
    input_catalog_id: string; version: string; case_count: number; sha256: string;
  }>;
  readonly g2_b_slice_matrix: Readonly<{
    matrix_id: string; expected_count: number; sha256: string;
  }>;
};

interface RawCaseAuthority {
  readonly id: string;
  readonly requirement_ids: readonly string[];
  readonly stage: string;
  readonly source_text: string;
  readonly setup: Readonly<Record<string, JsonValue>>;
}

interface FixtureCatalog {
  readonly fixture_catalog_id: string;
  readonly version: string;
  readonly environments: readonly Readonly<Record<string, JsonValue>>[];
  readonly goals: readonly Readonly<Record<string, JsonValue>>[];
  readonly query_views: readonly Readonly<Record<string, JsonValue>>[];
  readonly domain_scenarios: readonly Readonly<Record<string, JsonValue>>[];
  readonly ops_security_scenarios: readonly Readonly<Record<string, JsonValue>>[];
}

function readFrozenAuthority<T>(url: URL, expectedSha256: string, label: string): T {
  const bytes = readFileSync(url);
  const actual = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (actual !== expectedSha256) throw new Error(`B_SLICE_AUTHORITY_HASH_INVALID:${label}`);
  return JSON.parse(bytes.toString("utf8")) as T;
}

const matrixAuthority = readFrozenAuthority<{
  readonly matrix_id: string;
  readonly expected_count: number;
  readonly case_ids: readonly string[];
}>(
  new URL("../g2-b-slice-matrix.json", import.meta.url),
  manifestAuthority.g2_b_slice_matrix.sha256,
  "matrix",
);
const publicCaseCatalog = readFrozenAuthority<{
  readonly case_set_id: string;
  readonly version: string;
  readonly cases: readonly RawCaseAuthority[];
}>(
  new URL("../cases.json", import.meta.url),
  manifestAuthority.case_catalog.sha256,
  "public_cases",
);
const fixtureCatalog = readFrozenAuthority<FixtureCatalog>(
  new URL("../fixtures/core-v1.json", import.meta.url),
  manifestAuthority.fixture_catalog.sha256,
  "public_fixtures",
);
const sliceInputCatalog = readFrozenAuthority<{
  readonly input_catalog_id: string;
  readonly version: string;
  readonly cases: readonly RawCaseAuthority[];
}>(
  new URL("../b-slice-inputs.json", import.meta.url),
  manifestAuthority.b_slice_input_catalog.sha256,
  "slice_inputs",
);

interface DriverRuntime {
  readonly database: DatabaseSync;
  close(): void;
}

export type BSliceRuntimeFactory = (caseId: G2BSliceCaseId) => DriverRuntime;

const defaultNutrients: NutritionVector = Object.freeze({
  energy_kcal_milli: 100_000,
  protein_mg: 5_000,
  fat_mg: 2_000,
  carbohydrate_mg: 20_000,
  fiber_mg: 1_000,
  water_ml_milli: 70_000,
});

export function extractSingleReceiptProgress(payload: JsonValue): NutritionVector {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("B_SLICE_RECEIPT_PROGRESS_INVALID:payload");
  }
  const receipt = payload.receipt_data;
  if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt) ||
      !exactKeys(receipt, ["authority_kind", "status", "blocks"]) ||
      receipt.authority_kind !== "diet-manager/receipt-data/v1" || receipt.status !== "success" ||
      !Array.isArray(receipt.blocks)) {
    throw new Error("B_SLICE_RECEIPT_PROGRESS_INVALID:receipt");
  }
  const matches = receipt.blocks.filter((block): block is Record<string, JsonValue> =>
    typeof block === "object" && block !== null && !Array.isArray(block) && block.kind === "progress");
  if (matches.length !== 1) throw new Error("B_SLICE_RECEIPT_PROGRESS_INVALID:count");
  const block = matches[0]!;
  if (!exactKeys(block, ["kind", "daily_progress"])) {
    throw new Error("B_SLICE_RECEIPT_PROGRESS_INVALID:block");
  }
  const progress = block.daily_progress;
  if (typeof progress !== "object" || progress === null || Array.isArray(progress) ||
      !exactKeys(progress, ["coverage_status", "date", "nutrients", "timezone"]) ||
      typeof progress.date !== "string" || progress.timezone !== "Asia/Shanghai" ||
      (progress.coverage_status !== "complete" && progress.coverage_status !== "partial")) {
    throw new Error("B_SLICE_RECEIPT_PROGRESS_INVALID:progress");
  }
  const nutrients = progress.nutrients;
  const keys = [
    "energy_kcal_milli", "protein_mg", "fat_mg", "carbohydrate_mg", "fiber_mg",
    "water_ml_milli",
  ] as const;
  if (typeof nutrients !== "object" || nutrients === null || Array.isArray(nutrients) ||
      !exactKeys(nutrients, keys)) {
    throw new Error("B_SLICE_RECEIPT_PROGRESS_INVALID:nutrients");
  }
  const nutrient = (value: JsonValue): number | null => {
    if (value !== null &&
        (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
      throw new Error("B_SLICE_RECEIPT_PROGRESS_INVALID:nutrients");
    }
    return value;
  };
  return Object.freeze({
    energy_kcal_milli: nutrient(nutrients.energy_kcal_milli!),
    protein_mg: nutrient(nutrients.protein_mg!),
    fat_mg: nutrient(nutrients.fat_mg!),
    carbohydrate_mg: nutrient(nutrients.carbohydrate_mg!),
    fiber_mg: nutrient(nutrients.fiber_mg!),
    water_ml_milli: nutrient(nutrients.water_ml_milli!),
  });
}

function defaultRuntimeFactory(): DriverRuntime {
  const root = join(tmpdir(), `diet-manager-b-acceptance-${randomUUID().replaceAll("-", "")}`);
  mkdirSync(root, { recursive: false });
  let runtime: ReturnType<typeof openDietDatabase>;
  try {
    runtime = openDietDatabase({ privateRuntimeRoot: root });
  } catch (error) {
    rmSync(root, { recursive: true, force: false });
    throw error;
  }
  return {
    database: runtime.database,
    close() {
      try {
        runtime.close();
      } finally {
        rmSync(root, { recursive: true, force: false });
      }
    },
  };
}

function source(
  sourceType: "product_label" | "public_fixture",
  sourceRef: string,
  profileVersion: number,
  applicableProductId: string | null,
  basis: { kind: NutritionSourceCandidate["basis_kind"]; microunits: number; unit: string },
  nutrients: NutritionVector = defaultNutrients,
): NutritionSourceCandidate {
  return Object.freeze({
    source_type: sourceType,
    source_ref: sourceRef,
    profile_version: profileVersion,
    applicable_product_id: applicableProductId,
    basis_kind: basis.kind,
    basis_microunits: basis.microunits,
    basis_unit: basis.unit,
    nutrients,
  });
}

function amount(
  unit: string,
  observed: number,
  adopted: number | null,
  deducted: number | null,
  evidence: StructuredAmount["evidence"] = "explicit",
): StructuredAmount {
  return Object.freeze({
    unit,
    observed_microunits: observed,
    nutrition_adoption_microunits: adopted,
    inventory_deduction_microunits: deducted,
    template_reference_microunits: null,
    evidence,
  });
}

function purchaseOperation(options: {
  suffix: string;
  productId: string;
  normalizedName: string;
  batchId: string;
  quantity: number;
  unit: string;
  profileVersion?: number;
  sourceRef?: string;
  productType?: AddInventoryOperation["product"]["product_type"];
  nutrients?: NutritionVector;
  nutritionBasis?: { kind: NutritionSourceCandidate["basis_kind"]; microunits: number; unit: string };
}): AddInventoryOperation {
  return Object.freeze({
    kind: "add_inventory",
    operation_id: `operation-purchase-${options.suffix}`,
    product: Object.freeze({
      product_id: options.productId,
      normalized_name: options.normalizedName,
      product_type: options.productType ?? "solid",
    }),
    batch_id: options.batchId,
    amount: Object.freeze({
      ...amount(options.unit, options.quantity, null, null),
      template_reference_microunits: options.quantity,
    }),
    nutrition_sources: Object.freeze([
      source(
        "product_label",
        options.sourceRef ?? `label-${options.productId}-v${options.profileVersion ?? 1}`,
        options.profileVersion ?? 1,
        options.productId,
        options.nutritionBasis ?? {
          kind: options.unit === "g" ? "per_100g" : "per_item",
          microunits: options.unit === "g" ? 100_000_000 : 1_000_000,
          unit: options.unit,
        },
        options.nutrients,
      ),
    ]),
  });
}

function envelope(
  suffix: string,
  commandType: DomainEnvelopeInput["command_type"],
  operations: DomainEnvelopeInput["operations"],
  receivedAt = "2026-08-12T01:00:00.000Z",
): DomainEnvelopeInput {
  return Object.freeze({
    envelope_id: `envelope-${suffix}`,
    idempotency_key: `idem-${suffix}`,
    command_type: commandType,
    subject_scope: "user:self",
    source_message_id: `message-${suffix}`,
    conversation_id: "conversation-b-slice-acceptance",
    received_at: receivedAt,
    timezone: "Asia/Shanghai",
    operations: Object.freeze(operations),
  });
}

function purchaseEnvelope(options: Parameters<typeof purchaseOperation>[0]): DomainEnvelopeInput {
  return envelope(options.suffix, "add_inventory", [purchaseOperation(options)]);
}

function mealItem(options: {
  name: string;
  unit: string;
  observed: number;
  adopted: number | null;
  deducted: number | null;
  sources: readonly NutritionSourceCandidate[];
  evidence?: StructuredAmount["evidence"];
}): MealItemInput {
  return Object.freeze({
    item_type: "food",
    normalized_name: options.name,
    amount: amount(
      options.unit,
      options.observed,
      options.adopted,
      options.deducted,
      options.evidence,
    ),
    nutrition_sources: Object.freeze([...options.sources]),
  });
}

function mealEnvelope(options: {
  suffix: string;
  items: readonly MealItemInput[];
  location?: "home" | "outside";
  receivedAt?: string;
  occurredAt?: string;
}): DomainEnvelopeInput {
  return envelope(options.suffix, "record_meal", [Object.freeze({
    kind: "record_meal" as const,
    operation_id: `operation-meal-${options.suffix}`,
    meal_slot: "breakfast",
    occurred_at: options.occurredAt ?? options.receivedAt ?? "2026-08-12T01:00:00.000Z",
    location: options.location ?? "outside",
    items: Object.freeze([...options.items]),
  })], options.receivedAt);
}

function execute(service: DietDomainService, value: DomainEnvelopeInput) {
  const preview = service.preview(value);
  return service.execute({
    envelope: value,
    token: preview.token,
    input_digest: preview.input_digest,
    data_revision: preview.data_revision,
  });
}

function inventory(service: DietDomainService) {
  const result = service.query({ kind: "query_inventory", operation_id: "query-inventory-acceptance" });
  if (result.kind !== "inventory") throw new Error("B_SLICE_QUERY_INVALID:inventory");
  return result;
}

function businessTableNames(database: DatabaseSync): string[] {
  return (database.prepare(
    `SELECT name FROM sqlite_schema
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
     ORDER BY name`,
  ).all() as Array<{ name: string }>).map((row) => row.name);
}

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function tableCount(database: DatabaseSync, table: string): number {
  return Number((database.prepare(`SELECT COUNT(*) AS count FROM ${quotedIdentifier(table)}`).get() as { count: number }).count);
}

function businessWrites(database: DatabaseSync): number {
  return businessTableNames(database).reduce((sum, table) => sum + tableCount(database, table), 0);
}

function normalizeSqlValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  throw new Error("B_SLICE_DATABASE_STATE_INVALID:value");
}

function businessStateFingerprint(database: DatabaseSync): string {
  const tables = businessTableNames(database).map((table) => {
    const columns = (database.prepare(
      `PRAGMA table_info(${quotedIdentifier(table)})`,
    ).all() as Array<{ name: string }>).map((column) => column.name);
    const rows = (database.prepare(`SELECT * FROM ${quotedIdentifier(table)}`).all() as Array<Record<string, unknown>>)
      .map((row) => columns.map((column) => normalizeSqlValue(row[column])))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en-US"));
    return Object.freeze({ table, columns: Object.freeze(columns), rows: Object.freeze(rows) });
  });
  return createHash("sha256").update(JSON.stringify(tables), "utf8").digest("hex").toUpperCase();
}

function count(database: DatabaseSync, sql: string, ...parameters: SQLInputValue[]): number {
  return Number((database.prepare(sql).get(...parameters) as { count: number }).count);
}

function assertCaseId(value: string): G2BSliceCaseId {
  if (!(G2_B_SLICE_CASE_IDS as readonly string[]).includes(value)) {
    throw new Error(`B_SLICE_CASE_INVALID:${value}`);
  }
  return value as G2BSliceCaseId;
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return sameStrings(actual, [...expected].sort());
}

function cloneAuthorityJson(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function sameJson(actual: JsonValue, expected: JsonValue): boolean {
  if (actual === null || expected === null || typeof actual !== "object" || typeof expected !== "object") {
    return Object.is(actual, expected);
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual) && Array.isArray(expected) &&
      actual.length === expected.length &&
      actual.every((value, index) => sameJson(value, expected[index]!));
  }
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return sameStrings(actualKeys, expectedKeys) &&
    actualKeys.every((key) => sameJson(actual[key]!, expected[key]!));
}

function resolvedFixture(
  values: readonly Readonly<Record<string, JsonValue>>[],
  fixtureId: JsonValue | undefined,
  label: string,
): JsonValue {
  if (fixtureId === null || fixtureId === undefined) return null;
  if (typeof fixtureId !== "string" || fixtureId.length === 0) {
    throw new Error(`B_SLICE_AUTHORITY_INVALID:${label}`);
  }
  const matches = values.filter((value) => value.fixture_id === fixtureId);
  if (matches.length !== 1) throw new Error(`B_SLICE_AUTHORITY_INVALID:${label}:${fixtureId}`);
  return cloneAuthorityJson(matches[0] as JsonValue);
}

function resolveCaseSetup(candidate: RawCaseAuthority, inlineDomainScenario: boolean): JsonValue {
  const setup = candidate.setup;
  const domainScenario = inlineDomainScenario
    ? setup.domain_scenario
    : resolvedFixture(
      fixtureCatalog.domain_scenarios,
      setup.domain_scenario_fixture,
      `${candidate.id}:domain_scenario`,
    );
  if (inlineDomainScenario &&
      (typeof domainScenario !== "object" || domainScenario === null || Array.isArray(domainScenario))) {
    throw new Error(`B_SLICE_AUTHORITY_INVALID:${candidate.id}:domain_scenario`);
  }
  return Object.freeze({
    environment: resolvedFixture(
      fixtureCatalog.environments,
      setup.environment_fixture,
      `${candidate.id}:environment`,
    ),
    goals: resolvedFixture(fixtureCatalog.goals, setup.goals_fixture, `${candidate.id}:goals`),
    query_view: resolvedFixture(
      fixtureCatalog.query_views,
      setup.query_view_fixture,
      `${candidate.id}:query_view`,
    ),
    domain_scenario: inlineDomainScenario
      ? cloneAuthorityJson(domainScenario as JsonValue)
      : domainScenario,
    ops_security_scenario: inlineDomainScenario
      ? null
      : resolvedFixture(
        fixtureCatalog.ops_security_scenarios,
        setup.ops_security_fixture,
        `${candidate.id}:ops_security_scenario`,
      ),
    prior_context: cloneAuthorityJson(setup.prior_context ?? []),
  });
}

function buildCaseInputAuthorities(): ReadonlyMap<G2BSliceCaseId, BSliceCaseInputAuthority> {
  if (
    matrixAuthority.matrix_id !== manifestAuthority.g2_b_slice_matrix.matrix_id ||
    matrixAuthority.expected_count !== manifestAuthority.g2_b_slice_matrix.expected_count ||
    matrixAuthority.expected_count !== G2_B_SLICE_CASE_IDS.length ||
    !sameStrings(matrixAuthority.case_ids, G2_B_SLICE_CASE_IDS) ||
    publicCaseCatalog.case_set_id !== manifestAuthority.case_catalog.case_set_id ||
    publicCaseCatalog.version !== manifestAuthority.case_catalog.version ||
    publicCaseCatalog.cases.length !== manifestAuthority.case_catalog.case_count ||
    fixtureCatalog.fixture_catalog_id !== manifestAuthority.fixture_catalog.fixture_catalog_id ||
    fixtureCatalog.version !== manifestAuthority.fixture_catalog.version ||
    sliceInputCatalog.input_catalog_id !== manifestAuthority.b_slice_input_catalog.input_catalog_id ||
    sliceInputCatalog.version !== manifestAuthority.b_slice_input_catalog.version ||
    sliceInputCatalog.cases.length !== manifestAuthority.b_slice_input_catalog.case_count
  ) {
    throw new Error("B_SLICE_AUTHORITY_INVALID:identity");
  }
  const publicCases = publicCaseCatalog.cases.filter((candidate) =>
    (G2_B_SLICE_CASE_IDS as readonly string[]).includes(candidate.id));
  if (publicCases.length !== 8 || sliceInputCatalog.cases.length !== 9) {
    throw new Error("B_SLICE_AUTHORITY_INVALID:case_partition");
  }
  const publicById = new Map(publicCases.map((candidate) => [candidate.id, candidate]));
  const sliceById = new Map(sliceInputCatalog.cases.map((candidate) => [candidate.id, candidate]));
  if (publicById.size !== publicCases.length || sliceById.size !== sliceInputCatalog.cases.length) {
    throw new Error("B_SLICE_AUTHORITY_INVALID:duplicate_case");
  }
  const authorities = new Map<G2BSliceCaseId, BSliceCaseInputAuthority>();
  for (const caseId of G2_B_SLICE_CASE_IDS) {
    const publicCandidate = publicById.get(caseId);
    const sliceCandidate = sliceById.get(caseId);
    if ((publicCandidate === undefined) === (sliceCandidate === undefined)) {
      throw new Error(`B_SLICE_AUTHORITY_INVALID:case_source:${caseId}`);
    }
    const candidate = publicCandidate ?? sliceCandidate!;
    authorities.set(caseId, Object.freeze({
      requirement_ids: Object.freeze([...candidate.requirement_ids]),
      stage: candidate.stage,
      source_text: candidate.source_text,
      setup: resolveCaseSetup(candidate, sliceCandidate !== undefined),
    }));
  }
  return authorities;
}

const caseInputAuthorities = buildCaseInputAuthorities();

function assertInputAuthority(input: Parameters<BCaseDriver>[0], caseId: G2BSliceCaseId): void {
  const authority = caseInputAuthorities.get(caseId);
  if (
    authority === undefined ||
    !sameStrings(input.requirement_ids, authority.requirement_ids) ||
    input.stage !== authority.stage ||
    input.source_text !== authority.source_text ||
    !sameJson(input.setup, authority.setup) ||
    input.contract_hashes.length !== manifestAuthority.contracts.length ||
    input.contract_hashes.some((entry, index) => {
      const expected = manifestAuthority.contracts[index];
      return !exactKeys(entry, ["contract_id", "sha256"]) ||
        entry.contract_id !== expected.contract_id || entry.sha256 !== expected.sha256;
    })
  ) {
    throw new Error(`B_SLICE_INPUT_AUTHORITY_INVALID:${caseId}`);
  }
}

function assertNever(value: never): never {
  throw new Error(`B_SLICE_CASE_UNREACHABLE:${String(value)}`);
}

function succeeded(database: DatabaseSync, observation: JsonValue): DriverObservation {
  return Object.freeze({
    outcome_status: "succeeded",
    reason_code: null,
    business_writes: businessWrites(database),
    observation,
  });
}

function runMixed(database: DatabaseSync, service: DietDomainService): DriverObservation {
  const milk = source(
    "product_label",
    "fixture-label-whole-milk-250-v1",
    1,
    "fixture-product-milk-whole-250",
    { kind: "per_item", microunits: 1_000_000, unit: "carton" },
    Object.freeze({ ...defaultNutrients, fiber_mg: null, water_ml_milli: null }),
  );
  const value = envelope("mixed-001", "record_meal", [
    purchaseOperation({
      suffix: "mixed-001",
      productId: "fixture-product-milk-whole-250",
      normalizedName: "whole milk 250ml",
      batchId: "fixture-batch-milk-mixed-001",
      quantity: 24_000_000,
      unit: "carton",
      productType: "nutrition_drink",
      sourceRef: milk.source_ref,
      nutrients: milk.nutrients,
    }),
    Object.freeze({
      kind: "record_meal" as const,
      operation_id: "operation-meal-mixed-001",
      meal_slot: "breakfast",
      occurred_at: "2026-08-12T01:00:00.000Z",
      location: "home" as const,
      items: Object.freeze([mealItem({
        name: "whole milk 250ml",
        unit: "carton",
        observed: 1_000_000,
        adopted: 1_000_000,
        deducted: 1_000_000,
        sources: [milk],
      })]),
    }),
  ]);
  const result = execute(service, value);
  const batches = inventory(service).batches;
  const inventoryTransitions = (database.prepare(
    `SELECT payload_json FROM inventory_transactions
     WHERE batch_id = ? ORDER BY committed_at, transaction_id`,
  ).all("fixture-batch-milk-mixed-001") as Array<{ payload_json: string }>).map((row) => {
    const payload = JSON.parse(row.payload_json) as {
      quantity_after_microunits: number;
      quantity_delta_microunits: number;
    };
    return payload;
  });
  const initialQuantity = inventoryTransitions.length === 0
    ? null
    : inventoryTransitions[0].quantity_after_microunits - inventoryTransitions[0].quantity_delta_microunits;
  return succeeded(database, {
    mixed: result.items.map((item) => ({ sequence: item.sequence, status: item.status })),
    inventory_sequence: [
      initialQuantity,
      ...inventoryTransitions.map((transition) => transition.quantity_after_microunits),
    ],
    finalization: {
      count: tableCount(database, "envelope_finalizations"),
      mixed_item_count: tableCount(database, "mixed_item_results"),
    },
  });
}

function runCorrection(database: DatabaseSync, service: DietDomainService): DriverObservation {
  execute(service, purchaseEnvelope({
    suffix: "corr-eggs",
    productId: "product-corr-eggs",
    normalizedName: "eggs",
    batchId: "batch-corr-eggs",
    quantity: 10_000_000,
    unit: "piece",
  }));
  const original = mealEnvelope({
    suffix: "corr-original",
    location: "home",
    items: [mealItem({
      name: "eggs",
      unit: "piece",
      observed: 2_000_000,
      adopted: 2_000_000,
      deducted: 2_000_000,
      sources: [source(
        "product_label",
        "label-product-corr-eggs-v1",
        1,
        "product-corr-eggs",
        { kind: "per_item", microunits: 1_000_000, unit: "piece" },
      )],
    })],
  });
  execute(service, original);
  const correction = envelope("corr-001", "correct_record", [Object.freeze({
    kind: "correct_record" as const,
    operation_id: "operation-corr-001",
    target_event_id: deriveDomainId("event", original.idempotency_key, 0),
    base_revision: 1,
    item_order: 0,
    replacement_amount: amount("piece", 3_000_000, 3_000_000, 3_000_000),
  })]);
  const preview = service.preview(correction);
  const correctionInput = {
    envelope: correction,
    token: preview.token,
    input_digest: preview.input_digest,
    data_revision: preview.data_revision,
  } as const;
  const first = service.execute(correctionInput);
  const beforeReplay = businessStateFingerprint(database);
  const replay = service.execute(correctionInput);
  return succeeded(database, {
    fact_commit: {
      correction_events: tableCount(database, "correction_events"),
      original_events_preserved: count(database, "SELECT COUNT(*) AS count FROM event_records WHERE event_type = 'diet_meal'") === 1,
    },
    effect_bundle: {
      additional_egg_transactions: count(database, "SELECT COUNT(*) AS count FROM inventory_transactions WHERE reason_code = 'correction_compensation'"),
      remaining_microunits: inventory(service).batches[0]?.quantity_microunits ?? null,
    },
    finalization: { correction_status: first.status },
    idempotency: {
      exact_replay: JSON.stringify(first) === JSON.stringify(replay),
      business_state_unchanged: businessStateFingerprint(database) === beforeReplay,
    },
  });
}

function runQuery(database: DatabaseSync, service: DietDomainService): DriverObservation {
  for (const [suffix, occurredAt, name] of [
    ["query-breakfast", "2026-08-11T23:30:00.000Z", "rice"],
    ["query-apple", "2026-08-12T00:10:00.000Z", "apple"],
  ] as const) {
    execute(service, mealEnvelope({
      suffix,
      location: "outside",
      receivedAt: occurredAt,
      occurredAt,
      items: [mealItem({
        name,
        unit: "g",
        observed: 100_000_000,
        adopted: 100_000_000,
        deducted: 100_000_000,
        sources: [source("public_fixture", `fixture-${name}-v1`, 1, null, {
          kind: "per_100g", microunits: 100_000_000, unit: "g",
        })],
      })],
    }));
  }
  const before = businessStateFingerprint(database);
  const query = service.query({
    kind: "query_meals",
    operation_id: "query-current-day",
    date: "2026-08-12",
    timezone: "Asia/Shanghai",
  });
  if (query.kind !== "meals") throw new Error("B_SLICE_QUERY_INVALID:meals");
  return succeeded(database, {
    query: {
      names: query.meals.flatMap((meal) => meal.items.map((item) => item.normalized_name)),
      occurred_at: query.meals.map((meal) => meal.occurred_at),
      business_state_unchanged: businessStateFingerprint(database) === before,
    },
  });
}

function runEffectFailure(database: DatabaseSync, signingSecret: Uint8Array): DriverObservation {
  const value = mealEnvelope({
    suffix: "effect-001",
    location: "outside",
    items: [mealItem({
      name: "apple",
      unit: "piece",
      observed: 1_000_000,
      adopted: 1_000_000,
      deducted: 1_000_000,
      sources: [source("public_fixture", "fixture-apple-v1", 1, null, {
        kind: "per_item", microunits: 1_000_000, unit: "piece",
      })],
    })],
  });
  const failing = createDietDomainService({
    database,
    secret: signingSecret,
    now: () => "2026-08-12T04:00:01.000Z",
    fault: "after_meal_nutrition",
  });
  const preview = failing.preview(value);
  let errorCode: string | null = null;
  try {
    failing.execute({
      envelope: value,
      token: preview.token,
      input_digest: preview.input_digest,
      data_revision: preview.data_revision,
    });
  } catch (error) {
    errorCode = error instanceof Error ? error.message.split(":")[0].toLowerCase() : "unknown";
  }
  const state = database.prepare(
    "SELECT state FROM command_envelopes WHERE envelope_id = ?",
  ).get(value.envelope_id) as { state: string };
  const outboxStates = (database.prepare(
    "SELECT DISTINCT state FROM effect_outbox WHERE envelope_id = ? ORDER BY state",
  ).all(value.envelope_id) as Array<{ state: string }>).map((row) => row.state);
  const outboxStatus = outboxStates.length === 1 ? outboxStates[0] : outboxStates.join("|");
  const mealFactsBeforeRetry = count(
    database, "SELECT COUNT(*) AS count FROM event_records WHERE envelope_id = ? AND event_type = 'diet_meal'",
    value.envelope_id,
  );
  const snapshotsBeforeRetry = tableCount(database, "nutrition_snapshots");
  const finalizationsBeforeRetry = tableCount(database, "envelope_finalizations");
  const progressBeforeRetry = tableCount(database, "daily_progress_snapshots");
  const effectBusinessWritesBeforeRetry =
    tableCount(database, "nutrition_profiles") + snapshotsBeforeRetry +
    tableCount(database, "inventory_transactions") + tableCount(database, "issues") + progressBeforeRetry;
  const terminalIdempotencyBeforeRetry = count(
    database,
    "SELECT COUNT(*) AS count FROM idempotency_records WHERE idempotency_key = ? AND terminal_result_json IS NOT NULL",
    value.idempotency_key,
  );
  const healthy = createDietDomainService({
    database,
    secret: signingSecret,
    now: () => "2026-08-12T04:00:02.000Z",
  });
  const recovered = healthy.execute({
    envelope: value,
    token: preview.token,
    input_digest: preview.input_digest,
    data_revision: preview.data_revision,
  });
  return succeeded(database, {
    failure: {
      expected_error_code: errorCode,
      fact_commit_preserved: mealFactsBeforeRetry === 1,
      outbox_status: outboxStatus,
      envelope_status: state.state,
      effect_bundle_business_write_count: effectBusinessWritesBeforeRetry,
      success_receipt_visible: finalizationsBeforeRetry !== 0,
      daily_progress_visible: progressBeforeRetry !== 0,
      terminal_idempotency_visible: terminalIdempotencyBeforeRetry !== 0,
    },
    state_after_restart: {
      meal_fact_preserved: mealFactsBeforeRetry === 1,
      outbox_status: outboxStatus,
      envelope_status: state.state,
    },
    same_key_retry: {
      status: recovered.status,
      meal_fact_write_count: count(
        database, "SELECT COUNT(*) AS count FROM event_records WHERE envelope_id = ? AND event_type = 'diet_meal'",
        value.envelope_id,
      ) - mealFactsBeforeRetry,
      nutrition_snapshot_write_count: tableCount(database, "nutrition_snapshots") - snapshotsBeforeRetry,
      envelope_finalize_count: tableCount(database, "envelope_finalizations"),
    },
  });
}

function seedProduct(
  service: DietDomainService,
  options: Parameters<typeof purchaseOperation>[0],
): void {
  execute(service, purchaseEnvelope(options));
}

function runMeal006(database: DatabaseSync, service: DietDomainService): DriverObservation {
  for (const product of [
    { suffix: "meal006-rice", productId: "product-meal006-rice", normalizedName: "rice", batchId: "batch-meal006-rice", quantity: 1_000_000_000 },
    { suffix: "meal006-chicken", productId: "product-meal006-chicken", normalizedName: "chicken", batchId: "batch-meal006-chicken", quantity: 1_000_000_000 },
  ]) seedProduct(service, { ...product, unit: "g" });
  const result = execute(service, mealEnvelope({
    suffix: "meal006",
    location: "home",
    items: [
      mealItem({
        name: "rice", unit: "g", observed: 200_000_000, adopted: 200_000_000,
        deducted: 200_000_000,
        sources: [source("product_label", "label-product-meal006-rice-v1", 1, "product-meal006-rice", { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
      }),
      mealItem({
        name: "chicken", unit: "g", observed: 150_000_000, adopted: 150_000_000,
        deducted: 150_000_000,
        sources: [source("product_label", "label-product-meal006-chicken-v1", 1, "product-meal006-chicken", { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
      }),
    ],
  }));
  const meal = result.items[0] as unknown as {
    fact_status: string;
    meal_items: ReadonlyArray<{
      estimated_fields: readonly string[];
      nutrition_source_type: string;
    }>;
  };
  return succeeded(database, {
    fact_commit: { status: meal.fact_status, item_count: meal.meal_items.length },
    nutrition: {
      snapshot_count: tableCount(database, "nutrition_snapshots"),
      estimated_fields: meal.meal_items.flatMap((item) => [...item.estimated_fields]),
      source_types: meal.meal_items.map((item) => item.nutrition_source_type),
    },
  });
}

function runNutrition008(database: DatabaseSync, service: DietDomainService): DriverObservation {
  seedProduct(service, {
    suffix: "nutr008-orange",
    productId: "product-nutr008-orange",
    normalizedName: "orange",
    batchId: "batch-nutr008-orange",
    quantity: 5_000_000,
    unit: "piece",
    nutritionBasis: { kind: "per_100g", microunits: 100_000_000, unit: "g" },
  });
  const orange = source(
    "product_label", "label-product-nutr008-orange-v1", 1, "product-nutr008-orange",
    { kind: "per_100g", microunits: 100_000_000, unit: "g" },
  );
  const result = execute(service, mealEnvelope({
    suffix: "nutr008",
    location: "home",
    items: [mealItem({
      name: "orange", unit: "piece", observed: 1_000_000, adopted: 130_000_000,
      deducted: 1_000_000, evidence: "estimated_upper_bound", sources: [orange],
    })],
  }));
  const item = (result.items[0] as unknown as {
    meal_items: readonly [{
      estimated_fields: readonly string[];
      nutrition_adoption_microunits: number | null;
      nutrients: NutritionVector;
    }];
  }).meal_items[0];
  return succeeded(database, {
    nutrition: {
      adopted_microunits: item.nutrition_adoption_microunits,
      energy_kcal_milli: item.nutrients.energy_kcal_milli,
    },
    estimated_fields: [...item.estimated_fields],
  });
}

function runMeal003(database: DatabaseSync, service: DietDomainService): DriverObservation {
  seedProduct(service, {
    suffix: "meal003-rice",
    productId: "product-meal003-rice",
    normalizedName: "rice bowl",
    batchId: "batch-meal003-rice",
    quantity: 3_000_000,
    unit: "bowl",
    nutritionBasis: { kind: "per_100g", microunits: 100_000_000, unit: "g" },
  });
  const result = execute(service, mealEnvelope({
    suffix: "meal003",
    location: "home",
    items: [mealItem({
      name: "rice bowl", unit: "bowl", observed: 500_000, adopted: 150_000_000,
      deducted: 500_000, evidence: "estimated_upper_bound",
      sources: [source("product_label", "label-product-meal003-rice-v1", 1, "product-meal003-rice", {
        kind: "per_100g", microunits: 100_000_000, unit: "g",
      })],
    })],
  }));
  const meal = result.items[0] as unknown as { fact_status: string; meal_items: readonly [{ nutrition_adoption_microunits: number | null; inventory_deduction_microunits: number | null; estimated_fields: readonly string[] }] };
  return succeeded(database, {
    fact_commit: { status: meal.fact_status },
    nutrition: {
      adoption_microunits: meal.meal_items[0].nutrition_adoption_microunits,
      estimated_fields: [...meal.meal_items[0].estimated_fields],
    },
    inventory: {
      deduction_microunits: meal.meal_items[0].inventory_deduction_microunits,
      remaining_microunits: inventory(service).batches[0]?.quantity_microunits ?? null,
    },
  });
}

function runMeal004(database: DatabaseSync, service: DietDomainService): DriverObservation {
  seedProduct(service, {
    suffix: "meal004-apple",
    productId: "product-meal004-apple",
    normalizedName: "apple",
    batchId: "batch-meal004-apple",
    quantity: 5_000_000,
    unit: "piece",
  });
  const before = inventory(service).batches[0]?.quantity_microunits ?? null;
  const transactionCount = tableCount(database, "inventory_transactions");
  const result = execute(service, mealEnvelope({
    suffix: "meal004",
    location: "outside",
    items: [mealItem({
      name: "apple", unit: "piece", observed: 1_000_000, adopted: 1_000_000,
      deducted: 1_000_000,
      sources: [source("public_fixture", "fixture-apple-v1", 1, null, {
        kind: "per_item", microunits: 1_000_000, unit: "piece",
      })],
    })],
  }));
  const meal = result.items[0] as unknown as { fact_status: string; inventory_match: string };
  return succeeded(database, {
    fact_commit: { status: meal.fact_status },
    inventory: {
      match: meal.inventory_match,
      quantity_before: before,
      quantity_after: inventory(service).batches[0]?.quantity_microunits ?? null,
      transaction_delta: tableCount(database, "inventory_transactions") - transactionCount,
    },
  });
}

function runInventory003(database: DatabaseSync, service: DietDomainService): DriverObservation {
  for (const suffix of ["a", "b"] as const) seedProduct(service, {
    suffix: `inventory003-${suffix}`,
    productId: `product-inventory003-${suffix}`,
    normalizedName: "milk",
    batchId: `batch-inventory003-${suffix}`,
    quantity: 6_000_000,
    unit: "carton",
  });
  const before = inventory(service).batches.map((batch) => batch.quantity_microunits);
  const result = execute(service, mealEnvelope({
    suffix: "inventory003",
    location: "home",
    items: [mealItem({
      name: "milk", unit: "carton", observed: 1_000_000, adopted: 1_000_000,
      deducted: 1_000_000,
      sources: [source("public_fixture", "fixture-milk-v1", 1, null, {
        kind: "per_package", microunits: 1_000_000, unit: "carton",
      })],
    })],
  }));
  const meal = result.items[0] as unknown as { fact_status: string; inventory_match: string; issue_codes: readonly string[] };
  return succeeded(database, {
    fact_commit: { status: meal.fact_status, event_count: count(database, "SELECT COUNT(*) AS count FROM event_records WHERE event_type = 'diet_meal'") },
    effect_bundle: {
      inventory_match: meal.inventory_match,
      issue_codes: [...meal.issue_codes],
      quantity_unchanged: JSON.stringify(before) === JSON.stringify(inventory(service).batches.map((batch) => batch.quantity_microunits)),
    },
  });
}

function runInventory004(database: DatabaseSync, service: DietDomainService): DriverObservation {
  seedProduct(service, {
    suffix: "inventory004-eggs",
    productId: "product-inventory004-eggs",
    normalizedName: "eggs",
    batchId: "batch-inventory004-eggs",
    quantity: 2_000_000,
    unit: "piece",
  });
  const result = execute(service, mealEnvelope({
    suffix: "inventory004",
    location: "home",
    items: [mealItem({
      name: "eggs", unit: "piece", observed: 3_000_000, adopted: 3_000_000,
      deducted: 3_000_000,
      sources: [source("product_label", "label-product-inventory004-eggs-v1", 1, "product-inventory004-eggs", {
        kind: "per_item", microunits: 1_000_000, unit: "piece",
      })],
    })],
  }));
  const meal = result.items[0] as unknown as { fact_status: string; inventory_match: string; issue_codes: readonly string[] };
  return succeeded(database, {
    fact_commit: { status: meal.fact_status },
    effect_bundle: {
      inventory_match: meal.inventory_match,
      issue_codes: [...meal.issue_codes],
      remaining_microunits: inventory(service).batches[0]?.quantity_microunits ?? null,
      negative_rows: count(database, "SELECT COUNT(*) AS count FROM inventory_batch_projections WHERE json_extract(payload_json, '$.quantity_microunits') < 0"),
    },
  });
}

function runNutrition001(database: DatabaseSync, service: DietDomainService): DriverObservation {
  seedProduct(service, {
    suffix: "nutr001-milk",
    productId: "product-nutr001-milk",
    normalizedName: "milk",
    batchId: "batch-nutr001-milk",
    quantity: 4_000_000,
    unit: "carton",
    sourceRef: "fixture-label-whole-milk-250-v1",
    nutrients: Object.freeze({ ...defaultNutrients, fiber_mg: null }),
  });
  execute(service, mealEnvelope({
    suffix: "nutr001",
    location: "home",
    items: [mealItem({
      name: "milk", unit: "carton", observed: 1_000_000, adopted: 1_000_000,
      deducted: 1_000_000,
      sources: [
        source("public_fixture", "fixture-public-milk-v1", 1, null, {
          kind: "per_package", microunits: 1_000_000, unit: "carton",
        }),
        source("product_label", "fixture-label-whole-milk-250-v1", 1, "product-nutr001-milk", {
          kind: "per_item", microunits: 1_000_000, unit: "carton",
        }, Object.freeze({ ...defaultNutrients, fiber_mg: null })),
      ],
    })],
  }));
  const profile = database.prepare(
    `SELECT source_type, source_ref, profile_version, coverage_status
     FROM nutrition_profiles WHERE subject_id = ?`,
  ).get("product-nutr001-milk") as Record<string, JsonValue>;
  const snapshot = database.prepare(
    "SELECT profile_version, coverage_status FROM nutrition_snapshots ORDER BY created_at DESC LIMIT 1",
  ).get() as Record<string, JsonValue>;
  return succeeded(database, { effect_bundle: { profile, snapshot } });
}

function runNutrition002(database: DatabaseSync, service: DietDomainService): DriverObservation {
  execute(service, mealEnvelope({
    suffix: "nutr002",
    location: "outside",
    items: [mealItem({
      name: "pear", unit: "g", observed: 100_000_000, adopted: 100_000_000,
      deducted: 100_000_000,
      sources: [source("public_fixture", "fixture-public-pear-v1", 1, null, {
        kind: "per_100g", microunits: 100_000_000, unit: "g",
      })],
    })],
  }));
  const profile = database.prepare(
    "SELECT source_type, source_ref, coverage_status FROM nutrition_profiles ORDER BY created_at LIMIT 1",
  ).get() as Record<string, JsonValue>;
  return succeeded(database, { effect_bundle: { profile, snapshot_count: tableCount(database, "nutrition_snapshots") } });
}

function runNutrition005(database: DatabaseSync, service: DietDomainService): DriverObservation {
  const productId = "product-nutr005-yogurt";
  const v1 = source("product_label", "label-yogurt-v1", 1, productId, {
    kind: "per_item", microunits: 1_000_000, unit: "cup",
  });
  const v2 = source("product_label", "label-yogurt-v2", 2, productId, {
    kind: "per_item", microunits: 1_000_000, unit: "cup",
  }, Object.freeze({ ...defaultNutrients, protein_mg: 6_000 }));
  execute(service, mealEnvelope({
    suffix: "nutr005-v1", location: "outside",
    items: [mealItem({ name: "yogurt", unit: "cup", observed: 1_000_000, adopted: 1_000_000, deducted: 1_000_000, sources: [v1] })],
  }));
  const first = database.prepare(
    "SELECT snapshot_id, profile_version, payload_json FROM nutrition_snapshots ORDER BY created_at LIMIT 1",
  ).get() as { snapshot_id: string; profile_version: string; payload_json: string };
  execute(service, mealEnvelope({
    suffix: "nutr005-v2", location: "outside",
    receivedAt: "2026-08-12T02:00:00.000Z",
    items: [mealItem({ name: "yogurt", unit: "cup", observed: 1_000_000, adopted: 1_000_000, deducted: 1_000_000, sources: [v2] })],
  }));
  const versions = (database.prepare(
    "SELECT profile_version FROM nutrition_snapshots ORDER BY created_at, snapshot_id",
  ).all() as Array<{ profile_version: string }>).map((row) => Number(row.profile_version));
  const frozenFirst = database.prepare(
    "SELECT payload_json FROM nutrition_snapshots WHERE snapshot_id = ?",
  ).get(first.snapshot_id) as { payload_json: string };
  return succeeded(database, {
    history: { versions, first_snapshot_unchanged: frozenFirst.payload_json === first.payload_json },
    new_record: { profile_version: versions.at(-1) ?? null, profile_count: tableCount(database, "nutrition_profiles") },
  });
}

function runStorage001(database: DatabaseSync, service: DietDomainService): DriverObservation {
  const value = mealEnvelope({
    suffix: "storage001", location: "outside",
    items: [mealItem({
      name: "apple", unit: "piece", observed: 1_000_000, adopted: 1_000_000,
      deducted: 1_000_000,
      sources: [source("public_fixture", "fixture-apple-storage-v1", 1, null, {
        kind: "per_item", microunits: 1_000_000, unit: "piece",
      })],
    })],
  });
  const preview = service.preview(value);
  const input = {
    envelope: value,
    token: preview.token,
    input_digest: preview.input_digest,
    data_revision: preview.data_revision,
  } as const;
  const first = service.execute(input);
  const before = businessStateFingerprint(database);
  const replay = service.execute(input);
  return succeeded(database, {
    idempotency: {
      exact_result: JSON.stringify(first) === JSON.stringify(replay),
      business_state_unchanged: businessStateFingerprint(database) === before,
      meal_event_count: count(database, "SELECT COUNT(*) AS count FROM event_records WHERE event_type = 'diet_meal'"),
      finalization_count: tableCount(database, "envelope_finalizations"),
    },
  });
}

function runReceipt001(database: DatabaseSync, service: DietDomainService): DriverObservation {
  const result = execute(service, mealEnvelope({
    suffix: "receipt001", location: "outside",
    items: [
      mealItem({ name: "eggs", unit: "piece", observed: 2_000_000, adopted: 2_000_000, deducted: 2_000_000, sources: [source("public_fixture", "fixture-eggs-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })] }),
      mealItem({ name: "bread", unit: "slice", observed: 2_000_000, adopted: 2_000_000, deducted: 2_000_000, sources: [source("public_fixture", "fixture-bread-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "slice" })] }),
      mealItem({ name: "milk", unit: "ml", observed: 250_000_000, adopted: 250_000_000, deducted: 250_000_000, sources: [source("public_fixture", "fixture-milk-ml-v1", 1, null, { kind: "per_100ml", microunits: 100_000_000, unit: "ml" })] }),
    ],
  }));
  const payload = result.payload as { receipt_data: { blocks: ReadonlyArray<{ kind: string }> } };
  const kinds = payload.receipt_data.blocks.map((block) => block.kind);
  return succeeded(database, {
    receipt: {
      block_kinds: kinds,
      item_blocks: kinds.filter((kind) => kind === "item").length,
      progress_last: kinds.at(-1) === "progress",
      internal_id_visible: /(?:event|transaction|snapshot|profile)-[a-f0-9]{32}/.test(JSON.stringify(payload.receipt_data)),
    },
  });
}

function runReceipt003(database: DatabaseSync, service: DietDomainService): DriverObservation {
  for (const suffix of ["a", "b"] as const) seedProduct(service, {
    suffix: `receipt003-${suffix}`,
    productId: `product-receipt003-${suffix}`,
    normalizedName: "milk",
    batchId: `batch-receipt003-${suffix}`,
    quantity: 4_000_000,
    unit: "carton",
  });
  const result = execute(service, mealEnvelope({
    suffix: "receipt003", location: "home",
    items: [mealItem({ name: "milk", unit: "carton", observed: 1_000_000, adopted: 1_000_000, deducted: 1_000_000, sources: [source("public_fixture", "fixture-milk-prompt-v1", 1, null, { kind: "per_package", microunits: 1_000_000, unit: "carton" })] })],
  }));
  const payload = result.payload as { quick_prompts: ReadonlyArray<{ option_ids: readonly string[]; free_text_line: string }> };
  return succeeded(database, {
    quick_options: {
      prompt_count: payload.quick_prompts.length,
      option_ids: [...(payload.quick_prompts[0]?.option_ids ?? [])],
      free_text_sha256: createHash("sha256")
        .update(payload.quick_prompts[0]?.free_text_line ?? "", "utf8")
        .digest("hex")
        .toUpperCase(),
    },
  });
}

function runProgress010(database: DatabaseSync, service: DietDomainService): DriverObservation {
  const meal = mealEnvelope({
    suffix: "progress010", location: "outside",
    items: [
      mealItem({ name: "rice", unit: "g", observed: 100_000_000, adopted: 100_000_000, deducted: 100_000_000, sources: [source("public_fixture", "fixture-progress-rice-v1", 1, null, { kind: "per_100g", microunits: 100_000_000, unit: "g" })] }),
      mealItem({ name: "chicken", unit: "g", observed: 100_000_000, adopted: 100_000_000, deducted: 100_000_000, sources: [source("public_fixture", "fixture-progress-chicken-v1", 1, null, { kind: "per_100g", microunits: 100_000_000, unit: "g" })] }),
    ],
  }).operations[0]!;
  const result = execute(service, envelope("progress010", "record_meal", [
    purchaseOperation({
      suffix: "progress010",
      productId: "product-progress010-rice",
      normalizedName: "rice",
      batchId: "batch-progress010-rice",
      quantity: 1_000_000_000,
      unit: "g",
      sourceRef: "fixture-progress010-rice-label-v1",
    }),
    meal,
  ]));
  const payload = result.payload as JsonValue;
  const receiptProgress = extractSingleReceiptProgress(payload);
  const finalization = database.prepare(
    "SELECT payload_json FROM envelope_finalizations WHERE envelope_id = ?",
  ).get("envelope-progress010") as { payload_json: string };
  const finalized = JSON.parse(finalization.payload_json) as {
    payload: { daily_progress: { nutrients: NutritionVector } };
  };
  const mixedRows = database.prepare(
    `SELECT sequence, command_type, operation_id FROM mixed_item_results
     WHERE envelope_id = ? ORDER BY sequence`,
  ).all("envelope-progress010") as Array<{
    sequence: number;
    command_type: "add_inventory" | "record_meal";
    operation_id: string;
  }>;
  const operationContributions = mixedRows.map((row) => {
    const bundleRow = database.prepare(
      `SELECT payload_json FROM effect_bundle_commits
       WHERE envelope_id = ? AND operation_id = ?`,
    ).get("envelope-progress010", row.operation_id) as { payload_json: string };
    const bundle = JSON.parse(bundleRow.payload_json) as {
      effects: Array<{ contribution?: { nutrients: NutritionVector } }>;
    };
    const contribution = bundle.effects.find((effect) => effect.contribution !== undefined)?.contribution;
    return Object.freeze({
      sequence: row.sequence,
      kind: row.command_type,
      nutrients: contribution === undefined ? null : Object.freeze({ ...contribution.nutrients }),
    });
  });
  return succeeded(database, {
    progress: {
      child_operation_count: mixedRows.length,
      operation_contributions: operationContributions,
      snapshot_count: tableCount(database, "daily_progress_snapshots"),
      finalization_count: tableCount(database, "envelope_finalizations"),
      energy_kcal_milli: receiptProgress.energy_kcal_milli,
      receipt_progress: { ...receiptProgress },
      finalized_progress: { ...finalized.payload.daily_progress.nutrients },
      progress_block_count: 1,
    },
  });
}

function runCase(
  caseId: G2BSliceCaseId,
  database: DatabaseSync,
  service: DietDomainService,
  signingSecret: Uint8Array,
): DriverObservation {
  switch (caseId) {
    case "CASE-MIXED-001": return runMixed(database, service);
    case "CASE-CORR-001": return runCorrection(database, service);
    case "CASE-QUERY-001": return runQuery(database, service);
    case "CASE-EFFECT-001": return runEffectFailure(database, signingSecret);
    case "CASE-MEAL-006": return runMeal006(database, service);
    case "CASE-NUTR-008": return runNutrition008(database, service);
    case "CASE-MEAL-003": return runMeal003(database, service);
    case "CASE-MEAL-004": return runMeal004(database, service);
    case "CASE-INVENTORY-003": return runInventory003(database, service);
    case "CASE-INVENTORY-004": return runInventory004(database, service);
    case "CASE-NUTR-001": return runNutrition001(database, service);
    case "CASE-NUTR-002": return runNutrition002(database, service);
    case "CASE-NUTR-005": return runNutrition005(database, service);
    case "CASE-STORAGE-001": return runStorage001(database, service);
    case "CASE-RECEIPT-001": return runReceipt001(database, service);
    case "CASE-RECEIPT-003": return runReceipt003(database, service);
    case "CASE-PROGRESS-010": return runProgress010(database, service);
    default: return assertNever(caseId);
  }
}

export function createBSliceDriver(
  runtimeFactory: BSliceRuntimeFactory = defaultRuntimeFactory,
): BCaseDriver {
  return (input) => {
    const caseId = assertCaseId(input.case_id);
    assertInputAuthority(input, caseId);
    const runtime = runtimeFactory(caseId);
    try {
      const signingSecret = randomBytes(32);
      const service = createDietDomainService({
        database: runtime.database,
        secret: signingSecret,
        now: () => "2026-08-12T04:00:01.000Z",
      });
      return runCase(caseId, runtime.database, service, signingSecret);
    } finally {
      runtime.close();
    }
  };
}
