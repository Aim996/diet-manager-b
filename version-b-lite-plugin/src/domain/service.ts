import type { DatabaseSync } from "node:sqlite";
import { isProxy } from "node:util/types";

import { canonicalJson } from "../authority/canonical-json.js";
import { assertOffsetIsoTimestamp } from "../authority/offset-timestamp.js";
import {
  createMealFactIdentity,
  type MealFactPreviewMaterial,
} from "../authority/meal-fact-identity.js";
import { createWaterFactIdentity, type WaterFactPreviewMaterial } from "../authority/water-fact-identity.js";
import {
  createPurchaseFactIdentity,
  type PurchaseFactPreviewMaterial,
} from "../authority/purchase-fact-identity.js";
import {
  createInventoryAdjustmentFactIdentity,
  type InventoryAdjustmentFactPreviewMaterial,
} from "../authority/inventory-adjustment-fact-identity.js";
import {
  MealFactAuthorityError,
  optionalMealEvidenceFields,
  validateAndFreezeOccurredTimeEvidence,
  validateMealOperationEvidence,
} from "../authority/meal-fact.js";
import {
  authorizeRepositoryPreview,
  createServerPreview,
  reuseServerPreview,
  type AuthorizedRepositoryPreview,
} from "../preview/store.js";
import {
  appendPreparedOperationFact,
  sealPreparedEnvelopeFacts,
} from "../repository/fact-commit.js";
import { commitPreparedPurchaseEnvelope } from "../repository/purchase-envelope-commit.js";
import {
  finalizeEnvelope,
  type EnvelopeFinalizeOptions,
  type FinalizeEnvelopeInput,
  type FinalizedEnvelopeResult,
  type PreparedMixedItemResult,
} from "../repository/envelope-finalize.js";
import {
  createContributionProgressReservation,
  readEnvelopeProgressReservation,
  type ContributionProgressReservation,
} from "../repository/progress-reservation.js";
import { computeRepositoryDataRevision } from "../repository/revision.js";
import { assertStoredPurchaseFactMatchesExpected } from "../storage/inventory-repository.js";
import {
  applyMealEffects,
  applyRequiredMealInventoryInTransaction,
  applyWaterEffects,
  assertStoredWaterFactMatchesExpected,
  markWaterEffectsRetryable,
  markMealEffectsRetryable,
  applyPurchaseEffect,
  applyCorrectionEffects,
  assertStoredMealFactMatchesExpected,
  prepareCorrectionOperation,
  readAppliedMealResult,
  readAppliedCorrectionResult,
  prepareMealInventoryPlans,
  preflightMealOperation,
  preflightWaterOperation,
  prepareMealOperation,
  prepareWaterOperation,
  preparePurchaseOperation,
  prepareInventoryLocationCorrectionOperation,
  type MealOperationResult,
} from "./effect-bundle.js";
import { deriveDomainId, digestDomainEnvelope } from "./identity.js";
import {
  PantryEvidenceAuthorityError,
  validateAndFreezeExpirationEvidence,
  validateAndFreezeInventoryLocationCorrectionFactPayload,
  validateAndFreezePantryPurchaseEvidence,
  validateAndFreezeStorageLocationEvidence,
} from "./inventory-service.js";
import { queryDomainReadModel, type DomainQueryResult } from "./read-model.js";
import { validateAndFreezeResolvedNutritionEvidence } from "../nutrition/types.js";
import {
  buildQuickPrompt,
  buildReceiptData,
  type QuickPrompt,
  type QuickPromptIssueCode,
} from "./receipt.js";
import type {
  AddInventoryOperation,
  CorrectInventoryLocationOperation,
  CorrectMealTimeOperation,
  CorrectNutritionSupplementOperation,
  CorrectRecordOperation,
  DomainEnvelopeInput,
  DomainExecutionResult,
  DomainOperation,
  DomainQueryOperation,
  RecordMealOperation,
  RecordWaterOperation,
  UndoRecordOperation,
} from "./types.js";

function isInventoryLocationCorrection(
  operation: CorrectRecordOperation | UndoRecordOperation,
): operation is CorrectInventoryLocationOperation {
  return operation.kind === "correct_record" &&
    Object.hasOwn(operation, "correction_kind") &&
    (operation as { correction_kind?: unknown }).correction_kind === "inventory_location";
}

function storedInventoryLocationCorrection(
  database: DatabaseSync,
  envelope: DomainEnvelopeInput,
  operation: CorrectInventoryLocationOperation,
) {
  const rows = database.prepare(
    `SELECT event_id, operation_id, schema_version, event_type, fact_kind,
            source_message_id, conversation_id, received_at, occurred_at_text,
            meal_id, meal_slot, payload_json
     FROM event_records WHERE envelope_id = ? AND operation_id = ?`,
  ).all(envelope.envelope_id, operation.operation_id) as Array<Record<string, unknown>>;
  const row = rows[0];
  if (
    rows.length !== 1 || !row ||
    row.event_id !== deriveDomainId("event", envelope.idempotency_key, 0) ||
    row.operation_id !== operation.operation_id || row.schema_version !== "domain/v2" ||
    row.event_type !== "inventory_adjusted" || row.fact_kind !== "inventory" ||
    row.source_message_id !== envelope.source_message_id ||
    row.conversation_id !== envelope.conversation_id || row.received_at !== envelope.received_at ||
    row.occurred_at_text !== envelope.received_at || row.meal_id !== null || row.meal_slot !== null ||
    typeof row.payload_json !== "string"
  ) throw new Error("DIET_DOMAIN_RESULT_INVALID:location_correction_fact_identity");
  let payload;
  try {
    const parsed = JSON.parse(row.payload_json) as unknown;
    if (canonicalJson(parsed) !== row.payload_json) throw new Error("canonical");
    payload = validateAndFreezeInventoryLocationCorrectionFactPayload(parsed);
  } catch {
    throw new Error("DIET_DOMAIN_RESULT_INVALID:location_correction_fact_payload");
  }
  if (
    payload.batch_id !== operation.batch_id || payload.base_revision !== operation.base_revision ||
    canonicalJson(payload.previous_location) !== canonicalJson(operation.previous_location) ||
    canonicalJson(payload.next_location) !== canonicalJson(operation.next_location) ||
    canonicalJson(payload.next_expiration) !== canonicalJson(operation.expected_expiration) ||
    payload.source_text !== operation.source_text || payload.matched_span !== operation.matched_span ||
    payload.rule_version !== operation.rule_version || payload.result.operation_id !== operation.operation_id
  ) throw new Error("DIET_DOMAIN_RESULT_INVALID:location_correction_fact_authority");
  return payload;
}

export interface DomainPreviewResult {
  readonly envelope_id: string;
  readonly token: string;
  readonly input_digest: string;
  readonly data_revision: string;
  readonly reused: boolean;
}

export interface DomainExecuteInput {
  readonly envelope: DomainEnvelopeInput;
  readonly token: string;
  readonly input_digest: string;
  readonly data_revision: string;
}

export interface DietDomainFailureEntry {
  readonly stage: "FactCommit" | "EffectBundle" | "EnvelopeFinalize";
  readonly error_code: string;
  readonly trace_id: string;
  readonly input_digest: string;
}

type DietDomainFault =
  | "before_fact_commit"
  | "after_inventory_business_writes"
  | "after_location_correction_fact_commit"
  | "after_location_correction_effect_claim"
  | "after_meal_nutrition"
  | "after_meal_first_item"
  | "after_meal_first_inventory_allocation"
  | "after_meal_issue_write"
  | "after_meal_progress_contribution_prepared"
  | "after_water_event"
  | "after_water_outbox"
  | "after_water_progress_contribution_prepared"
  | "after_correction_claim"
  | "after_correction_compensation"
  | "after_correction_nutrition_progress"
  | "after_mixed_meal_effect_commit"
  | "after_mixed_seal"
  | "after_mixed_finalize_commit"
  | "after_finalization_row"
  | "after_envelope"
  | "after_idempotency"
  | "before_commit";

export interface CreateDietDomainServiceInput {
  readonly database: DatabaseSync;
  readonly secret: Uint8Array;
  readonly now: () => string;
  readonly fault?: DietDomainFault;
  readonly failureSink?: (entry: DietDomainFailureEntry) => void;
}

export interface DietDomainService {
  preview(input: DomainEnvelopeInput): DomainPreviewResult;
  execute(input: DomainExecuteInput): DomainExecutionResult;
  query(input: DomainQueryOperation): DomainQueryResult;
}

function invalid(reason: string): never {
  throw new TypeError(`DIET_DOMAIN_REQUEST_INVALID:${reason}`);
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string") return invalid(field);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    return invalid(field);
  }
  return value;
}

function receivedTimestamp(value: unknown, field: string): string {
  return assertOffsetIsoTimestamp(value, () => invalid(field));
}

function record(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid(field);
  const actual = Object.keys(value).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])) {
    return invalid(field);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || /[\u0000-\u001F\u007F]/.test(value)) {
    return invalid(field);
  }
  return value;
}

function safeNonnegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalid(field);
  }
  return value;
}

function nullableSafeNonnegativeInteger(value: unknown, field: string): number | null {
  return value === null ? null : safeNonnegativeInteger(value, field);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) return invalid(field);
  return value as T;
}

function validateNutritionVector(value: unknown, field: string): void {
  const candidate = record(value, [
    "energy_kcal_milli", "protein_mg", "fat_mg", "carbohydrate_mg", "fiber_mg", "water_ml_milli",
  ], field);
  for (const key of Object.keys(candidate)) {
    nullableSafeNonnegativeInteger(candidate[key], `${field}.${key}`);
  }
}

function validateNutritionSources(value: unknown, field: string): void {
  if (!Array.isArray(value)) return invalid(field);
  for (const [index, source] of value.entries()) {
    const candidate = record(source, [
      "source_type", "source_ref", "profile_version", "applicable_product_id", "basis_kind",
      "basis_microunits", "basis_unit", "nutrients",
    ], `${field}.${index}`);
    enumValue(candidate.source_type, ["product_label", "public_fixture"], `${field}.${index}.source_type`);
    text(candidate.source_ref, `${field}.${index}.source_ref`);
    const version = safeNonnegativeInteger(candidate.profile_version, `${field}.${index}.profile_version`);
    if (version < 1) return invalid(`${field}.${index}.profile_version`);
    if (candidate.applicable_product_id !== null) text(candidate.applicable_product_id, `${field}.${index}.applicable_product_id`);
    enumValue(candidate.basis_kind, [
      "per_100g", "per_100ml", "per_serving", "per_item", "per_package", "custom_recipe",
    ], `${field}.${index}.basis_kind`);
    const basis = safeNonnegativeInteger(candidate.basis_microunits, `${field}.${index}.basis_microunits`);
    if (basis === 0) return invalid(`${field}.${index}.basis_microunits`);
    text(candidate.basis_unit, `${field}.${index}.basis_unit`);
    validateNutritionVector(candidate.nutrients, `${field}.${index}.nutrients`);
  }
}

function validateStructuredAmount(value: unknown, field: string): void {
  const amount = record(value, [
    "unit", "observed_microunits", "nutrition_adoption_microunits",
    "inventory_deduction_microunits", "template_reference_microunits", "evidence",
  ], field);
  text(amount.unit, `${field}.unit`);
  if (amount.observed_microunits === null) {
    if (amount.nutrition_adoption_microunits !== null) {
      return invalid(`${field}.nutrition_adoption_microunits`);
    }
    if (amount.inventory_deduction_microunits !== null) {
      return invalid(`${field}.inventory_deduction_microunits`);
    }
    if (amount.template_reference_microunits !== null) {
      return invalid(`${field}.template_reference_microunits`);
    }
    if (amount.evidence !== "unknown") return invalid(`${field}.evidence`);
    return;
  }
  safeNonnegativeInteger(amount.observed_microunits, `${field}.observed_microunits`);
  nullableSafeNonnegativeInteger(amount.nutrition_adoption_microunits, `${field}.nutrition_adoption_microunits`);
  nullableSafeNonnegativeInteger(amount.inventory_deduction_microunits, `${field}.inventory_deduction_microunits`);
  nullableSafeNonnegativeInteger(amount.template_reference_microunits, `${field}.template_reference_microunits`);
  enumValue(amount.evidence, ["explicit", "estimated_upper_bound"], `${field}.evidence`);
}

