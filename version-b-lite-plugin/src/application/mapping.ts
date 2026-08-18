import { createHash } from "node:crypto";

import { canonicalJson } from "../authority/canonical-json.js";
import type { CoreApplicationRequest } from "../contracts.js";
import { resolveExpiration } from "../domain/inventory-service.js";
import type {
  CorrectNutritionSupplementOperation,
  DomainEnvelopeInput,
  DomainOperation,
  KnownStructuredAmount,
  NutritionSourceCandidate,
  PantryPurchaseEvidence,
  ProductIdentityEvidence,
} from "../domain/types.js";
import type { ResolvedNutritionEvidence } from "../nutrition/types.js";
import type {
  CoreCommandCandidate,
  CoreInventoryCommandCandidate,
  CoreInventoryLocationCorrectionCandidate,
  CoreMealAmountCorrectionCandidate,
  CoreMealCommandCandidate,
  CoreMealTimeCorrectionCandidate,
  CoreProfileCommandCandidate,
  CorePurchaseCommandCandidate,
  CorePurchaseItemCandidate,
  CoreWaterClassificationCorrectionCandidate,
} from "../parser/types.js";

export interface ResolvedCorePurchaseItem {
  readonly product_id: string;
  readonly batch_id: string;
  readonly identity: Readonly<ProductIdentityEvidence>;
}

export interface ResolvedCoreInventoryLocationCorrection {
  readonly batch_id: string;
  readonly base_revision: number;
  readonly previous_location: Readonly<PantryPurchaseEvidence["location"]>;
  readonly previous_expiration: Readonly<PantryPurchaseEvidence["expiration"]>;
  readonly expected_expiration: Readonly<PantryPurchaseEvidence["expiration"]>;
}

export interface ResolvedCoreNutritionSupplement {
  readonly target_event_id: string;
  readonly base_revision: number;
  readonly item_order: number;
  readonly previous_snapshot_id: string;
  readonly replacement_amount: Readonly<CorrectNutritionSupplementOperation["replacement_amount"]>;
  readonly replacement_nutrition_source: Readonly<NutritionSourceCandidate>;
  readonly replacement_nutrition_evidence: Readonly<ResolvedNutritionEvidence>;
}

export interface ResolvedCoreMealAmountCorrection {
  readonly target_event_id: string;
  readonly base_revision: number;
  readonly item_order: number;
  readonly replacement_amount: Readonly<KnownStructuredAmount>;
}

export interface ResolvedCoreMealTimeCorrection {
  readonly target_event_id: string;
  readonly base_revision: number;
}

export interface ResolvedCoreWaterClassification {
  readonly target_event_id: string;
  readonly base_revision: number;
}

function identity(request: Readonly<CoreApplicationRequest>): string {
  return createHash("sha256")
    .update("diet-manager/application-envelope/v1\n", "ascii")
    .update(request.operation_id, "utf8").update("\0", "ascii")
    .update(request.source_message_id, "utf8").update("\0", "ascii")
    .update(request.conversation_id, "utf8").digest("hex").toUpperCase();
}

function mealSlot(sourceText: string): string {
  for (const token of ["早餐", "午餐", "晚餐", "加餐", "夜宵"] as const) {
    if (sourceText.includes(token)) return token;
  }
  return "unknown";
}

function location(command: CoreMealCommandCandidate): "home" | "outside" {
  return command.context?.scene === "outside" || command.context?.scene === "company"
    ? "outside" : "home";
}

