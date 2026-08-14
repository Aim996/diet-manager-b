import { createHash } from "node:crypto";

import { canonicalJson } from "../authority/canonical-json.js";
import type { CoreApplicationRequest } from "../contracts.js";
import { resolveExpiration } from "../domain/inventory-service.js";
import type {
  DomainEnvelopeInput,
  DomainOperation,
  PantryPurchaseEvidence,
  ProductIdentityEvidence,
} from "../domain/types.js";
import type {
  CoreCommandCandidate,
  CoreInventoryCommandCandidate,
  CoreInventoryLocationCorrectionCandidate,
  CoreMealCommandCandidate,
  CorePurchaseCommandCandidate,
  CorePurchaseItemCandidate,
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

function mealOrWaterOperation(command: CoreCommandCandidate): DomainOperation {
  if (command.action === "record_water") return {
    kind: "record_water", operation_id: command.operation_id,
    occurred_time: command.occurred_time, source_text: command.source_text,
    plain_water_ml_milli: command.plain_water_ml_milli,
    amount_evidence: command.amount_evidence,
  };
  if (command.action !== "record_meal" || command.occurred_time.resolved_start === null) {
    throw new Error("CORE_APPLICATION_MAPPING_INVALID:command");
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
    items: command.items.map((item) => ({
      normalized_name: item.normalized_name,
      item_type: item.kind === "food" ? "food" : "nutrition_drink",
      ...(command.inventory_directive === undefined
        ? {}
        : { inventory_directive: command.inventory_directive }),
      amount: {
        unit: item.unit ?? "unknown",
        observed_microunits: item.quantity === null ? null : item.quantity * 1_000_000,
        nutrition_adoption_microunits: null,
        inventory_deduction_microunits: item.quantity === null ? null : item.quantity * 1_000_000,
        template_reference_microunits: null,
        evidence: item.quantity === null ? "unknown"
          : item.estimated === false ? "explicit" : "estimated_upper_bound",
      },
      nutrition_sources: [],
    })),
    source_text: command.source_text, occurred_time: command.occurred_time,
    subject: command.subject,
    ...(command.context === undefined ? {} : { context: command.context }),
  };
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

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

export function mapCoreCandidateToEnvelope(
  request: Readonly<CoreApplicationRequest>,
  command: CoreCommandCandidate,
  purchaseResolutions: readonly Readonly<ResolvedCorePurchaseItem>[] = Object.freeze([]),
  correctionResolution?: Readonly<ResolvedCoreInventoryLocationCorrection>,
): Readonly<DomainEnvelopeInput> {
  const digest = identity(request);
  if (command.action === "correct_record" && !("correction_kind" in command)) {
    throw new TypeError("CORE_APPLICATION_MAPPING_INVALID:nutrition_supplement_not_implemented");
  }
  const operations = command.action === "add_inventory"
    ? purchaseOperations(request, command, purchaseResolutions)
    : command.action === "correct_record"
      ? Object.freeze([locationCorrectionOperation(command, correctionResolution)])
      : Object.freeze([mealOrWaterOperation(command)]);
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
