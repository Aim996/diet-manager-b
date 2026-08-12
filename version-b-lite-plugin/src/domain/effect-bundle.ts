import type { DatabaseSync } from "node:sqlite";

import type { DietManagerAction } from "../contracts.js";
import type { PreparedEnvelopeOperation } from "../repository/fact-commit.js";
import {
  processInventoryEffect,
  type InventoryEffectFault,
  type InventoryEffectResult,
} from "../repository/inventory-effects.js";
import { deriveDomainId } from "./identity.js";
import { selectNutritionSource } from "./rules.js";
import type { AddInventoryOperation } from "./types.js";

export interface PurchaseOperationResult {
  readonly sequence: number;
  readonly operation_id: string;
  readonly status: "committed";
  readonly error_code: null;
  readonly batch_id: string;
  readonly product_id: string;
  readonly inventory_quantity_microunits: number;
  readonly unit: string;
  readonly nutrition_profile_id: string | null;
}

export interface PreparePurchaseInput {
  readonly database: DatabaseSync;
  readonly secret: Uint8Array;
  readonly token: string;
  readonly inputDigest: string;
  readonly dataRevision: string;
  readonly subjectScope: string;
  readonly commandType: DietManagerAction;
  readonly idempotencyKey: string;
  readonly sourceMessageId: string;
  readonly conversationId: string;
  readonly receivedAt: string;
  readonly committedAt: string;
  readonly sequence: number;
  readonly operation: AddInventoryOperation;
}

export interface PreparedPurchase {
  readonly fact: PreparedEnvelopeOperation;
  readonly outbox_id: string;
  readonly result: PurchaseOperationResult;
}

function invalid(reason: string): never {
  throw new TypeError(`PURCHASE_PREPARATION_INVALID:${reason}`);
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) return invalid(field);
  return value;
}

export function preparePurchaseOperation(input: PreparePurchaseInput): PreparedPurchase {
  const { operation } = input;
  if (operation.kind !== "add_inventory") return invalid("operation_kind");
  if (operation.amount.evidence !== "explicit") return invalid("amount_evidence");
  const quantity = positive(operation.amount.observed_microunits, "observed_microunits");
  if (
    operation.amount.inventory_deduction_microunits !== null ||
    operation.amount.nutrition_adoption_microunits !== null
  ) {
    return invalid("purchase_amount_role");
  }
  const nutrition = selectNutritionSource(
    operation.nutrition_sources,
    operation.product.product_id,
  );
  const profileId =
    nutrition.source_type === "unknown"
      ? null
      : deriveDomainId(
          "nutrition",
          `${operation.product.product_id}:${nutrition.profile_version}`,
          0,
        );
  const eventId = deriveDomainId("event", input.idempotencyKey, input.sequence);
  const effectId = deriveDomainId("effect", input.idempotencyKey, input.sequence);
  const outboxId = deriveDomainId("outbox", input.idempotencyKey, input.sequence);
  const transactionId = deriveDomainId("transaction", input.idempotencyKey, input.sequence);
  const traceId = deriveDomainId("trace", input.idempotencyKey, 0);
  const effectInput = Object.freeze({
    kind: "inventory_add" as const,
    transaction_id: transactionId,
    reason_code: "purchase",
    quantity_microunits: quantity,
    unit: operation.amount.unit,
    product: Object.freeze({
      product_id: operation.product.product_id,
      schema_version: "domain/v2",
      normalized_name: operation.product.normalized_name,
      product_type: operation.product.product_type,
      payload: Object.freeze({
        authority_kind: "diet-manager/product/v1",
      }),
    }),
    nutrition_profile:
      profileId === null
        ? null
        : Object.freeze({
            applicable_product_id: operation.product.product_id,
            nutrients: nutrition.nutrients,
            nutrition_profile_id: profileId,
            profile_version: nutrition.profile_version,
            source_ref: nutrition.source_ref,
            source_type: nutrition.source_type,
          }),
    batch: Object.freeze({
      batch_id: operation.batch_id,
      schema_version: "domain/v2",
      stocked_at: input.receivedAt,
      explicit_expiration_at: null,
      quantity_unit: operation.amount.unit,
      payload: Object.freeze({
        authority_kind: "diet-manager/inventory-batch/v1",
        template_reference_microunits: operation.amount.template_reference_microunits,
      }),
    }),
  });
  const result = Object.freeze({
    sequence: input.sequence,
    operation_id: operation.operation_id,
    status: "committed" as const,
    error_code: null,
    batch_id: operation.batch_id,
    product_id: operation.product.product_id,
    inventory_quantity_microunits: quantity,
    unit: operation.amount.unit,
    nutrition_profile_id: profileId,
  });
  return Object.freeze({
    fact: Object.freeze({
      database: input.database,
      secret: Uint8Array.from(input.secret),
      token: input.token,
      inputDigest: input.inputDigest,
      subjectScope: input.subjectScope,
      commandType: input.commandType,
      dataRevision: input.dataRevision,
      traceId,
      sequence: input.sequence,
      operationId: operation.operation_id,
      event: Object.freeze({
        eventId,
        operationId: operation.operation_id,
        schemaVersion: "domain/v2",
        eventType: "inventory_stock",
        factKind: "inventory",
        sourceMessageId: input.sourceMessageId,
        conversationId: input.conversationId,
        receivedAt: input.receivedAt,
        committedAt: input.committedAt,
        occurredAtText: input.receivedAt,
        mealId: null,
        mealSlot: null,
        payload: Object.freeze({
          authority_kind: "diet-manager/purchase-fact/v1",
          effect_inputs: Object.freeze({ [effectId]: effectInput }),
          result,
        }),
      }),
      items: Object.freeze([]),
      effects: Object.freeze([
        Object.freeze({
          outboxId,
          effectId,
          effectKind: "inventory_add",
          previousState: null,
          reason: null,
        }),
      ]),
    }),
    outbox_id: outboxId,
    result,
  });
}

export function applyPurchaseEffect(
  database: DatabaseSync,
  outboxId: string,
  now: string,
  fault?: InventoryEffectFault,
): InventoryEffectResult {
  return processInventoryEffect(
    { database, outboxId, now },
    {
      deferEnvelopeStability: true,
      ...(fault === undefined ? {} : { fault }),
    },
  );
}
