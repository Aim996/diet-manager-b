import { canonicalJson, canonicalSha256 } from "../authority/canonical-json.js";
import { processInventoryEffect, } from "../repository/inventory-effects.js";
import { computeRepositoryDataRevision } from "../repository/revision.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
import { assertEffectTransition, assertEnvelopeTransition } from "../state/transition-guard.js";
import { deriveDomainId } from "./identity.js";
import { toNaturalDate } from "./identity.js";
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
function readEffectiveMealState(database, targetEventId) {
    const event = database.prepare(`SELECT event_id, occurred_at_text, meal_slot, payload_json
     FROM event_records WHERE event_id = ? AND event_type = 'diet_meal'`).get(targetEventId);
    if (!event)
        throw new Error("CORRECTION_TARGET_INVALID:event");
    const eventPayload = parseCanonical(event.payload_json, "correction_target_event");
    if (eventPayload.authority_kind !== "diet-manager/meal-fact/v1" ||
        (eventPayload.location !== "home" && eventPayload.location !== "outside") ||
        eventPayload.timezone !== "Asia/Shanghai")
        throw new Error("CORRECTION_TARGET_INVALID:event_payload");
    const itemRows = database.prepare(`SELECT item_id, item_order, item_type, normalized_name, payload_json
     FROM meal_items WHERE event_id = ? ORDER BY item_order`).all(targetEventId);
    if (itemRows.length === 0)
        throw new Error("CORRECTION_TARGET_INVALID:items");
    const items = itemRows.map((item, index) => {
        if (item.item_order !== index)
            throw new Error("CORRECTION_TARGET_INVALID:item_order");
        const payload = parseCanonical(item.payload_json, "correction_target_item");
        if (payload.authority_kind !== "diet-manager/meal-item/v1" ||
            typeof payload.amount !== "object" || payload.amount === null || Array.isArray(payload.amount) ||
            !Array.isArray(payload.nutrition_sources))
            throw new Error("CORRECTION_TARGET_INVALID:item_payload");
        return {
            item_id: item.item_id,
            item_order: item.item_order,
            item_type: item.item_type,
            normalized_name: item.normalized_name,
            amount: payload.amount,
            nutrition_sources: payload.nutrition_sources,
        };
    });
    let snapshot = freezeJson({
        active: true,
        occurred_at: event.occurred_at_text,
        meal_slot: event.meal_slot,
        location: eventPayload.location,
        timezone: "Asia/Shanghai",
        items,
    });
    let revision = 1;
    const corrections = database.prepare(`SELECT c.base_revision, c.payload_json, b.effect_state, b.result_status
     FROM correction_events c
     JOIN event_records e ON e.operation_id = c.request_id AND e.event_type = 'diet_correction'
     JOIN effect_bundle_commits b
       ON b.envelope_id = e.envelope_id AND b.operation_id = e.operation_id
     WHERE c.target_event_id = ? ORDER BY c.base_revision`).all(targetEventId);
    for (const correction of corrections) {
        if (correction.effect_state === "pending") {
            throw new Error("CORRECTION_TARGET_INVALID:pending_correction");
        }
        if (!((correction.effect_state === "succeeded" && correction.result_status === "applied") ||
            (correction.effect_state === "permanent_business_skip" &&
                correction.result_status === "applied_with_issues"))) {
            throw new Error("CORRECTION_TARGET_INVALID:chain_state");
        }
        const payload = parseCanonical(correction.payload_json, "correction_chain");
        if (correction.base_revision !== revision || payload.base_revision !== revision ||
            payload.target_event_id !== targetEventId ||
            payload.authority_kind !== "diet-manager/correction-fact/v1" ||
            canonicalJson(payload.before_snapshot) !== canonicalJson(snapshot) ||
            typeof payload.after_snapshot !== "object" || payload.after_snapshot === null ||
            Array.isArray(payload.after_snapshot))
            throw new Error("CORRECTION_TARGET_INVALID:chain");
        snapshot = freezeJson(JSON.parse(canonicalJson(payload.after_snapshot)));
        revision += 1;
    }
    return Object.freeze({ revision, snapshot });
}
export function prepareCorrectionOperation(input) {
    const operation = input.operation;
    if ((operation.kind !== "correct_record" && operation.kind !== "undo_record") ||
        (input.commandType !== "correct_record" && input.commandType !== "undo_record") ||
        operation.kind !== input.commandType)
        return invalid("correction_operation");
    const current = readEffectiveMealState(input.database, operation.target_event_id);
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
        afterSnapshot = freezeJson({
            ...current.snapshot,
            items: current.snapshot.items.map((item, index) => index === itemOrder
                ? { ...item, amount: operation.replacement_amount }
                : item),
        });
        operationKind = "change_amount";
    }
    else {
        afterSnapshot = freezeJson({
            ...current.snapshot,
            active: !current.snapshot.active,
        });
        operationKind = current.snapshot.active ? "void_event" : "restore_event";
    }
    if (canonicalJson(afterSnapshot) === canonicalJson(current.snapshot)) {
        throw new Error("CORRECTION_TARGET_INVALID:no_change");
    }
    const affectedItemOrders = operationKind === "change_amount"
        ? [itemOrder]
        : current.snapshot.items.map((item) => item.item_order);
    const beforeAmount = current.snapshot.items[itemOrder].amount;
    const afterAmount = afterSnapshot.items[itemOrder].amount;
    const progressPreflight = preflightCorrectionNutrition(input.database, current.snapshot, afterSnapshot, affectedItemOrders);
    const correctionId = deriveDomainId("correction", input.idempotencyKey, input.sequence);
    const eventId = deriveDomainId("event", input.idempotencyKey, input.sequence);
    const date = toNaturalDate(current.snapshot.occurred_at, "Asia/Shanghai");
    const payload = freezeJson({
        affected_dates: [date],
        after_snapshot: afterSnapshot,
        authority_kind: "diet-manager/correction-fact/v1",
        base_revision: current.revision,
        before_snapshot: current.snapshot,
        change_set: operationKind === "change_amount"
            ? [{ after: afterAmount, before: beforeAmount, path: `/items/${itemOrder}/amount` }]
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
                eventType: "diet_correction",
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
    if (operation.amount.evidence !== "explicit")
        return invalid("amount_evidence");
    const quantity = positive(operation.amount.observed_microunits, "observed_microunits");
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
                authority_kind: "diet-manager/product/v1",
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
        status: "committed",
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
                payload: Object.freeze({
                    authority_kind: "diet-manager/meal-fact/v1",
                    location: operation.location,
                    timezone: "Asia/Shanghai",
                }),
            }),
            items: Object.freeze(operation.items.map((item, itemOrder) => Object.freeze({
                itemId: deriveDomainId("item", input.idempotencyKey, itemOrder),
                itemOrder,
                itemType: item.item_type,
                normalizedName: item.normalized_name,
                payload: Object.freeze({
                    amount: item.amount,
                    authority_kind: "diet-manager/meal-item/v1",
                    nutrition_sources: item.nutrition_sources,
                }),
            }))),
            effects: Object.freeze(effects),
        }),
    });
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
function exactKeys(value, fields, label) {
    if (Object.keys(value).sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
        throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
    }
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
export function preflightMealOperation(database, operation, precedingCandidates = new Map()) {
    let preflightMealProgress = zeroNutrition();
    for (const item of operation.items) {
        const candidates = operation.location === "outside"
            ? []
            : [...inventoryCandidates(database, item.normalized_name), ...(precedingCandidates.get(item.normalized_name) ?? [])];
        const decision = resolveInventoryMatch({
            location: operation.location,
            requested_unit: item.amount.unit,
            observed_microunits: item.amount.observed_microunits,
            nutrition_adoption_microunits: item.amount.nutrition_adoption_microunits,
            inventory_deduction_microunits: item.amount.inventory_deduction_microunits,
            template_reference_microunits: item.amount.template_reference_microunits,
            candidates,
        });
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
     WHERE subject_type = ? AND subject_id = ? AND CAST(profile_version AS INTEGER) < ?
     ORDER BY CAST(profile_version AS INTEGER) DESC LIMIT 1`).get(subjectType, subjectId, selection.profile_version);
    const supersedesProfileId = previous?.nutrition_profile_id ?? null;
    const existing = database.prepare(`SELECT nutrition_profile_id, source_type, source_ref, coverage_status,
            supersedes_profile_id, payload_json
     FROM nutrition_profiles
     WHERE subject_type = ? AND subject_id = ? AND profile_version = ?`).get(subjectType, subjectId, String(selection.profile_version));
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
    const eventPayload = parseCanonical(event.payload_json, "terminal_event");
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
        const amount = itemPayload.amount;
        const snapshots = input.database.prepare(`SELECT source_type, profile_version, payload_json FROM nutrition_snapshots
       WHERE intake_item_id = ? ORDER BY snapshot_id`).all(item.item_id);
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
        const transactions = input.database.prepare(`SELECT transaction_id FROM inventory_transactions
       WHERE event_id = ? AND idempotency_key = ? ORDER BY transaction_id`).all(event.event_id, mealEffectId(input.idempotencyKey, item.item_order, 0));
        if (transactions.length > 1) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_transaction");
        }
        const transactionId = transactions[0]?.transaction_id ?? null;
        const inventoryMatch = transactionId !== null
            ? "matched"
            : input.location === "outside"
                ? "skipped_outside"
                : issueCodes[0] === "inventory_multiple_candidates"
                    ? "skipped_ambiguous"
                    : issueCodes[0] === "inventory_insufficient"
                        ? "skipped_insufficient"
                        : issueCodes[0] === "inventory_unit_incompatible"
                            ? "skipped_unit_incompatible"
                            : issueCodes[0] === "inventory_amount_unknown"
                                ? "skipped_amount_unknown"
                                : (() => { throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_inventory"); })();
        const profileVersion = Number(snapshot.profile_version);
        if (!Number.isSafeInteger(profileVersion) || profileVersion < 1) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:terminal_snapshot");
        }
        const adoption = amount.nutrition_adoption_microunits;
        const deduction = amount.inventory_deduction_microunits;
        return Object.freeze({
            item_order: item.item_order,
            normalized_name: item.normalized_name,
            unit: String(amount.unit),
            inventory_match: inventoryMatch,
            inventory_transaction_id: transactionId,
            issue_codes: issueCodes,
            observed_microunits: Number(amount.observed_microunits),
            nutrition_adoption_microunits: adoption === null ? null : Number(adoption),
            inventory_deduction_microunits: deduction === null ? null : Number(deduction),
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
        const eventPayload = parseCanonical(event.payload_json, "event");
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
            const amount = payload.amount;
            const candidates = input.location === "outside" ? [] : inventoryCandidates(input.database, item.normalized_name);
            const adoptionValue = amount.nutrition_adoption_microunits;
            const deductionValue = amount.inventory_deduction_microunits;
            const adoptedMicrounits = adoptionValue === null ? null : Number(adoptionValue);
            const deductionMicrounits = deductionValue === null ? null : Number(deductionValue);
            const decision = resolveInventoryMatch({
                location: input.location,
                requested_unit: String(amount.unit),
                observed_microunits: Number(amount.observed_microunits),
                nutrition_adoption_microunits: adoptedMicrounits,
                inventory_deduction_microunits: deductionMicrounits,
                template_reference_microunits: amount.template_reference_microunits === null
                    ? null : Number(amount.template_reference_microunits),
                candidates,
            });
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
            if (input.fault === "after_nutrition") {
                throw new Error("NUTRITION_EFFECT_WRITE_FAILED:after_nutrition");
            }
            const transactionId = writeMealDeduction(input.database, input, event, item, decision);
            writeMealIssue(input.database, input, event, item, decision);
            progress = addNutritionVectors(progress, scaledNutrients);
            results.push(Object.freeze({
                item_order: item.item_order,
                normalized_name: item.normalized_name,
                unit: String(amount.unit),
                inventory_match: decision.status,
                inventory_transaction_id: transactionId,
                issue_codes: Object.freeze(decision.issue_code ? [decision.issue_code] : []),
                observed_microunits: Number(amount.observed_microunits),
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
            outboxes.some((outbox) => outbox.state !== "pending" || expectedKinds.get(outbox.effect_id) !== outbox.effect_kind) ||
            checkpointPayload.effects.some((effect, index) => {
                if (typeof effect !== "object" || effect === null || Array.isArray(effect))
                    return true;
                const value = effect;
                return Object.keys(value).sort().join("\u0000") !== "effect_id\u0000state" ||
                    value.effect_id !== outboxes[index]?.effect_id || value.state !== outboxes[index]?.state;
            })) {
            if (checkpointPayload.data_revision !== computeRepositoryDataRevision(input.database)) {
                throw new Error("PREVIEW_STALE:data_revision");
            }
            throw new Error("CORRECTION_EFFECT_INVALID:checkpoint_payload");
        }
        const correctionEvent = input.database.prepare(`SELECT event_id, source_message_id, conversation_id, received_at
       FROM event_records WHERE envelope_id = ? AND operation_id = ?
         AND event_type = 'diet_correction'`).get(input.envelopeId, input.operationId);
        const correction = input.database.prepare(`SELECT correction_id, target_event_id, base_revision, operation, payload_json
       FROM correction_events WHERE request_id = ?`).get(input.operationId);
        if (!correctionEvent || !correction)
            throw new Error("CORRECTION_EFFECT_INVALID:fact");
        const payload = parseCanonical(correction.payload_json, "correction_fact");
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
            Object.keys(nutritionDelta).join("\u0000") !== "items" ||
            !Array.isArray(inventoryIntent.items) || !Array.isArray(nutritionDelta.items) ||
            inventoryIntent.items.length === 0 ||
            inventoryIntent.items.length !== nutritionDelta.items.length)
            throw new Error("CORRECTION_EFFECT_INVALID:intents");
        const inventoryIntents = inventoryIntent.items;
        const nutritionIntents = nutritionDelta.items;
        const expectedItemCount = correction.operation === "change_amount"
            ? 1
            : beforeSnapshot.items.length;
        if (inventoryIntents.length !== expectedItemCount) {
            throw new Error("CORRECTION_EFFECT_INVALID:intent_count");
        }
        const target = input.database.prepare(`SELECT e.envelope_id, e.operation_id, e.source_message_id, e.conversation_id,
              e.received_at, e.payload_json, c.idempotency_key
       FROM event_records e JOIN command_envelopes c ON c.envelope_id = e.envelope_id
       WHERE e.event_id = ? AND e.event_type = 'diet_meal'`).get(correction.target_event_id);
        if (!target)
            throw new Error("CORRECTION_EFFECT_INVALID:target");
        const targetPayload = parseCanonical(target.payload_json, "correction_target");
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
                (correction.operation !== "change_amount" && itemOrder !== intentIndex))
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
            const originalTransactionId = deriveDomainId("transaction", target.idempotency_key, itemOrder);
            const originalTransaction = input.database.prepare(`SELECT transaction_id, product_id, batch_id, direction, unit, payload_json
         FROM inventory_transactions
         WHERE transaction_id = ? AND event_id = ? AND direction = 'out'
           AND reason_code = 'meal_consumption' AND lifecycle_status = 'active'`).get(originalTransactionId, correction.target_event_id);
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
                    if (Object.keys(ledgerPayload).sort().join("\u0000") !== [
                        "authority_kind",
                        "quantity_after_microunits",
                        "quantity_delta_microunits",
                        "unit",
                    ].sort().join("\u0000") ||
                        ledgerPayload.authority_kind !== "diet-manager/inventory-transaction/v1" ||
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
            const item = beforeSnapshot.items[itemOrder];
            const previousNutrition = input.database.prepare(`SELECT snapshot_id, meal_event_id, intake_item_id, nutrition_profile_id,
                profile_version, source_type, source_ref, payload_json
         FROM nutrition_snapshots WHERE intake_item_id = ? ORDER BY rowid DESC LIMIT 1`).get(item.item_id);
            if (!previousNutrition)
                throw new Error("CORRECTION_EFFECT_INVALID:nutrition_missing");
            const previousNutritionPayload = parseCanonical(previousNutrition.payload_json, "correction_nutrition");
            if (typeof previousNutritionPayload.nutrients !== "object" ||
                previousNutritionPayload.nutrients === null) {
                throw new Error("CORRECTION_EFFECT_INVALID:nutrition_payload");
            }
            const itemBeforeNutrients = previousNutritionPayload.nutrients;
            const itemAfterNutrients = correctedNutrition(previousNutritionPayload, afterSnapshot.active ? afterAmount.nutrition_adoption_microunits : 0, afterSnapshot.active);
            beforeNutrients = addNutritionVectors(beforeNutrients, itemBeforeNutrients);
            afterNutrients = addNutritionVectors(afterNutrients, itemAfterNutrients);
            input.database.prepare(`INSERT INTO nutrition_snapshots(
          snapshot_id, schema_version, meal_event_id, intake_item_id,
          nutrition_profile_id, profile_version, source_type, source_ref,
          coverage_status, created_at, payload_json
        ) VALUES (?, 'domain/v2', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(deriveDomainId("snapshot", input.idempotencyKey, itemOrder), correction.target_event_id, item.item_id, previousNutrition.nutrition_profile_id, previousNutrition.profile_version, previousNutrition.source_type, previousNutrition.source_ref, Object.values(itemAfterNutrients).every((value) => value !== null) ? "complete" : "partial", input.now, canonicalJson({
                amount: afterAmount,
                authority_kind: "diet-manager/nutrition-snapshot/v1",
                basis: previousNutritionPayload.basis,
                conversion: afterSnapshot.active && afterAmount.nutrition_adoption_microunits !== null
                    ? {
                        adopted_microunits: afterAmount.nutrition_adoption_microunits,
                        formula: "round_half_up(nutrient*adopted_microunits/basis_microunits)",
                    }
                    : null,
                correction_id: correction.correction_id,
                nutrients: itemAfterNutrients,
                source_nutrients: previousNutritionPayload.source_nutrients,
            }));
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
        for (const outbox of outboxes) {
            const nextState = skippedCompensationEffectIds.has(outbox.effect_id)
                ? "permanent_business_skip"
                : "succeeded";
            input.database.prepare(`UPDATE effect_outbox SET state = ?, updated_at = ?
         WHERE envelope_id = ? AND operation_id = ? AND effect_id = ? AND state = 'pending'`).run(nextState, input.now, input.envelopeId, input.operationId, outbox.effect_id);
            if (changed(input.database) !== 1) {
                throw new Error("CORRECTION_EFFECT_INVALID:outbox_cas");
            }
        }
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
            c.operation, c.payload_json, e.event_id
     FROM correction_events c
     JOIN event_records e ON e.operation_id = c.request_id AND e.event_type = 'diet_correction'
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
