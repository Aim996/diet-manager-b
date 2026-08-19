import { createPurchaseFactIdentity, purchaseFactIdentityEquals, } from "../authority/purchase-fact-identity.js";
import { canonicalJson } from "../authority/canonical-json.js";
import { createMealFactIdentity, mealFactIdentityEquals, } from "../authority/meal-fact-identity.js";
import { authenticateStoredPreviewAuthority } from "../preview/store.js";
function invalid(reason) {
    throw new Error(`PURCHASE_EVENT_AUTHORITY_INVALID:${reason}`);
}
export function assertAuthenticatedPurchaseEventAuthority(database, authoritySecret, eventId) {
    const rows = database.prepare(`SELECT e.event_id, e.envelope_id, e.operation_id, e.schema_version,
            e.event_type, e.fact_kind, e.source_message_id, e.conversation_id,
            e.received_at, e.committed_at, e.occurred_at_text, e.meal_id, e.meal_slot, e.payload_json,
            c.idempotency_key, c.payload_json AS preview_payload_json,
            c.input_digest, c.received_at AS envelope_received_at, c.state AS envelope_state
     FROM event_records e
     JOIN command_envelopes c ON c.envelope_id = e.envelope_id
     WHERE e.event_id = ?`).all(eventId);
    const row = rows[0];
    if (rows.length !== 1 || row === undefined || row.event_id !== eventId ||
        row.schema_version !== "domain/v2" || row.event_type !== "inventory_stock" ||
        row.fact_kind !== "inventory" || row.occurred_at_text === null ||
        row.meal_id !== null || row.meal_slot !== null ||
        row.envelope_state !== "finalized")
        return invalid("event");
    let authority;
    try {
        authority = authenticateStoredPreviewAuthority(row.preview_payload_json, authoritySecret);
    }
    catch {
        return invalid("preview");
    }
    const material = authority.purchase_fact_preview_material;
    if (authority.preview_authority_kind !== "diet-manager/server-preview/v4" ||
        material === undefined || material.input_digest !== row.input_digest ||
        authority.binding.preview_id !== row.envelope_id ||
        authority.binding.input_digest !== row.input_digest ||
        row.envelope_received_at !== material.committed_at_base)
        return invalid("preview");
    const storedEnvelopeIds = database.prepare("SELECT event_id FROM event_records WHERE envelope_id = ? ORDER BY event_id").all(row.envelope_id);
    const expectedEnvelopeIds = [
        ...material.purchase_fact_identities.map((identity) => identity.event_id),
        ...material.meal_fact_identities.map((identity) => identity.event_id),
    ].sort();
    if (storedEnvelopeIds.length !== expectedEnvelopeIds.length ||
        storedEnvelopeIds.some((stored, index) => stored.event_id !== expectedEnvelopeIds[index]))
        return invalid("event_set");
    const storedRows = database.prepare(`SELECT event_id,envelope_id,operation_id,schema_version,event_type,fact_kind,
            source_message_id,conversation_id,received_at,committed_at,occurred_at_text,
            meal_id,meal_slot,payload_json
     FROM event_records
     WHERE envelope_id = ? AND event_type = 'inventory_stock'
     ORDER BY event_id`).all(row.envelope_id);
    const expectedIdentities = [...material.purchase_fact_identities]
        .sort((left, right) => left.event_id < right.event_id ? -1 : left.event_id > right.event_id ? 1 : 0);
    if (storedRows.length !== expectedIdentities.length ||
        storedRows.some((stored, index) => stored.event_id !== expectedIdentities[index]?.event_id))
        return invalid("event_set");
    for (let index = 0; index < storedRows.length; index += 1) {
        const stored = storedRows[index];
        const expected = expectedIdentities[index];
        if (stored === undefined || expected === undefined || stored.envelope_id !== row.envelope_id ||
            stored.operation_id !== expected.operation_id || stored.schema_version !== "domain/v2" ||
            stored.event_type !== "inventory_stock" || stored.fact_kind !== "inventory" ||
            stored.occurred_at_text === null || stored.meal_id !== null || stored.meal_slot !== null ||
            stored.committed_at !== new Date(Date.parse(material.committed_at_base) + expected.sequence).toISOString())
            return invalid("identity");
        let payload;
        try {
            payload = JSON.parse(stored.payload_json);
            if (canonicalJson(payload) !== stored.payload_json)
                return invalid("payload");
        }
        catch {
            return invalid("payload");
        }
        const actual = createPurchaseFactIdentity({
            sequence: expected.sequence,
            event_id: stored.event_id,
            operation_id: stored.operation_id,
            schema_version: stored.schema_version,
            event_type: stored.event_type,
            fact_kind: stored.fact_kind,
            source_message_id: stored.source_message_id,
            conversation_id: stored.conversation_id,
            received_at: stored.received_at,
            occurred_at_text: stored.occurred_at_text,
            meal_id: stored.meal_id,
            meal_slot: stored.meal_slot,
            payload,
        });
        if (!purchaseFactIdentityEquals(actual, expected))
            return invalid("identity");
    }
    const storedMeals = database.prepare(`SELECT event_id,envelope_id,operation_id,schema_version,event_type,fact_kind,
            source_message_id,conversation_id,received_at,committed_at,occurred_at_text,
            meal_id,meal_slot,payload_json
     FROM event_records
     WHERE envelope_id = ? AND event_type = 'diet_meal'
     ORDER BY event_id`).all(row.envelope_id);
    const expectedMeals = [...material.meal_fact_identities]
        .sort((left, right) => left.event_id < right.event_id ? -1 : left.event_id > right.event_id ? 1 : 0);
    if (storedMeals.length !== expectedMeals.length ||
        storedMeals.some((stored, index) => stored.event_id !== expectedMeals[index]?.event_id))
        return invalid("event_set");
    for (let index = 0; index < storedMeals.length; index += 1) {
        const stored = storedMeals[index];
        const expected = expectedMeals[index];
        if (stored === undefined || expected === undefined || stored.envelope_id !== row.envelope_id ||
            stored.operation_id !== expected.operation_id || stored.schema_version !== "domain/v2" ||
            stored.event_type !== "diet_meal" || stored.fact_kind !== "meal" ||
            stored.occurred_at_text === null || stored.meal_id === null || stored.meal_slot === null ||
            stored.committed_at !== new Date(Date.parse(material.committed_at_base) + expected.sequence).toISOString())
            return invalid("identity");
        let payload;
        try {
            payload = JSON.parse(stored.payload_json);
            if (canonicalJson(payload) !== stored.payload_json)
                return invalid("payload");
        }
        catch {
            return invalid("payload");
        }
        const items = database.prepare(`SELECT item_id,item_order,item_type,normalized_name,payload_json
       FROM meal_items WHERE event_id = ? ORDER BY item_order`).all(stored.event_id);
        let itemInputs;
        try {
            itemInputs = items.map((item) => {
                const itemPayload = JSON.parse(item.payload_json);
                if (canonicalJson(itemPayload) !== item.payload_json)
                    return invalid("meal_item");
                return Object.freeze({
                    item_id: item.item_id,
                    item_order: item.item_order,
                    item_type: item.item_type,
                    normalized_name: item.normalized_name,
                    payload: itemPayload,
                });
            });
        }
        catch {
            return invalid("meal_item");
        }
        const actual = createMealFactIdentity({
            sequence: expected.sequence,
            event_id: stored.event_id,
            operation_id: stored.operation_id,
            schema_version: "domain/v2",
            event_type: "diet_meal",
            fact_kind: "meal",
            source_message_id: stored.source_message_id,
            conversation_id: stored.conversation_id,
            received_at: stored.received_at,
            occurred_at_text: stored.occurred_at_text,
            meal_id: stored.meal_id,
            meal_slot: stored.meal_slot,
            payload,
            items: itemInputs,
        });
        if (!mealFactIdentityEquals(actual, expected))
            return invalid("identity");
    }
    const expected = expectedIdentities.find((identity) => identity.event_id === row.event_id && identity.operation_id === row.operation_id);
    if (expected === undefined)
        return invalid("identity");
    return Object.freeze({
        envelope_id: row.envelope_id,
        operation_id: row.operation_id,
        event_id: row.event_id,
        idempotency_key: row.idempotency_key,
        source_message_id: row.source_message_id,
        conversation_id: row.conversation_id,
        received_at: row.received_at,
        committed_at: row.committed_at,
        sequence: expected.sequence,
        envelope_event_count: storedEnvelopeIds.length,
        payload_json: row.payload_json,
    });
}