function validateKnownStructuredAmount(value: unknown, field: string): void {
  validateStructuredAmount(value, field);
  if ((value as Record<string, unknown>).observed_microunits === null) {
    return invalid(`${field}.observed_microunits`);
  }
}

function validateInventoryDirective(value: unknown, field: string): void {
  const directive = record(value, ["mode", "evidence_kind", "matched_span", "rule_version"], field);
  enumValue(directive.mode, ["skip"], `${field}.mode`);
  enumValue(directive.evidence_kind, ["explicit"], `${field}.evidence_kind`);
  text(directive.matched_span, `${field}.matched_span`);
  text(directive.rule_version, `${field}.rule_version`);
}

function validatePantryInventoryPolicy(value: unknown, field: string): void {
  const policy = record(value, ["mode", "missing_candidate_behavior", "rule_version"], field);
  enumValue(policy.mode, ["pantry_v2"], `${field}.mode`);
  enumValue(policy.missing_candidate_behavior, ["skip_insufficient"], `${field}.missing_candidate_behavior`);
  enumValue(policy.rule_version, ["diet-manager/pantry-allocation-v1"], `${field}.rule_version`);
}

function validateOperation(
  value: unknown,
  field: string,
): RecordWaterOperation | CorrectInventoryLocationOperation | CorrectNutritionSupplementOperation | CorrectMealTimeOperation | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid(field);
  const operation = value as Record<string, unknown>;
  const kind = operation.kind;
  if (kind === "add_inventory") {
    const evidenceKeys = Object.hasOwn(operation, "pantry_evidence") ? ["pantry_evidence"] : [];
    const candidate = record(value, [
      "kind", "operation_id", "product", "batch_id", "amount", "nutrition_sources", ...evidenceKeys,
    ], field);
    text(candidate.operation_id, `${field}.operation_id`);
    text(candidate.batch_id, `${field}.batch_id`);
    const product = record(candidate.product, ["product_id", "normalized_name", "product_type"], `${field}.product`);
    text(product.product_id, `${field}.product.product_id`);
    text(product.normalized_name, `${field}.product.normalized_name`);
    text(product.product_type, `${field}.product.product_type`);
    if (evidenceKeys.length === 0) {
      validateKnownStructuredAmount(candidate.amount, `${field}.amount`);
    } else {
      validateStructuredAmount(candidate.amount, `${field}.amount`);
    }
    validateNutritionSources(candidate.nutrition_sources, `${field}.nutrition_sources`);
    if (evidenceKeys.length === 1) {
      try {
        const evidence = validateAndFreezePantryPurchaseEvidence(candidate.pantry_evidence);
        const amount = candidate.amount as Record<string, unknown>;
        if (
          amount.observed_microunits === null &&
          (
            amount.unit !== "unknown" || amount.evidence !== "unknown" ||
            evidence.package_quantity.total_inner !== null ||
            evidence.package_quantity.total_capacity !== null
          )
        ) return invalid(`${field}.amount.observed_microunits`);
      } catch (error) {
        if (error instanceof PantryEvidenceAuthorityError) return invalid(`${field}.${error.reason}`);
        throw error;
      }
    }
    return;
  }
  if (kind === "record_meal") {
    const policyKeys = Object.hasOwn(operation, "inventory_policy")
      ? ["inventory_policy"]
      : [];
    const candidate = record(value, [
      "kind", "operation_id", "occurred_at", "meal_slot", "location", "items",
      ...optionalMealEvidenceFields(operation), ...policyKeys,
    ], field);
    text(candidate.operation_id, `${field}.operation_id`);
    timestamp(candidate.occurred_at, `${field}.occurred_at`);
    text(candidate.meal_slot, `${field}.meal_slot`);
    enumValue(candidate.location, ["home", "outside"], `${field}.location`);
    if (policyKeys.length === 1) {
      validatePantryInventoryPolicy(candidate.inventory_policy, `${field}.inventory_policy`);
    }
    if (!Array.isArray(candidate.items) || candidate.items.length === 0) return invalid(`${field}.items`);
    for (const [index, item] of candidate.items.entries()) {
      const directiveKeys = typeof item === "object" && item !== null && Object.hasOwn(item, "inventory_directive")
        ? ["inventory_directive"]
        : [];
      const nutritionEvidenceKeys = typeof item === "object" && item !== null &&
          Object.hasOwn(item, "nutrition_evidence")
        ? ["nutrition_evidence"]
        : [];
      const mealItem = record(item, [
        "normalized_name", "item_type", "amount", "nutrition_sources", ...directiveKeys,
        ...nutritionEvidenceKeys,
      ], `${field}.items.${index}`);
      text(mealItem.normalized_name, `${field}.items.${index}.normalized_name`);
      enumValue(mealItem.item_type, ["dish", "food", "nutrition_drink"], `${field}.items.${index}.item_type`);
      if (directiveKeys.length === 1) {
        validateInventoryDirective(mealItem.inventory_directive, `${field}.items.${index}.inventory_directive`);
      }
      validateStructuredAmount(mealItem.amount, `${field}.items.${index}.amount`);
      validateNutritionSources(mealItem.nutrition_sources, `${field}.items.${index}.nutrition_sources`);
      if (nutritionEvidenceKeys.length === 1) {
        validateAndFreezeResolvedNutritionEvidence(mealItem.nutrition_evidence);
      }
    }
    try {
      validateMealOperationEvidence(candidate, candidate.occurred_at as string, field);
    } catch (error) {
      if (error instanceof MealFactAuthorityError) return invalid(error.reason);
      throw error;
    }
    return;
  }
  if (kind === "record_water") {
    const candidate = record(value, [
      "kind", "operation_id", "occurred_time", "source_text", "plain_water_ml_milli", "amount_evidence",
    ], field);
    text(candidate.operation_id, `${field}.operation_id`);
    let occurredTime;
    try {
      occurredTime = validateAndFreezeOccurredTimeEvidence(candidate.occurred_time, {
        path: `${field}.occurred_time`,
        requireExact: true,
      });
    } catch (error) {
      if (error instanceof MealFactAuthorityError) return invalid(error.reason);
      throw error;
    }
    text(candidate.source_text, `${field}.source_text`);
    if (
      !Number.isSafeInteger(candidate.plain_water_ml_milli) ||
      (candidate.plain_water_ml_milli as number) <= 0 ||
      (candidate.plain_water_ml_milli as number) > 20_000_000
    ) return invalid(`${field}.plain_water_ml_milli`);
    const evidence = record(candidate.amount_evidence, ["raw_text", "quantity", "unit", "estimated"], `${field}.amount_evidence`);
    text(evidence.raw_text, `${field}.amount_evidence.raw_text`);
    if (!Number.isSafeInteger(evidence.quantity) || (evidence.quantity as number) <= 0 || (evidence.quantity as number) > 20_000) {
      return invalid(`${field}.amount_evidence.quantity`);
    }
    if (evidence.unit !== "ml" || evidence.estimated !== false) return invalid(`${field}.amount_evidence`);
    if ((evidence.quantity as number) * 1_000 !== candidate.plain_water_ml_milli) {
      return invalid(`${field}.amount_evidence.quantity`);
    }
    return Object.freeze({ ...candidate, occurred_time: occurredTime }) as unknown as RecordWaterOperation;
  }
  if (kind === "correct_record") {
    if (Object.hasOwn(operation, "correction_kind")) {
      if ((operation as Record<string, unknown>).correction_kind === "nutrition_supplement") {
        const candidate = record(value, [
          "kind", "operation_id", "correction_kind", "target_event_id", "base_revision",
          "item_order", "previous_snapshot_id", "replacement_amount", "replacement_nutrition_source",
          "replacement_nutrition_evidence",
        ], field);
        text(candidate.operation_id, `${field}.operation_id`);
        enumValue(candidate.correction_kind, ["nutrition_supplement"], `${field}.correction_kind`);
        text(candidate.target_event_id, `${field}.target_event_id`);
        const baseRevision = safeNonnegativeInteger(candidate.base_revision, `${field}.base_revision`);
        if (baseRevision < 1) return invalid(`${field}.base_revision`);
        safeNonnegativeInteger(candidate.item_order, `${field}.item_order`);
        text(candidate.previous_snapshot_id, `${field}.previous_snapshot_id`);
        validateKnownStructuredAmount(candidate.replacement_amount, `${field}.replacement_amount`);
        validateNutritionSources(
          [candidate.replacement_nutrition_source],
          `${field}.replacement_nutrition_source`,
        );
        validateAndFreezeResolvedNutritionEvidence(candidate.replacement_nutrition_evidence);
        return Object.freeze({ ...candidate }) as unknown as CorrectNutritionSupplementOperation;
      }
      if ((operation as Record<string, unknown>).correction_kind === "meal_time") {
        const candidate = record(value, [
          "kind", "operation_id", "correction_kind", "target_event_id", "base_revision",
          "replacement_occurred_at", "replacement_meal_slot",
        ], field);
        text(candidate.operation_id, `${field}.operation_id`);
        enumValue(candidate.correction_kind, ["meal_time"], `${field}.correction_kind`);
        text(candidate.target_event_id, `${field}.target_event_id`);
        const baseRevision = safeNonnegativeInteger(candidate.base_revision, `${field}.base_revision`);
        if (baseRevision < 1) return invalid(`${field}.base_revision`);
        timestamp(candidate.replacement_occurred_at, `${field}.replacement_occurred_at`);
        text(candidate.replacement_meal_slot, `${field}.replacement_meal_slot`);
        return Object.freeze({ ...candidate }) as unknown as CorrectMealTimeOperation;
      }
      const candidate = record(value, [
        "kind", "operation_id", "correction_kind", "batch_id", "base_revision",
        "previous_location", "previous_expiration", "next_location", "expected_expiration", "source_text",
        "matched_span", "rule_version",
      ], field);
      text(candidate.operation_id, `${field}.operation_id`);
      enumValue(candidate.correction_kind, ["inventory_location"], `${field}.correction_kind`);
      text(candidate.batch_id, `${field}.batch_id`);
      const baseRevision = safeNonnegativeInteger(candidate.base_revision, `${field}.base_revision`);
      if (baseRevision < 1) return invalid(`${field}.base_revision`);
      try {
        const previousLocation = validateAndFreezeStorageLocationEvidence(candidate.previous_location);
        const previousExpiration = validateAndFreezeExpirationEvidence(candidate.previous_expiration);
        const nextLocation = validateAndFreezeStorageLocationEvidence(candidate.next_location);
        const expectedExpiration = validateAndFreezeExpirationEvidence(candidate.expected_expiration);
        if (
          nextLocation.evidence_kind !== "corrected_explicit" ||
          previousLocation.value === nextLocation.value
        ) return invalid(`${field}.location_transition`);
        text(candidate.source_text, `${field}.source_text`);
        text(candidate.matched_span, `${field}.matched_span`);
        enumValue(candidate.rule_version, ["diet-manager/location-correction/v1"], `${field}.rule_version`);
        return Object.freeze({
          ...candidate,
          previous_location: previousLocation,
          previous_expiration: previousExpiration,
          next_location: nextLocation,
          expected_expiration: expectedExpiration,
        }) as unknown as CorrectInventoryLocationOperation;
      } catch (error) {
        if (error instanceof PantryEvidenceAuthorityError) return invalid(`${field}.${error.reason}`);
        throw error;
      }
    }
    const candidate = record(value, ["kind", "operation_id", "target_event_id", "base_revision", "item_order", "replacement_amount"], field);
    text(candidate.operation_id, `${field}.operation_id`);
    text(candidate.target_event_id, `${field}.target_event_id`);
    safeNonnegativeInteger(candidate.base_revision, `${field}.base_revision`);
    safeNonnegativeInteger(candidate.item_order, `${field}.item_order`);
    validateKnownStructuredAmount(candidate.replacement_amount, `${field}.replacement_amount`);
    return;
  }
  if (kind === "undo_record") {
    const candidate = record(value, ["kind", "operation_id", "target_event_id", "base_revision"], field);
    text(candidate.operation_id, `${field}.operation_id`);
    text(candidate.target_event_id, `${field}.target_event_id`);
    safeNonnegativeInteger(candidate.base_revision, `${field}.base_revision`);
    return;
  }
  if (kind === "query_inventory") {
    text(record(value, ["kind", "operation_id"], field).operation_id, `${field}.operation_id`);
    return;
  }
  if (kind === "query_meals" || kind === "query_daily_summary") {
    const candidate = record(value, ["kind", "operation_id", "date", "timezone"], field);
    text(candidate.operation_id, `${field}.operation_id`);
    text(candidate.date, `${field}.date`);
    enumValue(candidate.timezone, ["Asia/Shanghai"], `${field}.timezone`);
    return;
  }
  return invalid(`${field}.kind`);
}