function decimalMicrounits(value: string, scale: bigint, field: string): number {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/u.exec(value);
  if (match === null) throw new TypeError(`CORE_APPLICATION_MAPPING_INVALID:${field}`);
  const fraction = match[2] ?? "";
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${match[1]}${fraction}`) * scale;
  let rounded = numerator / denominator;
  if ((numerator % denominator) * 2n >= denominator) rounded += 1n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(`CORE_APPLICATION_MAPPING_INVALID:${field}`);
  }
  return Number(rounded);
}

export function mapResolvedNutritionAmountMicrounits(
  evidence: Readonly<ResolvedNutritionEvidence>,
): number | null {
  return evidence.adopted_amount === null
    ? null
    : decimalMicrounits(evidence.adopted_amount, 1_000_000n, "adopted_amount");
}

export function mapResolvedNutritionEvidenceToDomainSource(
  evidence: Readonly<ResolvedNutritionEvidence>,
): Readonly<NutritionSourceCandidate> | null {
  if (evidence.source_type === "unknown") return null;
  const nutrient = (field: keyof ResolvedNutritionEvidence["nutrient_values"], scale: bigint) => {
    const value = evidence.nutrient_values[field];
    return value === null ? null : decimalMicrounits(value, scale, `nutrient.${field}`);
  };
  const versionHex = createHash("sha256")
    .update(`${evidence.source_id}\0${evidence.source_ref}\0${evidence.source_version}`, "utf8")
    .digest("hex").slice(0, 12);
  return Object.freeze({
    source_type: "public_fixture" as const,
    source_ref: evidence.source_ref,
    profile_version: Number.parseInt(versionHex, 16) + 1,
    applicable_product_id: null,
    basis_kind: evidence.basis_kind,
    basis_microunits: decimalMicrounits(evidence.basis_amount, 1_000_000n, "basis_amount"),
    basis_unit: evidence.basis_unit,
    nutrients: Object.freeze({
      energy_kcal_milli: nutrient("energy_kcal", 1_000n),
      protein_mg: nutrient("protein_g", 1_000n),
      fat_mg: nutrient("fat_g", 1_000n),
      carbohydrate_mg: nutrient("carbohydrate_g", 1_000n),
      fiber_mg: nutrient("fiber_g", 1_000n),
      water_ml_milli: nutrient("water_ml", 1_000n),
    }),
  });
}

function mealOrWaterOperation(
  command: CoreCommandCandidate,
  nutritionEvidence: readonly Readonly<ResolvedNutritionEvidence>[] = Object.freeze([]),
): DomainOperation {
  if (command.action === "record_water") return {
    kind: "record_water", operation_id: command.operation_id,
    occurred_time: command.occurred_time, source_text: command.source_text,
    plain_water_ml_milli: command.plain_water_ml_milli,
    amount_evidence: command.amount_evidence,
  };
  if (command.action !== "record_meal" || command.occurred_time.resolved_start === null) {
    throw new Error("CORE_APPLICATION_MAPPING_INVALID:command");
  }
  if (nutritionEvidence.length !== 0 && nutritionEvidence.length !== command.items.length) {
    throw new Error("CORE_APPLICATION_MAPPING_INVALID:nutrition_evidence_count");
  }
  return {
    kind: "record_meal", operation_id: command.operation_id,
    occurred_at: new Date(command.occurred_time.resolved_start).toISOString(),
    meal_slot: mealSlot(command.source_text), location: location(command),
    inventory_policy: {
      mode: "pantry_v2",
      missing_candidate_behavior: "skip_insufficient",
      rule_version: "diet-manager/pantry-allocation-v1",
    },
    items: command.items.map((item, index) => {
      const evidence = nutritionEvidence[index];
      const source = evidence === undefined ? null : mapResolvedNutritionEvidenceToDomainSource(evidence);
      const adoptedMicrounits = evidence === undefined
        ? null
        : mapResolvedNutritionAmountMicrounits(evidence);
      return ({
      normalized_name: item.normalized_name,
      item_type: item.kind === "food" ? "food" : "nutrition_drink",
      ...(command.inventory_directive === undefined
        ? {}
        : { inventory_directive: command.inventory_directive }),
      amount: {
        unit: item.unit ?? "unknown",
        observed_microunits: item.quantity === null ? null : item.quantity * 1_000_000,
        nutrition_adoption_microunits: adoptedMicrounits,
        inventory_deduction_microunits: item.quantity === null ? null : item.quantity * 1_000_000,
        template_reference_microunits: null,
        evidence: item.quantity === null ? "unknown"
          : item.estimated === false ? "explicit" : "estimated_upper_bound",
      },
      nutrition_sources: source === null ? [] : [source],
      ...(evidence === undefined ? {} : { nutrition_evidence: evidence }),
    }); }),
    source_text: command.source_text, occurred_time: command.occurred_time,
    subject: command.subject,
    ...(command.context === undefined ? {} : { context: command.context }),
  };
}

function profileOperation(
  command: Extract<CoreCommandCandidate, { action: "set_profile" }>,
): DomainOperation {
  return Object.freeze({
    kind: "set_profile" as const,
    operation_id: command.operation_id,
    height_cm: command.height_cm,
    weight_kg: command.weight_kg,
    sex: command.sex,
    age: command.age,
    goal_state: command.goal_state,
  });
}

function normalizedPackageUnit(value: string | null): string | null {
  if (value === null) return null;
  const units: Readonly<Record<string, string>> = Object.freeze({
    箱: "box",
    袋: "bag",
    瓶: "bottle",
    盒: "carton",
  });
  return units[value] ?? value;
}

function pantryEvidence(
  item: Readonly<CorePurchaseItemCandidate>,
  resolution: Readonly<ResolvedCorePurchaseItem>,
  receivedAt: string,
  legacy?: Readonly<CoreInventoryCommandCandidate>,
): Readonly<PantryPurchaseEvidence> {
  const quantity = item.package_quantity;
  return {
    schema_version: "diet-manager/pantry-evidence/v1",
    product_identity: resolution.identity,
    package_quantity: {
      outer_count: quantity.outer_count,
      outer_unit: normalizedPackageUnit(quantity.outer_unit),
      inner_per_outer: quantity.inner_per_outer,
      inner_unit: normalizedPackageUnit(quantity.inner_unit),
      capacity_per_inner: quantity.capacity_per_inner,
      capacity_unit: quantity.capacity_unit,
      total_inner: quantity.total_inner,
      total_capacity: quantity.total_capacity,
      formula: quantity.formula,
    },
    location: {
      value: item.location.value,
      evidence_kind: item.location.evidence_kind,
      rule_version: item.location.rule_version,
    },
    opening: item.opening === null
      ? null
      : {
          status: "opened",
          opened_at: receivedAt,
          evidence_kind: "rule",
          rule_version: item.opening.rule_version,
        },
    expiration: legacy !== undefined
      ? {
          explicit_at: null,
          effective_at: legacy.estimated_expires_at,
          basis: "rule",
          rule_version: legacy.shelf_life_rule_version,
        }
      : item.opening !== null
        ? resolveExpiration({
            reliability: "reliable_rule",
            explicit_at: null,
            duration_days: 1,
            anchor_at: receivedAt,
            rule_version: "diet-manager/shelf-life-v1",
          })
        : {
          explicit_at: null,
          effective_at: null,
          basis: "unknown",
          rule_version: null,
        },
  };
}

function purchaseAmount(item: Readonly<CorePurchaseItemCandidate>): Readonly<{
  readonly unit: string;
  readonly observed_microunits: number | null;
  readonly evidence: "explicit" | "unknown";
}> {
  const quantity = item.package_quantity;
  if (quantity.total_inner !== null && quantity.inner_unit !== null) {
    return Object.freeze({
      unit: normalizedPackageUnit(quantity.inner_unit)!,
      observed_microunits: quantity.total_inner * 1_000_000,
      evidence: "explicit" as const,
    });
  }
  if (quantity.total_capacity !== null && quantity.capacity_unit !== null) {
    return Object.freeze({
      unit: quantity.capacity_unit,
      observed_microunits: quantity.total_capacity * 1_000_000,
      evidence: "explicit" as const,
    });
  }
  if (
    item.opening !== null && quantity.outer_count !== null &&
    quantity.outer_unit === "瓶"
  ) {
    return Object.freeze({
      unit: "bottle",
      observed_microunits: quantity.outer_count * 1_000_000,
      evidence: "explicit" as const,
    });
  }
  return Object.freeze({ unit: "unknown", observed_microunits: null, evidence: "unknown" as const });
}

function newPurchaseItem(command: CoreInventoryCommandCandidate): Readonly<CorePurchaseItemCandidate> {
  return Object.freeze({
    order: 0,
    raw_name: command.product.raw_text,
    normalized_name: "milk",
    product_type: "nutrition_drink",
    identity_reference: "explicit",
    specification: null,
    package_quantity: Object.freeze({
      outer_count: null, outer_unit: null, inner_per_outer: null, inner_unit: null,
      capacity_per_inner: null, capacity_unit: null, total_inner: null,
      total_capacity: null, formula: null,
    }),
    location: Object.freeze({
      value: "refrigerator",
      evidence_kind: "configured_home_default",
      rule_version: "diet-manager/default-location-v1",
    }),
    opening: null,
    expiration: Object.freeze({ reliability: "unknown", explicit_at: null, matched_span: null }),
  });
}

function purchaseOperations(
  request: Readonly<CoreApplicationRequest>,
  command: Readonly<CorePurchaseCommandCandidate | CoreInventoryCommandCandidate>,
  resolutions: readonly Readonly<ResolvedCorePurchaseItem>[],
): readonly DomainOperation[] {
  const items = "items" in command ? command.items : Object.freeze([newPurchaseItem(command)]);
  if (resolutions.length !== items.length || items.length === 0 || items.length > 64) {
    throw new Error("CORE_APPLICATION_MAPPING_INVALID:purchase_resolution");
  }
  return Object.freeze(items.map((item, index) => {
    const resolution = resolutions[index]!;
    const amount = purchaseAmount(item);
    const operationId = items.length === 1
      ? command.operation_id
      : `${command.operation_id}:item:${index}`;
    return {
      kind: "add_inventory" as const,
      operation_id: operationId,
      product: {
        product_id: resolution.product_id,
        normalized_name: item.normalized_name,
        product_type: item.product_type,
      },
      batch_id: resolution.batch_id,
      amount: {
        unit: amount.unit,
        observed_microunits: amount.observed_microunits,
        nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null,
        template_reference_microunits: null,
        evidence: amount.evidence,
      },
      nutrition_sources: [],
      pantry_evidence: pantryEvidence(
        item,
        resolution,
        request.received_at,
        "items" in command ? undefined : command,
      ),
    };
  }));
}

function locationCorrectionOperation(
  command: Readonly<CoreInventoryLocationCorrectionCandidate>,
  resolution: Readonly<ResolvedCoreInventoryLocationCorrection> | undefined,
): DomainOperation {
  if (
    resolution === undefined ||
    resolution.previous_location.value !== command.previous_location
  ) throw new Error("CORE_APPLICATION_MAPPING_INVALID:location_correction_resolution");
  return Object.freeze({
    kind: "correct_record" as const,
    operation_id: command.operation_id,
    correction_kind: "inventory_location" as const,
    batch_id: resolution.batch_id,
    base_revision: resolution.base_revision,
    previous_location: resolution.previous_location,
    previous_expiration: resolution.previous_expiration,
    next_location: Object.freeze({
      value: command.next_location,
      evidence_kind: "corrected_explicit" as const,
      rule_version: null,
    }),
    expected_expiration: resolution.expected_expiration,
    source_text: command.source_text,
    matched_span: command.matched_span,
    rule_version: command.rule_version,
  });
}

function nutritionSupplementOperation(
  command: Extract<CoreCommandCandidate, { action: "correct_record"; kind: "nutrition_supplement" }>,
  resolution: Readonly<ResolvedCoreNutritionSupplement> | undefined,
): Readonly<CorrectNutritionSupplementOperation> {
  if (resolution === undefined || resolution.target_event_id !== command.target_record_id) {
    throw new Error("CORE_APPLICATION_MAPPING_INVALID:nutrition_supplement_resolution");
  }
  return Object.freeze({
    kind: "correct_record" as const,
    operation_id: command.operation_id,
    correction_kind: "nutrition_supplement" as const,
    target_event_id: resolution.target_event_id,
    base_revision: resolution.base_revision,
    item_order: resolution.item_order,
    previous_snapshot_id: resolution.previous_snapshot_id,
    replacement_amount: resolution.replacement_amount,
    replacement_nutrition_source: resolution.replacement_nutrition_source,
    replacement_nutrition_evidence: resolution.replacement_nutrition_evidence,
  });
}

function mealAmountCorrectionOperation(
  command: Readonly<CoreMealAmountCorrectionCandidate>,
  resolution: Readonly<ResolvedCoreMealAmountCorrection> | undefined,
): DomainOperation {
  if (resolution === undefined) {
    throw new Error("CORE_APPLICATION_MAPPING_INVALID:meal_amount_resolution");
  }
  return Object.freeze({
    kind: "correct_record" as const,
    operation_id: command.operation_id,
    target_event_id: resolution.target_event_id,
    base_revision: resolution.base_revision,
    item_order: resolution.item_order,
    replacement_amount: resolution.replacement_amount,
  });
}

function mealTimeCorrectionOperation(
  command: Readonly<CoreMealTimeCorrectionCandidate>,
  resolution: Readonly<ResolvedCoreMealTimeCorrection> | undefined,
): DomainOperation {
  if (resolution === undefined) {
    throw new Error("CORE_APPLICATION_MAPPING_INVALID:meal_time_resolution");
  }
  return Object.freeze({
    kind: "correct_record" as const,
    operation_id: command.operation_id,
    correction_kind: "meal_time" as const,
    target_event_id: resolution.target_event_id,
    base_revision: resolution.base_revision,
    replacement_occurred_at: command.replacement_occurred_at,
    replacement_meal_slot: command.replacement_meal_slot,
  });
}

function waterClassificationOperation(
  command: Readonly<CoreWaterClassificationCorrectionCandidate>,
  resolution: Readonly<ResolvedCoreWaterClassification> | undefined,
): DomainOperation {
  if (resolution === undefined) {
    throw new Error("CORE_APPLICATION_MAPPING_INVALID:water_classification_resolution");
  }
  return Object.freeze({
    kind: "correct_record" as const,
    operation_id: command.operation_id,
    correction_kind: "water_classification" as const,
    target_event_id: resolution.target_event_id,
    base_revision: resolution.base_revision,
    replacement_kind: command.replacement_kind,
    replacement_name: command.replacement_name,
  });
}

function correctionOperation(
  command: Extract<CoreCommandCandidate, { action: "correct_record" }>,
  correctionResolution?: Readonly<
    ResolvedCoreInventoryLocationCorrection | ResolvedCoreNutritionSupplement
    | ResolvedCoreMealAmountCorrection | ResolvedCoreMealTimeCorrection
    | ResolvedCoreWaterClassification
  >,
): DomainOperation {
  if ("kind" in command) {
    return nutritionSupplementOperation(
      command,
      correctionResolution as Readonly<ResolvedCoreNutritionSupplement> | undefined,
    );
  }
  if (command.correction_kind === "inventory_location") {
    return locationCorrectionOperation(
      command,
      correctionResolution as Readonly<ResolvedCoreInventoryLocationCorrection> | undefined,
    );
  }
  if (command.correction_kind === "water_classification") {
    return waterClassificationOperation(
      command,
      correctionResolution as Readonly<ResolvedCoreWaterClassification> | undefined,
    );
  }
  if (command.correction_kind === "meal_amount") {
    return mealAmountCorrectionOperation(
      command,
      correctionResolution as Readonly<ResolvedCoreMealAmountCorrection> | undefined,
    );
  }
  return mealTimeCorrectionOperation(
    command,
    correctionResolution as Readonly<ResolvedCoreMealTimeCorrection> | undefined,
  );
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

export function mapCoreCandidateToEnvelope(
  request: Readonly<CoreApplicationRequest>,
  command: CoreCommandCandidate,
  purchaseResolutions: readonly Readonly<ResolvedCorePurchaseItem>[] = Object.freeze([]),
  correctionResolution?: Readonly<
    ResolvedCoreInventoryLocationCorrection | ResolvedCoreNutritionSupplement
    | ResolvedCoreMealAmountCorrection | ResolvedCoreMealTimeCorrection
    | ResolvedCoreWaterClassification
  >,
  nutritionEvidence: readonly Readonly<ResolvedNutritionEvidence>[] = Object.freeze([]),
): Readonly<DomainEnvelopeInput> {
  const digest = identity(request);
  const operations = command.action === "add_inventory"
    ? purchaseOperations(request, command, purchaseResolutions)
    : command.action === "correct_record"
      ? Object.freeze([correctionOperation(command, correctionResolution)])
      : command.action === "set_profile"
        ? Object.freeze([profileOperation(command)])
        : Object.freeze([mealOrWaterOperation(command, nutritionEvidence)]);
  const envelope = JSON.parse(canonicalJson({
    envelope_id: `envelope-${digest.slice(0, 32).toLowerCase()}`,
    idempotency_key: `core-${digest}`, command_type: request.action,
    subject_scope: "user:self", source_message_id: request.source_message_id,
    conversation_id: request.conversation_id, received_at: request.received_at,
    timezone: "Asia/Shanghai", operations,
  })) as DomainEnvelopeInput;
  deepFreeze(envelope);
  return envelope;
}

export function mapUndoCandidateToEnvelope(
  request: Readonly<CoreApplicationRequest>,
  command: Extract<CoreCommandCandidate, { action: "undo_record" }>,
  targetEventId: string,
  baseRevision: number,
): Readonly<DomainEnvelopeInput> {
  const digest = identity(request);
  const operations = Object.freeze([Object.freeze({
    kind: "undo_record" as const,
    operation_id: command.operation_id,
    target_event_id: targetEventId,
    base_revision: baseRevision,
  })]);
  const envelope = JSON.parse(canonicalJson({
    envelope_id: `envelope-${digest.slice(0, 32).toLowerCase()}`,
    idempotency_key: `core-${digest}`, command_type: request.action,
    subject_scope: "user:self", source_message_id: request.source_message_id,
    conversation_id: request.conversation_id, received_at: request.received_at,
    timezone: "Asia/Shanghai", operations,
  })) as DomainEnvelopeInput;
  deepFreeze(envelope);
  return envelope;
}
