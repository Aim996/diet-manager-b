import { canonicalJson, canonicalSha256 } from "../authority/canonical-json.js";
import { processInventoryEffect, } from "../repository/inventory-effects.js";
import { computeRepositoryDataRevision } from "../repository/revision.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
import { deriveDomainId } from "./identity.js";
import { toNaturalDate } from "./identity.js";
import { addNutritionVectors, resolveInventoryMatch, scaleNutritionVector, selectNutritionSource, } from "./rules.js";
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
    const effectId = deriveDomainId("effect", input.idempotencyKey, input.sequence);
    const outboxId = deriveDomainId("outbox", input.idempotencyKey, input.sequence);
    const transactionId = deriveDomainId("transaction", input.idempotencyKey, input.sequence);
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
                outboxId: deriveDomainId("outbox", input.idempotencyKey, itemOrder * 10),
                effectId: mealEffectId(input.idempotencyKey, itemOrder, 0),
                effectKind: "inventory_deduct",
                previousState: null,
                reason: null,
            }));
            effects.push(Object.freeze({
                outboxId: deriveDomainId("outbox", input.idempotencyKey, itemOrder * 10 + 1),
                effectId: mealEffectId(input.idempotencyKey, itemOrder, 1),
                effectKind: "issue_projection",
                previousState: null,
                reason: null,
            }));
        }
        effects.push(Object.freeze({
            outboxId: deriveDomainId("outbox", input.idempotencyKey, itemOrder * 10 + 2),
            effectId: mealEffectId(input.idempotencyKey, itemOrder, 2),
            effectKind: "nutrition_snapshot",
            previousState: null,
            reason: null,
        }));
    }
    effects.push(Object.freeze({
        outboxId: deriveDomainId("outbox", input.idempotencyKey, operation.items.length * 10 + 9),
        effectId: mealEffectId(input.idempotencyKey, operation.items.length, 9),
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
            outboxes[index]?.state !== "pending")
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:checkpoint_effects");
    });
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
            database.prepare(`UPDATE effect_outbox SET state = ?, updated_at = ?
         WHERE envelope_id = ? AND operation_id = ? AND effect_id = ? AND state = 'pending'`).run(inventoryState, input.now, input.envelopeId, input.operationId, mealEffectId(input.idempotencyKey, item.item_order, 0));
            if (changed(database) !== 1)
                throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:inventory_outbox_compare_and_set");
        }
        database.prepare(`UPDATE effect_outbox SET state = 'succeeded', updated_at = ?
       WHERE envelope_id = ? AND operation_id = ? AND effect_id IN (?, ?) AND state = 'pending'`).run(input.now, input.envelopeId, input.operationId, mealEffectId(input.idempotencyKey, item.item_order, 1), mealEffectId(input.idempotencyKey, item.item_order, 2));
        if (changed(database) !== (input.location === "home" ? 2 : 1)) {
            throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:item_outbox_compare_and_set");
        }
    }
    database.prepare(`UPDATE effect_outbox SET state = 'succeeded', updated_at = ?
     WHERE envelope_id = ? AND operation_id = ? AND effect_kind = 'daily_progress_contribution'
       AND state = 'pending'`).run(input.now, input.envelopeId, input.operationId);
    if (changed(database) !== 1)
        throw new Error("MEAL_EFFECT_AUTHORITY_INVALID:progress_outbox_compare_and_set");
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
        assertPendingMealCheckpoint(input.database, checkpoint, input.envelopeId, input.operationId, input.operationSequence, input.idempotencyKey, input.location);
        const checkpointPayload = parseCanonical(checkpoint.payload_json, "checkpoint");
        if (checkpointPayload.data_revision !== computeRepositoryDataRevision(input.database)) {
            throw new Error("PREVIEW_STALE:data_revision");
        }
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
            if (input.fault === "after_nutrition")
                throw new Error("MEAL_EFFECT_FAILED:after_nutrition");
            const transactionId = writeMealDeduction(input.database, input, event, item, decision);
            writeMealIssue(input.database, input, event, item, decision);
            progress = addNutritionVectors(progress, scaledNutrients);
            results.push(Object.freeze({
                item_order: item.item_order,
                normalized_name: item.normalized_name,
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
            sequence: 0,
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