function unsafeClone(path: string, reason: string): never {
  return invalid(`${path.replaceAll(".", "_")}_${reason}`);
}

function objectPrototype(value: object, path: string): object | null {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    return unsafeClone(path, "clone");
  }
}

function descriptors(value: object, path: string): PropertyDescriptorMap {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    return unsafeClone(path, "clone");
  }
}

function ownKeys(value: object, path: string): readonly PropertyKey[] {
  try {
    return Reflect.ownKeys(value);
  } catch {
    return unsafeClone(path, "clone");
  }
}

function dataDescriptor(
  value: PropertyDescriptor | undefined,
  path: string,
): unknown {
  if (!value || !("value" in value) || value.get !== undefined || value.set !== undefined) {
    return unsafeClone(path, "descriptor");
  }
  return value.value;
}

function cloneUntrustedJson(value: unknown, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return unsafeClone(path, "number");
    return value;
  }
  if (typeof value !== "object") return unsafeClone(path, "value");
  if (isProxy(value)) return unsafeClone(path, "proxy");
  if (Array.isArray(value)) {
    if (objectPrototype(value, path) !== Array.prototype) return unsafeClone(path, "prototype");
    const source = descriptors(value, path);
    const length = dataDescriptor(source.length, path);
    if (!Number.isSafeInteger(length) || (length as number) < 0) return unsafeClone(path, "length");
    const keys = ownKeys(value, path);
    if (keys.some((key) => typeof key === "symbol")) return unsafeClone(path, "symbols");
    const names = keys as readonly string[];
    const expected = ["length", ...Array.from({ length: length as number }, (_, index) => String(index))];
    if (names.length !== expected.length || expected.some((name) => !Object.hasOwn(source, name))) {
      return unsafeClone(path, "shape");
    }
    const lengthDescriptor = source.length;
    if (!lengthDescriptor || lengthDescriptor.enumerable !== false || lengthDescriptor.configurable !== false || typeof lengthDescriptor.writable !== "boolean") {
      return unsafeClone(path, "length_descriptor");
    }
    const clone: unknown[] = [];
    for (let index = 0; index < (length as number); index += 1) {
      const descriptor = source[String(index)];
      if (!descriptor || descriptor.enumerable !== true || typeof descriptor.configurable !== "boolean" || typeof descriptor.writable !== "boolean") {
        return unsafeClone(`${path}.${index}`, "descriptor");
      }
      clone.push(cloneUntrustedJson(dataDescriptor(descriptor, `${path}.${index}`), `${path}.${index}`));
    }
    return Object.freeze(clone);
  }
  if (objectPrototype(value, path) !== Object.prototype) return unsafeClone(path, "prototype");
  const source = descriptors(value, path);
  const clone: Record<string, unknown> = {};
  const keys = ownKeys(value, path);
  if (keys.some((key) => typeof key === "symbol")) return unsafeClone(path, "symbols");
  for (const name of keys as readonly string[]) {
    const descriptor = source[name];
    if (descriptor?.enumerable !== true) return unsafeClone(path, "descriptor");
    Object.defineProperty(clone, name, {
      value: cloneUntrustedJson(dataDescriptor(descriptor, path), `${path}.${name}`),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(clone);
}

function validateAndFreezeEnvelope(value: unknown): DomainEnvelopeInput {
  const cloned = cloneUntrustedJson(value, "envelope");
  const envelope = record(cloned, [
    "envelope_id", "idempotency_key", "command_type", "subject_scope", "source_message_id",
    "conversation_id", "received_at", "timezone", "operations",
  ], "envelope");
  text(envelope.envelope_id, "envelope.envelope_id");
  text(envelope.idempotency_key, "envelope.idempotency_key");
  enumValue(envelope.command_type, [
    "record_meal", "record_water", "add_inventory", "query_inventory", "query_meals",
    "query_daily_summary", "correct_record", "undo_record",
  ], "envelope.command_type");
  text(envelope.subject_scope, "envelope.subject_scope");
  text(envelope.source_message_id, "envelope.source_message_id");
  text(envelope.conversation_id, "envelope.conversation_id");
  receivedTimestamp(envelope.received_at, "envelope.received_at");
  enumValue(envelope.timezone, ["Asia/Shanghai"], "envelope.timezone");
  if (!Array.isArray(envelope.operations) || envelope.operations.length === 0) return invalid("envelope.operations");
  const operations = envelope.operations;
  const normalizedOperations = operations.map((operation, index) =>
    validateOperation(operation, `envelope.operations.${index}`) ?? operation);
  if (normalizedOperations.some((operation, index) => operation !== operations[index])) {
    return Object.freeze({ ...envelope, operations: Object.freeze(normalizedOperations) }) as unknown as DomainEnvelopeInput;
  }
  return envelope as unknown as DomainEnvelopeInput;
}

function preflightWriteOperations(
  database: DatabaseSync,
  authoritySecret: Uint8Array,
  operations: ValidatedWriteOperations,
): readonly ReturnType<typeof preflightMealOperation>[] {
  if (isMixedPurchaseMeal(operations)) {
    const [purchase, meal] = operations;
    const purchaseCandidates = purchase.amount.observed_microunits === null
      ? new Map<string, readonly []>()
      : new Map([[purchase.product.normalized_name, Object.freeze([{
          batch_id: purchase.batch_id,
          product_id: purchase.product.product_id,
          available_microunits: purchase.amount.observed_microunits,
          unit: purchase.amount.unit,
        }])]]);
    return Object.freeze([preflightMealOperation(database, authoritySecret, meal, purchaseCandidates)]);
  }
  const contributions = [];
  for (const operation of operations) {
    if (operation.kind === "record_meal") {
      contributions.push(preflightMealOperation(database, authoritySecret, operation));
    }
  }
  return Object.freeze(contributions);
}

function createMealProgressReservation(
  database: DatabaseSync,
  contributions: readonly ReturnType<typeof preflightMealOperation>[],
): ContributionProgressReservation | undefined {
  if (contributions.length === 0) return undefined;
  if (contributions.length !== 1) {
    throw new Error("DIET_DOMAIN_REQUEST_INVALID:progress_contribution_count");
  }
  try {
    return createContributionProgressReservation(database, contributions[0]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "PROGRESS_RESERVATION_AUTHORITY_INVALID:daily_progress_sum"
    ) {
      throw new Error("ENVELOPE_FINALIZE_AUTHORITY_INVALID:daily_progress_sum");
    }
    throw error;
  }
}

function quickPromptIssueCode(value: string): QuickPromptIssueCode {
  switch (value) {
    case "inventory_multiple_candidates":
    case "inventory_insufficient":
    case "inventory_unit_incompatible":
    case "inventory_unit_conversion_unproven":
    case "inventory_amount_unknown":
      return value;
    default:
      throw new Error("DIET_DOMAIN_RESULT_INVALID:issue_code");
  }
}

function buildMealQuickPrompts(
  database: DatabaseSync,
  result: MealOperationResult,
  idempotencyKey: string,
  generatedAt: string,
): readonly QuickPrompt[] {
  const expiresAt = new Date(Date.parse(generatedAt) + 60 * 60 * 1_000).toISOString();
  return Object.freeze(result.meal_items.flatMap((item) => item.issue_codes.map((code) => {
    const issueId = deriveDomainId("issue", idempotencyKey, item.item_order);
    const row = database.prepare(
      "SELECT issue_id, issue_code, revision, detected_at, status FROM issues WHERE issue_id = ?",
    ).get(issueId) as {
      issue_id: string;
      issue_code: string;
      revision: number;
      detected_at: string;
      status: string;
    } | undefined;
    if (
      !row || row.issue_id !== issueId || row.issue_code !== code || row.revision !== 1 ||
      row.detected_at !== generatedAt || row.status !== "open"
    ) throw new Error("DIET_DOMAIN_RESULT_INVALID:issue_authority");
    return buildQuickPrompt({
      issue_id: row.issue_id,
      issue_code: quickPromptIssueCode(row.issue_code),
      revision: row.revision,
      generated_at: row.detected_at,
      expires_at: expiresAt,
    });
  })));
}

function emitFailure(
  sink: CreateDietDomainServiceInput["failureSink"],
  entry: DietDomainFailureEntry,
): void {
  if (!sink) return;
  try {
    sink(Object.freeze(entry));
  } catch {
    // Diagnostics are outside the business transaction and cannot replace its error.
  }
}

function failureCode(error: unknown, fallback: string): string {
  const code = (error instanceof Error ? error.message : fallback).split(":", 1)[0];
  return /^[A-Z][A-Z0-9_]*$/.test(code) ? code : fallback;
}

function appendFactWithFailure(
  input: Parameters<typeof appendPreparedOperationFact>[0],
  sink: CreateDietDomainServiceInput["failureSink"],
  fault?: "after_event" | "after_effects",
  beforeCommit?: () => void,
): ReturnType<typeof appendPreparedOperationFact> {
  return appendPreparedOperationFact(input, {
    ...(fault === undefined ? {} : { fault }),
    ...(beforeCommit === undefined ? {} : { beforeCommit }),
    failureSink: (entry) => emitFailure(sink, {
      stage: "FactCommit",
      error_code: entry.error_code,
      trace_id: entry.trace_id,
      input_digest: entry.input_digest,
    }),
  });
}

function runEffectWithFailure<Result>(
  run: () => Result,
  sink: CreateDietDomainServiceInput["failureSink"],
  traceId: string,
  inputDigest: string,
  fallbackErrorCode: string,
): Result {
  try {
    return run();
  } catch (error) {
    emitFailure(sink, {
      stage: "EffectBundle",
      error_code: failureCode(error, fallbackErrorCode),
      trace_id: traceId,
      input_digest: inputDigest,
    });
    throw error;
  }
}

function envelopeFinalizeOptions(
  fault: DietDomainFault | undefined,
): EnvelopeFinalizeOptions | undefined {
  if (
    fault === "after_finalization_row" ||
    fault === "after_envelope" ||
    fault === "after_idempotency" ||
    fault === "before_commit"
  ) return Object.freeze({ fault });
  if (fault === "after_mixed_finalize_commit") {
    return Object.freeze({ fault: "after_commit_before_reply" });
  }
  return undefined;
}

function finalizeWithFailure(
  input: FinalizeEnvelopeInput,
  fault: DietDomainFault | undefined,
  sink: CreateDietDomainServiceInput["failureSink"],
): FinalizedEnvelopeResult {
  try {
    return finalizeEnvelope(input, envelopeFinalizeOptions(fault));
  } catch (error) {
    emitFailure(sink, {
      stage: "EnvelopeFinalize",
      error_code: failureCode(error, "ENVELOPE_FINALIZE_FAILED"),
      trace_id: input.traceId,
      input_digest: input.inputDigest,
    });
    throw error;
  }
}

type WriteOperation =
  | AddInventoryOperation
  | RecordMealOperation
  | RecordWaterOperation
  | CorrectRecordOperation
  | UndoRecordOperation;

type ValidatedWriteOperations = readonly WriteOperation[];

function isMixedPurchaseMeal(
  operations: readonly DomainOperation[],
): operations is readonly [AddInventoryOperation, RecordMealOperation] {
  return operations.length === 2 &&
    operations[0]?.kind === "add_inventory" &&
    operations[1]?.kind === "record_meal";
}

function writeOperations(
  envelope: DomainEnvelopeInput,
): ValidatedWriteOperations {
  if (
    envelope.command_type === "record_meal" &&
    isMixedPurchaseMeal(envelope.operations)
  ) {
    return Object.freeze([envelope.operations[0], envelope.operations[1]]);
  }
  if (
    envelope.command_type === "add_inventory" &&
    envelope.operations.length >= 1 &&
    envelope.operations.length <= 64 &&
    envelope.operations.every((operation) => operation.kind === "add_inventory") &&
    new Set(envelope.operations.map((operation) => operation.operation_id)).size ===
      envelope.operations.length
  ) return Object.freeze([...envelope.operations]);
  if (envelope.operations.length !== 1) return invalid("operation_count");
  const operation = envelope.operations[0]!;
  if (
    (envelope.command_type === "add_inventory" && operation.kind === "add_inventory") ||
    (envelope.command_type === "record_meal" && operation.kind === "record_meal") ||
    (envelope.command_type === "record_water" && operation.kind === "record_water") ||
    (envelope.command_type === "correct_record" && operation.kind === "correct_record") ||
    (envelope.command_type === "undo_record" && operation.kind === "undo_record")
  ) return Object.freeze([operation]);
  return invalid("command_operation");
}

function factPreviewMaterial(
  envelope: DomainEnvelopeInput,
  inputDigest: string,
  database: DatabaseSync,
  secret: Uint8Array,
  committedAtBase?: string,
): Readonly<{ authority_kind: "diet-manager/domain-preview/v1"; envelope: DomainEnvelopeInput }> |
  MealFactPreviewMaterial | WaterFactPreviewMaterial | PurchaseFactPreviewMaterial |
  InventoryAdjustmentFactPreviewMaterial {
  const locationCorrection = envelope.operations.find(
    (operation): operation is CorrectInventoryLocationOperation =>
      operation.kind === "correct_record" &&
      Object.hasOwn(operation, "correction_kind") &&
      (operation as CorrectInventoryLocationOperation).correction_kind === "inventory_location",
  );
  if (locationCorrection) {
    const existing = database.prepare(
      "SELECT COUNT(*) AS count FROM event_records WHERE envelope_id = ? AND operation_id = ?",
    ).get(envelope.envelope_id, locationCorrection.operation_id) as { count: number };
    const payload = existing.count === 0
      ? prepareInventoryLocationCorrectionOperation({
          database,
          secret,
          token: "preview-material",
          inputDigest,
          dataRevision: "repository-v1:preview-material",
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          idempotencyKey: envelope.idempotency_key,
          sourceMessageId: envelope.source_message_id,
          conversationId: envelope.conversation_id,
          receivedAt: envelope.received_at,
          committedAt: envelope.received_at,
          sequence: 0,
          operation: locationCorrection,
        }).payload
      : storedInventoryLocationCorrection(database, envelope, locationCorrection);
    return Object.freeze({
      authority_kind: "diet-manager/domain-preview/v5",
      input_digest: inputDigest,
      inventory_adjustment_fact_identities: Object.freeze([
        createInventoryAdjustmentFactIdentity({
          sequence: 0,
          event_id: deriveDomainId("event", envelope.idempotency_key, 0),
          operation_id: locationCorrection.operation_id,
          schema_version: "domain/v2",
          event_type: "inventory_adjusted",
          fact_kind: "inventory",
          source_message_id: envelope.source_message_id,
          conversation_id: envelope.conversation_id,
          received_at: envelope.received_at,
          occurred_at_text: envelope.received_at,
          meal_id: null,
          meal_slot: null,
          payload,
        }),
      ]),
    });
  }
  const water = envelope.operations.find((operation): operation is RecordWaterOperation => operation.kind === "record_water");
  if (water) {
    if (water.occurred_time.resolved_start === null) return invalid("envelope.operations.0.occurred_time.resolved_interval");
    const occurredAtText = new Date(water.occurred_time.resolved_start).toISOString();
    return Object.freeze({
      authority_kind: "diet-manager/domain-preview/v3",
      input_digest: inputDigest,
      meal_fact_identities: Object.freeze([]),
      water_fact_identities: Object.freeze([createWaterFactIdentity({
        sequence: 0, event_id: deriveDomainId("event", envelope.idempotency_key, 0), operation_id: water.operation_id,
        schema_version: "domain/v2", event_type: "diet_water", fact_kind: "water",
        source_message_id: envelope.source_message_id, conversation_id: envelope.conversation_id,
        received_at: envelope.received_at, occurred_at_text: occurredAtText, meal_id: null, meal_slot: null,
        payload: {
          amount_evidence: water.amount_evidence, authority_kind: "diet-manager/water-fact/v1", estimated: false,
          occurred_time: water.occurred_time, plain_water_ml_milli: water.plain_water_ml_milli,
          source_text: water.source_text, timezone: "Asia/Shanghai",
        },
      })]),
    });
  }
  const meals = envelope.operations.flatMap((operation, sequence) =>
    operation.kind === "record_meal" ? [{ operation, sequence }] : []);
  const mealPlans = new Map(meals.map(({ operation, sequence }) => [
    sequence,
    envelope.operations.length === 1
      ? prepareMealInventoryPlans(database, secret, operation, envelope.envelope_id)
      : Object.freeze(operation.items.map(() => null)),
  ]));
  const mealIdentities = () => meals.map(({ operation, sequence }) =>
    createMealFactIdentity({
      sequence,
      event_id: deriveDomainId("event", envelope.idempotency_key, sequence),
      operation_id: operation.operation_id,
      schema_version: "domain/v2",
      event_type: "diet_meal",
      fact_kind: "meal",
      source_message_id: envelope.source_message_id,
      conversation_id: envelope.conversation_id,
      received_at: envelope.received_at,
      occurred_at_text: operation.occurred_at,
      meal_id: deriveDomainId("meal", envelope.idempotency_key, sequence),
      meal_slot: operation.meal_slot,
      payload: {
        authority_kind: "diet-manager/meal-fact/v1",
        location: operation.location,
        ...(Object.hasOwn(operation, "source_text") ? { source_text: operation.source_text } : {}),
        ...(Object.hasOwn(operation, "occurred_time") ? { occurred_time: operation.occurred_time } : {}),
        ...(Object.hasOwn(operation, "subject") ? { subject: operation.subject } : {}),
        ...(Object.hasOwn(operation, "context") ? { context: operation.context } : {}),
        timezone: "Asia/Shanghai",
      },
      items: operation.items.map((item, itemOrder) => ({
        item_id: deriveDomainId("item", envelope.idempotency_key, itemOrder),
        item_order: itemOrder,
        item_type: item.item_type,
        normalized_name: item.normalized_name,
        payload: {
          amount: item.amount,
          authority_kind: "diet-manager/meal-item/v1",
          ...(item.inventory_directive === undefined ? {} : { inventory_directive: item.inventory_directive }),
          ...(mealPlans.get(sequence)?.[itemOrder] === null ||
              mealPlans.get(sequence)?.[itemOrder] === undefined
            ? {}
            : { inventory_plan: mealPlans.get(sequence)?.[itemOrder] }),
          ...(item.nutrition_evidence === undefined
            ? {}
            : { nutrition_evidence: item.nutrition_evidence }),
          nutrition_sources: item.nutrition_sources,
        },
      })),
    }));
  const purchaseEntries = envelope.operations
    .map((operation, sequence) => ({ operation, sequence }))
    .filter((entry): entry is { operation: AddInventoryOperation; sequence: number } =>
      entry.operation.kind === "add_inventory" && entry.operation.pantry_evidence !== undefined);
  if (purchaseEntries.length > 0) {
    if (committedAtBase === undefined) return invalid("purchase_committed_at_base");
    const identities = purchaseEntries.map((purchaseEntry) => {
      const purchaseIdentityKey = envelope.operations.length > 1
        ? deriveDomainId("idempotency", envelope.idempotency_key, purchaseEntry.sequence)
        : undefined;
      const prepared = preparePurchaseOperation({
        database,
        secret,
        token: "preview-material",
        inputDigest,
        dataRevision: "repository-v1:preview-material",
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        idempotencyKey: envelope.idempotency_key,
        ...(purchaseIdentityKey === undefined ? {} : { effectIdentityKey: purchaseIdentityKey }),
        sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id,
        receivedAt: envelope.received_at,
        committedAt: envelope.received_at,
        sequence: purchaseEntry.sequence,
        operation: purchaseEntry.operation,
      });
      const event = prepared.fact.event;
      return createPurchaseFactIdentity({
        sequence: purchaseEntry.sequence,
        event_id: event.eventId,
        operation_id: event.operationId,
        schema_version: "domain/v2",
        event_type: "inventory_stock",
        fact_kind: "inventory",
        source_message_id: event.sourceMessageId,
        conversation_id: event.conversationId,
        received_at: event.receivedAt,
        occurred_at_text: event.occurredAtText ?? envelope.received_at,
        meal_id: null,
        meal_slot: null,
        payload: event.payload,
      });
    });
    return Object.freeze({
      authority_kind: "diet-manager/domain-preview/v4",
      committed_at_base: committedAtBase,
      input_digest: inputDigest,
      meal_fact_identities: Object.freeze(mealIdentities()),
      purchase_fact_identities: Object.freeze(identities),
    });
  }
  const hasEvidence = meals.some(({ operation }) =>
    ["source_text", "occurred_time", "subject", "context"].some((field) =>
      Object.hasOwn(operation, field))) ||
    [...mealPlans.values()].some((plans) => plans.some((plan) => plan !== null));
  if (!hasEvidence) {
    return Object.freeze({
      authority_kind: "diet-manager/domain-preview/v1",
      envelope,
    });
  }
  return Object.freeze({
    authority_kind: "diet-manager/domain-preview/v2",
    input_digest: inputDigest,
    meal_fact_identities: Object.freeze(mealIdentities()),
  });
}

function assertMealFactPreviewAuthority(
  authority: AuthorizedRepositoryPreview,
  expected: ReturnType<typeof factPreviewMaterial>,
): void {
  if (expected.authority_kind === "diet-manager/domain-preview/v1") {
    if (authority.preview_authority_kind !== "diet-manager/server-preview/v1") {
      throw new Error("PREVIEW_AUTHORITY_INVALID:meal_fact_identity");
    }
    return;
  }
  if (expected.authority_kind === "diet-manager/domain-preview/v3") {
    if (authority.preview_authority_kind !== "diet-manager/server-preview/v3" ||
        authority.water_fact_preview_material === undefined ||
        canonicalJson(authority.water_fact_preview_material) !== canonicalJson(expected)) {
      throw new Error("PREVIEW_AUTHORITY_INVALID:water_fact_identity");
    }
    return;
  }
  if (expected.authority_kind === "diet-manager/domain-preview/v4") {
    if (
      authority.preview_authority_kind !== "diet-manager/server-preview/v4" ||
      authority.purchase_fact_preview_material === undefined ||
      canonicalJson(authority.purchase_fact_preview_material) !== canonicalJson(expected)
    ) throw new Error("PREVIEW_AUTHORITY_INVALID:purchase_fact_identity");
    return;
  }
  if (expected.authority_kind === "diet-manager/domain-preview/v5") {
    if (
      authority.preview_authority_kind !== "diet-manager/server-preview/v5" ||
      authority.inventory_adjustment_fact_preview_material === undefined ||
      canonicalJson(authority.inventory_adjustment_fact_preview_material) !== canonicalJson(expected)
    ) throw new Error("PREVIEW_AUTHORITY_INVALID:inventory_adjustment_fact_identity");
    return;
  }
  if (
    authority.preview_authority_kind !== "diet-manager/server-preview/v2" ||
    authority.meal_fact_preview_material === undefined ||
    canonicalJson(authority.meal_fact_preview_material) !== canonicalJson(expected)
  ) {
    throw new Error("PREVIEW_AUTHORITY_INVALID:meal_fact_identity");
  }
}

function timestampAfter(value: string, offsetMilliseconds: number): string {
  return new Date(Date.parse(value) + offsetMilliseconds).toISOString();
}

function storedFinalizedExecution(
  database: DatabaseSync,
  envelopeId: string,
): {
  payload: DomainExecutionResult;
  resultStatus: "committed" | "committed_with_issues";
  receiptId: string;
  finalizedAt: string;
  frozenAt: string;
} {
  const row = database.prepare(
    `SELECT result_status, receipt_id, finalized_at, frozen_at, payload_json
     FROM envelope_finalizations WHERE envelope_id = ?`,
  ).get(envelopeId) as {
    result_status: string;
    receipt_id: string | null;
    finalized_at: string | null;
    frozen_at: string | null;
    payload_json: string;
  } | undefined;
  if (
    !row ||
    (row.result_status !== "committed" && row.result_status !== "committed_with_issues") ||
    row.receipt_id === null || row.finalized_at === null || row.frozen_at === null
  ) throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_missing");
  const parsed = JSON.parse(row.payload_json) as DomainExecutionResult;
  if (canonicalJson(parsed) !== row.payload_json || parsed.status !== row.result_status) {
    throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_payload");
  }
  return {
    payload: parsed,
    resultStatus: row.result_status,
    receiptId: row.receipt_id,
    finalizedAt: row.finalized_at,
    frozenAt: row.frozen_at,
  };
}

function storedMixedItems(
  database: DatabaseSync,
  envelopeId: string,
): readonly PreparedMixedItemResult[] {
  const rows = database.prepare(
    `SELECT sequence, operation_id, idempotency_key, command_type, status, error_code, payload_json
     FROM mixed_item_results WHERE envelope_id = ? ORDER BY sequence`,
  ).all(envelopeId) as Array<{
    sequence: number;
    operation_id: string;
    idempotency_key: string;
    command_type: "add_inventory" | "record_meal";
    status: "committed" | "committed_with_issues" | "failed";
    error_code: string | null;
    payload_json: string;
  }>;
  return Object.freeze(rows.map((row, index) => {
    const payload = JSON.parse(row.payload_json) as unknown;
    if (
      row.sequence !== index || canonicalJson(payload) !== row.payload_json ||
      (row.command_type !== "add_inventory" && row.command_type !== "record_meal") ||
      (row.status !== "committed" && row.status !== "committed_with_issues" && row.status !== "failed")
    ) throw new Error("DIET_DOMAIN_RESULT_INVALID:mixed_items");
    return Object.freeze({
      sequence: row.sequence,
      operation_id: row.operation_id,
      idempotency_key: row.idempotency_key,
      command_type: row.command_type,
      status: row.status,
      error_code: row.error_code,
      payload,
    });
  }));
}

function storedEnvelopeTime(database: DatabaseSync, envelopeId: string): string {
  const row = database
    .prepare("SELECT received_at FROM command_envelopes WHERE envelope_id = ?")
    .get(envelopeId) as { received_at: string } | undefined;
  if (!row) return invalid("envelope_missing");
  return receivedTimestamp(row.received_at, "stored_received_at");
}

function frozenPurchaseExecutionResult(
  envelope: DomainEnvelopeInput,
  inputDigest: string,
  items: readonly ReturnType<typeof preparePurchaseOperation>["result"][],
): DomainExecutionResult {
  if (items.length === 0 || items.length > 64) return invalid("purchase_result_count");
  const inventory = items.length === 1
    ? Object.freeze({
        batch_id: items[0]!.batch_id,
        product_id: items[0]!.product_id,
        quantity_microunits: items[0]!.inventory_quantity_microunits,
        unit: items[0]!.unit,
      })
    : Object.freeze({
        items: Object.freeze(items.map((item) => Object.freeze({
          batch_id: item.batch_id,
          product_id: item.product_id,
          quantity_microunits: item.inventory_quantity_microunits,
          unit: item.unit,
        }))),
      });
  return Object.freeze({
    envelope_id: envelope.envelope_id,
    input_digest: inputDigest,
    status: "committed" as const,
    items: Object.freeze([...items]),
    payload: Object.freeze({
      authority_kind: "diet-manager/domain-execution/v1",
      inventory,
    }),
  });
}

function freezeCreator(input: CreateDietDomainServiceInput): {
  database: DatabaseSync;
  secret: Uint8Array;
  now: () => string;
  fault?: DietDomainFault;
  failureSink?: (entry: DietDomainFailureEntry) => void;
} {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid("service_options");
  }
  if (typeof input.database !== "object" || input.database === null) return invalid("database");
  if (!(input.secret instanceof Uint8Array) || input.secret.byteLength < 16) {
    return invalid("secret");
  }
  if (typeof input.now !== "function") return invalid("clock");
  if (
    input.fault !== undefined &&
    input.fault !== "before_fact_commit" &&
    input.fault !== "after_inventory_business_writes" &&
    input.fault !== "after_location_correction_fact_commit" &&
    input.fault !== "after_location_correction_effect_claim" &&
    input.fault !== "after_meal_nutrition" &&
    input.fault !== "after_meal_first_item" &&
    input.fault !== "after_meal_first_inventory_allocation" &&
    input.fault !== "after_meal_issue_write" &&
    input.fault !== "after_meal_progress_contribution_prepared" &&
    input.fault !== "after_water_event" &&
    input.fault !== "after_water_outbox" &&
    input.fault !== "after_water_progress_contribution_prepared" &&
    input.fault !== "after_correction_claim" &&
    input.fault !== "after_correction_compensation" &&
    input.fault !== "after_correction_nutrition_progress" &&
    input.fault !== "after_mixed_meal_effect_commit" &&
    input.fault !== "after_mixed_seal" &&
    input.fault !== "after_mixed_finalize_commit" &&
    input.fault !== "after_finalization_row" &&
    input.fault !== "after_envelope" &&
    input.fault !== "after_idempotency" &&
    input.fault !== "before_commit"
  ) {
    return invalid("fault");
  }
  if (input.failureSink !== undefined && typeof input.failureSink !== "function") {
    return invalid("failure_sink");
  }
  return {
    database: input.database,
    secret: Uint8Array.from(input.secret),
    now: input.now,
    ...(input.fault === undefined ? {} : { fault: input.fault }),
    ...(input.failureSink === undefined ? {} : { failureSink: input.failureSink }),
  };
}

export function createDietDomainService(
  input: CreateDietDomainServiceInput,
): DietDomainService {
  const options = freezeCreator(input);
  const finalize = (finalizerInput: FinalizeEnvelopeInput): FinalizedEnvelopeResult =>
    finalizeWithFailure(finalizerInput, options.fault, options.failureSink);
  return Object.freeze({
    preview(envelope: DomainEnvelopeInput): DomainPreviewResult {
      const validatedEnvelope = validateAndFreezeEnvelope(envelope);
      const operations = writeOperations(validatedEnvelope);
      const inputDigest = digestDomainEnvelope(validatedEnvelope);
      const needsPurchaseAuthority = operations.some(
        (operation) => operation.kind === "add_inventory" && operation.pantry_evidence !== undefined,
      );
      const existingEnvelope = needsPurchaseAuthority
        ? options.database.prepare(
            "SELECT received_at FROM command_envelopes WHERE envelope_id = ?",
          ).get(validatedEnvelope.envelope_id) as { received_at: string } | undefined
        : undefined;
      const previewNow = needsPurchaseAuthority
        ? existingEnvelope === undefined
          ? timestamp(options.now(), "clock")
          : receivedTimestamp(existingEnvelope.received_at, "stored_received_at")
        : undefined;
      const previewMaterial = factPreviewMaterial(
        validatedEnvelope,
        inputDigest,
        options.database,
        options.secret,
        previewNow,
      );
      const reused = reuseServerPreview({
        database: options.database,
        secret: options.secret,
        previewId: validatedEnvelope.envelope_id,
        idempotencyKey: validatedEnvelope.idempotency_key,
        inputDigest,
        subjectScope: validatedEnvelope.subject_scope,
        commandType: validatedEnvelope.command_type,
        sourceMessageId: validatedEnvelope.source_message_id,
        conversationId: validatedEnvelope.conversation_id,
        previewMaterial,
      });
      if (reused) {
        return Object.freeze({
          envelope_id: validatedEnvelope.envelope_id,
          token: reused.token,
          input_digest: inputDigest,
          data_revision: reused.binding.data_revision,
          reused: true,
        });
      }
      preflightWriteOperations(options.database, options.secret, operations);
      const dataRevision = computeRepositoryDataRevision(options.database);
      const preview = createServerPreview({
        database: options.database,
        secret: options.secret,
        previewId: validatedEnvelope.envelope_id,
        idempotencyKey: validatedEnvelope.idempotency_key,
        inputDigest,
        subjectScope: validatedEnvelope.subject_scope,
        commandType: validatedEnvelope.command_type,
        dataRevision,
        sourceMessageId: validatedEnvelope.source_message_id,
        conversationId: validatedEnvelope.conversation_id,
        previewMaterial,
        now: previewNow ?? timestamp(options.now(), "clock"),
      });
      return Object.freeze({
        envelope_id: validatedEnvelope.envelope_id,
        token: preview.token,
        input_digest: inputDigest,
        data_revision: dataRevision,
        reused: preview.reused,
      });
    },

    execute(execution: DomainExecuteInput): DomainExecutionResult {
      const envelope = validateAndFreezeEnvelope(execution.envelope);
      const operations = writeOperations(envelope);
      const inputDigest = digestDomainEnvelope(envelope);
      if (execution.input_digest !== inputDigest) return invalid("input_digest");
      const needsPurchaseAuthority = operations.some(
        (operation) => operation.kind === "add_inventory" && operation.pantry_evidence !== undefined,
      );
      const expectedPreviewMaterial = factPreviewMaterial(
        envelope,
        inputDigest,
        options.database,
        options.secret,
        needsPurchaseAuthority
          ? storedEnvelopeTime(options.database, envelope.envelope_id)
          : undefined,
      );
      const authority = authorizeRepositoryPreview({
        database: options.database,
        secret: options.secret,
        token: execution.token,
        inputDigest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision: execution.data_revision,
      });
      if (authority.binding.preview_id !== envelope.envelope_id) {
        return invalid("envelope_id");
      }
      assertMealFactPreviewAuthority(authority, expectedPreviewMaterial);
      const existingProgressReservation = readEnvelopeProgressReservation(
        options.database,
        envelope.envelope_id,
      );
      const firstOperation = operations[0];
      const progressReservation = existingProgressReservation ??
        (authority.envelope_state === "received"
          ? firstOperation.kind === "record_water"
            ? createContributionProgressReservation(
                options.database,
                preflightWaterOperation(firstOperation),
              )
            : createMealProgressReservation(
                options.database,
                preflightWriteOperations(options.database, options.secret, operations),
              )
          : undefined);
      const committedAt = storedEnvelopeTime(options.database, envelope.envelope_id);
      if (isMixedPurchaseMeal(operations)) {
        const [purchaseOperation, mealOperation] = operations;
        const traceId = deriveDomainId("trace", envelope.idempotency_key, 0);
        const purchaseIdentityKey = deriveDomainId(
          "idempotency",
          envelope.idempotency_key,
          0,
        );
        const mealIdentityKey = deriveDomainId(
          "idempotency",
          envelope.idempotency_key,
          1,
        );
        const purchaseAt = timestampAfter(committedAt, 0);
        const mealAt = timestampAfter(committedAt, 1);
        const finalizedAt = timestampAfter(committedAt, 2);
        const preparedMeal = prepareMealOperation({
          database: options.database,
          secret: options.secret,
          token: execution.token,
          inputDigest,
          dataRevision: execution.data_revision,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          idempotencyKey: envelope.idempotency_key,
          effectIdentityKey: mealIdentityKey,
          sourceMessageId: envelope.source_message_id,
          conversationId: envelope.conversation_id,
          receivedAt: envelope.received_at,
          committedAt: mealAt,
          sequence: 1,
          operation: mealOperation,
        });
        const preparedPurchase = preparePurchaseOperation({
          database: options.database,
          secret: options.secret,
          token: execution.token,
          inputDigest,
          dataRevision: execution.data_revision,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          idempotencyKey: envelope.idempotency_key,
          effectIdentityKey: purchaseIdentityKey,
          sourceMessageId: envelope.source_message_id,
          conversationId: envelope.conversation_id,
          receivedAt: envelope.received_at,
          committedAt: purchaseAt,
          sequence: 0,
          operation: purchaseOperation,
          ...(progressReservation === undefined ? {} : { progressReservation }),
        });
        if (authority.envelope_state !== "received") {
          assertStoredPurchaseFactMatchesExpected({
            database: options.database,
            envelopeId: envelope.envelope_id,
            operationId: purchaseOperation.operation_id,
            operationSequence: 0,
            expectedFact: preparedPurchase.fact,
            requireAppliedEffect: authority.envelope_state !== "effects_pending",
          });
          assertStoredMealFactMatchesExpected({
            database: options.database,
            envelopeId: envelope.envelope_id,
            operationId: mealOperation.operation_id,
            operationSequence: 1,
            idempotencyKey: mealIdentityKey,
            location: mealOperation.location,
            expectedFact: preparedMeal.fact,
          });
        }
        if (authority.envelope_state === "finalized") {
          const stored = storedFinalizedExecution(options.database, envelope.envelope_id);
          return finalize({
            database: options.database,
            secret: options.secret,
            token: execution.token,
            inputDigest,
            subjectScope: envelope.subject_scope,
            commandType: envelope.command_type,
            dataRevision: execution.data_revision,
            traceId,
            resultStatus: stored.resultStatus,
            receiptId: stored.receiptId,
            finalizedAt: stored.finalizedAt,
            frozenAt: stored.frozenAt,
            payload: stored.payload,
            mixedItems: storedMixedItems(options.database, envelope.envelope_id),
          }).payload as DomainExecutionResult;
        }
        if (
          authority.envelope_state !== "received" &&
          authority.envelope_state !== "effects_stable"
        ) {
          throw new Error(`DIET_DOMAIN_EXECUTION_PENDING:${authority.envelope_state}`);
        }
        if (options.fault === "before_fact_commit") {
          emitFailure(options.failureSink, {
            stage: "FactCommit",
            error_code: "DIET_DOMAIN_EXECUTION_FAILED",
            trace_id: traceId,
            input_digest: inputDigest,
          });
          throw new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
        }
        if (authority.envelope_state === "received") {
          appendFactWithFailure(preparedPurchase.fact, options.failureSink);
          runEffectWithFailure(
            () => applyPurchaseEffect(
              options.database,
              preparedPurchase.outbox_id,
              purchaseAt,
              options.fault === "after_inventory_business_writes"
                ? "after_business_writes"
                : undefined,
            ),
            options.failureSink,
            traceId,
            inputDigest,
            "INVENTORY_EFFECT_FAILED",
          );
        }
        if (authority.envelope_state === "received") {
          appendFactWithFailure(preparedMeal.fact, options.failureSink);
        }
        const mealResult = runEffectWithFailure(
          () => applyMealEffects({
            database: options.database,
            authoritySecret: options.secret,
            envelopeId: envelope.envelope_id,
            operationId: mealOperation.operation_id,
            operationSequence: 1,
            idempotencyKey: mealIdentityKey,
            now: mealAt,
            location: mealOperation.location,
            ...(options.fault === "after_meal_nutrition"
              ? { fault: "after_nutrition" as const }
              : options.fault === "after_meal_first_item"
                ? { fault: "after_first_item" as const }
                : options.fault === "after_meal_first_inventory_allocation"
                  ? { fault: "after_first_inventory_allocation" as const }
                : options.fault === "after_meal_issue_write"
                  ? { fault: "after_issue_write" as const }
                  : options.fault === "after_meal_progress_contribution_prepared"
                    ? { fault: "after_progress_contribution_prepared" as const }
                    : {}),
          }),
          options.failureSink,
          traceId,
          inputDigest,
          "MEAL_EFFECT_FAILED",
        );
        if (
          authority.envelope_state === "received" &&
          options.fault === "after_mixed_meal_effect_commit"
        ) {
          throw new Error("DIET_DOMAIN_EXECUTION_FAILED:after_mixed_meal_effect_commit");
        }
        if (authority.envelope_state === "received") {
          sealPreparedEnvelopeFacts({
            database: options.database,
            secret: options.secret,
            token: execution.token,
            inputDigest,
            subjectScope: envelope.subject_scope,
            commandType: envelope.command_type,
            dataRevision: execution.data_revision,
            traceId,
            expectedOperationIds: Object.freeze([
              purchaseOperation.operation_id,
              mealOperation.operation_id,
            ]),
            sealedAt: finalizedAt,
          });
          if (options.fault === "after_mixed_seal") {
            throw new Error("DIET_DOMAIN_EXECUTION_FAILED:after_mixed_seal");
          }
        }
        const quickPrompts = buildMealQuickPrompts(
          options.database,
          mealResult,
          mealIdentityKey,
          mealAt,
        );
        const receiptData = buildReceiptData({
          status: mealResult.status,
          date: mealResult.daily_progress.date,
          meal_slot: mealOperation.meal_slot,
          items: mealResult.meal_items,
          quick_prompts: quickPrompts,
          daily_progress: mealResult.daily_progress,
        });
        const status = mealResult.status;
        const result: DomainExecutionResult = Object.freeze({
          envelope_id: envelope.envelope_id,
          input_digest: inputDigest,
          status,
          items: Object.freeze([preparedPurchase.result, mealResult]),
          payload: Object.freeze({
            authority_kind: "diet-manager/domain-execution/v1",
            daily_progress: mealResult.daily_progress,
            daily_progress_by_date: mealResult.daily_progress_by_date,
            quick_prompts: quickPrompts,
            receipt_data: receiptData,
          }),
        });
        return finalize({
          database: options.database,
          secret: options.secret,
          token: execution.token,
          inputDigest,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          dataRevision: execution.data_revision,
          traceId,
          resultStatus: status,
          receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
          finalizedAt,
          frozenAt: finalizedAt,
          payload: result,
          mixedItems: Object.freeze([
            Object.freeze({
              sequence: 0,
              operation_id: purchaseOperation.operation_id,
              idempotency_key: purchaseIdentityKey,
              command_type: "add_inventory" as const,
              status: preparedPurchase.result.status,
              error_code: preparedPurchase.result.error_code,
              payload: preparedPurchase.result,
            }),
            Object.freeze({
              sequence: 1,
              operation_id: mealOperation.operation_id,
              idempotency_key: mealIdentityKey,
              command_type: "record_meal" as const,
              status: mealResult.status,
              error_code: mealResult.error_code,
              payload: mealResult,
            }),
          ]),
        }).payload as DomainExecutionResult;
      }
      if (operations.length > 1) {
        const purchaseOperations = operations as readonly AddInventoryOperation[];
        const traceId = deriveDomainId("trace", envelope.idempotency_key, 0);
        const finalizedAt = timestampAfter(committedAt, purchaseOperations.length);
        const preparedPurchases = Object.freeze(purchaseOperations.map((purchaseOperation, sequence) => {
          const effectIdentityKey = deriveDomainId("idempotency", envelope.idempotency_key, sequence);
          return preparePurchaseOperation({
            database: options.database,
            secret: options.secret,
            token: execution.token,
            inputDigest,
            dataRevision: execution.data_revision,
            subjectScope: envelope.subject_scope,
            commandType: envelope.command_type,
            idempotencyKey: envelope.idempotency_key,
            effectIdentityKey,
            sourceMessageId: envelope.source_message_id,
            conversationId: envelope.conversation_id,
            receivedAt: envelope.received_at,
            committedAt: timestampAfter(committedAt, sequence),
            sequence,
            operation: purchaseOperation,
          });
        }));

        if (authority.envelope_state !== "received") {
          preparedPurchases.forEach((preparedPurchase, sequence) => {
            assertStoredPurchaseFactMatchesExpected({
              database: options.database,
              envelopeId: envelope.envelope_id,
              operationId: purchaseOperations[sequence]!.operation_id,
              operationSequence: sequence,
              expectedFact: preparedPurchase.fact,
              requireAppliedEffect: authority.envelope_state !== "effects_pending",
            });
          });
        }
        if (authority.envelope_state === "finalized") {
          const stored = storedFinalizedExecution(options.database, envelope.envelope_id);
          return finalize({
            database: options.database,
            secret: options.secret,
            token: execution.token,
            inputDigest,
            subjectScope: envelope.subject_scope,
            commandType: envelope.command_type,
            dataRevision: execution.data_revision,
            traceId,
            resultStatus: stored.resultStatus,
            receiptId: stored.receiptId,
            finalizedAt: stored.finalizedAt,
            frozenAt: stored.frozenAt,
            payload: stored.payload,
            mixedItems: storedMixedItems(options.database, envelope.envelope_id),
          }).payload as DomainExecutionResult;
        }
        if (
          authority.envelope_state !== "received" &&
          authority.envelope_state !== "effects_stable"
        ) {
          throw new Error(`DIET_DOMAIN_EXECUTION_PENDING:${authority.envelope_state}`);
        }
        if (authority.envelope_state === "received") {
          if (options.fault === "before_fact_commit") {
            emitFailure(options.failureSink, {
              stage: "FactCommit",
              error_code: "DIET_DOMAIN_EXECUTION_FAILED",
              trace_id: traceId,
              input_digest: inputDigest,
            });
            throw new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
          }
          runEffectWithFailure(
            () => commitPreparedPurchaseEnvelope(
              {
                operations: Object.freeze(preparedPurchases.map((preparedPurchase) => preparedPurchase.fact)),
                seal: {
                  database: options.database,
                  secret: options.secret,
                  token: execution.token,
                  inputDigest,
                  subjectScope: envelope.subject_scope,
                  commandType: envelope.command_type,
                  dataRevision: execution.data_revision,
                  traceId,
                  expectedOperationIds: Object.freeze(purchaseOperations.map((operation) => operation.operation_id)),
                  sealedAt: finalizedAt,
                },
                effect_times: Object.freeze(preparedPurchases.map((_, sequence) => timestampAfter(committedAt, sequence))),
              },
              options.fault === "after_inventory_business_writes"
                ? { fault: "after_operation_effect", faultSequence: 0 }
                : undefined,
            ),
            options.failureSink,
            traceId,
            inputDigest,
            "INVENTORY_EFFECT_FAILED",
          );
        }
        const result = frozenPurchaseExecutionResult(
          envelope,
          inputDigest,
          Object.freeze(preparedPurchases.map((preparedPurchase) => preparedPurchase.result)),
        );
        return finalize({
          database: options.database,
          secret: options.secret,
          token: execution.token,
          inputDigest,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          dataRevision: execution.data_revision,
          traceId,
          resultStatus: "committed",
          receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
          finalizedAt,
          frozenAt: finalizedAt,
          payload: result,
          mixedItems: Object.freeze(preparedPurchases.map((preparedPurchase, sequence) => Object.freeze({
            sequence,
            operation_id: purchaseOperations[sequence]!.operation_id,
            idempotency_key: deriveDomainId("idempotency", envelope.idempotency_key, sequence),
            command_type: "add_inventory" as const,
            status: preparedPurchase.result.status,
            error_code: preparedPurchase.result.error_code,
            payload: preparedPurchase.result,
          }))),
        }).payload as DomainExecutionResult;
      }
      const operation = operations[0];
      if (operation.kind === "correct_record" && isInventoryLocationCorrection(operation)) {
        const traceId = deriveDomainId("trace", envelope.idempotency_key, 0);
        let correctionResult;
        let outboxId = deriveDomainId("outbox", envelope.idempotency_key, 0);
        const correctionFactCount = options.database.prepare(
          "SELECT COUNT(*) AS count FROM event_records WHERE envelope_id = ? AND operation_id = ?",
        ).get(envelope.envelope_id, operation.operation_id) as { count: number };
        if (authority.envelope_state === "received" && correctionFactCount.count === 0) {
          const prepared = prepareInventoryLocationCorrectionOperation({
            database: options.database,
            secret: options.secret,
            token: execution.token,
            inputDigest,
            dataRevision: execution.data_revision,
            subjectScope: envelope.subject_scope,
            commandType: envelope.command_type,
            idempotencyKey: envelope.idempotency_key,
            sourceMessageId: envelope.source_message_id,
            conversationId: envelope.conversation_id,
            receivedAt: envelope.received_at,
            committedAt,
            sequence: 0,
            operation,
          });
          correctionResult = prepared.result;
          outboxId = prepared.outbox_id;
          if (options.fault === "before_fact_commit") {
            throw new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
          }
          appendFactWithFailure(prepared.fact, options.failureSink);
          if (options.fault === "after_location_correction_fact_commit") {
            throw new Error("DIET_DOMAIN_EXECUTION_FAILED:after_location_correction_fact_commit");
          }
        } else {
          const stored = storedInventoryLocationCorrection(options.database, envelope, operation);
          correctionResult = stored.result;
        }
        if (authority.envelope_state === "finalized") {
          const stored = storedFinalizedExecution(options.database, envelope.envelope_id);
          return finalize({
            database: options.database,
            secret: options.secret,
            token: execution.token,
            inputDigest,
            subjectScope: envelope.subject_scope,
            commandType: envelope.command_type,
            dataRevision: execution.data_revision,
            traceId,
            resultStatus: stored.resultStatus,
            receiptId: stored.receiptId,
            finalizedAt: stored.finalizedAt,
            frozenAt: stored.frozenAt,
            payload: stored.payload,
            mixedItems: storedMixedItems(options.database, envelope.envelope_id),
          }).payload as DomainExecutionResult;
        }
        if (
          authority.envelope_state !== "received" &&
          authority.envelope_state !== "effects_pending" &&
          authority.envelope_state !== "effects_stable"
        ) throw new Error(`DIET_DOMAIN_EXECUTION_PENDING:${authority.envelope_state}`);
        if (authority.envelope_state !== "effects_stable") {
          runEffectWithFailure(
            () => applyPurchaseEffect(
              options.database,
              outboxId,
              committedAt,
              options.fault === "after_location_correction_effect_claim"
                ? "after_claim"
                : options.fault === "after_inventory_business_writes"
                  ? "after_business_writes"
                  : undefined,
            ),
            options.failureSink,
            traceId,
            inputDigest,
            "INVENTORY_EFFECT_FAILED",
          );
          sealPreparedEnvelopeFacts({
            database: options.database,
            secret: options.secret,
            token: execution.token,
            inputDigest,
            subjectScope: envelope.subject_scope,
            commandType: envelope.command_type,
            dataRevision: execution.data_revision,
            traceId,
            expectedOperationIds: Object.freeze([operation.operation_id]),
            sealedAt: committedAt,
          });
        }
        const correctionExecution: DomainExecutionResult = Object.freeze({
          envelope_id: envelope.envelope_id,
          input_digest: inputDigest,
          status: "committed",
          items: Object.freeze([correctionResult]),
          payload: Object.freeze({
            authority_kind: "diet-manager/domain-execution/v1",
            inventory_location_correction: Object.freeze({
              batch_id: correctionResult.batch_id,
              previous_location: correctionResult.previous_location,
              current_location: correctionResult.current_location,
              expiration: correctionResult.expiration,
            }),
          }),
        });
        return finalize({
          database: options.database,
          secret: options.secret,
          token: execution.token,
          inputDigest,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          dataRevision: execution.data_revision,
          traceId,
          resultStatus: "committed",
          receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
          finalizedAt: committedAt,
          frozenAt: committedAt,
          payload: correctionExecution,
          mixedItems: Object.freeze([]),
        }).payload as DomainExecutionResult;
      }
      if (operation.kind === "correct_record" || operation.kind === "undo_record") {
        const traceId = deriveDomainId("trace", envelope.idempotency_key, 0);
        if (authority.envelope_state === "finalized") {
          const row = options.database.prepare(
            "SELECT payload_json FROM envelope_finalizations WHERE envelope_id = ?",
          ).get(envelope.envelope_id) as { payload_json: string } | undefined;
          if (!row) throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_missing");
          const parsed = JSON.parse(row.payload_json) as DomainExecutionResult;
          if (
            canonicalJson(parsed) !== row.payload_json ||
            (parsed.status !== "committed" && parsed.status !== "committed_with_issues")
          ) {
            throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_payload");
          }
          return finalize({
            database: options.database,
            secret: options.secret,
            token: execution.token,
            inputDigest,
            subjectScope: envelope.subject_scope,
            commandType: envelope.command_type,
            dataRevision: execution.data_revision,
            traceId,
            resultStatus: parsed.status,
            receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
            finalizedAt: committedAt,
            frozenAt: committedAt,
            payload: parsed,
            mixedItems: Object.freeze([]),
          }).payload as DomainExecutionResult;
        }
        if (
          authority.envelope_state !== "received" &&
          authority.envelope_state !== "effects_stable"
        ) {
          throw new Error(`DIET_DOMAIN_EXECUTION_PENDING:${authority.envelope_state}`);
        }
        const existingFact = options.database.prepare(
          `SELECT event_id, event_type FROM event_records
           WHERE envelope_id = ? AND operation_id = ?`,
        ).get(envelope.envelope_id, operation.operation_id) as {
          event_id: string;
          event_type: string;
        } | undefined;
        if (existingFact) {
          const expectedEventType = operation.kind === "correct_record" &&
              "correction_kind" in operation && operation.correction_kind === "nutrition_supplement"
            ? "nutrition_supplemented"
            : "diet_correction";
          if (
            existingFact.event_id !== deriveDomainId("event", envelope.idempotency_key, 0) ||
            existingFact.event_type !== expectedEventType
          ) {
            throw new Error("DIET_DOMAIN_RESULT_INVALID:correction_fact_identity");
          }
        } else if (authority.envelope_state === "received") {
          const preparedCorrection = prepareCorrectionOperation({
            database: options.database,
            secret: options.secret,
            token: execution.token,
            inputDigest,
            dataRevision: execution.data_revision,
            subjectScope: envelope.subject_scope,
            commandType: envelope.command_type,
            idempotencyKey: envelope.idempotency_key,
            sourceMessageId: envelope.source_message_id,
            conversationId: envelope.conversation_id,
            receivedAt: envelope.received_at,
            committedAt,
            sequence: 0,
            operation,
          });
          if (options.fault === "before_fact_commit") {
            emitFailure(options.failureSink, {
              stage: "FactCommit",
              error_code: "DIET_DOMAIN_EXECUTION_FAILED",
              trace_id: traceId,
              input_digest: inputDigest,
            });
            throw new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
          }
          appendFactWithFailure(preparedCorrection.fact, options.failureSink);
        }
        let correctionResult;
        if (authority.envelope_state === "effects_stable") {
          correctionResult = readAppliedCorrectionResult({
            database: options.database,
            envelopeId: envelope.envelope_id,
            operationId: operation.operation_id,
            operationSequence: 0,
            idempotencyKey: envelope.idempotency_key,
          });
        } else {
          try {
            correctionResult = applyCorrectionEffects({
              database: options.database,
              envelopeId: envelope.envelope_id,
              operationId: operation.operation_id,
              operationSequence: 0,
              idempotencyKey: envelope.idempotency_key,
              now: committedAt,
              ...(options.fault === "after_correction_claim"
                ? { fault: "after_claim" as const }
                : options.fault === "after_correction_compensation"
                  ? { fault: "after_compensation" as const }
                  : options.fault === "after_correction_nutrition_progress"
                    ? { fault: "after_nutrition_progress" as const }
                    : {}),
            });
          } catch (error) {
            const code = (error instanceof Error ? error.message : "CORRECTION_EFFECT_FAILED")
              .split(":", 1)[0];
            emitFailure(options.failureSink, {
              stage: "EffectBundle",
              error_code: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "CORRECTION_EFFECT_FAILED",
              trace_id: traceId,
              input_digest: inputDigest,
            });
            throw error;
          }
          sealPreparedEnvelopeFacts({
            database: options.database,
            secret: options.secret,
            token: execution.token,
            inputDigest,
            subjectScope: envelope.subject_scope,
            commandType: envelope.command_type,
            dataRevision: execution.data_revision,
            traceId,
            expectedOperationIds: Object.freeze([operation.operation_id]),
            sealedAt: committedAt,
          });
        }
        const correctionExecution: DomainExecutionResult = Object.freeze({
          envelope_id: envelope.envelope_id,
          input_digest: inputDigest,
          status: correctionResult.status,
          items: Object.freeze([correctionResult]),
          payload: Object.freeze({
            authority_kind: "diet-manager/domain-execution/v1",
            daily_progress: correctionResult.daily_progress,
            daily_progress_by_date: correctionResult.daily_progress_by_date,
          }),
        });
        return finalize({
          database: options.database,
          secret: options.secret,
          token: execution.token,
          inputDigest,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          dataRevision: execution.data_revision,
          traceId,
          resultStatus: correctionResult.status,
          receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
          finalizedAt: committedAt,
          frozenAt: committedAt,
          payload: correctionExecution,
          mixedItems: Object.freeze([]),
        }).payload as DomainExecutionResult;
      }
      if (operation.kind === "record_water") {
        const preparedWater = prepareWaterOperation({
          database: options.database,
          secret: options.secret,
          token: execution.token,
          inputDigest,
          dataRevision: execution.data_revision,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          idempotencyKey: envelope.idempotency_key,
          sourceMessageId: envelope.source_message_id,
          conversationId: envelope.conversation_id,
          receivedAt: envelope.received_at,
          committedAt,
          sequence: 0,
          operation,
          ...(progressReservation === undefined ? {} : { progressReservation }),
        });
        const traceId = preparedWater.fact.traceId;
        if (authority.envelope_state !== "received") {
          assertStoredWaterFactMatchesExpected({
            database: options.database, envelopeId: envelope.envelope_id,
            operationId: operation.operation_id, expectedFact: preparedWater.fact,
          });
        }
        if (authority.envelope_state === "finalized") {
          const stored = storedFinalizedExecution(options.database, envelope.envelope_id);
          return finalize({
            database: options.database, secret: options.secret, token: execution.token,
            inputDigest, subjectScope: envelope.subject_scope, commandType: envelope.command_type,
            dataRevision: execution.data_revision, traceId, resultStatus: stored.resultStatus,
            receiptId: stored.receiptId, finalizedAt: stored.finalizedAt, frozenAt: stored.frozenAt,
            payload: stored.payload, mixedItems: Object.freeze([]),
          }).payload as DomainExecutionResult;
        }
        if (authority.envelope_state !== "received" && authority.envelope_state !== "effects_pending" && authority.envelope_state !== "effects_stable") {
          throw new Error(`DIET_DOMAIN_EXECUTION_PENDING:${authority.envelope_state}`);
        }
        if (authority.envelope_state === "received" && options.fault === "before_fact_commit") {
          emitFailure(options.failureSink, { stage: "FactCommit", error_code: "DIET_DOMAIN_EXECUTION_FAILED", trace_id: traceId, input_digest: inputDigest });
          throw new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
        }
        const storedWaterFact = options.database.prepare(
          "SELECT event_id FROM event_records WHERE envelope_id = ? AND operation_id = ?",
        ).get(envelope.envelope_id, operation.operation_id) as { event_id: string } | undefined;
        if (storedWaterFact) {
          assertStoredWaterFactMatchesExpected({
            database: options.database, envelopeId: envelope.envelope_id,
            operationId: operation.operation_id, expectedFact: preparedWater.fact,
          });
        }
        if (authority.envelope_state === "received" && !storedWaterFact) appendFactWithFailure(
          preparedWater.fact, options.failureSink,
          options.fault === "after_water_event" ? "after_event"
            : options.fault === "after_water_outbox" ? "after_effects" : undefined,
        );
        let waterResult;
        try {
          waterResult = applyWaterEffects({
            database: options.database, envelopeId: envelope.envelope_id, operationId: operation.operation_id,
            operationSequence: 0, idempotencyKey: envelope.idempotency_key, now: committedAt,
            ...(options.fault === "after_water_progress_contribution_prepared"
              ? { fault: "after_progress_contribution_prepared" as const } : {}),
          });
        } catch (error) {
          const code = (error instanceof Error ? error.message : "WATER_EFFECT_FAILED").split(":", 1)[0];
          if (authority.envelope_state === "received") {
            markWaterEffectsRetryable({
              database: options.database, envelopeId: envelope.envelope_id, operationId: operation.operation_id,
              operationSequence: 0, idempotencyKey: envelope.idempotency_key, now: committedAt,
              inputDigest, errorCode: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "WATER_EFFECT_FAILED",
            });
          }
          emitFailure(options.failureSink, { stage: "EffectBundle", error_code: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "WATER_EFFECT_FAILED", trace_id: traceId, input_digest: inputDigest });
          throw error;
        }
        if (authority.envelope_state !== "effects_stable") {
          sealPreparedEnvelopeFacts({
            database: options.database, secret: options.secret, token: execution.token, inputDigest,
            subjectScope: envelope.subject_scope, commandType: envelope.command_type,
            dataRevision: execution.data_revision, traceId,
            expectedOperationIds: Object.freeze([operation.operation_id]), sealedAt: committedAt,
          });
        }
        const virtualWaterItem = Object.freeze({
          item_order: 0, normalized_name: "plain water", unit: "ml", inventory_match: "skipped_outside" as const,
          inventory_transaction_id: null, issue_codes: Object.freeze([]), observed_microunits: operation.plain_water_ml_milli,
          nutrition_adoption_microunits: null, inventory_deduction_microunits: null,
          estimated_fields: Object.freeze([]), nutrition_source_type: "unknown" as const, nutrition_profile_version: 0,
          nutrients: waterResult.daily_progress.nutrients,
        });
        const receiptData = buildReceiptData({
          status: "committed", date: waterResult.daily_progress.date, meal_slot: "water",
          items: Object.freeze([virtualWaterItem]), quick_prompts: Object.freeze([]), daily_progress: waterResult.daily_progress,
        });
        const waterExecution: DomainExecutionResult = Object.freeze({
          envelope_id: envelope.envelope_id, input_digest: inputDigest, status: "committed",
          items: Object.freeze([waterResult]),
          payload: Object.freeze({ authority_kind: "diet-manager/domain-execution/v1", daily_progress: waterResult.daily_progress,
            daily_progress_by_date: waterResult.daily_progress_by_date, quick_prompts: Object.freeze([]), receipt_data: receiptData }),
        });
        return finalize({
          database: options.database, secret: options.secret, token: execution.token, inputDigest,
          subjectScope: envelope.subject_scope, commandType: envelope.command_type, dataRevision: execution.data_revision,
          traceId, resultStatus: "committed", receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
          finalizedAt: committedAt, frozenAt: committedAt, payload: waterExecution, mixedItems: Object.freeze([]),
        }).payload as DomainExecutionResult;
      }
      if (operation.kind === "record_meal") {
        const inventoryPlans = prepareMealInventoryPlans(
          options.database,
          options.secret,
          operation,
          envelope.envelope_id,
        );
        const preparedMeal = prepareMealOperation({
          database: options.database,
          secret: options.secret,
          token: execution.token,
          inputDigest,
          dataRevision: execution.data_revision,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          idempotencyKey: envelope.idempotency_key,
          sourceMessageId: envelope.source_message_id,
          conversationId: envelope.conversation_id,
          receivedAt: envelope.received_at,
          committedAt,
          sequence: 0,
          operation,
          inventoryPlans,
          ...(progressReservation === undefined ? {} : { progressReservation }),
        });
        const storedMealFactAuthority = Object.freeze({
          database: options.database,
          envelopeId: envelope.envelope_id,
          operationId: operation.operation_id,
          operationSequence: 0,
          idempotencyKey: envelope.idempotency_key,
          location: operation.location,
          expectedFact: preparedMeal.fact,
        });
        if (
          authority.envelope_state === "finalized" ||
          authority.envelope_state === "effects_pending"
        ) {
          assertStoredMealFactMatchesExpected(storedMealFactAuthority);
        }
        if (authority.envelope_state === "finalized") {
          const row = options.database
            .prepare("SELECT payload_json FROM envelope_finalizations WHERE envelope_id = ?")
            .get(envelope.envelope_id) as { payload_json: string } | undefined;
          if (!row) throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_missing");
          const parsed = JSON.parse(row.payload_json) as DomainExecutionResult;
          if (canonicalJson(parsed) !== row.payload_json) {
            throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_payload");
          }
          if (parsed.status !== "committed" && parsed.status !== "committed_with_issues") {
            throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_status");
          }
          const recoveredMeal = readAppliedMealResult(storedMealFactAuthority);
          if (
            parsed.items.length !== 1 ||
            canonicalJson(parsed.items[0]) !== canonicalJson(recoveredMeal)
          ) throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_meal");
          return finalize({
            database: options.database,
            secret: options.secret,
            token: execution.token,
            inputDigest,
            subjectScope: envelope.subject_scope,
            commandType: envelope.command_type,
            dataRevision: execution.data_revision,
            traceId: preparedMeal.fact.traceId,
            resultStatus: parsed.status,
            receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
            finalizedAt: committedAt,
            frozenAt: committedAt,
            payload: parsed,
            mixedItems: Object.freeze([]),
          }).payload as DomainExecutionResult;
        }
        if (
          authority.envelope_state !== "received" &&
          authority.envelope_state !== "effects_pending" &&
          authority.envelope_state !== "effects_stable"
        ) {
          throw new Error(`DIET_DOMAIN_EXECUTION_PENDING:${authority.envelope_state}`);
        }
        if (authority.envelope_state === "received" && options.fault === "before_fact_commit") {
          emitFailure(options.failureSink, {
            stage: "FactCommit",
            error_code: "DIET_DOMAIN_EXECUTION_FAILED",
            trace_id: preparedMeal.fact.traceId,
            input_digest: inputDigest,
          });
          throw new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
        }
        if (authority.envelope_state === "received") {
          appendFactWithFailure(
            preparedMeal.fact,
            options.failureSink,
            undefined,
            () => applyRequiredMealInventoryInTransaction({
              database: options.database,
              authoritySecret: options.secret,
              envelopeId: envelope.envelope_id,
              operationId: operation.operation_id,
              operationSequence: 0,
              idempotencyKey: envelope.idempotency_key,
              now: committedAt,
              location: operation.location,
              ...(options.fault === "after_meal_first_inventory_allocation"
                ? { fault: "after_first_inventory_allocation" as const }
                : {}),
            }),
          );
        }
        let mealResult: MealOperationResult;
        if (authority.envelope_state === "effects_stable") {
          mealResult = readAppliedMealResult(storedMealFactAuthority);
        } else {
          try {
            mealResult = applyMealEffects({
              database: options.database,
              authoritySecret: options.secret,
              envelopeId: envelope.envelope_id,
              operationId: operation.operation_id,
              operationSequence: 0,
              idempotencyKey: envelope.idempotency_key,
              now: committedAt,
              location: operation.location,
              ...(options.fault === "after_meal_nutrition"
                ? { fault: "after_nutrition" as const }
                : options.fault === "after_meal_first_item"
                  ? { fault: "after_first_item" as const }
                  : options.fault === "after_meal_first_inventory_allocation"
                    ? { fault: "after_first_inventory_allocation" as const }
                  : options.fault === "after_meal_issue_write"
                    ? { fault: "after_issue_write" as const }
                    : options.fault === "after_meal_progress_contribution_prepared"
                      ? { fault: "after_progress_contribution_prepared" as const }
                      : {}),
            });
          } catch (error) {
            const code = (error instanceof Error ? error.message : "MEAL_EFFECT_FAILED").split(
              ":",
              1,
            )[0];
            if (authority.envelope_state === "received") {
              markMealEffectsRetryable({
                database: options.database,
                envelopeId: envelope.envelope_id,
                operationId: operation.operation_id,
                operationSequence: 0,
                idempotencyKey: envelope.idempotency_key,
                inputDigest,
                now: committedAt,
                location: operation.location,
                errorCode: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "MEAL_EFFECT_FAILED",
              });
            }
            emitFailure(options.failureSink, {
              stage: "EffectBundle",
              error_code: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "MEAL_EFFECT_FAILED",
              trace_id: preparedMeal.fact.traceId,
              input_digest: inputDigest,
            });
            throw error;
          }
          sealPreparedEnvelopeFacts({
            database: options.database,
            secret: options.secret,
            token: execution.token,
            inputDigest,
            subjectScope: envelope.subject_scope,
            commandType: envelope.command_type,
            dataRevision: execution.data_revision,
            traceId: preparedMeal.fact.traceId,
            expectedOperationIds: Object.freeze([operation.operation_id]),
            sealedAt: committedAt,
          });
        }
        const quickPrompts = buildMealQuickPrompts(
          options.database,
          mealResult,
          envelope.idempotency_key,
          committedAt,
        );
        const receiptData = buildReceiptData({
          status: mealResult.status,
          date: mealResult.daily_progress.date,
          meal_slot: operation.meal_slot,
          items: mealResult.meal_items,
          quick_prompts: quickPrompts,
          daily_progress: mealResult.daily_progress,
        });
        const mealExecution: DomainExecutionResult = Object.freeze({
          envelope_id: envelope.envelope_id,
          input_digest: inputDigest,
          status: mealResult.status,
          items: Object.freeze([mealResult]),
          payload: Object.freeze({
            authority_kind: "diet-manager/domain-execution/v1",
            daily_progress: mealResult.daily_progress,
            daily_progress_by_date: mealResult.daily_progress_by_date,
            quick_prompts: quickPrompts,
            receipt_data: receiptData,
          }),
        });
        const finalizedMeal = finalize({
          database: options.database,
          secret: options.secret,
          token: execution.token,
          inputDigest,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          dataRevision: execution.data_revision,
          traceId: preparedMeal.fact.traceId,
          resultStatus: mealResult.status,
          receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
          finalizedAt: committedAt,
          frozenAt: committedAt,
          payload: mealExecution,
          mixedItems: Object.freeze([]),
        });
        return finalizedMeal.payload as DomainExecutionResult;
      }
      const prepared = preparePurchaseOperation({
        database: options.database,
        secret: options.secret,
        token: execution.token,
        inputDigest,
        dataRevision: execution.data_revision,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        idempotencyKey: envelope.idempotency_key,
        sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id,
        receivedAt: envelope.received_at,
        committedAt,
        sequence: 0,
        operation,
      });
      const traceId = prepared.fact.traceId;
      const result = frozenPurchaseExecutionResult(envelope, inputDigest, Object.freeze([prepared.result]));
      const finalizerInput = {
        database: options.database,
        secret: options.secret,
        token: execution.token,
        inputDigest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision: execution.data_revision,
        traceId,
        resultStatus: "committed" as const,
        receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
        finalizedAt: committedAt,
        frozenAt: committedAt,
        payload: result,
        mixedItems: Object.freeze([]),
      };

      if (authority.envelope_state !== "received") {
        assertStoredPurchaseFactMatchesExpected({
          database: options.database,
          envelopeId: envelope.envelope_id,
          operationId: operation.operation_id,
          operationSequence: 0,
          expectedFact: prepared.fact,
          requireAppliedEffect: authority.envelope_state !== "effects_pending",
        });
      }

      if (authority.envelope_state === "finalized") {
        return finalize(finalizerInput).payload as DomainExecutionResult;
      }
      const shouldApplyPurchase =
        authority.envelope_state === "received" || authority.envelope_state === "effects_pending";
      if (authority.envelope_state === "received") {
        if (options.fault === "before_fact_commit") {
          emitFailure(options.failureSink, {
            stage: "FactCommit",
            error_code: "DIET_DOMAIN_EXECUTION_FAILED",
            trace_id: traceId,
            input_digest: inputDigest,
          });
          throw new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
        }
        appendFactWithFailure(prepared.fact, options.failureSink);
      }
      if (shouldApplyPurchase) {
        try {
          applyPurchaseEffect(
            options.database,
            prepared.outbox_id,
            committedAt,
            options.fault === "after_inventory_business_writes"
              ? "after_business_writes"
              : undefined,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "INVENTORY_EFFECT_FAILED";
          const code = message.split(":", 1)[0];
          emitFailure(options.failureSink, {
            stage: "EffectBundle",
            error_code: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "INVENTORY_EFFECT_FAILED",
            trace_id: traceId,
            input_digest: inputDigest,
          });
          throw error;
        }
        sealPreparedEnvelopeFacts({
          database: options.database,
          secret: options.secret,
          token: execution.token,
          inputDigest,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          dataRevision: execution.data_revision,
          traceId,
          expectedOperationIds: Object.freeze([operation.operation_id]),
          sealedAt: committedAt,
        });
      }
      const state = authorizeRepositoryPreview({
        database: options.database,
        secret: options.secret,
        token: execution.token,
        inputDigest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision: execution.data_revision,
      });
      if (state.envelope_state !== "effects_stable") {
        throw new Error(`DIET_DOMAIN_EXECUTION_PENDING:${state.envelope_state}`);
      }
      const finalized = finalize(finalizerInput);
      if (canonicalJson(finalized.payload) !== canonicalJson(result)) {
        throw new Error("DIET_DOMAIN_RESULT_INVALID:finalized_payload");
      }
      return finalized.payload as DomainExecutionResult;
    },

    query(operation: DomainQueryOperation): DomainQueryResult {
      return queryDomainReadModel(options.database, options.secret, operation);
    },
  });
}
