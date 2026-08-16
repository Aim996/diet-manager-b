import { canonicalJson, canonicalSha256 } from "../authority/canonical-json.js";
import { validateAndFreezeMealFactPayload, validateAndFreezeOccurredTimeEvidence, } from "../authority/meal-fact.js";
import { processInventoryEffect, } from "../repository/inventory-effects.js";
import { computeRepositoryDataRevision } from "../repository/revision.js";
import { createReplacementProgressReservation, reservationFromEventPayload, } from "../repository/progress-reservation.js";
import { readEffectiveMealState, } from "../repository/correction-target.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
import { applyPantryAllocationsInTransaction, assertCurrentInventoryLocationCorrectionLineage, createPantryProjectionPayload, listPantryAllocationCandidates, pendingLocationCorrectionBatchIds, pendingMealInventoryAllocationBatchIds, parseProjectionPayloadJson, parseInventoryAllocationPlan, preparePantryPurchase, } from "../storage/inventory-repository.js";
import { assertEffectTransition, assertEnvelopeTransition } from "../state/transition-guard.js";
import { deriveDomainId } from "./identity.js";
import { toNaturalDate } from "./identity.js";
import { resolveInventoryAllocation } from "./inventory-service.js";
import { validateAndFreezeInventoryLocationCorrectionFactPayload, validateAndFreezePantryPurchaseEvidence, } from "./inventory-service.js";
import { buildInventoryLocationCorrectionReceiptItem, buildPantryPurchaseReceiptItem, } from "./receipt.js";
import { buildNutritionRecords, } from "../nutrition/nutrition-service.js";
import { assertNutritionRecordsPersisted, persistNutritionRecords, } from "../nutrition/nutrition-repository.js";
import { validateAndFreezeResolvedNutritionEvidence } from "../nutrition/types.js";
import { addNutritionVectors, resolveInventoryMatch, scaleNutritionVector, selectNutritionSource, } from "./rules.js";
function freezeJson(value) {
    if (Array.isArray(value)) {
        for (const item of value)
            freezeJson(item);
        return Object.freeze(value);
    }
    if (typeof value === "object" && value !== null) {
        for (const child of Object.values(value))
            freezeJson(child);
        return Object.freeze(value);
    }
    return value;
}
export function prepareCorrectionOperation(input) {
    const operation = input.operation;
    if ((operation.kind !== "correct_record" && operation.kind !== "undo_record") ||
        (input.commandType !== "correct_record" && input.commandType !== "undo_record") ||
        operation.kind !== input.commandType)
        return invalid("correction_operation");
    const current = readEffectiveMealState(input.database, input.secret, operation.target_event_id);
    if (current.snapshot.items.some((item) => item.amount.observed_microunits === null)) {
        throw new Error("DIET_DOMAIN_REQUEST_INVALID:unknown_target_amount");
    }
    if (operation.base_revision !== current.revision) {
        throw new Error("CORRECTION_TARGET_INVALID:stale_revision");
    }
    if (operation.kind === "correct_record" && !current.snapshot.active) {
        throw new Error("CORRECTION_TARGET_INVALID:inactive");
    }
    let afterSnapshot;
    let operationKind;
    let itemOrder = 0;
    if (operation.kind === "correct_record") {
        itemOrder = operation.item_order;
        if (!Number.isSafeInteger(itemOrder) || itemOrder < 0 || itemOrder >= current.snapshot.items.length) {
            throw new Error("CORRECTION_TARGET_INVALID:item_order");
        }
        if ("correction_kind" in operation) {
            const previous = input.database.prepare(`SELECT snapshot_id FROM nutrition_snapshots
         WHERE intake_item_id = ? AND schema_version = 'domain/v2'
         ORDER BY rowid DESC LIMIT 1`).get(current.snapshot.items[itemOrder].item_id);
            if (!previous || previous.snapshot_id !== operation.previous_snapshot_id) {
                throw new Error("CORRECTION_TARGET_INVALID:nutrition_snapshot");
            }
            afterSnapshot = freezeJson({
                ...current.snapshot,
                items: current.snapshot.items.map((item, index) => index === itemOrder
                    ? {
                        ...item,
                        amount: operation.replacement_amount,
                        nutrition_sources: [operation.replacement_nutrition_source],
                        nutrition_evidence: operation.replacement_nutrition_evidence,
                    }
                    : item),
            });
            operationKind = "change_nutrition_source";
        }
        else {
            afterSnapshot = freezeJson({
                ...current.snapshot,
                items: current.snapshot.items.map((item, index) => index === itemOrder
                    ? { ...item, amount: operation.replacement_amount }
                    : item),
            });
            operationKind = "change_amount";
        }
    }
    else {
        if (!current.snapshot.active) {
            throw new Error("CORRECTION_TARGET_INVALID:already_void");
        }
        afterSnapshot = freezeJson({
            ...current.snapshot,
            active: false,
        });
        operationKind = "void_event";
    }
    if (canonicalJson(afterSnapshot) === canonicalJson(current.snapshot)) {
        throw new Error("CORRECTION_TARGET_INVALID:no_change");
    }
    const affectedItemOrders = operationKind === "change_amount" || operationKind === "change_nutrition_source"
        ? [itemOrder]
        : current.snapshot.items.map((item) => item.item_order);
    const beforeAmount = current.snapshot.items[itemOrder].amount;
    const afterAmount = afterSnapshot.items[itemOrder].amount;
    const progressPreflight = operationKind === "change_nutrition_source"
        ? preflightNutritionSupplement(input.database, current.snapshot, afterSnapshot, itemOrder)
        : preflightCorrectionNutrition(input.database, current.snapshot, afterSnapshot, affectedItemOrders);
    const correctionId = deriveDomainId("correction", input.idempotencyKey, input.sequence);
    const eventId = deriveDomainId("event", input.idempotencyKey, input.sequence);
    const date = toNaturalDate(current.snapshot.occurred_at, "Asia/Shanghai");
    const beforeProgress = Object.freeze({
        coverage_status: Object.values(progressPreflight.before).every((value) => value !== null)
            ? "complete"
            : "partial",
        date,
        nutrients: progressPreflight.before,
        timezone: "Asia/Shanghai",
    });
    const afterProgress = Object.freeze({
        coverage_status: Object.values(progressPreflight.after).every((value) => value !== null)
            ? "complete"
            : "partial",
        date,
        nutrients: progressPreflight.after,
        timezone: "Asia/Shanghai",
    });
    let progressReservation;
    try {
        progressReservation = createReplacementProgressReservation(input.database, date, beforeProgress, afterProgress);
    }
    catch (error) {
        if (error instanceof Error &&
            (error.message === "PROGRESS_RESERVATION_AUTHORITY_INVALID:daily_progress_delta" ||
                error.message === "PROGRESS_RESERVATION_AUTHORITY_INVALID:daily_progress_missing")) {
            throw new Error("CORRECTION_EFFECT_INVALID:daily_progress");
        }
        throw error;
    }
    const payload = freezeJson({
        affected_dates: [date],
        after_snapshot: afterSnapshot,
        authority_kind: "diet-manager/correction-fact/v1",
        base_revision: current.revision,
        before_snapshot: current.snapshot,
        change_set: operationKind === "change_amount" || operationKind === "change_nutrition_source"
            ? operationKind === "change_nutrition_source"
                ? [
                    {
                        after: afterSnapshot.items[itemOrder].nutrition_sources,
                        before: current.snapshot.items[itemOrder].nutrition_sources,
                        path: `/items/${itemOrder}/nutrition_sources`,
                    },
                    { after: afterAmount, before: beforeAmount, path: `/items/${itemOrder}/amount` },
                ]
                : [{ after: afterAmount, before: beforeAmount, path: `/items/${itemOrder}/amount` }]
            : [{
                    after: afterSnapshot.active,
                    before: current.snapshot.active,
                    path: "/active",
                }],
        correction_id: correctionId,
        inventory_compensation_intent: {
            items: affectedItemOrders.map((affectedItemOrder) => ({
                from_microunits: current.snapshot.active
                    ? current.snapshot.items[affectedItemOrder].amount.inventory_deduction_microunits
                    : 0,
                item_order: affectedItemOrder,
                to_microunits: afterSnapshot.active
                    ? afterSnapshot.items[affectedItemOrder].amount.inventory_deduction_microunits
                    : 0,
            })),
        },
        nutrition_delta: {
            items: affectedItemOrders.map((affectedItemOrder) => ({
                from_adoption_microunits: current.snapshot.active
                    ? current.snapshot.items[affectedItemOrder].amount.nutrition_adoption_microunits
                    : 0,
                item_order: affectedItemOrder,
                to_adoption_microunits: afterSnapshot.active
                    ? afterSnapshot.items[affectedItemOrder].amount.nutrition_adoption_microunits
                    : 0,
            })),
            progress_reservation: progressReservation,
        },
        operation: operationKind,
        request_id: operation.operation_id,
        target_event_id: operation.target_event_id,
    });
    return Object.freeze({
        correction_id: correctionId,
        operation,
        progress_date: date,
        progress_before: progressPreflight.before,
        progress_after: progressPreflight.after,
        fact: Object.freeze({
            database: input.database,
            secret: Uint8Array.from(input.secret),
            token: input.token,
            inputDigest: input.inputDigest,
            subjectScope: input.subjectScope,
            commandType: input.commandType,
            dataRevision: input.dataRevision,
            traceId: deriveDomainId("trace", input.idempotencyKey, 0),
            sequence: input.sequence,
            operationId: operation.operation_id,
            event: Object.freeze({
                eventId,
                operationId: operation.operation_id,
                schemaVersion: "domain/v2",
                eventType: operationKind === "change_nutrition_source"
                    ? "nutrition_supplemented"
                    : "diet_correction",
                factKind: "correction",
                sourceMessageId: input.sourceMessageId,
                conversationId: input.conversationId,
                receivedAt: input.receivedAt,
                committedAt: input.committedAt,
                occurredAtText: null,
                mealId: null,
                mealSlot: null,
                payload,
            }),
            items: Object.freeze([]),
            effects: Object.freeze([
                ...affectedItemOrders.map((_, affectedIndex) => Object.freeze({
                    outboxId: deriveDomainId("outbox", input.idempotencyKey, affectedIndex),
                    effectId: deriveDomainId("effect", input.idempotencyKey, affectedIndex),
                    effectKind: "correction_inventory_compensation",
                    previousState: null,
                    reason: null,
                })),
                Object.freeze({
                    outboxId: deriveDomainId("outbox", input.idempotencyKey, affectedItemOrders.length),
                    effectId: deriveDomainId("effect", input.idempotencyKey, affectedItemOrders.length),
                    effectKind: "daily_progress_replacement",
                    previousState: null,
                    reason: null,
                }),
            ]),
            progressReservation,
        }),
    });
}
function invalid(reason) {
    throw new TypeError(`PURCHASE_PREPARATION_INVALID:${reason}`);
}
function positive(value, field) {
    if (!Number.isSafeInteger(value) || value <= 0)
        return invalid(field);
    return value;
}
export function preparePurchaseOperation(input) {
    const { operation } = input;
    const effectIdentityKey = input.effectIdentityKey ?? input.idempotencyKey;
    const effectIdentitySequence = input.effectIdentityKey === undefined ? input.sequence : 0;
    if (operation.kind !== "add_inventory")
        return invalid("operation_kind");
    if (operation.amount.evidence !== "explicit" &&
        !(operation.pantry_evidence !== undefined && operation.amount.evidence === "unknown"))
        return invalid("amount_evidence");
    const quantity = operation.amount.observed_microunits === null
        ? null
        : positive(operation.amount.observed_microunits, "observed_microunits");
    if (quantity === null &&
        (operation.pantry_evidence === undefined || operation.amount.evidence !== "unknown" ||
            operation.amount.unit !== "unknown"))
        return invalid("observed_microunits");
    if (operation.amount.inventory_deduction_microunits !== null ||
        operation.amount.nutrition_adoption_microunits !== null) {
        return invalid("purchase_amount_role");
    }
    const nutrition = selectNutritionSource(operation.nutrition_sources, operation.product.product_id);
    const profileId = nutrition.source_type === "unknown"
        ? null
        : deriveDomainId("nutrition", `${operation.product.product_id}:${nutrition.profile_version}`, 0);
    const eventId = deriveDomainId("event", input.idempotencyKey, input.sequence);
    const effectId = deriveDomainId("effect", effectIdentityKey, effectIdentitySequence);
    const outboxId = deriveDomainId("outbox", effectIdentityKey, effectIdentitySequence);
    const transactionId = deriveDomainId("transaction", effectIdentityKey, effectIdentitySequence);
    const traceId = deriveDomainId("trace", input.idempotencyKey, 0);
    const pantry = operation.pantry_evidence === undefined
        ? undefined
        : preparePantryPurchase({
            evidence: operation.pantry_evidence,
            product_id: operation.product.product_id,
            normalized_name: operation.product.normalized_name,
            batch_id: operation.batch_id,
            quantity_microunits: quantity,
            unit: operation.amount.unit,
            template_reference_microunits: operation.amount.template_reference_microunits,
        });
    const effectInput = Object.freeze({
        kind: "inventory_add",
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
                ...(pantry === undefined
                    ? { authority_kind: "diet-manager/product/v1" }
                    : pantry.product_payload),
            }),
        }),
        nutrition_profile: profileId === null
            ? null
            : Object.freeze({
                applicable_product_id: operation.product.product_id,
                basis_kind: nutrition.basis_kind,
                basis_microunits: nutrition.basis_microunits,
                basis_unit: nutrition.basis_unit,
                nutrients: nutrition.nutrients,
                nutrition_profile_id: profileId,
                profile_version: nutrition.profile_version,
                source_ref: nutrition.source_ref,
                source_type: nutrition.source_type,
            }),
        batch: Object.freeze({
            batch_id: operation.batch_id,
            schema_version: "domain/v2",
            stocked_at: new Date(input.receivedAt).toISOString(),
            explicit_expiration_at: pantry?.explicit_expiration_at ?? null,
            quantity_unit: operation.amount.unit,
            payload: Object.freeze({
                ...(pantry === undefined
                    ? {
                        authority_kind: "diet-manager/inventory-batch/v1",
                        template_reference_microunits: operation.amount.template_reference_microunits,
                    }
                    : pantry.batch_payload),
            }),
        }),
    });
    const result = Object.freeze({
        sequence: input.sequence,
        operation_id: operation.operation_id,
        status: "committed",
        error_code: null,
        batch_id: operation.batch_id,
        product_id: operation.product.product_id,
        inventory_quantity_microunits: quantity,
        unit: operation.amount.unit,
        nutrition_profile_id: profileId,
        ...(pantry === undefined ? {} : {
            pantry_evidence: pantry.evidence,
            receipt_item: buildPantryPurchaseReceiptItem({
                product_id: operation.product.product_id,
                batch_id: operation.batch_id,
                name: operation.product.normalized_name,
                stocked_at: input.receivedAt,
                evidence: pantry.evidence,
            }),
        }),
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
                    authority_kind: pantry === undefined
                        ? "diet-manager/purchase-fact/v1"
                        : "diet-manager/purchase-fact/v2",
                    ...(pantry === undefined ? {} : { pantry_evidence: pantry.evidence }),
                    effect_inputs: Object.freeze({ [effectId]: effectInput }),
                    ...(input.progressReservation === undefined
                        ? {}
                        : { progress_reservation: input.progressReservation }),
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
            ...(input.progressReservation === undefined
                ? {}
                : { progressReservation: input.progressReservation }),
        }),
        outbox_id: outboxId,
        result,
    });
}
export function prepareInventoryLocationCorrectionOperation(input) {
    const operation = input.operation;
    if (input.commandType !== "correct_record" || operation.correction_kind !== "inventory_location") {
        return invalid("inventory_location_correction_operation");
    }
    try {
        if (pendingMealInventoryAllocationBatchIds(input.database).has(operation.batch_id)) {
            throw new Error("pending");
        }
    }
    catch {
        throw new Error("INVENTORY_LOCATION_CORRECTION_INVALID:pending_inventory_effect");
    }
    try {
        if (pendingLocationCorrectionBatchIds(input.database).has(operation.batch_id)) {
            throw new Error("pending");
        }
    }
    catch {
        throw new Error("INVENTORY_LOCATION_CORRECTION_INVALID:pending_revision");
    }
    const row = input.database.prepare(`SELECT i.*, b.product_id, b.explicit_expiration_at, b.quantity_unit
     FROM inventory_batch_projections i
     JOIN inventory_batches b ON b.batch_id = i.batch_id
     WHERE i.batch_id = ?`).get(operation.batch_id);
    if (!row)
        throw new Error("INVENTORY_LOCATION_CORRECTION_INVALID:batch");
    const projection = parseProjectionPayloadJson(row.payload_json);
    if (projection.version !== 2 || projection.pantry_evidence === null) {
        throw new Error("INVENTORY_LOCATION_CORRECTION_INVALID:projection_version");
    }
    let revision;
    try {
        revision = assertCurrentInventoryLocationCorrectionLineage(input.database, input.secret, operation.batch_id, projection.pantry_evidence);
    }
    catch (error) {
        if (error instanceof Error &&
            error.message === "PANTRY_REPOSITORY_AUTHORITY_INVALID:pending_location_correction") {
            throw new Error("INVENTORY_LOCATION_CORRECTION_INVALID:pending_revision");
        }
        throw new Error("INVENTORY_LOCATION_CORRECTION_INVALID:lineage_authority");
    }
    if (operation.base_revision !== revision) {
        throw new Error("INVENTORY_LOCATION_CORRECTION_INVALID:stale_revision");
    }
    if (canonicalJson(projection.pantry_evidence.location) !== canonicalJson(operation.previous_location) ||
        canonicalJson(projection.pantry_evidence.expiration) !== canonicalJson(operation.previous_expiration) ||
        row.effective_expiration_at !== operation.previous_expiration.effective_at)
        throw new Error("INVENTORY_LOCATION_CORRECTION_INVALID:previous_projection");
    const nextEvidenceSource = JSON.parse(canonicalJson(projection.pantry_evidence));
    nextEvidenceSource.location = operation.next_location;
    nextEvidenceSource.expiration = operation.expected_expiration;
    const nextEvidence = validateAndFreezePantryPurchaseEvidence(nextEvidenceSource);
    const nextProjectionJson = canonicalJson(createPantryProjectionPayload({
        batch_id: projection.batch_id,
        product_id: projection.product_id,
        quantity_microunits: projection.quantity_microunits,
        unit: projection.unit,
        pantry_evidence: nextEvidence,
    }));
    const eventId = deriveDomainId("event", input.idempotencyKey, input.sequence);
    const effectId = deriveDomainId("effect", input.idempotencyKey, input.sequence);
    const outboxId = deriveDomainId("outbox", input.idempotencyKey, input.sequence);
    const result = Object.freeze({
        sequence: input.sequence,
        operation_id: operation.operation_id,
        status: "committed",
        error_code: null,
        batch_id: operation.batch_id,
        adjustment_kind: "location_correction",
        previous_location: operation.previous_location,
        current_location: operation.next_location,
        expiration: operation.expected_expiration,
        receipt_item: buildInventoryLocationCorrectionReceiptItem({
            batch_id: operation.batch_id,
            previous_location: operation.previous_location,
            current_location: operation.next_location,
            expiration: operation.expected_expiration,
        }),
    });
    const intent = Object.freeze({
        kind: "inventory_location_correction",
        batch_id: operation.batch_id,
        base_revision: operation.base_revision,
        previous_last_event_id: row.last_event_id,
        previous_last_changed_at: row.last_changed_at,
        previous_projection_json: row.payload_json,
        next_projection_json: nextProjectionJson,
    });
    const payload = validateAndFreezeInventoryLocationCorrectionFactPayload({
        authority_kind: "diet-manager/inventory-location-correction-fact/v1",
        adjustment_kind: "location_correction",
        batch_id: operation.batch_id,
        base_revision: operation.base_revision,
        previous_last_event_id: row.last_event_id,
        previous_last_changed_at: row.last_changed_at,
        previous_projection_json: row.payload_json,
        next_projection_json: nextProjectionJson,
        previous_location: operation.previous_location,
        next_location: operation.next_location,
        previous_expiration: projection.pantry_evidence.expiration,
        next_expiration: operation.expected_expiration,
        source_text: operation.source_text,
        matched_span: operation.matched_span,
        rule_version: operation.rule_version,
        effect_inputs: Object.freeze({ [effectId]: intent }),
        result,
    });
    return Object.freeze({
        event_id: eventId,
        outbox_id: outboxId,
        payload,
        result,
        fact: Object.freeze({
            database: input.database,
            secret: Uint8Array.from(input.secret),
            token: input.token,
            inputDigest: input.inputDigest,
            subjectScope: input.subjectScope,
            commandType: input.commandType,
            dataRevision: input.dataRevision,
            traceId: deriveDomainId("trace", input.idempotencyKey, 0),
            sequence: input.sequence,
            operationId: operation.operation_id,
            event: Object.freeze({
                eventId,
                operationId: operation.operation_id,
                schemaVersion: "domain/v2",
                eventType: "inventory_adjusted",
                factKind: "inventory",
                sourceMessageId: input.sourceMessageId,
                conversationId: input.conversationId,
                receivedAt: input.receivedAt,
                committedAt: input.committedAt,
                occurredAtText: input.receivedAt,
                mealId: null,
                mealSlot: null,
                payload,
            }),
            items: Object.freeze([]),
            effects: Object.freeze([Object.freeze({
                    outboxId,
                    effectId,
                    effectKind: "inventory_location_correction",
                    previousState: row.last_event_id,
                    reason: null,
                })]),
        }),
    });
}
export function applyPurchaseEffect(database, outboxId, now, fault) {
    return processInventoryEffect({ database, outboxId, now }, {
        deferEnvelopeStability: true,
        ...(fault === undefined ? {} : { fault }),
    });
}
function mealEffectId(idempotencyKey, itemOrder, effectOrder) {
    return deriveDomainId("effect", idempotencyKey, itemOrder * 10 + effectOrder);
}
export function prepareMealOperation(input) {
    const { operation } = input;
    const effectIdentityKey = input.effectIdentityKey ?? input.idempotencyKey;
    if (operation.kind !== "record_meal" || operation.items.length === 0) {
        return invalid("meal_operation");
    }
    if (input.inventoryPlans !== undefined && input.inventoryPlans.length !== operation.items.length) {
        return invalid("inventory_plans");
    }
    const inventoryPlans = input.inventoryPlans?.map((plan) => plan === null ? null : parseInventoryAllocationPlan(plan));
    const eventId = deriveDomainId("event", input.idempotencyKey, input.sequence);
    const mealId = deriveDomainId("meal", input.idempotencyKey, input.sequence);
    const traceId = deriveDomainId("trace", input.idempotencyKey, 0);
    const effects = [];
    for (let itemOrder = 0; itemOrder < operation.items.length; itemOrder += 1) {
        if (operation.location === "home") {
            effects.push(Object.freeze({
                outboxId: deriveDomainId("outbox", effectIdentityKey, itemOrder * 10),
                effectId: mealEffectId(effectIdentityKey, itemOrder, 0),
                effectKind: "inventory_deduct",
                previousState: null,
                reason: null,
            }));
            effects.push(Object.freeze({
                outboxId: deriveDomainId("outbox", effectIdentityKey, itemOrder * 10 + 1),
                effectId: mealEffectId(effectIdentityKey, itemOrder, 1),
                effectKind: "issue_projection",
                previousState: null,
                reason: null,
            }));
        }
        effects.push(Object.freeze({
            outboxId: deriveDomainId("outbox", effectIdentityKey, itemOrder * 10 + 2),
            effectId: mealEffectId(effectIdentityKey, itemOrder, 2),
            effectKind: "nutrition_snapshot",
            previousState: null,
            reason: null,
        }));
    }
    effects.push(Object.freeze({
        outboxId: deriveDomainId("outbox", effectIdentityKey, operation.items.length * 10 + 9),
        effectId: mealEffectId(effectIdentityKey, operation.items.length, 9),
        effectKind: "daily_progress_contribution",
        previousState: null,
        reason: null,
    }));
    const eventPayload = validateAndFreezeMealFactPayload({
        authority_kind: "diet-manager/meal-fact/v1",
        location: operation.location,
        ...(Object.hasOwn(operation, "source_text") ? { source_text: operation.source_text } : {}),
        ...(Object.hasOwn(operation, "occurred_time") ? { occurred_time: operation.occurred_time } : {}),
        ...(Object.hasOwn(operation, "subject") ? { subject: operation.subject } : {}),
        ...(Object.hasOwn(operation, "context") ? { context: operation.context } : {}),
        ...(input.progressReservation === undefined
            ? {}
            : { progress_reservation: input.progressReservation }),
        timezone: "Asia/Shanghai",
    }, {
        occurredAt: operation.occurred_at,
        path: "prepared_meal_fact",
    });
    return Object.freeze({
        event_id: eventId,
        operation,
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
                eventType: "diet_meal",
                factKind: "meal",
                sourceMessageId: input.sourceMessageId,
                conversationId: input.conversationId,
                receivedAt: input.receivedAt,
                committedAt: input.committedAt,
                occurredAtText: operation.occurred_at,
                mealId,
                mealSlot: operation.meal_slot,
                payload: eventPayload,
            }),
            items: Object.freeze(operation.items.map((item, itemOrder) => Object.freeze({
                itemId: deriveDomainId("item", input.idempotencyKey, itemOrder),
                itemOrder,
                itemType: item.item_type,
                normalizedName: item.normalized_name,
                payload: Object.freeze({
                    amount: item.amount,
                    authority_kind: "diet-manager/meal-item/v1",
                    ...(item.inventory_directive === undefined ? {} : { inventory_directive: item.inventory_directive }),
                    ...(inventoryPlans?.[itemOrder] === undefined || inventoryPlans[itemOrder] === null
                        ? {}
                        : { inventory_plan: inventoryPlans[itemOrder] }),
                    ...(item.nutrition_evidence === undefined
                        ? {}
                        : { nutrition_evidence: item.nutrition_evidence }),
                    nutrition_sources: item.nutrition_sources,
                }),
            }))),
            effects: Object.freeze(effects),
            ...(input.progressReservation === undefined
                ? {}
                : { progressReservation: input.progressReservation }),
        }),
    });
}
export function prepareWaterOperation(input) {
    const { operation } = input;
    if (operation.kind !== "record_water")
        return invalid("water_operation");
    const occurredTime = validateAndFreezeOccurredTimeEvidence(operation.occurred_time, {
        path: "water_operation.occurred_time",
        requireExact: true,
    });
    if (occurredTime.resolved_start === null)
        return invalid("water_occurred_time");
    const occurredAtText = new Date(occurredTime.resolved_start).toISOString();
    const eventId = deriveDomainId("event", input.idempotencyKey, input.sequence);
    const effectId = deriveDomainId("effect", input.idempotencyKey, 9);
    const outboxId = deriveDomainId("outbox", input.idempotencyKey, 9);
    const traceId = deriveDomainId("trace", input.idempotencyKey, 0);
    const payload = Object.freeze({
        amount_evidence: operation.amount_evidence,
        authority_kind: "diet-manager/water-fact/v1",
        estimated: false,
        occurred_time: occurredTime,
        plain_water_ml_milli: operation.plain_water_ml_milli,
        ...(input.progressReservation === undefined ? {} : { progress_reservation: input.progressReservation }),
        source_text: operation.source_text,
        timezone: "Asia/Shanghai",
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
                eventType: "diet_water",
                factKind: "water",
                sourceMessageId: input.sourceMessageId,
                conversationId: input.conversationId,
                receivedAt: input.receivedAt,
                committedAt: input.committedAt,
                occurredAtText,
                mealId: null,
                mealSlot: null,
                payload,
            }),
            items: Object.freeze([]),
            effects: Object.freeze([Object.freeze({
                    outboxId,
                    effectId,
                    effectKind: "daily_progress_contribution",
                    previousState: null,
                    reason: null,
                })]),
            ...(input.progressReservation === undefined ? {} : { progressReservation: input.progressReservation }),
        }),
    });
}
export function preflightWaterOperation(operation) {
    const occurredTime = validateAndFreezeOccurredTimeEvidence(operation.occurred_time, {
        path: "water_operation.occurred_time",
        requireExact: true,
    });
    if (occurredTime.resolved_start === null)
        return invalid("water_occurred_time");
    return Object.freeze({
        date: toNaturalDate(new Date(occurredTime.resolved_start).toISOString(), "Asia/Shanghai"),
        timezone: "Asia/Shanghai",
        coverage_status: "partial",
        nutrients: Object.freeze({
            energy_kcal_milli: null, protein_mg: null, fat_mg: null,
            carbohydrate_mg: null, fiber_mg: null,
            water_ml_milli: operation.plain_water_ml_milli,
        }),
    });
}
function v11NutritionRecords(operationId, eventId, committedAt, item, evidenceValue) {
    const evidence = validateAndFreezeResolvedNutritionEvidence(evidenceValue);
    return buildNutritionRecords({
        operation_id: operationId,
        meal_event_id: eventId,
        intake_item_id: item.item_id,
        item_name: item.normalized_name,
        subject_type: evidence.source_type === "product_label" ? "product" : "food",
        subject_id: item.normalized_name,
        created_at: committedAt,
    }, evidence);
}
function parseCanonical(value, label) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}_json`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
        canonicalJson(parsed) !== value) {
        throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}_canonical`);
    }
    return parsed;
}
function validatedMealFactPayload(value, occurredAt, label) {
    try {
        return validateAndFreezeMealFactPayload(value, {
            occurredAt,
            path: label,
        });
    }
    catch {
        throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
    }
}
function exactKeys(value, fields, label) {
    if (Object.keys(value).sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
        throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
    }
}
function storedNullableMicrounits(value, label) {
    if (value === null)
        return null;
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
    }
    return value;
}
function storedStructuredAmount(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
    }
    const amount = value;
    exactKeys(amount, [
        "evidence",
        "inventory_deduction_microunits",
        "nutrition_adoption_microunits",
        "observed_microunits",
        "template_reference_microunits",
        "unit",
    ], label);
    if (typeof amount.unit !== "string" || amount.unit.length === 0 ||
        amount.unit.length > 256 || /[\u0000-\u001F\u007F]/.test(amount.unit))
        throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
    const observed = storedNullableMicrounits(amount.observed_microunits, `${label}_observed`);
    const adoption = storedNullableMicrounits(amount.nutrition_adoption_microunits, `${label}_adoption`);
    const deduction = storedNullableMicrounits(amount.inventory_deduction_microunits, `${label}_deduction`);
    const template = storedNullableMicrounits(amount.template_reference_microunits, `${label}_template`);
    if (observed === null) {
        if (adoption !== null || deduction !== null || template !== null ||
            amount.evidence !== "unknown")
            throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
    }
    else if (amount.evidence !== "explicit" &&
        amount.evidence !== "estimated_upper_bound")
        throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
    return Object.freeze({
        unit: amount.unit,
        observed_microunits: observed,
        nutrition_adoption_microunits: adoption,
        inventory_deduction_microunits: deduction,
        template_reference_microunits: template,
        evidence: amount.evidence,
    });
}
function changed(database) {
    return Number(database.prepare("SELECT changes() AS count").get().count);
}
function assertPendingMealCheckpoint(database, checkpoint, envelopeId, operationId, expectedSequence, idempotencyKey, location) {
    if (checkpoint.operation_id !== operationId || checkpoint.effect_state !== "pending" ||
        checkpoint.result_status !== "facts_committed_effects_pending" || checkpoint.completed_at !== null)
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:checkpoint_state");
    const operations = database.prepare(`SELECT operation_id FROM event_records WHERE envelope_id = ? ORDER BY committed_at, event_id`).all(envelopeId);
    if (operations[expectedSequence]?.operation_id !== operationId ||
        operations.filter((row) => row.operation_id === operationId).length !== 1)
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:operation_sequence");
    const payload = parseCanonical(checkpoint.payload_json, "checkpoint");
    exactKeys(payload, ["authority_kind", "data_revision", "effects", "operation_sequence"], "checkpoint_payload");
    if (payload.authority_kind !== "diet-manager/effect-bundle-checkpoint/v1" ||
        payload.operation_sequence !== expectedSequence || typeof payload.data_revision !== "string" ||
        !payload.data_revision.startsWith("repository-v1:") || !Array.isArray(payload.effects))
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:checkpoint_payload");
    const outboxes = database.prepare(`SELECT effect_id, effect_kind, state FROM effect_outbox
     WHERE envelope_id = ? AND operation_id = ? ORDER BY effect_id`).all(envelopeId, operationId);
    const itemCount = Number(database.prepare(`SELECT COUNT(*) AS count FROM meal_items WHERE event_id IN (
       SELECT event_id FROM event_records WHERE envelope_id = ? AND operation_id = ?
     )`).get(envelopeId, operationId).count);
    const expectedKinds = new Map();
    for (let itemOrder = 0; itemOrder < itemCount; itemOrder += 1) {
        if (location === "home") {
            expectedKinds.set(mealEffectId(idempotencyKey, itemOrder, 0), "inventory_deduct");
            expectedKinds.set(mealEffectId(idempotencyKey, itemOrder, 1), "issue_projection");
        }
        expectedKinds.set(mealEffectId(idempotencyKey, itemOrder, 2), "nutrition_snapshot");
    }
    expectedKinds.set(mealEffectId(idempotencyKey, itemCount, 9), "daily_progress_contribution");
    if (payload.effects.length !== outboxes.length || outboxes.length !== expectedKinds.size ||
        new Set(outboxes.map((row) => row.effect_id)).size !== outboxes.length ||
        outboxes.some((row) => expectedKinds.get(row.effect_id) !== row.effect_kind)) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:checkpoint_effects");
    }
    payload.effects.forEach((candidate, index) => {
        if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:checkpoint_effects");
        }
        const effect = candidate;
        exactKeys(effect, ["effect_id", "state"], "checkpoint_effects");
        if (effect.effect_id !== outboxes[index]?.effect_id || effect.state !== "pending" ||
            (outboxes[index]?.state !== "pending" && outboxes[index]?.state !== "retryable_failed"))
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:checkpoint_effects");
    });
}
export function markMealEffectsRetryable(input) {
    let transactionOpen = false;
    try {
        input.database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        assertCurrentMigrationAuthority(input.database);
        const checkpoint = input.database.prepare(`SELECT operation_id, effect_state, result_status, completed_at, payload_json
       FROM effect_bundle_commits WHERE envelope_id = ? AND operation_id = ?`).get(input.envelopeId, input.operationId);
        if (!checkpoint)
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:checkpoint_missing");
        assertPendingMealCheckpoint(input.database, checkpoint, input.envelopeId, input.operationId, input.operationSequence, input.idempotencyKey, input.location);
        assertEffectTransition("pending", "processing");
        input.database.prepare(`UPDATE effect_outbox SET state = 'processing', attempt_count = attempt_count + 1,
         reason = NULL, updated_at = ?
       WHERE envelope_id = ? AND operation_id = ? AND state = 'pending'`).run(input.now, input.envelopeId, input.operationId);
        const claimed = changed(input.database);
        if (claimed < 1)
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:retry_claim");
        assertEffectTransition("processing", "retryable_failed");
        input.database.prepare(`UPDATE effect_outbox SET state = 'retryable_failed', reason = ?, updated_at = ?
       WHERE envelope_id = ? AND operation_id = ? AND state = 'processing'`).run(input.errorCode, input.now, input.envelopeId, input.operationId);
        if (changed(input.database) !== claimed) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:retry_fail_compare_and_set");
        }
        const envelope = input.database.prepare("SELECT state, result_status FROM command_envelopes WHERE envelope_id = ?").get(input.envelopeId);
        if (envelope?.state !== "received" || envelope.result_status !== "preview_ready") {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:retry_envelope_state");
        }
        assertEnvelopeTransition("received", "facts_committed");
        input.database.prepare(`UPDATE command_envelopes SET state = 'facts_committed', result_status = 'facts_committed', committed_at = ?
       WHERE envelope_id = ? AND state = 'received' AND result_status = 'preview_ready'`).run(input.now, input.envelopeId);
        if (changed(input.database) !== 1)
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:retry_fact_compare_and_set");
        assertEnvelopeTransition("facts_committed", "effects_pending");
        input.database.prepare(`UPDATE command_envelopes SET state = 'effects_pending', result_status = 'facts_committed_effects_pending'
       WHERE envelope_id = ? AND state = 'facts_committed' AND result_status = 'facts_committed'`).run(input.envelopeId);
        if (changed(input.database) !== 1)
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:retry_envelope_compare_and_set");
        input.database.prepare(`UPDATE idempotency_records SET state = 'effects_pending', updated_at = ?
       WHERE idempotency_key = ? AND operation_id = ? AND input_digest = ?
         AND state = 'preview_ready' AND terminal_result_json IS NULL`).run(input.now, input.idempotencyKey, input.envelopeId, input.inputDigest);
        if (changed(input.database) !== 1)
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:retry_idempotency_compare_and_set");
        input.database.exec("COMMIT");
        transactionOpen = false;
    }
    catch (error) {
        if (transactionOpen) {
            try {
                input.database.exec("ROLLBACK");
            }
            catch { /* preserve primary */ }
        }
        throw error;
    }
}
function inventoryCandidates(database, normalizedName) {
    return Object.freeze(database.prepare(`SELECT p.product_id, i.batch_id, i.payload_json
     FROM products p
     JOIN inventory_batches b ON b.product_id = p.product_id
     JOIN inventory_batch_projections i ON i.batch_id = b.batch_id
     WHERE p.normalized_name = ?
     ORDER BY i.batch_id`).all(normalizedName).map((row) => {
        const payload = parseCanonical(row.payload_json, "projection");
        if (payload.authority_kind !== "diet-manager/inventory-projection/v1" ||
            payload.product_id !== row.product_id || payload.batch_id !== row.batch_id ||
            !Number.isSafeInteger(payload.quantity_microunits) ||
            typeof payload.unit !== "string") {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:projection");
        }
        return Object.freeze({
            batch_id: row.batch_id,
            product_id: row.product_id,
            available_microunits: payload.quantity_microunits,
            unit: payload.unit,
        });
    }));
}
/**
 * Builds immutable Pantry-v2 allocation authority before FactCommit. Legacy
 * v1 inventory keeps its byte-exact single-candidate path by returning null.
 * Outside and unknown-amount skips also retain their existing zero-read fact
 * shape until an explicit inventory directive is supplied by the parser.
 */
export function prepareMealInventoryPlans(database, authoritySecret, operation, envelopeId) {
    if (envelopeId !== undefined) {
        const stored = database.prepare(`SELECT i.payload_json FROM meal_items i
       JOIN event_records e ON e.event_id = i.event_id
       WHERE e.envelope_id = ? AND e.operation_id = ?
       ORDER BY i.item_order`).all(envelopeId, operation.operation_id);
        if (stored.length > 0) {
            if (stored.length !== operation.items.length) {
                throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:stored_inventory_plans");
            }
            return Object.freeze(stored.map(({ payload_json }) => {
                const payload = parseCanonical(payload_json, "stored_inventory_plan");
                return Object.hasOwn(payload, "inventory_plan")
                    ? parseInventoryAllocationPlan(payload.inventory_plan)
                    : null;
            }));
        }
    }
    return Object.freeze(operation.items.map((item) => {
        if (item.inventory_directive !== undefined) {
            return resolveInventoryAllocation({
                location: operation.location,
                explicit_skip: true,
                requested_microunits: item.amount.inventory_deduction_microunits,
                unit: item.amount.unit,
                specified_batch_id: null,
                candidates: Object.freeze([]),
            });
        }
        if (operation.location === "outside" || item.amount.inventory_deduction_microunits === null) {
            return null;
        }
        const read = listPantryAllocationCandidates(database, authoritySecret, item.normalized_name, operation.occurred_at);
        if (read === null && operation.inventory_policy === undefined)
            return null;
        return resolveInventoryAllocation({
            location: operation.location,
            explicit_skip: false,
            requested_microunits: item.amount.inventory_deduction_microunits,
            unit: item.amount.unit,
            specified_batch_id: null,
            candidates: read?.candidates ?? Object.freeze([]),
        });
    }));
}
function allocationDecision(plan) {
    const first = plan.allocations[0];
    const issueCode = plan.issue_code === "inventory_unit_conversion_unproven"
        ? "inventory_unit_incompatible"
        : plan.issue_code;
    return Object.freeze({
        status: plan.status === "skipped_by_user" ? "skipped_outside" : plan.status,
        batch_id: first?.batch_id ?? null,
        product_id: first?.product_id ?? null,
        deduction_microunits: plan.status === "matched" ? plan.requested_microunits ?? 0 : 0,
        unit: plan.unit,
        issue_code: issueCode,
    });
}
function selectMealNutrition(item, decision) {
    if (!Array.isArray(item.nutrition_sources)) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:nutrition_sources");
    }
    const sources = item.nutrition_sources;
    const uniqueLabelProducts = [...new Set(sources
            .filter((source) => source.source_type === "product_label")
            .map((source) => source.applicable_product_id)
            .filter((value) => typeof value === "string"))];
    const productId = decision.product_id ?? (uniqueLabelProducts.length === 1 ? uniqueLabelProducts[0] : null);
    return selectNutritionSource(sources, productId);
}
export function preflightMealOperation(database, authoritySecret, operation, precedingCandidates = new Map()) {
    let preflightMealProgress = zeroNutrition();
    const pantryPlans = precedingCandidates.size === 0
        ? prepareMealInventoryPlans(database, authoritySecret, operation)
        : Object.freeze(operation.items.map(() => null));
    for (let itemOrder = 0; itemOrder < operation.items.length; itemOrder += 1) {
        const item = operation.items[itemOrder];
        const pantryPlan = pantryPlans[itemOrder];
        const candidates = pantryPlan !== null && pantryPlan !== undefined ||
            operation.location === "outside" || item.amount.inventory_deduction_microunits === null
            ? []
            : [...inventoryCandidates(database, item.normalized_name), ...(precedingCandidates.get(item.normalized_name) ?? [])];
        const decision = pantryPlan === null || pantryPlan === undefined
            ? resolveInventoryMatch({
                location: operation.location,
                requested_unit: item.amount.unit,
                observed_microunits: item.amount.observed_microunits,
                nutrition_adoption_microunits: item.amount.nutrition_adoption_microunits,
                inventory_deduction_microunits: item.amount.inventory_deduction_microunits,
                template_reference_microunits: item.amount.template_reference_microunits,
                candidates,
            })
            : allocationDecision(pantryPlan);
        const selection = selectMealNutrition({ nutrition_sources: item.nutrition_sources }, decision);
        const scaled = item.amount.nutrition_adoption_microunits === null
            ? Object.freeze({
                energy_kcal_milli: null, protein_mg: null, fat_mg: null,
                carbohydrate_mg: null, fiber_mg: null, water_ml_milli: null,
            })
            : selection.basis_microunits === null
                ? selection.nutrients
                : scaleNutritionVector(selection.nutrients, item.amount.nutrition_adoption_microunits, selection.basis_microunits);
        preflightMealProgress = addNutritionVectors(preflightMealProgress, scaled);
    }
    return Object.freeze({
        date: toNaturalDate(operation.occurred_at, "Asia/Shanghai"),
        timezone: "Asia/Shanghai",
        coverage_status: Object.values(preflightMealProgress).every((value) => value !== null)
            ? "complete"
            : "partial",
        nutrients: Object.freeze(preflightMealProgress),
    });
}
function writeMealNutritionProfile(database, idempotencyKey, itemOrder, normalizedName, selection, now) {
    const subjectType = selection.applicable_product_id === null ? "food" : "product";
    const subjectId = selection.applicable_product_id ?? normalizedName;
    const profileId = deriveDomainId("nutrition", subjectType === "product"
        ? `${subjectId}:${selection.profile_version}`
        : canonicalSha256({
            profile_version: selection.profile_version,
            subject_id: subjectId,
            subject_type: subjectType,
        }), 0);
    const coverage = Object.values(selection.nutrients).every((value) => value !== null)
        ? "complete" : "partial";
    const legacyPayloadJson = canonicalJson({
        applicable_product_id: selection.applicable_product_id,
        authority_kind: "diet-manager/nutrition-profile/v1",
        nutrients: selection.nutrients,
        source_ref: selection.source_ref,
        source_type: selection.source_type,
    });
    const payloadJson = canonicalJson({
        ...JSON.parse(legacyPayloadJson),
        basis: selection.basis_kind === null ? null : {
            kind: selection.basis_kind,
            microunits: selection.basis_microunits,
            unit: selection.basis_unit,
        },
    });
    const previous = database.prepare(`SELECT nutrition_profile_id FROM nutrition_profiles
     WHERE schema_version = 'domain/v2' AND subject_type = ? AND subject_id = ?
       AND CAST(profile_version AS INTEGER) < ?
     ORDER BY CAST(profile_version AS INTEGER) DESC LIMIT 1`).get(subjectType, subjectId, selection.profile_version);
    const supersedesProfileId = previous?.nutrition_profile_id ?? null;
    const existing = database.prepare(`SELECT nutrition_profile_id, source_type, source_ref, coverage_status,
            supersedes_profile_id, payload_json
     FROM nutrition_profiles
     WHERE schema_version = 'domain/v2' AND subject_type = ? AND subject_id = ? AND profile_version = ?`).get(subjectType, subjectId, String(selection.profile_version));
    if (existing) {
        const legacyExisting = existing.payload_json === legacyPayloadJson;
        if (existing.nutrition_profile_id !== profileId || existing.source_type !== selection.source_type ||
            existing.source_ref !== selection.source_ref || existing.coverage_status !== coverage ||
            (existing.supersedes_profile_id !== supersedesProfileId &&
                !(legacyExisting && existing.supersedes_profile_id === null)) ||
            existing.payload_json !== payloadJson && existing.payload_json !== legacyPayloadJson)
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:nutrition_profile_conflict");
        return profileId;
    }
    database.prepare(`INSERT INTO nutrition_profiles(
      nutrition_profile_id, schema_version, subject_type, subject_id, profile_version,
      source_type, source_ref, source_version, retrieved_at, coverage_status,
      created_at, supersedes_profile_id, payload_json
    ) VALUES (?, 'domain/v2', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(profileId, subjectType, subjectId, String(selection.profile_version), selection.source_type, selection.source_ref, String(selection.profile_version), now, coverage, now, supersedesProfileId, payloadJson);
    void idempotencyKey;
    void itemOrder;
    return profileId;
}
function writeMealNutritionSnapshot(database, input, event, item, itemPayload, selection, scaledNutrients, profileId, createdAt) {
    const amount = itemPayload.amount;
    const coverage = Object.values(scaledNutrients).every((value) => value !== null)
        ? "complete" : "partial";
    database.prepare(`INSERT INTO nutrition_snapshots(
      snapshot_id, schema_version, meal_event_id, intake_item_id,
      nutrition_profile_id, profile_version, source_type, source_ref,
      coverage_status, created_at, payload_json
    ) VALUES (?, 'domain/v2', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(deriveDomainId("snapshot", input.idempotencyKey, item.item_order), event.event_id, item.item_id, profileId, String(selection.profile_version), selection.source_type, selection.source_ref, coverage, createdAt, canonicalJson({
        amount,
        authority_kind: "diet-manager/nutrition-snapshot/v1",
        basis: selection.basis_kind === null ? null : {
            kind: selection.basis_kind,
            microunits: selection.basis_microunits,
            unit: selection.basis_unit,
        },
        conversion: selection.basis_microunits === null ? null : {
            adopted_microunits: amount.nutrition_adoption_microunits,
            formula: "round_half_up(nutrient*adopted_microunits/basis_microunits)",
        },
        nutrients: scaledNutrients,
        source_nutrients: selection.nutrients,
    }));
}
function writeMealDeduction(database, input, event, item, decision) {
    if (decision.status !== "matched" || !decision.batch_id || !decision.product_id)
        return null;
    const projection = database.prepare(`SELECT payload_json FROM inventory_batch_projections WHERE batch_id = ?`).get(decision.batch_id);
    if (!projection)
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:projection_missing");
    const payload = parseCanonical(projection.payload_json, "projection");
    const current = payload.quantity_microunits;
    const remaining = current - decision.deduction_microunits;
    if (!Number.isSafeInteger(remaining) || remaining < 0) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:negative_inventory");
    }
    const transactionId = deriveDomainId("transaction", input.idempotencyKey, item.item_order);
    const effectId = mealEffectId(input.idempotencyKey, item.item_order, 0);
    database.prepare(`INSERT INTO inventory_transactions(
      transaction_id, event_id, product_id, batch_id, idempotency_key,
      schema_version, direction, reason_code, unit, related_event_id,
      related_transaction_id, source_message_id, conversation_id, received_at,
      committed_at, result_status, lifecycle_status, payload_json
    ) VALUES (?, ?, ?, ?, ?, 'domain/v2', 'out', 'meal_consumption', ?, NULL,
      NULL, ?, ?, ?, ?, 'applied', 'active', ?)`).run(transactionId, event.event_id, decision.product_id, decision.batch_id, effectId, decision.unit, event.source_message_id, event.conversation_id, event.received_at, input.now, canonicalJson({
        authority_kind: "diet-manager/inventory-transaction/v1",
        quantity_after_microunits: remaining,
        quantity_delta_microunits: -decision.deduction_microunits,
        unit: decision.unit,
    }));
    database.prepare(`UPDATE inventory_batch_projections
     SET last_event_id = ?, last_changed_at = ?, quantity_status = ?,
         effective_status = ?, payload_json = ?
     WHERE batch_id = ?`).run(event.event_id, input.now, remaining === 0 ? "empty" : "available", remaining === 0 ? "empty" : "active", canonicalJson({
        authority_kind: "diet-manager/inventory-projection/v1",
        batch_id: decision.batch_id, product_id: decision.product_id,
        quantity_microunits: remaining, unit: decision.unit,
    }), decision.batch_id);
    return transactionId;
}
function writeMealIssue(database, input, event, item, decision) {
    if (!decision.issue_code)
        return;
    database.prepare(`INSERT INTO issues(
      issue_id, issue_code, issue_type, priority, entity_type, entity_id,
      field_path, detected_at, source_message_id, status, revision,
      last_presented_at, resolved_at, resolution_source, resolution_reason,
      resolution_event_id, payload_json
    ) VALUES (?, ?, 'inventory_match', 'normal', 'meal_item', ?, 'inventory', ?, ?,
      'open', 1, NULL, NULL, NULL, NULL, NULL, ?)`).run(deriveDomainId("issue", input.idempotencyKey, item.item_order), decision.issue_code, item.item_id, input.now, event.source_message_id, canonicalJson({ authority_kind: "diet-manager/issue/v1", decision }));
}
function updateMealOutboxes(database, input, itemResults) {
    for (const item of itemResults) {
        if (input.location === "home") {
            const inventoryState = item.inventory_match === "matched" ? "succeeded" : "permanent_business_skip";
            assertEffectTransition("processing", inventoryState);
            database.prepare(`UPDATE effect_outbox SET state = ?, reason = ?, updated_at = ?
         WHERE envelope_id = ? AND operation_id = ? AND effect_id = ?
           AND state = 'processing'`).run(inventoryState, inventoryState === "succeeded" ? null : item.inventory_match, input.now, input.envelopeId, input.operationId, mealEffectId(input.idempotencyKey, item.item_order, 0));
            if (changed(database) !== 1)
                throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:inventory_outbox_compare_and_set");
        }
        assertEffectTransition("processing", "succeeded");
        database.prepare(`UPDATE effect_outbox SET state = 'succeeded', reason = NULL, updated_at = ?
       WHERE envelope_id = ? AND operation_id = ? AND effect_id IN (?, ?)
         AND state = 'processing'`).run(input.now, input.envelopeId, input.operationId, mealEffectId(input.idempotencyKey, item.item_order, 1), mealEffectId(input.idempotencyKey, item.item_order, 2));
        if (changed(database) !== (input.location === "home" ? 2 : 1)) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:item_outbox_compare_and_set");
        }
    }
    assertEffectTransition("processing", "succeeded");
    database.prepare(`UPDATE effect_outbox SET state = 'succeeded', reason = NULL, updated_at = ?
     WHERE envelope_id = ? AND operation_id = ? AND effect_kind = 'daily_progress_contribution'
       AND state = 'processing'`).run(input.now, input.envelopeId, input.operationId);
    if (changed(database) !== 1)
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:progress_outbox_compare_and_set");
}
function claimMealOutboxes(database, input) {
    const states = database.prepare(`SELECT state, COUNT(*) AS count FROM effect_outbox
     WHERE envelope_id = ? AND operation_id = ? GROUP BY state ORDER BY state`).all(input.envelopeId, input.operationId);
    if (states.length === 0 || states.some((row) => row.state !== "pending" && row.state !== "retryable_failed")) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:claim_state");
    }
    for (const row of states) {
        assertEffectTransition(row.state, "processing");
        database.prepare(`UPDATE effect_outbox SET state = 'processing', attempt_count = attempt_count + 1,
         reason = NULL, updated_at = ?
       WHERE envelope_id = ? AND operation_id = ? AND state = ?`).run(input.now, input.envelopeId, input.operationId, row.state);
        if (changed(database) !== Number(row.count)) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:claim_compare_and_set");
        }
    }
}
export function applyRequiredMealInventoryInTransaction(input) {
    const event = input.database.prepare(`SELECT event_id,envelope_id,operation_id,source_message_id,conversation_id,
            received_at,committed_at,occurred_at_text,payload_json
     FROM event_records WHERE envelope_id = ? AND operation_id = ?`).get(input.envelopeId, input.operationId);
    if (!event || event.operation_id !== input.operationId) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:required_inventory_event");
    }
    const eventPayload = validatedMealFactPayload(parseCanonical(event.payload_json, "required_inventory_event"), event.occurred_at_text, "required_inventory_event");
    if (eventPayload.authority_kind !== "diet-manager/meal-fact/v1" || eventPayload.location !== input.location) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:required_inventory_event");
    }
    const items = input.database.prepare(`SELECT item_id,item_order,normalized_name,payload_json
     FROM meal_items WHERE event_id = ? ORDER BY item_order`).all(event.event_id);
    for (const item of items) {
        const payload = parseCanonical(item.payload_json, "required_inventory_item");
        if (!Object.hasOwn(payload, "inventory_plan"))
            continue;
        const plan = parseInventoryAllocationPlan(payload.inventory_plan);
        applyPantryAllocationsInTransaction({
            database: input.database,
            authority_secret: input.authoritySecret,
            event_id: event.event_id,
            source_message_id: event.source_message_id,
            conversation_id: event.conversation_id,
            received_at: event.received_at,
            committed_at: input.now,
            occurred_at: event.occurred_at_text,
            effect_id: mealEffectId(input.idempotencyKey, item.item_order, 0),
            plan,
            ...(input.fault === "after_first_inventory_allocation"
                ? { afterAllocation: (index) => {
                        if (index === 0)
                            throw new Error("MEAL_EFFECT_FAILED:after_first_inventory_allocation");
                    } }
                : {}),
        });
    }
}
function assertExpectedMealFactInput(input) {
    if (!Number.isSafeInteger(input.operationSequence) || input.operationSequence < 0 ||
        input.expectedFact.database !== input.database ||
        input.expectedFact.operationId !== input.operationId ||
        input.expectedFact.sequence !== input.operationSequence ||
        input.expectedFact.event.operationId !== input.operationId ||
        typeof input.expectedFact.dataRevision !== "string" ||
        !input.expectedFact.dataRevision.startsWith("repository-v1:")) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_expected_fact");
    }
}
function assertStoredMealFactMatchesExpectedInTransaction(input) {
    assertExpectedMealFactInput(input);
    const events = input.database.prepare(`SELECT event_id, envelope_id, operation_id, schema_version, event_type, fact_kind,
            source_message_id, conversation_id, received_at, committed_at, occurred_at_text,
            meal_id, meal_slot, payload_json
     FROM event_records WHERE envelope_id = ? AND operation_id = ?`).all(input.envelopeId, input.operationId);
    const event = events[0];
    const expectedEvent = input.expectedFact.event;
    if (events.length !== 1 || !event || event.event_id !== expectedEvent.eventId ||
        event.envelope_id !== input.envelopeId || event.operation_id !== expectedEvent.operationId) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_event");
    }
    if (event.schema_version !== expectedEvent.schemaVersion ||
        event.event_type !== expectedEvent.eventType || event.fact_kind !== expectedEvent.factKind)
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_event_kind");
    if (event.source_message_id !== expectedEvent.sourceMessageId ||
        event.conversation_id !== expectedEvent.conversationId)
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_event_source");
    if (event.received_at !== expectedEvent.receivedAt ||
        event.committed_at !== expectedEvent.committedAt)
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_event_time");
    if (event.occurred_at_text !== expectedEvent.occurredAtText ||
        event.meal_id !== expectedEvent.mealId || event.meal_slot !== expectedEvent.mealSlot)
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_event_meal");
    if (event.occurred_at_text === null) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_event_payload");
    }
    if (expectedEvent.occurredAtText === null) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_expected_fact");
    }
    let parsedPayload;
    try {
        parsedPayload = JSON.parse(event.payload_json);
        if (canonicalJson(parsedPayload) !== event.payload_json) {
            throw new Error("noncanonical");
        }
        validatedMealFactPayload(parsedPayload, event.occurred_at_text, "terminal_event_payload");
        validateAndFreezeMealFactPayload(expectedEvent.payload, {
            occurredAt: expectedEvent.occurredAtText,
            path: "terminal_expected_event_payload",
        });
    }
    catch {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_event_payload");
    }
    if (event.payload_json !== canonicalJson(expectedEvent.payload)) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_event_payload");
    }
    const items = input.database.prepare(`SELECT item_id, item_order, item_type, normalized_name, payload_json FROM meal_items
     WHERE event_id = ? ORDER BY item_order, item_id`).all(event.event_id);
    if (items.length === 0 || items.length !== input.expectedFact.items.length) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_items");
    }
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const expectedItem = input.expectedFact.items[index];
        if (!expectedItem || item.item_id !== expectedItem.itemId ||
            item.item_order !== expectedItem.itemOrder || item.item_type !== expectedItem.itemType ||
            item.normalized_name !== expectedItem.normalizedName ||
            item.payload_json !== canonicalJson(expectedItem.payload))
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_item");
    }
}
/** Authenticate an already-stored immutable meal Fact without writing. */
export function assertStoredMealFactMatchesExpected(input) {
    let transactionOpen = false;
    try {
        input.database.exec("BEGIN DEFERRED");
        transactionOpen = true;
        assertCurrentMigrationAuthority(input.database);
        assertStoredMealFactMatchesExpectedInTransaction(input);
        input.database.exec("ROLLBACK");
        transactionOpen = false;
    }
    catch (error) {
        if (transactionOpen) {
            try {
                input.database.exec("ROLLBACK");
            }
            catch { /* preserve primary */ }
        }
        throw error;
    }
}
function freezeStoredNutritionVector(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
    }
    const record = value;
    exactKeys(record, [
        "energy_kcal_milli",
        "protein_mg",
        "fat_mg",
        "carbohydrate_mg",
        "fiber_mg",
        "water_ml_milli",
    ], label);
    for (const candidate of Object.values(record)) {
        if (candidate !== null && (!Number.isSafeInteger(candidate) || candidate < 0)) {
            throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
        }
    }
    return Object.freeze({
        energy_kcal_milli: record.energy_kcal_milli,
        protein_mg: record.protein_mg,
        fat_mg: record.fat_mg,
        carbohydrate_mg: record.carbohydrate_mg,
        fiber_mg: record.fiber_mg,
        water_ml_milli: record.water_ml_milli,
    });
}
function readAppliedMealResultInTransaction(input, checkpoint) {
    if (checkpoint.operation_id !== input.operationId || checkpoint.completed_at === null ||
        !(checkpoint.effect_state === "succeeded" && checkpoint.result_status === "applied" ||
            checkpoint.effect_state === "permanent_business_skip" &&
                checkpoint.result_status === "applied_with_issues")) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_checkpoint");
    }
    const bundle = parseCanonical(checkpoint.payload_json, "terminal_checkpoint");
    exactKeys(bundle, ["authority_kind", "data_revision", "effects", "operation_sequence"], "terminal_checkpoint");
    if (bundle.authority_kind !== "diet-manager/effect-bundle/v1" ||
        bundle.operation_sequence !== input.operationSequence ||
        typeof bundle.data_revision !== "string" ||
        !bundle.data_revision.startsWith("repository-v1:") ||
        !Array.isArray(bundle.effects)) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_checkpoint");
    }
    const event = input.database.prepare(`SELECT * FROM event_records WHERE envelope_id = ? AND operation_id = ?`).get(input.envelopeId, input.operationId);
    if (!event)
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_event");
    const parsedEventPayload = parseCanonical(event.payload_json, "terminal_event");
    const eventPayload = validatedMealFactPayload(parsedEventPayload, event.occurred_at_text, "terminal_event");
    reservationFromEventPayload(eventPayload, "diet_meal");
    if (eventPayload.authority_kind !== "diet-manager/meal-fact/v1" ||
        eventPayload.location !== input.location) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_event");
    }
    const items = input.database.prepare(`SELECT item_id, item_order, normalized_name, payload_json FROM meal_items
     WHERE event_id = ? ORDER BY item_order`).all(event.event_id);
    const outboxes = input.database.prepare(`SELECT effect_id, effect_kind, state FROM effect_outbox
     WHERE envelope_id = ? AND operation_id = ? ORDER BY effect_id`).all(input.envelopeId, input.operationId);
    if (bundle.effects.length !== outboxes.length) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_effects");
    }
    let dailyProgress = null;
    bundle.effects.forEach((candidate, index) => {
        if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_effects");
        }
        const effect = candidate;
        const outbox = outboxes[index];
        if (!outbox || effect.effect_id !== outbox.effect_id || effect.state !== outbox.state) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_effects");
        }
        if (outbox.effect_kind === "daily_progress_contribution") {
            exactKeys(effect, ["contribution", "effect_id", "state"], "terminal_progress_effect");
            if (dailyProgress !== null || typeof effect.contribution !== "object" ||
                effect.contribution === null || Array.isArray(effect.contribution)) {
                throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_progress_effect");
            }
            const progress = effect.contribution;
            exactKeys(progress, ["coverage_status", "date", "nutrients", "timezone"], "terminal_progress");
            if (typeof progress.date !== "string" || progress.timezone !== "Asia/Shanghai" ||
                (progress.coverage_status !== "complete" && progress.coverage_status !== "partial")) {
                throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_progress");
            }
            dailyProgress = Object.freeze({
                date: progress.date,
                timezone: "Asia/Shanghai",
                coverage_status: progress.coverage_status,
                nutrients: freezeStoredNutritionVector(progress.nutrients, "terminal_progress_nutrients"),
            });
        }
        else {
            exactKeys(effect, ["effect_id", "state"], "terminal_effects");
        }
    });
    if (dailyProgress === null) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_progress_missing");
    }
    const results = items.map((item) => {
        const itemPayload = parseCanonical(item.payload_json, "terminal_item");
        if (typeof itemPayload.amount !== "object" || itemPayload.amount === null ||
            Array.isArray(itemPayload.amount)) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_item");
        }
        const amount = storedStructuredAmount(itemPayload.amount, "terminal_item_amount");
        const pantryPlan = Object.hasOwn(itemPayload, "inventory_plan")
            ? parseInventoryAllocationPlan(itemPayload.inventory_plan)
            : null;
        const snapshots = input.database.prepare(`SELECT source_type, profile_version, payload_json FROM nutrition_snapshots
       WHERE intake_item_id = ? AND schema_version = 'domain/v2' ORDER BY snapshot_id`).all(item.item_id);
        if (snapshots.length !== 1) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_snapshot");
        }
        const snapshot = snapshots[0];
        const snapshotPayload = parseCanonical(snapshot.payload_json, "terminal_snapshot");
        exactKeys(snapshotPayload, [
            "amount", "authority_kind", "basis", "conversion", "nutrients", "source_nutrients",
        ], "terminal_snapshot");
        if (snapshotPayload.authority_kind !== "diet-manager/nutrition-snapshot/v1" ||
            canonicalJson(snapshotPayload.amount) !== canonicalJson(amount)) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_snapshot");
        }
        const issues = input.database.prepare(`SELECT issue_code FROM issues WHERE entity_type = 'meal_item' AND entity_id = ?
       ORDER BY issue_id`).all(item.item_id);
        if (issues.length > 1)
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_issues");
        const issueCodes = Object.freeze(issues.map((issue) => issue.issue_code));
        if (pantryPlan !== null &&
            canonicalJson(issueCodes) !== canonicalJson(pantryPlan.issue_code === null ? [] : [pantryPlan.issue_code]))
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_issues");
        const transactions = input.database.prepare(`SELECT transaction_id, product_id, batch_id, direction, reason_code, unit,
              result_status, lifecycle_status, payload_json
       FROM inventory_transactions
       WHERE event_id = ? AND idempotency_key = ? ORDER BY rowid`).all(event.event_id, mealEffectId(input.idempotencyKey, item.item_order, 0));
        let terminalAllocations = null;
        if (pantryPlan === null) {
            if (transactions.length > 1) {
                throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_transaction");
            }
        }
        else {
            if (transactions.length !== pantryPlan.allocations.length) {
                throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_transaction");
            }
            terminalAllocations = Object.freeze(pantryPlan.allocations.map((allocation, index) => {
                const transaction = transactions[index];
                const expectedTransactionId = deriveDomainId("transaction", mealEffectId(input.idempotencyKey, item.item_order, 0), index);
                const expectedPayload = canonicalJson({
                    allocation_index: index,
                    authority_kind: "diet-manager/inventory-transaction/v2",
                    quantity_after_microunits: allocation.after_microunits,
                    quantity_delta_microunits: -allocation.deducted_microunits,
                    selection_basis: allocation.selection_basis,
                    unit: allocation.unit,
                });
                if (!transaction || transaction.transaction_id !== expectedTransactionId ||
                    transaction.product_id !== allocation.product_id || transaction.batch_id !== allocation.batch_id ||
                    transaction.direction !== "out" || transaction.reason_code !== "meal_consumption" ||
                    transaction.unit !== allocation.unit || transaction.result_status !== "applied" ||
                    transaction.lifecycle_status !== "active" || transaction.payload_json !== expectedPayload)
                    throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_transaction");
                return Object.freeze({ transaction_id: transaction.transaction_id, ...allocation });
            }));
        }
        const transactionId = transactions[0]?.transaction_id ?? null;
        const inventoryMatch = pantryPlan !== null
            ? pantryPlan.status
            : transactionId !== null
                ? "matched"
                : issueCodes[0] === "inventory_amount_unknown"
                    ? "skipped_amount_unknown"
                    : input.location === "outside"
                        ? "skipped_outside"
                        : issueCodes[0] === "inventory_multiple_candidates"
                            ? "skipped_ambiguous"
                            : issueCodes[0] === "inventory_insufficient"
                                ? "skipped_insufficient"
                                : issueCodes[0] === "inventory_unit_incompatible"
                                    ? "skipped_unit_incompatible"
                                    : (() => { throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_inventory"); })();
        const profileVersion = Number(snapshot.profile_version);
        if (!Number.isSafeInteger(profileVersion) || profileVersion < 1) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_snapshot");
        }
        if (Object.hasOwn(itemPayload, "nutrition_evidence")) {
            assertNutritionRecordsPersisted(input.database, [v11NutritionRecords(event.operation_id, event.event_id, event.committed_at, item, itemPayload.nutrition_evidence)]);
        }
        const adoption = amount.nutrition_adoption_microunits;
        const deduction = amount.inventory_deduction_microunits;
        return Object.freeze({
            item_order: item.item_order,
            normalized_name: item.normalized_name,
            unit: String(amount.unit),
            inventory_match: inventoryMatch,
            inventory_transaction_id: transactionId,
            ...(terminalAllocations === null ? {} : {
                inventory_transaction_ids: Object.freeze(terminalAllocations.map(({ transaction_id }) => transaction_id)),
                inventory_allocations: terminalAllocations,
            }),
            issue_codes: issueCodes,
            observed_microunits: amount.observed_microunits,
            ...(amount.observed_microunits === null
                ? { amount_evidence: "unknown" }
                : {}),
            nutrition_adoption_microunits: adoption,
            inventory_deduction_microunits: deduction,
            estimated_fields: Object.freeze(amount.evidence === "estimated_upper_bound"
                ? ["nutrition_adoption_microunits"] : []),
            nutrition_source_type: snapshot.source_type,
            nutrition_profile_version: profileVersion,
            nutrients: freezeStoredNutritionVector(snapshotPayload.nutrients, "terminal_snapshot_nutrients"),
        });
    });
    const issueCodes = Object.freeze(results.flatMap((result) => [...result.issue_codes]));
    const hasIssues = checkpoint.result_status === "applied_with_issues";
    if (hasIssues !== (issueCodes.length > 0) || results.length === 0) {
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_status");
    }
    return Object.freeze({
        sequence: input.operationSequence,
        operation_id: input.operationId,
        status: hasIssues ? "committed_with_issues" : "committed",
        error_code: null,
        fact_status: "committed",
        inventory_match: results[0].inventory_match,
        inventory_transaction_id: results[0].inventory_transaction_id,
        issue_codes: issueCodes,
        meal_items: Object.freeze(results),
        daily_progress: dailyProgress,
        daily_progress_by_date: Object.freeze([dailyProgress]),
    });
}
/**
 * Reconstruct a meal result from its terminal effect bundle without claiming
 * or writing an outbox. The bundle revision is immutable terminal evidence;
 * the prepared Fact carries the separately authorized execution binding, so
 * unrelated later commits cannot prevent finalization recovery.
 */
export function readAppliedMealResult(input) {
    let transactionOpen = false;
    try {
        input.database.exec("BEGIN");
        transactionOpen = true;
        assertCurrentMigrationAuthority(input.database);
        assertStoredMealFactMatchesExpectedInTransaction(input);
        const checkpoints = input.database.prepare(`SELECT operation_id, effect_state, result_status, completed_at, payload_json
       FROM effect_bundle_commits WHERE envelope_id = ? AND operation_id = ?`).all(input.envelopeId, input.operationId);
        if (checkpoints.length !== 1) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_checkpoint");
        }
        const checkpoint = checkpoints[0];
        const bundle = parseCanonical(checkpoint.payload_json, "terminal_checkpoint");
        exactKeys(bundle, ["authority_kind", "data_revision", "effects", "operation_sequence"], "terminal_checkpoint");
        if (bundle.authority_kind !== "diet-manager/effect-bundle/v1" ||
            typeof bundle.data_revision !== "string" ||
            !bundle.data_revision.startsWith("repository-v1:") ||
            bundle.operation_sequence !== input.operationSequence || !Array.isArray(bundle.effects)) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_checkpoint");
        }
        const expectedEffects = [...input.expectedFact.effects].sort((left, right) => left.effectId.localeCompare(right.effectId));
        const outboxes = input.database.prepare(`SELECT outbox_id, effect_id, effect_kind, state FROM effect_outbox
       WHERE envelope_id = ? AND operation_id = ? ORDER BY effect_id`).all(input.envelopeId, input.operationId);
        if (outboxes.length !== expectedEffects.length || bundle.effects.length !== expectedEffects.length) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_effects");
        }
        for (let index = 0; index < expectedEffects.length; index += 1) {
            const expectedEffect = expectedEffects[index];
            const outbox = outboxes[index];
            const bundled = bundle.effects[index];
            if (!expectedEffect || !outbox || typeof bundled !== "object" || bundled === null ||
                Array.isArray(bundled) || outbox.outbox_id !== expectedEffect.outboxId ||
                outbox.effect_id !== expectedEffect.effectId || outbox.effect_kind !== expectedEffect.effectKind ||
                (outbox.state !== "succeeded" && outbox.state !== "permanent_business_skip")) {
                throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_effects");
            }
            const bundledEffect = bundled;
            exactKeys(bundledEffect, expectedEffect.effectKind === "daily_progress_contribution"
                ? ["contribution", "effect_id", "state"]
                : ["effect_id", "state"], "terminal_effects");
            if (bundledEffect.effect_id !== outbox.effect_id || bundledEffect.state !== outbox.state) {
                throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_effects");
            }
        }
        const result = readAppliedMealResultInTransaction(input, checkpoint);
        input.database.exec("COMMIT");
        transactionOpen = false;
        return result;
    }
    catch (error) {
        if (transactionOpen) {
            try {
                input.database.exec("ROLLBACK");
            }
            catch { /* preserve primary error */ }
        }
        throw error;
    }
}
export function applyMealEffects(input) {
    let transactionOpen = false;
    try {
        input.database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        assertCurrentMigrationAuthority(input.database);
        const checkpoint = input.database.prepare(`SELECT operation_id, effect_state, result_status, completed_at, payload_json
       FROM effect_bundle_commits WHERE envelope_id = ? AND operation_id = ?`).get(input.envelopeId, input.operationId);
        if (!checkpoint)
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:checkpoint");
        if (checkpoint.effect_state !== "pending") {
            const replay = readAppliedMealResultInTransaction(input, checkpoint);
            input.database.exec("ROLLBACK");
            transactionOpen = false;
            return replay;
        }
        assertPendingMealCheckpoint(input.database, checkpoint, input.envelopeId, input.operationId, input.operationSequence, input.idempotencyKey, input.location);
        const checkpointPayload = parseCanonical(checkpoint.payload_json, "checkpoint");
        if (checkpointPayload.data_revision !== computeRepositoryDataRevision(input.database)) {
            throw new Error("PREVIEW_STALE:data_revision");
        }
        claimMealOutboxes(input.database, input);
        const event = input.database.prepare(`SELECT * FROM event_records WHERE envelope_id = ? AND operation_id = ?`).get(input.envelopeId, input.operationId);
        if (!event)
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:event");
        const parsedEventPayload = parseCanonical(event.payload_json, "event");
        const eventPayload = validatedMealFactPayload(parsedEventPayload, event.occurred_at_text, "event_payload");
        reservationFromEventPayload(eventPayload, "diet_meal");
        if (eventPayload.authority_kind !== "diet-manager/meal-fact/v1" || eventPayload.location !== input.location) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:event_payload");
        }
        const items = input.database.prepare(`SELECT item_id, item_order, normalized_name, payload_json FROM meal_items
       WHERE event_id = ? ORDER BY item_order`).all(event.event_id);
        const date = toNaturalDate(event.occurred_at_text, "Asia/Shanghai");
        const generatedAt = input.now;
        const results = [];
        let progress = {
            energy_kcal_milli: 0, protein_mg: 0, fat_mg: 0,
            carbohydrate_mg: 0, fiber_mg: 0, water_ml_milli: 0,
        };
        for (const item of items) {
            const payload = parseCanonical(item.payload_json, "item");
            if (payload.authority_kind !== "diet-manager/meal-item/v1" || typeof payload.amount !== "object" || payload.amount === null) {
                throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:item_payload");
            }
            const amount = storedStructuredAmount(payload.amount, "item_amount");
            const adoptionValue = amount.nutrition_adoption_microunits;
            const deductionValue = amount.inventory_deduction_microunits;
            const adoptedMicrounits = adoptionValue;
            const deductionMicrounits = deductionValue;
            const pantryPlan = Object.hasOwn(payload, "inventory_plan")
                ? parseInventoryAllocationPlan(payload.inventory_plan)
                : null;
            const candidates = pantryPlan !== null || input.location === "outside" || deductionMicrounits === null
                ? []
                : inventoryCandidates(input.database, item.normalized_name);
            const decision = pantryPlan === null
                ? resolveInventoryMatch({
                    location: input.location,
                    requested_unit: amount.unit,
                    observed_microunits: amount.observed_microunits,
                    nutrition_adoption_microunits: adoptedMicrounits,
                    inventory_deduction_microunits: deductionMicrounits,
                    template_reference_microunits: amount.template_reference_microunits,
                    candidates,
                })
                : allocationDecision(pantryPlan);
            const selection = selectMealNutrition(payload, decision);
            const scaledNutrients = adoptedMicrounits === null
                ? Object.freeze({
                    energy_kcal_milli: null, protein_mg: null, fat_mg: null,
                    carbohydrate_mg: null, fiber_mg: null, water_ml_milli: null,
                })
                : selection.basis_microunits === null
                    ? selection.nutrients
                    : scaleNutritionVector(selection.nutrients, adoptedMicrounits, selection.basis_microunits);
            const profileId = writeMealNutritionProfile(input.database, input.idempotencyKey, item.item_order, item.normalized_name, selection, generatedAt);
            writeMealNutritionSnapshot(input.database, input, event, item, payload, selection, scaledNutrients, profileId, generatedAt);
            if (Object.hasOwn(payload, "nutrition_evidence")) {
                const records = v11NutritionRecords(event.operation_id, event.event_id, event.committed_at, item, payload.nutrition_evidence);
                persistNutritionRecords(input.database, [records]);
                assertNutritionRecordsPersisted(input.database, [records]);
            }
            if (input.fault === "after_nutrition") {
                throw new Error("NUTRITION_EFFECT_WRITE_FAILED:after_nutrition");
            }
            const allocations = pantryPlan === null
                ? Object.freeze([])
                : applyPantryAllocationsInTransaction({
                    database: input.database,
                    authority_secret: input.authoritySecret,
                    event_id: event.event_id,
                    source_message_id: event.source_message_id,
                    conversation_id: event.conversation_id,
                    received_at: event.received_at,
                    committed_at: input.now,
                    occurred_at: event.occurred_at_text,
                    effect_id: mealEffectId(input.idempotencyKey, item.item_order, 0),
                    plan: pantryPlan,
                    ...(input.fault === "after_first_inventory_allocation"
                        ? { afterAllocation: (index) => {
                                if (index === 0)
                                    throw new Error("MEAL_EFFECT_FAILED:after_first_inventory_allocation");
                            } }
                        : {}),
                });
            const transactionId = pantryPlan === null
                ? writeMealDeduction(input.database, input, event, item, decision)
                : allocations[0]?.transaction_id ?? null;
            writeMealIssue(input.database, input, event, item, pantryPlan ?? decision);
            const issueCode = pantryPlan?.issue_code ?? decision.issue_code;
            if (input.fault === "after_issue_write") {
                throw new Error("MEAL_EFFECT_FAILED:after_issue_write");
            }
            progress = addNutritionVectors(progress, scaledNutrients);
            results.push(Object.freeze({
                item_order: item.item_order,
                normalized_name: item.normalized_name,
                unit: amount.unit,
                inventory_match: pantryPlan?.status ?? decision.status,
                inventory_transaction_id: transactionId,
                ...(pantryPlan === null ? {} : {
                    inventory_transaction_ids: Object.freeze(allocations.map(({ transaction_id }) => transaction_id)),
                    inventory_allocations: allocations,
                }),
                issue_codes: Object.freeze(issueCode === null ? [] : [issueCode]),
                observed_microunits: amount.observed_microunits,
                ...(amount.observed_microunits === null
                    ? { amount_evidence: "unknown" }
                    : {}),
                nutrition_adoption_microunits: adoptedMicrounits,
                inventory_deduction_microunits: deductionMicrounits,
                estimated_fields: Object.freeze(amount.evidence === "estimated_upper_bound"
                    ? ["nutrition_adoption_microunits"] : []),
                nutrition_source_type: selection.source_type,
                nutrition_profile_version: selection.profile_version,
                nutrients: scaledNutrients,
            }));
            if (input.fault === "after_first_item" && item.item_order === 0) {
                throw new Error("MEAL_EFFECT_FAILED:after_first_item");
            }
        }
        const coverage = Object.values(progress).every((value) => value !== null) ? "complete" : "partial";
        const dailyProgress = Object.freeze({
            date, timezone: "Asia/Shanghai", coverage_status: coverage,
            nutrients: Object.freeze(progress),
        });
        if (input.fault === "after_progress_contribution_prepared") {
            throw new Error("MEAL_EFFECT_FAILED:after_progress_contribution_prepared");
        }
        updateMealOutboxes(input.database, input, results);
        const effectRows = input.database.prepare(`SELECT effect_id, effect_kind, state FROM effect_outbox
       WHERE envelope_id = ? AND operation_id = ? ORDER BY effect_id`).all(input.envelopeId, input.operationId);
        if (effectRows.some((effect) => effect.state !== "succeeded" && effect.state !== "permanent_business_skip"))
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_effects");
        const effects = effectRows.map((effect) => effect.effect_kind === "daily_progress_contribution"
            ? Object.freeze({
                contribution: dailyProgress,
                effect_id: effect.effect_id,
                state: effect.state,
            })
            : Object.freeze({ effect_id: effect.effect_id, state: effect.state }));
        const hasIssues = results.some((result) => result.issue_codes.length > 0);
        input.database.prepare(`UPDATE effect_bundle_commits
       SET effect_state = ?, result_status = ?, completed_at = ?, payload_json = ?
       WHERE envelope_id = ? AND operation_id = ? AND effect_state = 'pending'`).run(hasIssues ? "permanent_business_skip" : "succeeded", hasIssues ? "applied_with_issues" : "applied", input.now, canonicalJson({
            authority_kind: "diet-manager/effect-bundle/v1",
            data_revision: computeRepositoryDataRevision(input.database),
            effects,
            operation_sequence: input.operationSequence,
        }), input.envelopeId, input.operationId);
        if (changed(input.database) !== 1) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:bundle_compare_and_set");
        }
        const issueCodes = Object.freeze(results.flatMap((result) => [...result.issue_codes]));
        const operationResult = Object.freeze({
            sequence: input.operationSequence,
            operation_id: input.operationId,
            status: hasIssues ? "committed_with_issues" : "committed",
            error_code: null,
            fact_status: "committed",
            inventory_match: results[0].inventory_match,
            inventory_transaction_id: results[0].inventory_transaction_id,
            issue_codes: issueCodes,
            meal_items: Object.freeze(results),
            daily_progress: dailyProgress,
            daily_progress_by_date: Object.freeze([dailyProgress]),
        });
        input.database.exec("COMMIT");
        transactionOpen = false;
        return operationResult;
    }
    catch (error) {
        if (transactionOpen) {
            try {
                input.database.exec("ROLLBACK");
            }
            catch { /* preserve primary */ }
        }
        throw error;
    }
}
function assertPendingWaterAuthority(input) {
    const checkpoint = input.database.prepare(`SELECT effect_state, result_status, completed_at, payload_json FROM effect_bundle_commits
     WHERE envelope_id = ? AND operation_id = ?`).get(input.envelopeId, input.operationId);
    if (!checkpoint || checkpoint.effect_state !== "pending" || checkpoint.result_status !== "facts_committed_effects_pending" || checkpoint.completed_at !== null) {
        throw new Error("WATER_EFFECT_AUTHORITY_INVALID:checkpoint");
    }
    const bundle = parseCanonical(checkpoint.payload_json, "water_checkpoint");
    exactKeys(bundle, ["authority_kind", "data_revision", "effects", "operation_sequence"], "water_checkpoint");
    if (bundle.authority_kind !== "diet-manager/effect-bundle-checkpoint/v1" || bundle.operation_sequence !== input.operationSequence ||
        bundle.data_revision !== computeRepositoryDataRevision(input.database) || !Array.isArray(bundle.effects) || bundle.effects.length !== 1) {
        throw new Error("WATER_EFFECT_AUTHORITY_INVALID:checkpoint");
    }
    const effectId = deriveDomainId("effect", input.idempotencyKey, 9);
    const outboxId = deriveDomainId("outbox", input.idempotencyKey, 9);
    const expected = bundle.effects[0];
    if (typeof expected !== "object" || expected === null || Array.isArray(expected))
        throw new Error("WATER_EFFECT_AUTHORITY_INVALID:checkpoint");
    exactKeys(expected, ["effect_id", "state"], "water_checkpoint");
    const outboxes = input.database.prepare(`SELECT outbox_id, effect_id, effect_kind, state FROM effect_outbox WHERE envelope_id = ? AND operation_id = ?`).all(input.envelopeId, input.operationId);
    if (outboxes.length !== 1 || outboxes[0]?.outbox_id !== outboxId || outboxes[0].effect_id !== effectId ||
        outboxes[0].effect_kind !== "daily_progress_contribution" ||
        (outboxes[0].state !== "pending" && outboxes[0].state !== "retryable_failed") ||
        expected.effect_id !== effectId || expected.state !== "pending") {
        throw new Error("WATER_EFFECT_AUTHORITY_INVALID:outbox");
    }
    return Object.freeze({ effectId });
}
export function assertStoredWaterFactMatchesExpected(input) {
    let transactionOpen = false;
    try {
        input.database.exec("BEGIN DEFERRED");
        transactionOpen = true;
        assertCurrentMigrationAuthority(input.database);
        const row = input.database.prepare(`SELECT event_id, operation_id, schema_version, event_type, fact_kind, source_message_id,
       conversation_id, received_at, committed_at, occurred_at_text, meal_id, meal_slot, payload_json
       FROM event_records WHERE envelope_id = ? AND operation_id = ?`).get(input.envelopeId, input.operationId);
        const expected = input.expectedFact.event;
        if (!row || Object.entries({
            event_id: expected.eventId, operation_id: expected.operationId, schema_version: expected.schemaVersion,
            event_type: expected.eventType, fact_kind: expected.factKind, source_message_id: expected.sourceMessageId,
            conversation_id: expected.conversationId, received_at: expected.receivedAt, committed_at: expected.committedAt,
            occurred_at_text: expected.occurredAtText, meal_id: null, meal_slot: null,
        }).some(([key, value]) => row[key] !== value) || row.payload_json !== canonicalJson(expected.payload)) {
            throw new Error("WATER_EFFECT_AUTHORITY_INVALID:stored_fact");
        }
        const items = input.database.prepare("SELECT COUNT(*) AS count FROM meal_items WHERE event_id = ?").get(expected.eventId);
        if (items.count !== 0)
            throw new Error("WATER_EFFECT_AUTHORITY_INVALID:stored_items");
        input.database.exec("ROLLBACK");
        transactionOpen = false;
    }
    catch (error) {
        if (transactionOpen) {
            try {
                input.database.exec("ROLLBACK");
            }
            catch { /* preserve primary */ }
        }
        throw error;
    }
}
function waterProgressFromStoredFact(database, envelopeId, operationId) {
    const event = database.prepare(`SELECT event_type, fact_kind, occurred_at_text, meal_id, meal_slot, payload_json
     FROM event_records WHERE envelope_id = ? AND operation_id = ?`).get(envelopeId, operationId);
    if (!event || event.event_type !== "diet_water" || event.fact_kind !== "water" ||
        event.occurred_at_text === null || event.meal_id !== null || event.meal_slot !== null)
        throw new Error("WATER_EFFECT_AUTHORITY_INVALID:event");
    const payload = parseCanonical(event.payload_json, "water_event");
    exactKeys(payload, Object.hasOwn(payload, "progress_reservation")
        ? ["amount_evidence", "authority_kind", "estimated", "occurred_time", "plain_water_ml_milli", "progress_reservation", "source_text", "timezone"]
        : ["amount_evidence", "authority_kind", "estimated", "occurred_time", "plain_water_ml_milli", "source_text", "timezone"], "water_event");
    if (payload.authority_kind !== "diet-manager/water-fact/v1" || payload.estimated !== false ||
        payload.timezone !== "Asia/Shanghai" || typeof payload.source_text !== "string" ||
        !Number.isSafeInteger(payload.plain_water_ml_milli) || payload.plain_water_ml_milli <= 0)
        throw new Error("WATER_EFFECT_AUTHORITY_INVALID:payload");
    try {
        validateAndFreezeOccurredTimeEvidence(payload.occurred_time, {
            occurredAt: event.occurred_at_text,
            path: "water_event.occurred_time",
            requireExact: true,
        });
    }
    catch {
        throw new Error("WATER_EFFECT_AUTHORITY_INVALID:payload");
    }
    return Object.freeze({
        date: toNaturalDate(event.occurred_at_text, "Asia/Shanghai"),
        timezone: "Asia/Shanghai",
        coverage_status: "partial",
        nutrients: Object.freeze({
            energy_kcal_milli: null,
            protein_mg: null,
            fat_mg: null,
            carbohydrate_mg: null,
            fiber_mg: null,
            water_ml_milli: payload.plain_water_ml_milli,
        }),
    });
}
function waterResult(input, progress) {
    return Object.freeze({
        sequence: input.operationSequence,
        operation_id: input.operationId,
        status: "committed",
        error_code: null,
        fact_status: "committed",
        daily_progress: progress,
        daily_progress_by_date: Object.freeze([progress]),
    });
}
export function applyWaterEffects(input) {
    let transactionOpen = false;
    try {
        input.database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        assertCurrentMigrationAuthority(input.database);
        const checkpoint = input.database.prepare(`SELECT effect_state, result_status, completed_at, payload_json
       FROM effect_bundle_commits WHERE envelope_id = ? AND operation_id = ?`).get(input.envelopeId, input.operationId);
        if (!checkpoint)
            throw new Error("WATER_EFFECT_AUTHORITY_INVALID:checkpoint");
        const progress = waterProgressFromStoredFact(input.database, input.envelopeId, input.operationId);
        if (checkpoint.effect_state !== "pending") {
            if (checkpoint.effect_state !== "succeeded" || checkpoint.result_status !== "applied" || checkpoint.completed_at === null) {
                throw new Error("WATER_EFFECT_AUTHORITY_INVALID:checkpoint_state");
            }
            const bundle = parseCanonical(checkpoint.payload_json, "water_terminal");
            exactKeys(bundle, ["authority_kind", "data_revision", "effects", "operation_sequence"], "water_terminal");
            const effectId = deriveDomainId("effect", input.idempotencyKey, 9);
            const outboxId = deriveDomainId("outbox", input.idempotencyKey, 9);
            if (bundle.authority_kind !== "diet-manager/effect-bundle/v1" ||
                typeof bundle.data_revision !== "string" || !/^repository-v1:[A-F0-9]{64}$/.test(bundle.data_revision) ||
                bundle.operation_sequence !== input.operationSequence ||
                !Array.isArray(bundle.effects) || bundle.effects.length !== 1) {
                throw new Error("WATER_EFFECT_AUTHORITY_INVALID:terminal_bundle");
            }
            const effect = bundle.effects[0];
            if (typeof effect !== "object" || effect === null || Array.isArray(effect))
                throw new Error("WATER_EFFECT_AUTHORITY_INVALID:terminal_bundle");
            exactKeys(effect, ["contribution", "effect_id", "state"], "water_terminal");
            const outboxes = input.database.prepare("SELECT outbox_id, effect_id, effect_kind, state FROM effect_outbox WHERE envelope_id = ? AND operation_id = ?").all(input.envelopeId, input.operationId);
            if (outboxes.length !== 1 || outboxes[0]?.outbox_id !== outboxId || outboxes[0].effect_id !== effectId ||
                outboxes[0].effect_kind !== "daily_progress_contribution" || outboxes[0].state !== "succeeded" ||
                effect.effect_id !== effectId || effect.state !== "succeeded" || canonicalJson(effect.contribution) !== canonicalJson(progress)) {
                throw new Error("WATER_EFFECT_AUTHORITY_INVALID:terminal_bundle");
            }
            input.database.exec("ROLLBACK");
            transactionOpen = false;
            return waterResult(input, progress);
        }
        const authority = assertPendingWaterAuthority(input);
        const outbox = input.database.prepare("SELECT state FROM effect_outbox WHERE envelope_id = ? AND operation_id = ?").get(input.envelopeId, input.operationId);
        assertEffectTransition(outbox.state, "processing");
        input.database.prepare(`UPDATE effect_outbox SET state = 'processing', attempt_count = attempt_count + 1,
       reason = NULL, updated_at = ? WHERE envelope_id = ? AND operation_id = ?
       AND state = ?`).run(input.now, input.envelopeId, input.operationId, outbox.state);
        if (changed(input.database) !== 1)
            throw new Error("WATER_EFFECT_AUTHORITY_INVALID:claim");
        if (input.fault === "after_progress_contribution_prepared") {
            throw new Error("WATER_EFFECT_FAILED:after_progress_contribution_prepared");
        }
        assertEffectTransition("processing", "succeeded");
        input.database.prepare(`UPDATE effect_outbox SET state = 'succeeded', reason = NULL, updated_at = ?
       WHERE envelope_id = ? AND operation_id = ? AND state = 'processing'`).run(input.now, input.envelopeId, input.operationId);
        if (changed(input.database) !== 1)
            throw new Error("WATER_EFFECT_AUTHORITY_INVALID:complete");
        input.database.prepare(`UPDATE effect_bundle_commits SET effect_state = 'succeeded', result_status = 'applied',
       completed_at = ?, payload_json = ? WHERE envelope_id = ? AND operation_id = ?
       AND effect_state = 'pending'`).run(input.now, canonicalJson({
            authority_kind: "diet-manager/effect-bundle/v1",
            data_revision: computeRepositoryDataRevision(input.database),
            effects: [{ contribution: progress, effect_id: authority.effectId, state: "succeeded" }],
            operation_sequence: input.operationSequence,
        }), input.envelopeId, input.operationId);
        if (changed(input.database) !== 1)
            throw new Error("WATER_EFFECT_AUTHORITY_INVALID:bundle");
        input.database.exec("COMMIT");
        transactionOpen = false;
        return waterResult(input, progress);
    }
    catch (error) {
        if (transactionOpen) {
            try {
                input.database.exec("ROLLBACK");
            }
            catch { /* preserve primary error */ }
        }
        throw error;
    }
}
export function markWaterEffectsRetryable(input) {
    let transactionOpen = false;
    try {
        input.database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        assertCurrentMigrationAuthority(input.database);
        assertPendingWaterAuthority(input);
        assertEffectTransition("pending", "processing");
        input.database.prepare(`UPDATE effect_outbox SET state = 'processing', attempt_count = attempt_count + 1, reason = NULL, updated_at = ?
       WHERE envelope_id = ? AND operation_id = ? AND state = 'pending'`).run(input.now, input.envelopeId, input.operationId);
        if (changed(input.database) !== 1)
            throw new Error("WATER_EFFECT_AUTHORITY_INVALID:retry_claim");
        assertEffectTransition("processing", "retryable_failed");
        input.database.prepare(`UPDATE effect_outbox SET state = 'retryable_failed', reason = ?, updated_at = ?
       WHERE envelope_id = ? AND operation_id = ? AND state = 'processing'`).run(input.errorCode, input.now, input.envelopeId, input.operationId);
        if (changed(input.database) !== 1)
            throw new Error("WATER_EFFECT_AUTHORITY_INVALID:retry_complete");
        assertEnvelopeTransition("received", "facts_committed");
        input.database.prepare(`UPDATE command_envelopes SET state = 'facts_committed', result_status = 'facts_committed', committed_at = ?
       WHERE envelope_id = ? AND state = 'received' AND result_status = 'preview_ready'`).run(input.now, input.envelopeId);
        if (changed(input.database) !== 1)
            throw new Error("WATER_EFFECT_AUTHORITY_INVALID:retry_envelope_facts");
        assertEnvelopeTransition("facts_committed", "effects_pending");
        input.database.prepare(`UPDATE command_envelopes SET state = 'effects_pending', result_status = 'facts_committed_effects_pending'
       WHERE envelope_id = ? AND state = 'facts_committed' AND result_status = 'facts_committed'`).run(input.envelopeId);
        if (changed(input.database) !== 1)
            throw new Error("WATER_EFFECT_AUTHORITY_INVALID:retry_envelope_pending");
        input.database.prepare(`UPDATE idempotency_records SET state = 'effects_pending', updated_at = ?
       WHERE idempotency_key = ? AND operation_id = ? AND input_digest = ?
         AND state = 'preview_ready' AND terminal_result_json IS NULL`).run(input.now, input.idempotencyKey, input.envelopeId, input.inputDigest);
        if (changed(input.database) !== 1)
            throw new Error("WATER_EFFECT_AUTHORITY_INVALID:retry_idempotency");
        input.database.exec("COMMIT");
        transactionOpen = false;
    }
    catch (error) {
        if (transactionOpen) {
            try {
                input.database.exec("ROLLBACK");
            }
            catch { /* preserve primary */ }
        }
        throw error;
    }
}
function zeroNutrition() {
    return {
        energy_kcal_milli: 0,
        protein_mg: 0,
        fat_mg: 0,
        carbohydrate_mg: 0,
        fiber_mg: 0,
        water_ml_milli: 0,
    };
}
function correctedNutrition(snapshotPayload, adoptedMicrounits, active) {
    if (!active)
        return Object.freeze(zeroNutrition());
    if (adoptedMicrounits === null) {
        return Object.freeze({
            energy_kcal_milli: null,
            protein_mg: null,
            fat_mg: null,
            carbohydrate_mg: null,
            fiber_mg: null,
            water_ml_milli: null,
        });
    }
    if (typeof snapshotPayload.source_nutrients !== "object" ||
        snapshotPayload.source_nutrients === null ||
        Array.isArray(snapshotPayload.source_nutrients) ||
        typeof snapshotPayload.basis !== "object" ||
        snapshotPayload.basis === null ||
        Array.isArray(snapshotPayload.basis))
        throw new Error("CORRECTION_EFFECT_INVALID:nutrition_snapshot");
    const basis = snapshotPayload.basis;
    if (!Number.isSafeInteger(basis.microunits) || basis.microunits <= 0) {
        throw new Error("CORRECTION_EFFECT_INVALID:nutrition_basis");
    }
    return scaleNutritionVector(snapshotPayload.source_nutrients, adoptedMicrounits, basis.microunits);
}
function preflightCorrectionNutrition(database, beforeSnapshot, afterSnapshot, affectedItemOrders) {
    let beforeNutrients = zeroNutrition();
    let afterNutrients = zeroNutrition();
    for (const itemOrder of affectedItemOrders) {
        const item = beforeSnapshot.items[itemOrder];
        const previousNutrition = database.prepare(`SELECT payload_json FROM nutrition_snapshots
       WHERE intake_item_id = ? ORDER BY rowid DESC LIMIT 1`).get(item.item_id);
        if (!previousNutrition)
            throw new Error("CORRECTION_EFFECT_INVALID:nutrition_missing");
        const payload = parseCanonical(previousNutrition.payload_json, "correction_nutrition");
        if (typeof payload.nutrients !== "object" || payload.nutrients === null) {
            throw new Error("CORRECTION_EFFECT_INVALID:nutrition_payload");
        }
        beforeNutrients = addNutritionVectors(beforeNutrients, payload.nutrients);
        afterNutrients = addNutritionVectors(afterNutrients, correctedNutrition(payload, afterSnapshot.active
            ? afterSnapshot.items[itemOrder].amount.nutrition_adoption_microunits
            : 0, afterSnapshot.active));
    }
    return Object.freeze({
        before: Object.freeze(beforeNutrients),
        after: Object.freeze(afterNutrients),
    });
}
function preflightNutritionSupplement(database, beforeSnapshot, afterSnapshot, itemOrder) {
    const item = beforeSnapshot.items[itemOrder];
    const previous = database.prepare(`SELECT payload_json FROM nutrition_snapshots
     WHERE intake_item_id = ? AND schema_version = 'domain/v2'
     ORDER BY rowid DESC LIMIT 1`).get(item.item_id);
    if (!previous)
        throw new Error("CORRECTION_EFFECT_INVALID:nutrition_missing");
    const previousPayload = parseCanonical(previous.payload_json, "nutrition_supplement_previous");
    if (typeof previousPayload.nutrients !== "object" || previousPayload.nutrients === null) {
        throw new Error("CORRECTION_EFFECT_INVALID:nutrition_payload");
    }
    const selection = selectNutritionSource(afterSnapshot.items[itemOrder].nutrition_sources, null);
    const adopted = afterSnapshot.items[itemOrder].amount.nutrition_adoption_microunits;
    const next = adopted === null
        ? Object.freeze({
            energy_kcal_milli: null, protein_mg: null, fat_mg: null,
            carbohydrate_mg: null, fiber_mg: null, water_ml_milli: null,
        })
        : selection.basis_microunits === null
            ? selection.nutrients
            : scaleNutritionVector(selection.nutrients, adopted, selection.basis_microunits);
    return Object.freeze({
        before: Object.freeze(previousPayload.nutrients),
        after: Object.freeze(next),
    });
}
export function replaceDailyProgress(previous, before, after) {
    const nutrients = {};
    for (const field of Object.keys(previous.nutrients)) {
        const current = previous.nutrients[field];
        const oldValue = before[field];
        const newValue = after[field];
        if (current === null || oldValue === null || newValue === null) {
            nutrients[field] = null;
            continue;
        }
        const value = current - oldValue + newValue;
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error("CORRECTION_EFFECT_INVALID:daily_progress");
        }
        nutrients[field] = value;
    }
    return Object.freeze({
        date: previous.date,
        timezone: previous.timezone,
        coverage_status: Object.values(nutrients).every((value) => value !== null)
            ? "complete"
            : "partial",
        nutrients: Object.freeze(nutrients),
    });
}
function claimCorrectionOutboxes(database, input, outboxes) {
    if (outboxes.length === 0 || outboxes.some((outbox) => outbox.state !== "pending" && outbox.state !== "retryable_failed")) {
        throw new Error("CORRECTION_EFFECT_INVALID:claim_state");
    }
    for (const outbox of outboxes) {
        assertEffectTransition(outbox.state, "processing");
        database.prepare(`UPDATE effect_outbox SET state = 'processing', attempt_count = attempt_count + 1,
         reason = NULL, updated_at = ?
       WHERE envelope_id = ? AND operation_id = ? AND effect_id = ? AND state = ?`).run(input.now, input.envelopeId, input.operationId, outbox.effect_id, outbox.state);
        if (changed(database) !== 1) {
            throw new Error("CORRECTION_EFFECT_INVALID:claim_cas");
        }
    }
}
function finalizeCorrectionOutboxes(database, input, outboxes, skippedCompensationEffectIds) {
    for (const outbox of outboxes) {
        const terminal = skippedCompensationEffectIds.has(outbox.effect_id)
            ? "permanent_business_skip"
            : "succeeded";
        assertEffectTransition("processing", terminal);
        database.prepare(`UPDATE effect_outbox SET state = ?, reason = ?, updated_at = ?
       WHERE envelope_id = ? AND operation_id = ? AND effect_id = ? AND state = 'processing'`).run(terminal, terminal === "succeeded" ? null : "inventory_insufficient", input.now, input.envelopeId, input.operationId, outbox.effect_id);
        if (changed(database) !== 1) {
            throw new Error("CORRECTION_EFFECT_INVALID:terminal_cas");
        }
    }
}
export function applyCorrectionEffects(input) {
    let transactionOpen = false;
    try {
        input.database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        assertCurrentMigrationAuthority(input.database);
        const checkpoint = input.database.prepare(`SELECT operation_id, effect_state, result_status, completed_at, payload_json
       FROM effect_bundle_commits
       WHERE envelope_id = ? AND operation_id = ?`).get(input.envelopeId, input.operationId);
        if (checkpoint?.operation_id === input.operationId &&
            checkpoint.completed_at !== null &&
            ((checkpoint.effect_state === "succeeded" && checkpoint.result_status === "applied") ||
                (checkpoint.effect_state === "permanent_business_skip" &&
                    checkpoint.result_status === "applied_with_issues"))) {
            const replay = readAppliedCorrectionResult(input);
            input.database.exec("ROLLBACK");
            transactionOpen = false;
            return replay;
        }
        if (!checkpoint || checkpoint.operation_id !== input.operationId ||
            checkpoint.effect_state !== "pending" ||
            checkpoint.result_status !== "facts_committed_effects_pending" ||
            checkpoint.completed_at !== null) {
            throw new Error("CORRECTION_EFFECT_INVALID:checkpoint");
        }
        const checkpointPayload = parseCanonical(checkpoint.payload_json, "correction_checkpoint");
        const outboxes = input.database.prepare(`SELECT effect_id, effect_kind, state FROM effect_outbox
       WHERE envelope_id = ? AND operation_id = ? ORDER BY effect_id`).all(input.envelopeId, input.operationId);
        const operations = input.database.prepare("SELECT operation_id FROM event_records WHERE envelope_id = ? ORDER BY committed_at, event_id").all(input.envelopeId);
        const correctionFact = input.database.prepare("SELECT payload_json FROM correction_events WHERE request_id = ?").get(input.operationId);
        const checkpointCorrectionPayload = correctionFact
            ? parseCanonical(correctionFact.payload_json, "correction_checkpoint_fact")
            : null;
        const checkpointInventoryIntent = checkpointCorrectionPayload?.inventory_compensation_intent;
        if (typeof checkpointInventoryIntent !== "object" || checkpointInventoryIntent === null ||
            Array.isArray(checkpointInventoryIntent) ||
            !Array.isArray(checkpointInventoryIntent.items) ||
            checkpointInventoryIntent.items.length === 0)
            throw new Error("CORRECTION_EFFECT_INVALID:checkpoint_payload");
        const compensationEffectCount = checkpointInventoryIntent.items.length;
        const expectedKinds = new Map();
        for (let index = 0; index < compensationEffectCount; index += 1) {
            expectedKinds.set(deriveDomainId("effect", input.idempotencyKey, index), "correction_inventory_compensation");
        }
        expectedKinds.set(deriveDomainId("effect", input.idempotencyKey, compensationEffectCount), "daily_progress_replacement");
        if (Object.keys(checkpointPayload).sort().join("\u0000") !==
            ["authority_kind", "data_revision", "effects", "operation_sequence"]
                .sort().join("\u0000") ||
            checkpointPayload.authority_kind !== "diet-manager/effect-bundle-checkpoint/v1" ||
            checkpointPayload.operation_sequence !== input.operationSequence ||
            typeof checkpointPayload.data_revision !== "string" ||
            !checkpointPayload.data_revision.startsWith("repository-v1:") ||
            checkpointPayload.data_revision !== computeRepositoryDataRevision(input.database) ||
            !Array.isArray(checkpointPayload.effects) ||
            checkpointPayload.effects.length !== expectedKinds.size ||
            operations[input.operationSequence]?.operation_id !== input.operationId ||
            operations.filter((operation) => operation.operation_id === input.operationId).length !== 1 ||
            outboxes.length !== expectedKinds.size ||
            outboxes.some((outbox) => (outbox.state !== "pending" && outbox.state !== "retryable_failed") ||
                expectedKinds.get(outbox.effect_id) !== outbox.effect_kind) ||
            checkpointPayload.effects.some((effect, index) => {
                if (typeof effect !== "object" || effect === null || Array.isArray(effect))
                    return true;
                const value = effect;
                return Object.keys(value).sort().join("\u0000") !== "effect_id\u0000state" ||
                    value.effect_id !== outboxes[index]?.effect_id || value.state !== "pending";
            })) {
            if (checkpointPayload.data_revision !== computeRepositoryDataRevision(input.database)) {
                throw new Error("PREVIEW_STALE:data_revision");
            }
            throw new Error("CORRECTION_EFFECT_INVALID:checkpoint_payload");
        }
        claimCorrectionOutboxes(input.database, input, outboxes);
        if (input.fault === "after_claim") {
            throw new Error("CORRECTION_EFFECT_FAILED:after_claim");
        }
        const correctionEvent = input.database.prepare(`SELECT event_id, event_type, source_message_id, conversation_id, received_at, committed_at
       FROM event_records WHERE envelope_id = ? AND operation_id = ?
         AND event_type IN ('diet_correction','nutrition_supplemented')`).get(input.envelopeId, input.operationId);
        const correction = input.database.prepare(`SELECT correction_id, target_event_id, base_revision, operation, payload_json
       FROM correction_events WHERE request_id = ?`).get(input.operationId);
        if (!correctionEvent || !correction)
            throw new Error("CORRECTION_EFFECT_INVALID:fact");
        const payload = parseCanonical(correction.payload_json, "correction_fact");
        reservationFromEventPayload(payload, correctionEvent.event_type);
        if (payload.correction_id !== correction.correction_id ||
            payload.target_event_id !== correction.target_event_id ||
            payload.base_revision !== correction.base_revision ||
            payload.operation !== correction.operation ||
            typeof payload.before_snapshot !== "object" || payload.before_snapshot === null ||
            typeof payload.after_snapshot !== "object" || payload.after_snapshot === null ||
            typeof payload.inventory_compensation_intent !== "object" ||
            payload.inventory_compensation_intent === null ||
            typeof payload.nutrition_delta !== "object" || payload.nutrition_delta === null ||
            !Array.isArray(payload.affected_dates) || payload.affected_dates.length !== 1)
            throw new Error("CORRECTION_EFFECT_INVALID:fact_payload");
        const beforeSnapshot = payload.before_snapshot;
        const afterSnapshot = payload.after_snapshot;
        const inventoryIntent = payload.inventory_compensation_intent;
        const nutritionDelta = payload.nutrition_delta;
        if (Object.keys(inventoryIntent).join("\u0000") !== "items" ||
            Object.keys(nutritionDelta).sort().join("\u0000") !==
                "items\u0000progress_reservation" ||
            !Array.isArray(inventoryIntent.items) || !Array.isArray(nutritionDelta.items) ||
            inventoryIntent.items.length === 0 ||
            inventoryIntent.items.length !== nutritionDelta.items.length)
            throw new Error("CORRECTION_EFFECT_INVALID:intents");
        const inventoryIntents = inventoryIntent.items;
        const nutritionIntents = nutritionDelta.items;
        const expectedItemCount = correction.operation === "change_amount" ||
            correction.operation === "change_nutrition_source"
            ? 1
            : beforeSnapshot.items.length;
        if (inventoryIntents.length !== expectedItemCount) {
            throw new Error("CORRECTION_EFFECT_INVALID:intent_count");
        }
        const target = input.database.prepare(`SELECT e.envelope_id, e.operation_id, e.source_message_id, e.conversation_id,
              e.received_at, e.occurred_at_text, e.payload_json, c.idempotency_key
       FROM event_records e JOIN command_envelopes c ON c.envelope_id = e.envelope_id
       WHERE e.event_id = ? AND e.event_type = 'diet_meal'`).get(correction.target_event_id);
        if (!target)
            throw new Error("CORRECTION_EFFECT_INVALID:target");
        const parsedTargetPayload = parseCanonical(target.payload_json, "correction_target");
        const targetPayload = validatedMealFactPayload(parsedTargetPayload, target.occurred_at_text, "correction_target");
        reservationFromEventPayload(targetPayload, "diet_meal");
        if (targetPayload.location !== "home" && targetPayload.location !== "outside") {
            throw new Error("CORRECTION_EFFECT_INVALID:target_location");
        }
        let compensationTransactionId = null;
        let beforeNutrients = zeroNutrition();
        let afterNutrients = zeroNutrition();
        const skippedCompensationEffectIds = new Set();
        const issueCodes = [];
        for (let intentIndex = 0; intentIndex < inventoryIntents.length; intentIndex += 1) {
            const currentInventoryIntent = inventoryIntents[intentIndex];
            const currentNutritionIntent = nutritionIntents[intentIndex];
            if (typeof currentInventoryIntent !== "object" || currentInventoryIntent === null ||
                Array.isArray(currentInventoryIntent) ||
                typeof currentNutritionIntent !== "object" || currentNutritionIntent === null ||
                Array.isArray(currentNutritionIntent) ||
                Object.keys(currentInventoryIntent).sort().join("\u0000") !==
                    ["from_microunits", "item_order", "to_microunits"].join("\u0000") ||
                Object.keys(currentNutritionIntent).sort().join("\u0000") !==
                    ["from_adoption_microunits", "item_order", "to_adoption_microunits"].join("\u0000"))
                throw new Error("CORRECTION_EFFECT_INVALID:intent_shape");
            const itemOrder = Number(currentInventoryIntent.item_order);
            if (!Number.isSafeInteger(itemOrder) || itemOrder < 0 ||
                itemOrder >= beforeSnapshot.items.length || itemOrder >= afterSnapshot.items.length ||
                currentNutritionIntent.item_order !== itemOrder ||
                (correction.operation !== "change_amount" &&
                    correction.operation !== "change_nutrition_source" && itemOrder !== intentIndex))
                throw new Error("CORRECTION_EFFECT_INVALID:item_order");
            const beforeAmount = beforeSnapshot.items[itemOrder].amount;
            const afterAmount = afterSnapshot.items[itemOrder].amount;
            const fromDeduction = currentInventoryIntent.from_microunits;
            const toDeduction = currentInventoryIntent.to_microunits;
            if (!Number.isSafeInteger(fromDeduction) || !Number.isSafeInteger(toDeduction) ||
                fromDeduction < 0 || toDeduction < 0 ||
                fromDeduction !== (beforeSnapshot.active
                    ? beforeAmount.inventory_deduction_microunits
                    : 0) ||
                toDeduction !== (afterSnapshot.active ? afterAmount.inventory_deduction_microunits : 0) ||
                currentNutritionIntent.from_adoption_microunits !==
                    (beforeSnapshot.active ? beforeAmount.nutrition_adoption_microunits : 0) ||
                currentNutritionIntent.to_adoption_microunits !==
                    (afterSnapshot.active ? afterAmount.nutrition_adoption_microunits : 0))
                throw new Error("CORRECTION_EFFECT_INVALID:intent_amount");
            let inventoryDelta = toDeduction - fromDeduction;
            const correctionEffectId = deriveDomainId("effect", input.idempotencyKey, intentIndex);
            if (!outboxes.some((outbox) => outbox.effect_id === correctionEffectId &&
                outbox.effect_kind === "correction_inventory_compensation")) {
                throw new Error("CORRECTION_EFFECT_INVALID:compensation_outbox");
            }
            // The meal keys its out transactions by the item's inventory-effect id in both
            // write paths (the legacy single-deduction write and the pantry-v2 allocation
            // write), never by the target's raw idempotency key. Re-derive that effect id so
            // undo/amount correction finds the actual deducted batch instead of guessing.
            const originalTransactions = input.database.prepare(`SELECT transaction_id, product_id, batch_id, direction, unit, payload_json
         FROM inventory_transactions
         WHERE event_id = ? AND idempotency_key = ? AND direction = 'out'
           AND reason_code = 'meal_consumption' AND lifecycle_status = 'active'
         ORDER BY transaction_id`).all(correction.target_event_id, mealEffectId(target.idempotency_key, itemOrder, 0));
            if (originalTransactions.length > 1) {
                // A single meal item can span multiple pantry batches. Reversing that split
                // across batches needs an allocation-aware compensation plan that 0.1.1 does
                // not model; fail closed rather than silently under-compensate a batch.
                throw new Error("CORRECTION_EFFECT_INVALID:multiple_allocations");
            }
            const originalTransaction = originalTransactions[0];
            if (originalTransaction) {
                const ledgerRows = [originalTransaction, ...input.database.prepare(`SELECT transaction_id, product_id, batch_id, direction, unit, payload_json
           FROM inventory_transactions
           WHERE related_event_id = ? AND related_transaction_id = ?
             AND reason_code = 'correction_compensation' AND lifecycle_status = 'active'
           ORDER BY transaction_id`).all(correction.target_event_id, originalTransaction.transaction_id)];
                let signedLedgerDelta = 0;
                for (const ledgerRow of ledgerRows) {
                    const ledgerPayload = parseCanonical(ledgerRow.payload_json, "correction_inventory_ledger");
                    const signedDelta = ledgerPayload.quantity_delta_microunits;
                    const kind = ledgerPayload.authority_kind;
                    const isV1 = kind === "diet-manager/inventory-transaction/v1" &&
                        Object.keys(ledgerPayload).sort().join("\u0000") ===
                            ["authority_kind", "quantity_after_microunits", "quantity_delta_microunits", "unit"].sort().join("\u0000");
                    const isV2 = kind === "diet-manager/inventory-transaction/v2" &&
                        Object.keys(ledgerPayload).sort().join("\u0000") ===
                            ["allocation_index", "authority_kind", "quantity_after_microunits", "quantity_delta_microunits", "selection_basis", "unit"].sort().join("\u0000") &&
                        ["explicit_batch", "fefo", "fifo"].includes(String(ledgerPayload.selection_basis));
                    if ((!isV1 && !isV2) ||
                        ledgerPayload.unit !== originalTransaction.unit ||
                        !Number.isSafeInteger(ledgerPayload.quantity_after_microunits) ||
                        ledgerPayload.quantity_after_microunits < 0 ||
                        !Number.isSafeInteger(signedDelta) || signedDelta === 0 ||
                        (ledgerRow.direction === "out" && signedDelta >= 0) ||
                        (ledgerRow.direction === "in" && signedDelta <= 0) ||
                        (ledgerRow.direction !== "out" && ledgerRow.direction !== "in") ||
                        ledgerRow.product_id !== originalTransaction.product_id ||
                        ledgerRow.batch_id !== originalTransaction.batch_id ||
                        ledgerRow.unit !== originalTransaction.unit)
                        throw new Error("CORRECTION_EFFECT_INVALID:inventory_ledger");
                    signedLedgerDelta += signedDelta;
                    if (!Number.isSafeInteger(signedLedgerDelta)) {
                        throw new Error("CORRECTION_EFFECT_INVALID:inventory_ledger");
                    }
                }
                const actualDeduction = -signedLedgerDelta;
                if (actualDeduction < 0) {
                    throw new Error("CORRECTION_EFFECT_INVALID:inventory_ledger");
                }
                inventoryDelta = toDeduction - actualDeduction;
            }
            if (inventoryDelta !== 0 && originalTransaction) {
                const projectionRow = input.database.prepare("SELECT payload_json FROM inventory_batch_projections WHERE batch_id = ?").get(originalTransaction.batch_id);
                if (!projectionRow)
                    throw new Error("CORRECTION_EFFECT_INVALID:projection");
                const projection = parseCanonical(projectionRow.payload_json, "correction_projection");
                const current = Number(projection.quantity_microunits);
                const remaining = current - inventoryDelta;
                if (!Number.isSafeInteger(current) || !Number.isSafeInteger(remaining) || remaining < 0) {
                    skippedCompensationEffectIds.add(correctionEffectId);
                    issueCodes.push("inventory_insufficient");
                    input.database.prepare(`INSERT INTO issues(
              issue_id, issue_code, issue_type, priority, entity_type, entity_id,
              field_path, detected_at, source_message_id, status, revision,
              last_presented_at, resolved_at, resolution_source, resolution_reason,
              resolution_event_id, payload_json
            ) VALUES (?, 'inventory_insufficient', 'inventory_match', 'normal',
              'meal_item', ?, 'inventory', ?, ?, 'open', 1,
              NULL, NULL, NULL, NULL, NULL, ?)`).run(deriveDomainId("issue", input.idempotencyKey, itemOrder), beforeSnapshot.items[itemOrder].item_id, input.now, correctionEvent.source_message_id, canonicalJson({
                        authority_kind: "diet-manager/issue/v1",
                        correction_id: correction.correction_id,
                        inventory_delta_microunits: inventoryDelta,
                        reason: "inventory_insufficient",
                    }));
                }
                else {
                    const transactionId = deriveDomainId("transaction", input.idempotencyKey, itemOrder);
                    compensationTransactionId ??= transactionId;
                    input.database.prepare(`INSERT INTO inventory_transactions(
              transaction_id, event_id, product_id, batch_id, idempotency_key,
              schema_version, direction, reason_code, unit, related_event_id,
              related_transaction_id, source_message_id, conversation_id, received_at,
              committed_at, result_status, lifecycle_status, payload_json
            ) VALUES (?, ?, ?, ?, ?, 'domain/v2', ?, 'correction_compensation', ?, ?,
              ?, ?, ?, ?, ?, 'applied', 'active', ?)`).run(transactionId, correctionEvent.event_id, originalTransaction.product_id, originalTransaction.batch_id, correctionEffectId, inventoryDelta > 0 ? "out" : "in", originalTransaction.unit, correction.target_event_id, originalTransaction.transaction_id, correctionEvent.source_message_id, correctionEvent.conversation_id, correctionEvent.received_at, input.now, canonicalJson({
                        authority_kind: "diet-manager/inventory-transaction/v1",
                        quantity_after_microunits: remaining,
                        quantity_delta_microunits: -inventoryDelta,
                        unit: originalTransaction.unit,
                    }));
                    input.database.prepare(`UPDATE inventory_batch_projections SET
              last_event_id = ?, last_changed_at = ?, quantity_status = ?, effective_status = ?,
              payload_json = ? WHERE batch_id = ?`).run(correctionEvent.event_id, input.now, remaining === 0 ? "empty" : "available", remaining === 0 ? "empty" : "active", canonicalJson({
                        authority_kind: "diet-manager/inventory-projection/v1",
                        batch_id: originalTransaction.batch_id,
                        product_id: originalTransaction.product_id,
                        quantity_microunits: remaining,
                        unit: originalTransaction.unit,
                    }), originalTransaction.batch_id);
                    if (changed(input.database) !== 1) {
                        throw new Error("CORRECTION_EFFECT_INVALID:projection_cas");
                    }
                }
            }
            else if (inventoryDelta !== 0 && targetPayload.location === "home") {
                const inventoryOutbox = input.database.prepare(`SELECT effect_kind, state FROM effect_outbox
           WHERE envelope_id = ? AND operation_id = ? AND effect_id = ?`).get(target.envelope_id, target.operation_id, mealEffectId(target.idempotency_key, itemOrder, 0));
                if (!inventoryOutbox || inventoryOutbox.effect_kind !== "inventory_deduct" ||
                    inventoryOutbox.state !== "permanent_business_skip")
                    throw new Error("CORRECTION_EFFECT_INVALID:original_transaction");
            }
            if (input.fault === "after_compensation") {
                throw new Error("CORRECTION_EFFECT_FAILED:after_compensation");
            }
            const item = beforeSnapshot.items[itemOrder];
            const previousNutrition = input.database.prepare(`SELECT snapshot_id, meal_event_id, intake_item_id, nutrition_profile_id,
                profile_version, source_type, source_ref, payload_json
         FROM nutrition_snapshots
         WHERE intake_item_id = ? AND schema_version = 'domain/v2'
         ORDER BY rowid DESC LIMIT 1`).get(item.item_id);
            if (!previousNutrition)
                throw new Error("CORRECTION_EFFECT_INVALID:nutrition_missing");
            const previousNutritionPayload = parseCanonical(previousNutrition.payload_json, "correction_nutrition");
            if (typeof previousNutritionPayload.nutrients !== "object" ||
                previousNutritionPayload.nutrients === null) {
                throw new Error("CORRECTION_EFFECT_INVALID:nutrition_payload");
            }
            const itemBeforeNutrients = previousNutritionPayload.nutrients;
            const supplementSelection = correction.operation === "change_nutrition_source"
                ? selectNutritionSource(afterSnapshot.items[itemOrder].nutrition_sources, null)
                : null;
            const itemAfterNutrients = supplementSelection === null
                ? correctedNutrition(previousNutritionPayload, afterSnapshot.active ? afterAmount.nutrition_adoption_microunits : 0, afterSnapshot.active)
                : afterAmount.nutrition_adoption_microunits === null
                    ? Object.freeze({
                        energy_kcal_milli: null, protein_mg: null, fat_mg: null,
                        carbohydrate_mg: null, fiber_mg: null, water_ml_milli: null,
                    })
                    : supplementSelection.basis_microunits === null
                        ? supplementSelection.nutrients
                        : scaleNutritionVector(supplementSelection.nutrients, afterAmount.nutrition_adoption_microunits, supplementSelection.basis_microunits);
            const nextProfileId = supplementSelection === null
                ? previousNutrition.nutrition_profile_id
                : writeMealNutritionProfile(input.database, input.idempotencyKey, itemOrder, item.normalized_name, supplementSelection, input.now);
            const nextProfileVersion = supplementSelection?.profile_version ?? previousNutrition.profile_version;
            const nextSourceType = supplementSelection?.source_type ?? previousNutrition.source_type;
            const nextSourceRef = supplementSelection?.source_ref ?? previousNutrition.source_ref;
            const nextBasis = supplementSelection === null
                ? previousNutritionPayload.basis
                : {
                    kind: supplementSelection.basis_kind,
                    microunits: supplementSelection.basis_microunits,
                    unit: supplementSelection.basis_unit,
                };
            const nextSourceNutrients = supplementSelection?.nutrients ?? previousNutritionPayload.source_nutrients;
            beforeNutrients = addNutritionVectors(beforeNutrients, itemBeforeNutrients);
            afterNutrients = addNutritionVectors(afterNutrients, itemAfterNutrients);
            input.database.prepare(`INSERT INTO nutrition_snapshots(
          snapshot_id, schema_version, meal_event_id, intake_item_id,
          nutrition_profile_id, profile_version, source_type, source_ref,
          coverage_status, created_at, payload_json
        ) VALUES (?, 'domain/v2', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(deriveDomainId("snapshot", input.idempotencyKey, itemOrder), correction.target_event_id, item.item_id, nextProfileId, nextProfileVersion, nextSourceType, nextSourceRef, Object.values(itemAfterNutrients).every((value) => value !== null) ? "complete" : "partial", input.now, canonicalJson({
                amount: afterAmount,
                authority_kind: "diet-manager/nutrition-snapshot/v1",
                basis: nextBasis,
                conversion: afterSnapshot.active && afterAmount.nutrition_adoption_microunits !== null
                    ? {
                        adopted_microunits: afterAmount.nutrition_adoption_microunits,
                        formula: "round_half_up(nutrient*adopted_microunits/basis_microunits)",
                    }
                    : null,
                correction_id: correction.correction_id,
                nutrients: itemAfterNutrients,
                source_nutrients: nextSourceNutrients,
            }));
            if (correction.operation === "change_nutrition_source") {
                const nutritionEvidence = afterSnapshot.items[itemOrder]?.nutrition_evidence;
                if (nutritionEvidence === undefined) {
                    throw new Error("CORRECTION_EFFECT_INVALID:nutrition_evidence");
                }
                const records = v11NutritionRecords(input.operationId, correction.target_event_id, correctionEvent.committed_at, item, nutritionEvidence);
                persistNutritionRecords(input.database, [records]);
                assertNutritionRecordsPersisted(input.database, [records]);
            }
        }
        const date = String(payload.affected_dates[0]);
        const progressRow = input.database.prepare(`SELECT coverage_status, payload_json FROM daily_progress_snapshots
       WHERE date = ? AND timezone = 'Asia/Shanghai'
       ORDER BY generated_at DESC, progress_snapshot_id DESC LIMIT 1`).get(date);
        if (!progressRow)
            throw new Error("CORRECTION_EFFECT_INVALID:daily_progress_missing");
        const progressPayload = parseCanonical(progressRow.payload_json, "correction_progress");
        if (progressPayload.authority_kind !== "diet-manager/daily-progress/v1" ||
            progressPayload.date !== date || progressPayload.timezone !== "Asia/Shanghai" ||
            typeof progressPayload.nutrients !== "object" || progressPayload.nutrients === null)
            throw new Error("CORRECTION_EFFECT_INVALID:daily_progress_payload");
        const replacement = replaceDailyProgress(Object.freeze({
            date,
            timezone: "Asia/Shanghai",
            coverage_status: progressRow.coverage_status,
            nutrients: progressPayload.nutrients,
        }), beforeNutrients, afterNutrients);
        if (input.fault === "after_nutrition_progress") {
            throw new Error("CORRECTION_EFFECT_FAILED:after_nutrition_progress");
        }
        finalizeCorrectionOutboxes(input.database, input, outboxes, skippedCompensationEffectIds);
        const terminalEffects = input.database.prepare(`SELECT effect_id, effect_kind, state FROM effect_outbox
       WHERE envelope_id = ? AND operation_id = ? ORDER BY effect_id`).all(input.envelopeId, input.operationId);
        const hasIssues = issueCodes.length > 0;
        const deltaBefore = Object.freeze({
            date,
            timezone: "Asia/Shanghai",
            coverage_status: Object.values(beforeNutrients).every((value) => value !== null)
                ? "complete"
                : "partial",
            nutrients: Object.freeze(beforeNutrients),
        });
        const deltaAfter = Object.freeze({
            date,
            timezone: "Asia/Shanghai",
            coverage_status: Object.values(afterNutrients).every((value) => value !== null)
                ? "complete"
                : "partial",
            nutrients: Object.freeze(afterNutrients),
        });
        const result = Object.freeze({
            sequence: input.operationSequence,
            operation_id: input.operationId,
            status: hasIssues ? "committed_with_issues" : "committed",
            error_code: null,
            correction_id: correction.correction_id,
            target_event_id: correction.target_event_id,
            revision: correction.base_revision + 1,
            operation: correction.operation,
            compensation_transaction_id: compensationTransactionId,
            issue_codes: Object.freeze(issueCodes),
            daily_progress: replacement,
            daily_progress_by_date: Object.freeze([replacement]),
        });
        input.database.prepare(`UPDATE effect_bundle_commits SET effect_state = ?, result_status = ?,
         completed_at = ?, payload_json = ?
       WHERE envelope_id = ? AND operation_id = ? AND effect_state = 'pending'`).run(hasIssues ? "permanent_business_skip" : "succeeded", hasIssues ? "applied_with_issues" : "applied", input.now, canonicalJson({
            authority_kind: "diet-manager/effect-bundle/v1",
            data_revision: computeRepositoryDataRevision(input.database),
            effects: terminalEffects.map((effect) => effect.effect_kind === "daily_progress_replacement"
                ? {
                    delta: { after: deltaAfter, before: deltaBefore },
                    effect_id: effect.effect_id,
                    replacement,
                    state: effect.state,
                }
                : { effect_id: effect.effect_id, state: effect.state }),
            operation_sequence: input.operationSequence,
        }), input.envelopeId, input.operationId);
        if (changed(input.database) !== 1)
            throw new Error("CORRECTION_EFFECT_INVALID:bundle_cas");
        input.database.exec("COMMIT");
        transactionOpen = false;
        return result;
    }
    catch (error) {
        if (transactionOpen) {
            try {
                input.database.exec("ROLLBACK");
            }
            catch { /* preserve primary */ }
        }
        throw error;
    }
}
const CORRECTION_RESULT_FIELDS = [
    "compensation_transaction_id",
    "correction_id",
    "daily_progress",
    "daily_progress_by_date",
    "error_code",
    "issue_codes",
    "operation",
    "operation_id",
    "revision",
    "sequence",
    "status",
    "target_event_id",
];
const CORRECTION_NUTRIENT_FIELDS = [
    "energy_kcal_milli",
    "protein_mg",
    "fat_mg",
    "carbohydrate_mg",
    "fiber_mg",
    "water_ml_milli",
];
function correctionAuthorityInvalid(reason) {
    throw new Error(`CORRECTION_EFFECT_INVALID:${reason}`);
}
function parseCorrectionCanonical(value, reason) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        return correctionAuthorityInvalid(reason);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
        canonicalJson(parsed) !== value)
        return correctionAuthorityInvalid(reason);
    return parsed;
}
function exactCorrectionRecord(value, fields, reason) {
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
        Object.keys(value).sort().join("\u0000") !== [...fields].sort().join("\u0000"))
        return correctionAuthorityInvalid(reason);
    return value;
}
function parseCorrectionProgress(value) {
    const progress = exactCorrectionRecord(value, ["coverage_status", "date", "nutrients", "timezone"], "terminal_progress");
    const nutrients = exactCorrectionRecord(progress.nutrients, CORRECTION_NUTRIENT_FIELDS, "terminal_progress");
    if (typeof progress.date !== "string" ||
        progress.timezone !== "Asia/Shanghai" ||
        (progress.coverage_status !== "complete" && progress.coverage_status !== "partial") ||
        CORRECTION_NUTRIENT_FIELDS.some((field) => nutrients[field] !== null && !Number.isSafeInteger(nutrients[field])))
        return correctionAuthorityInvalid("terminal_progress");
    return freezeJson(JSON.parse(canonicalJson(progress)));
}
export function readAppliedCorrectionResult(input) {
    assertCurrentMigrationAuthority(input.database);
    const bundleRows = input.database.prepare(`SELECT operation_id, effect_state, result_status, completed_at, payload_json
     FROM effect_bundle_commits WHERE envelope_id = ? AND operation_id = ?`).all(input.envelopeId, input.operationId);
    if (bundleRows.length !== 1)
        return correctionAuthorityInvalid("terminal_bundle");
    const bundleRow = bundleRows[0];
    if (!bundleRow || bundleRow.operation_id !== input.operationId || bundleRow.completed_at === null ||
        !((bundleRow.effect_state === "succeeded" && bundleRow.result_status === "applied") ||
            (bundleRow.effect_state === "permanent_business_skip" &&
                bundleRow.result_status === "applied_with_issues")))
        return correctionAuthorityInvalid("terminal_bundle");
    const bundle = exactCorrectionRecord(parseCorrectionCanonical(bundleRow.payload_json, "terminal_bundle"), ["authority_kind", "data_revision", "effects", "operation_sequence"], "terminal_bundle");
    if (bundle.authority_kind !== "diet-manager/effect-bundle/v1" ||
        typeof bundle.data_revision !== "string" ||
        !bundle.data_revision.startsWith("repository-v1:") ||
        bundle.operation_sequence !== input.operationSequence ||
        !Array.isArray(bundle.effects))
        return correctionAuthorityInvalid("terminal_bundle");
    const correctionRows = input.database.prepare(`SELECT c.correction_id, c.target_event_id, c.base_revision, c.request_id,
            c.operation, c.payload_json, e.event_id, e.event_type, e.committed_at
     FROM correction_events c
     JOIN event_records e ON e.operation_id = c.request_id
       AND e.event_type IN ('diet_correction','nutrition_supplemented')
     WHERE c.request_id = ? AND e.envelope_id = ?`).all(input.operationId, input.envelopeId);
    if (correctionRows.length !== 1)
        return correctionAuthorityInvalid("terminal_fact");
    const correction = correctionRows[0];
    if (!correction || correction.correction_id !== deriveDomainId("correction", input.idempotencyKey, input.operationSequence) || correction.event_id !== deriveDomainId("event", input.idempotencyKey, input.operationSequence))
        return correctionAuthorityInvalid("terminal_fact");
    const fact = exactCorrectionRecord(parseCorrectionCanonical(correction.payload_json, "terminal_fact"), [
        "affected_dates",
        "after_snapshot",
        "authority_kind",
        "base_revision",
        "before_snapshot",
        "change_set",
        "correction_id",
        "inventory_compensation_intent",
        "nutrition_delta",
        "operation",
        "request_id",
        "target_event_id",
    ], "terminal_fact");
    reservationFromEventPayload(fact, correction.event_type);
    if (fact.authority_kind !== "diet-manager/correction-fact/v1" ||
        fact.correction_id !== correction.correction_id ||
        fact.target_event_id !== correction.target_event_id ||
        fact.request_id !== correction.request_id ||
        fact.base_revision !== correction.base_revision ||
        fact.operation !== correction.operation)
        return correctionAuthorityInvalid("terminal_fact");
    const inventoryIntent = exactCorrectionRecord(fact.inventory_compensation_intent, ["items"], "terminal_fact");
    if (!Array.isArray(inventoryIntent.items) || inventoryIntent.items.length === 0) {
        return correctionAuthorityInvalid("terminal_fact");
    }
    if (correction.operation === "change_nutrition_source") {
        if (inventoryIntent.items.length !== 1)
            return correctionAuthorityInvalid("terminal_nutrition");
        const intent = exactCorrectionRecord(inventoryIntent.items[0], ["from_microunits", "item_order", "to_microunits"], "terminal_nutrition");
        if (!Number.isSafeInteger(intent.item_order) || intent.item_order < 0) {
            return correctionAuthorityInvalid("terminal_nutrition");
        }
        const itemOrder = intent.item_order;
        const afterSnapshot = exactCorrectionRecord(fact.after_snapshot, ["active", "items", "location", "meal_slot", "occurred_at", "timezone"], "terminal_nutrition");
        if (!Array.isArray(afterSnapshot.items))
            return correctionAuthorityInvalid("terminal_nutrition");
        const afterItem = afterSnapshot.items[itemOrder];
        if (typeof afterItem !== "object" || afterItem === null || Array.isArray(afterItem)) {
            return correctionAuthorityInvalid("terminal_nutrition");
        }
        const evidence = afterItem.nutrition_evidence;
        if (evidence === undefined)
            return correctionAuthorityInvalid("terminal_nutrition");
        const storedItem = input.database.prepare(`SELECT item_id, normalized_name FROM meal_items WHERE event_id = ? AND item_order = ?`).get(correction.target_event_id, itemOrder);
        if (storedItem === undefined)
            return correctionAuthorityInvalid("terminal_nutrition");
        try {
            assertNutritionRecordsPersisted(input.database, [v11NutritionRecords(input.operationId, correction.target_event_id, correction.committed_at, storedItem, evidence)]);
        }
        catch {
            return correctionAuthorityInvalid("terminal_nutrition");
        }
    }
    const outboxes = input.database.prepare(`SELECT effect_id, effect_kind, state FROM effect_outbox
     WHERE envelope_id = ? AND operation_id = ? ORDER BY effect_id`).all(input.envelopeId, input.operationId);
    if (outboxes.length !== bundle.effects.length || outboxes.length !== inventoryIntent.items.length + 1) {
        return correctionAuthorityInvalid("terminal_effects");
    }
    const outboxById = new Map(outboxes.map((outbox) => [outbox.effect_id, outbox]));
    let progress = null;
    for (const effectValue of bundle.effects) {
        const candidate = effectValue;
        const effectId = typeof candidate?.effect_id === "string" ? candidate.effect_id : "";
        const outbox = outboxById.get(effectId);
        if (!outbox)
            return correctionAuthorityInvalid("terminal_effects");
        if (outbox.effect_kind === "daily_progress_replacement") {
            const effect = exactCorrectionRecord(effectValue, ["delta", "effect_id", "replacement", "state"], "terminal_effects");
            if (effect.state !== "succeeded" || outbox.state !== "succeeded" || progress !== null) {
                return correctionAuthorityInvalid("terminal_effects");
            }
            exactCorrectionRecord(effect.delta, ["after", "before"], "terminal_effects");
            progress = parseCorrectionProgress(effect.replacement);
        }
        else {
            const effect = exactCorrectionRecord(effectValue, ["effect_id", "state"], "terminal_effects");
            if (outbox.effect_kind !== "correction_inventory_compensation" ||
                effect.state !== outbox.state ||
                (outbox.state !== "succeeded" && outbox.state !== "permanent_business_skip"))
                return correctionAuthorityInvalid("terminal_effects");
        }
        outboxById.delete(effectId);
    }
    if (outboxById.size !== 0 || progress === null) {
        return correctionAuthorityInvalid("terminal_effects");
    }
    const expectedIssueCodes = [];
    let expectedCompensationId = null;
    const expectedTransactionIds = new Set();
    for (let intentIndex = 0; intentIndex < inventoryIntent.items.length; intentIndex += 1) {
        const intent = exactCorrectionRecord(inventoryIntent.items[intentIndex], ["from_microunits", "item_order", "to_microunits"], "terminal_fact");
        const itemOrder = intent.item_order;
        if (!Number.isSafeInteger(itemOrder) || itemOrder < 0) {
            return correctionAuthorityInvalid("terminal_fact");
        }
        const effectId = deriveDomainId("effect", input.idempotencyKey, intentIndex);
        const outbox = outboxes.find((candidate) => candidate.effect_id === effectId);
        if (!outbox || outbox.effect_kind !== "correction_inventory_compensation") {
            return correctionAuthorityInvalid("terminal_effects");
        }
        const transactionId = deriveDomainId("transaction", input.idempotencyKey, itemOrder);
        const transaction = input.database.prepare(`SELECT transaction_id, event_id, reason_code, related_event_id, payload_json
       FROM inventory_transactions WHERE transaction_id = ?`).get(transactionId);
        const issue = input.database.prepare(`SELECT issue_code, status, payload_json FROM issues WHERE issue_id = ?`).get(deriveDomainId("issue", input.idempotencyKey, itemOrder));
        if (outbox.state === "permanent_business_skip") {
            if (transaction || !issue || issue.issue_code !== "inventory_insufficient" || issue.status !== "open") {
                return correctionAuthorityInvalid("terminal_issue");
            }
            const issuePayload = parseCorrectionCanonical(issue.payload_json, "terminal_issue");
            if (issuePayload.correction_id !== correction.correction_id || issuePayload.reason !== "inventory_insufficient") {
                return correctionAuthorityInvalid("terminal_issue");
            }
            expectedIssueCodes.push("inventory_insufficient");
        }
        else {
            if (issue)
                return correctionAuthorityInvalid("terminal_issue");
            if (transaction) {
                if (transaction.event_id !== correction.event_id ||
                    transaction.reason_code !== "correction_compensation" ||
                    transaction.related_event_id !== correction.target_event_id)
                    return correctionAuthorityInvalid("terminal_transaction");
                parseCorrectionCanonical(transaction.payload_json, "terminal_transaction");
                expectedTransactionIds.add(transaction.transaction_id);
                expectedCompensationId ??= transaction.transaction_id;
            }
        }
    }
    const actualTransactions = input.database.prepare(`SELECT transaction_id FROM inventory_transactions
     WHERE event_id = ? AND reason_code = 'correction_compensation'`).all(correction.event_id);
    if (actualTransactions.length !== expectedTransactionIds.size ||
        actualTransactions.some((row) => !expectedTransactionIds.has(row.transaction_id)))
        return correctionAuthorityInvalid("terminal_result");
    const result = {
        sequence: input.operationSequence,
        operation_id: input.operationId,
        status: bundleRow.result_status === "applied" ? "committed" : "committed_with_issues",
        error_code: null,
        correction_id: correction.correction_id,
        target_event_id: correction.target_event_id,
        revision: correction.base_revision + 1,
        operation: correction.operation,
        compensation_transaction_id: expectedCompensationId,
        issue_codes: expectedIssueCodes,
        daily_progress: progress,
        daily_progress_by_date: [progress],
    };
    exactCorrectionRecord(result, CORRECTION_RESULT_FIELDS, "terminal_result");
    return freezeJson(JSON.parse(canonicalJson(result)));
}
