import { canonicalJson } from "../authority/canonical-json.js";
import { assertEffectTransition, assertEnvelopeTransition, } from "../state/transition-guard.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
import { parseInventoryProjectionRow, } from "./query.js";
const INPUT_FIELDS = ["database", "now", "outboxId"];
const ADD_FIELDS = [
    "batch",
    "kind",
    "product",
    "quantity_microunits",
    "reason_code",
    "transaction_id",
    "unit",
];
const DEDUCT_FIELDS = [
    "batch_id",
    "kind",
    "product_id",
    "quantity_microunits",
    "reason_code",
    "transaction_id",
    "unit",
];
const PRODUCT_FIELDS = [
    "normalized_name",
    "payload",
    "product_id",
    "product_type",
    "schema_version",
];
const BATCH_FIELDS = [
    "batch_id",
    "explicit_expiration_at",
    "payload",
    "quantity_unit",
    "schema_version",
    "stocked_at",
];
function invalid(reason) {
    throw new TypeError(`INVENTORY_EFFECT_REQUEST_INVALID:${reason}`);
}
function authorityInvalid(reason) {
    throw new Error(`INVENTORY_EFFECT_AUTHORITY_INVALID:${reason}`);
}
function exactDataProperties(value, fields) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return invalid("shape");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") ||
        keys.sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
        return invalid("shape");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const field of fields) {
        const descriptor = descriptors[field];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            return invalid("descriptor");
        }
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        return invalid("prototype");
    return descriptors;
}
function exactJsonObject(value, fields) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return authorityInvalid("effect_shape");
    }
    const record = value;
    if (Object.keys(record).sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
        return authorityInvalid("effect_shape");
    }
    return record;
}
function ascii(value, field, maxLength = 256) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > maxLength ||
        !/^[\x20-\x7E]+$/.test(value)) {
        return authorityInvalid(field);
    }
    return value;
}
function text(value, field, maxLength = 512) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > maxLength ||
        /[\u0000-\u001F\u007F]/.test(value)) {
        return authorityInvalid(field);
    }
    return value;
}
function timestamp(value, field) {
    if (typeof value !== "string")
        return authorityInvalid(field);
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
        return authorityInvalid(field);
    }
    return value;
}
function positiveMicrounits(value) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        return authorityInvalid("quantity_microunits");
    }
    return value;
}
function freezeInput(value) {
    const fields = exactDataProperties(value, INPUT_FIELDS);
    if (typeof fields.database.value !== "object" || fields.database.value === null) {
        return invalid("database");
    }
    return Object.freeze({
        database: fields.database.value,
        outboxId: ascii(fields.outboxId.value, "outbox_id"),
        now: timestamp(fields.now.value, "now"),
    });
}
function freezeOptions(value) {
    if (value === undefined)
        return Object.freeze({});
    const fields = exactDataProperties(value, ["fault"]);
    if (![
        "after_claim",
        "after_business_writes",
        "after_outbox",
        "after_bundle",
        "before_commit",
        "after_commit_before_reply",
    ].includes(String(fields.fault.value))) {
        return invalid("fault");
    }
    return Object.freeze({ fault: fields.fault.value });
}
function injectFault(options, point) {
    if (options.fault === point)
        throw new Error(`INVENTORY_EFFECT_FAILED:${point}`);
}
function readOutbox(database, outboxId) {
    const rows = database
        .prepare(`SELECT
        o.*, e.event_id, e.source_message_id, e.conversation_id,
        e.received_at, e.committed_at, e.payload_json AS event_payload_json
       FROM effect_outbox o
       JOIN event_records e
         ON e.envelope_id = o.envelope_id AND e.operation_id = o.operation_id
       WHERE o.outbox_id = ?
       ORDER BY e.event_id`)
        .all(outboxId);
    if (rows.length !== 1)
        return authorityInvalid("outbox");
    return rows[0];
}
function effectValue(row) {
    let payload;
    try {
        payload = JSON.parse(row.event_payload_json);
    }
    catch {
        return authorityInvalid("event_payload");
    }
    if (canonicalJson(payload) !== row.event_payload_json) {
        return authorityInvalid("event_payload_canonical");
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        return authorityInvalid("event_payload");
    }
    const effectInputs = payload.effect_inputs;
    if (typeof effectInputs !== "object" ||
        effectInputs === null ||
        Array.isArray(effectInputs) ||
        !Object.hasOwn(effectInputs, row.effect_id)) {
        return authorityInvalid("effect_input");
    }
    return effectInputs[row.effect_id];
}
function parseAdd(value) {
    const source = exactJsonObject(value, ADD_FIELDS);
    if (source.kind !== "inventory_add")
        return authorityInvalid("effect_kind");
    const product = exactJsonObject(source.product, PRODUCT_FIELDS);
    const batch = exactJsonObject(source.batch, BATCH_FIELDS);
    const explicitExpirationAt = batch.explicit_expiration_at === null
        ? null
        : timestamp(batch.explicit_expiration_at, "explicit_expiration_at");
    return Object.freeze({
        kind: "inventory_add",
        transactionId: ascii(source.transaction_id, "transaction_id"),
        reasonCode: ascii(source.reason_code, "reason_code", 128),
        quantityMicrounits: positiveMicrounits(source.quantity_microunits),
        unit: ascii(source.unit, "unit", 128),
        product: Object.freeze({
            productId: ascii(product.product_id, "product_id"),
            schemaVersion: ascii(product.schema_version, "product_schema_version", 128),
            normalizedName: text(product.normalized_name, "normalized_name"),
            productType: ascii(product.product_type, "product_type", 128),
            payloadJson: canonicalJson(product.payload),
        }),
        batch: Object.freeze({
            batchId: ascii(batch.batch_id, "batch_id"),
            schemaVersion: ascii(batch.schema_version, "batch_schema_version", 128),
            stockedAt: timestamp(batch.stocked_at, "stocked_at"),
            explicitExpirationAt,
            quantityUnit: ascii(batch.quantity_unit, "quantity_unit", 128),
            payloadJson: canonicalJson(batch.payload),
        }),
    });
}
function parseDeduct(value) {
    const source = exactJsonObject(value, DEDUCT_FIELDS);
    if (source.kind !== "inventory_deduct")
        return authorityInvalid("effect_kind");
    return Object.freeze({
        kind: "inventory_deduct",
        transactionId: ascii(source.transaction_id, "transaction_id"),
        reasonCode: ascii(source.reason_code, "reason_code", 128),
        productId: ascii(source.product_id, "product_id"),
        batchId: ascii(source.batch_id, "batch_id"),
        quantityMicrounits: positiveMicrounits(source.quantity_microunits),
        unit: ascii(source.unit, "unit", 128),
    });
}
function parseIntent(row) {
    const value = effectValue(row);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return authorityInvalid("effect_input");
    }
    const kind = value.kind;
    const intent = kind === "inventory_add" ? parseAdd(value) : parseDeduct(value);
    if (row.effect_kind !== intent.kind)
        return authorityInvalid("outbox_effect_kind");
    return intent;
}
function projectionPayload(batchId, productId, quantityMicrounits, unit) {
    return canonicalJson({
        authority_kind: "diet-manager/inventory-projection/v1",
        batch_id: batchId,
        product_id: productId,
        quantity_microunits: quantityMicrounits,
        unit,
    });
}
function transactionPayload(deltaMicrounits, quantityAfterMicrounits, unit) {
    return canonicalJson({
        authority_kind: "diet-manager/inventory-transaction/v1",
        quantity_after_microunits: quantityAfterMicrounits,
        quantity_delta_microunits: deltaMicrounits,
        unit,
    });
}
function insertTransaction(database, row, intent, productId, batchId, direction, deltaMicrounits, quantityAfterMicrounits, now) {
    database
        .prepare(`INSERT INTO inventory_transactions(
        transaction_id, event_id, product_id, batch_id, idempotency_key,
        schema_version, direction, reason_code, unit, related_event_id,
        related_transaction_id, source_message_id, conversation_id, received_at,
        committed_at, result_status, lifecycle_status, payload_json
      ) VALUES (?, ?, ?, ?, ?, 'domain/v2', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 'applied', 'active', ?)`)
        .run(intent.transactionId, row.event_id, productId, batchId, row.effect_id, direction, intent.reasonCode, intent.unit, row.source_message_id, row.conversation_id, row.received_at, now, transactionPayload(deltaMicrounits, quantityAfterMicrounits, intent.unit));
}
function writeProjection(database, batchId, productId, eventId, now, quantityMicrounits, unit, explicitExpirationAt) {
    const empty = quantityMicrounits === 0;
    database
        .prepare(`INSERT INTO inventory_batch_projections(
        batch_id, last_event_id, last_changed_at, last_verified_at,
        quantity_status, seal_status, expiry_status, effective_status,
        effective_expiration_at, payload_json
      ) VALUES (?, ?, ?, NULL, ?, 'unknown', 'unknown', ?, ?, ?)
      ON CONFLICT(batch_id) DO UPDATE SET
        last_event_id = excluded.last_event_id,
        last_changed_at = excluded.last_changed_at,
        quantity_status = excluded.quantity_status,
        effective_status = excluded.effective_status,
        effective_expiration_at = excluded.effective_expiration_at,
        payload_json = excluded.payload_json`)
        .run(batchId, eventId, now, empty ? "empty" : "available", empty ? "empty" : "active", explicitExpirationAt, projectionPayload(batchId, productId, quantityMicrounits, unit));
}
function applyAdd(database, row, intent, now) {
    if (intent.batch.quantityUnit !== intent.unit)
        return authorityInvalid("quantity_unit");
    const product = database
        .prepare("SELECT * FROM products WHERE product_id = ?")
        .get(intent.product.productId);
    if (product) {
        if (product.schema_version !== intent.product.schemaVersion ||
            product.normalized_name !== intent.product.normalizedName ||
            product.product_type !== intent.product.productType ||
            product.payload_json !== intent.product.payloadJson ||
            product.brand !== null ||
            product.manufacturer !== null ||
            product.barcode !== null ||
            product.sku !== null) {
            return authorityInvalid("product_conflict");
        }
    }
    else {
        database
            .prepare(`INSERT INTO products(
          product_id, schema_version, normalized_name, product_type,
          brand, manufacturer, barcode, sku, payload_json
        ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`)
            .run(intent.product.productId, intent.product.schemaVersion, intent.product.normalizedName, intent.product.productType, intent.product.payloadJson);
    }
    const existingBatch = database
        .prepare("SELECT batch_id FROM inventory_batches WHERE batch_id = ?")
        .get(intent.batch.batchId);
    if (existingBatch)
        return authorityInvalid("batch_conflict");
    database
        .prepare(`INSERT INTO inventory_batches(
        batch_id, product_id, stock_event_id, schema_version, committed_at,
        stocked_at, explicit_expiration_at, quantity_unit, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(intent.batch.batchId, intent.product.productId, row.event_id, intent.batch.schemaVersion, now, intent.batch.stockedAt, intent.batch.explicitExpirationAt, intent.batch.quantityUnit, intent.batch.payloadJson);
    insertTransaction(database, row, intent, intent.product.productId, intent.batch.batchId, "in", intent.quantityMicrounits, intent.quantityMicrounits, now);
    writeProjection(database, intent.batch.batchId, intent.product.productId, row.event_id, now, intent.quantityMicrounits, intent.unit, intent.batch.explicitExpirationAt);
    return Object.freeze({
        outbox_id: row.outbox_id,
        effect_id: row.effect_id,
        effect_state: "succeeded",
        result_status: "applied",
        batch_id: intent.batch.batchId,
        transaction_id: intent.transactionId,
        quantity_microunits: intent.quantityMicrounits,
        unit: intent.unit,
    });
}
function currentProjection(database, batchId) {
    const row = database
        .prepare("SELECT * FROM inventory_batch_projections WHERE batch_id = ?")
        .get(batchId);
    if (!row)
        return authorityInvalid("projection_missing");
    return parseInventoryProjectionRow(row);
}
function skipReason(projection) {
    return canonicalJson({
        code: "INSUFFICIENT_INVENTORY",
        quantity_microunits: projection.quantity_microunits,
        unit: projection.unit,
    });
}
function applyDeduct(database, row, intent, now) {
    const batch = database
        .prepare("SELECT product_id, quantity_unit, explicit_expiration_at FROM inventory_batches WHERE batch_id = ?")
        .get(intent.batchId);
    if (!batch)
        return authorityInvalid("batch_missing");
    if (batch.product_id !== intent.productId)
        return authorityInvalid("product_id");
    if (batch.quantity_unit !== intent.unit)
        return authorityInvalid("quantity_unit");
    const projection = currentProjection(database, intent.batchId);
    if (projection.product_id !== intent.productId || projection.unit !== intent.unit) {
        return authorityInvalid("projection_identity");
    }
    if (projection.quantity_microunits < intent.quantityMicrounits) {
        return Object.freeze({
            outbox_id: row.outbox_id,
            effect_id: row.effect_id,
            effect_state: "permanent_business_skip",
            result_status: "insufficient_inventory",
            batch_id: intent.batchId,
            transaction_id: null,
            quantity_microunits: projection.quantity_microunits,
            unit: intent.unit,
        });
    }
    const remaining = projection.quantity_microunits - intent.quantityMicrounits;
    if (!Number.isSafeInteger(remaining) || remaining < 0) {
        return authorityInvalid("negative_quantity");
    }
    insertTransaction(database, row, intent, intent.productId, intent.batchId, "out", -intent.quantityMicrounits, remaining, now);
    writeProjection(database, intent.batchId, intent.productId, row.event_id, now, remaining, intent.unit, batch.explicit_expiration_at);
    return Object.freeze({
        outbox_id: row.outbox_id,
        effect_id: row.effect_id,
        effect_state: "succeeded",
        result_status: "applied",
        batch_id: intent.batchId,
        transaction_id: intent.transactionId,
        quantity_microunits: remaining,
        unit: intent.unit,
    });
}
function updateOutbox(database, result, now) {
    assertEffectTransition("processing", result.effect_state);
    const reason = result.effect_state === "permanent_business_skip"
        ? skipReason({
            batch_id: result.batch_id,
            product_id: "unused",
            quantity_microunits: result.quantity_microunits,
            unit: result.unit,
            quantity_status: result.quantity_microunits === 0 ? "empty" : "available",
            effective_status: result.quantity_microunits === 0 ? "empty" : "active",
            last_event_id: "unused",
            last_changed_at: now,
        })
        : null;
    database
        .prepare(`UPDATE effect_outbox
       SET state = ?, reason = ?, updated_at = ?
       WHERE outbox_id = ? AND state = 'processing'`)
        .run(result.effect_state, reason, now, result.outbox_id);
    const changes = database.prepare("SELECT changes() AS count").get();
    if (changes.count !== 1)
        return authorityInvalid("outbox_compare_and_set");
}
function finalizeBundleIfTerminal(database, row, now) {
    const effects = database
        .prepare("SELECT effect_id, state FROM effect_outbox WHERE envelope_id = ? ORDER BY effect_id")
        .all(row.envelope_id);
    if (effects.some((effect) => effect.state !== "succeeded" && effect.state !== "permanent_business_skip")) {
        return;
    }
    const skipped = effects.some((effect) => effect.state === "permanent_business_skip");
    database
        .prepare(`INSERT INTO effect_bundle_commits(
        envelope_id, operation_id, stage, effect_state, result_status,
        completed_at, payload_json
      ) VALUES (?, ?, 'EffectBundle', ?, ?, ?, ?)`)
        .run(row.envelope_id, row.operation_id, skipped ? "permanent_business_skip" : "succeeded", skipped ? "applied_with_issues" : "applied", now, canonicalJson({
        authority_kind: "diet-manager/effect-bundle/v1",
        effects,
    }));
    assertEnvelopeTransition("effects_pending", "effects_stable");
    database
        .prepare(`UPDATE command_envelopes
       SET state = 'effects_stable', result_status = 'effects_stable'
       WHERE envelope_id = ? AND state = 'effects_pending'
         AND result_status = 'facts_committed_effects_pending'`)
        .run(row.envelope_id);
    let changes = database.prepare("SELECT changes() AS count").get();
    if (changes.count !== 1)
        return authorityInvalid("envelope_compare_and_set");
    database
        .prepare(`UPDATE idempotency_records
       SET state = 'effects_stable', updated_at = ?
       WHERE operation_id = ? AND state = 'effects_pending'
         AND terminal_result_json IS NULL`)
        .run(now, row.envelope_id);
    changes = database.prepare("SELECT changes() AS count").get();
    if (changes.count !== 1)
        return authorityInvalid("idempotency_compare_and_set");
}
function transactionResult(row, transaction) {
    let parsed;
    try {
        parsed = JSON.parse(transaction.payload_json);
    }
    catch {
        return authorityInvalid("transaction_payload");
    }
    if (canonicalJson(parsed) !== transaction.payload_json) {
        return authorityInvalid("transaction_payload_canonical");
    }
    const payload = exactJsonObject(parsed, [
        "authority_kind",
        "quantity_after_microunits",
        "quantity_delta_microunits",
        "unit",
    ]);
    if (payload.authority_kind !== "diet-manager/inventory-transaction/v1" ||
        !Number.isSafeInteger(payload.quantity_after_microunits) ||
        payload.quantity_after_microunits < 0 ||
        payload.unit !== transaction.unit) {
        return authorityInvalid("transaction_payload_authority");
    }
    return Object.freeze({
        outbox_id: row.outbox_id,
        effect_id: row.effect_id,
        effect_state: "succeeded",
        result_status: "applied",
        batch_id: transaction.batch_id,
        transaction_id: transaction.transaction_id,
        quantity_microunits: payload.quantity_after_microunits,
        unit: transaction.unit,
    });
}
function replayResult(database, row) {
    if (row.state === "succeeded") {
        const transaction = database
            .prepare("SELECT * FROM inventory_transactions WHERE transaction_id = ?")
            .get(row.effect_id);
        if (!transaction) {
            const intent = parseIntent(row);
            const byIntent = database
                .prepare("SELECT * FROM inventory_transactions WHERE transaction_id = ?")
                .get(intent.transactionId);
            if (!byIntent)
                return authorityInvalid("transaction_missing");
            return transactionResult(row, byIntent);
        }
        return transactionResult(row, transaction);
    }
    if (row.state !== "permanent_business_skip" || row.reason === null) {
        return authorityInvalid("replay_state");
    }
    let parsed;
    try {
        parsed = JSON.parse(row.reason);
    }
    catch {
        return authorityInvalid("skip_reason");
    }
    const reason = exactJsonObject(parsed, ["code", "quantity_microunits", "unit"]);
    const intent = parseIntent(row);
    if (reason.code !== "INSUFFICIENT_INVENTORY" ||
        !Number.isSafeInteger(reason.quantity_microunits) ||
        reason.quantity_microunits < 0 ||
        reason.unit !== intent.unit) {
        return authorityInvalid("skip_reason");
    }
    return Object.freeze({
        outbox_id: row.outbox_id,
        effect_id: row.effect_id,
        effect_state: "permanent_business_skip",
        result_status: "insufficient_inventory",
        batch_id: intent.kind === "inventory_add" ? intent.batch.batchId : intent.batchId,
        transaction_id: null,
        quantity_microunits: reason.quantity_microunits,
        unit: intent.unit,
    });
}
export function listPendingInventoryEffects(input) {
    const fields = exactDataProperties(input, ["database", "limit"]);
    if (typeof fields.database.value !== "object" || fields.database.value === null) {
        return invalid("database");
    }
    if (!Number.isSafeInteger(fields.limit.value) ||
        fields.limit.value < 1 ||
        fields.limit.value > 1_000) {
        return invalid("limit");
    }
    const database = fields.database.value;
    assertCurrentMigrationAuthority(database);
    const rows = database
        .prepare(`SELECT
        outbox_id, envelope_id, operation_id, effect_id, effect_kind,
        state, attempt_count, created_at, updated_at
       FROM effect_outbox
       WHERE state IN ('pending', 'retryable_failed')
         AND effect_kind IN ('inventory_add', 'inventory_deduct')
       ORDER BY created_at, outbox_id
       LIMIT ?`)
        .all(fields.limit.value);
    for (const row of rows) {
        if ((row.effect_kind !== "inventory_add" && row.effect_kind !== "inventory_deduct") ||
            (row.state !== "pending" && row.state !== "retryable_failed") ||
            !Number.isSafeInteger(row.attempt_count) ||
            row.attempt_count < 0) {
            return authorityInvalid("pending_row");
        }
        Object.freeze(row);
    }
    return Object.freeze(rows);
}
export function processInventoryEffect(input, options) {
    const frozen = freezeInput(input);
    const frozenOptions = freezeOptions(options);
    let transactionOpen = false;
    let committed = false;
    try {
        frozen.database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        assertCurrentMigrationAuthority(frozen.database);
        const row = readOutbox(frozen.database, frozen.outboxId);
        if (row.state === "succeeded" || row.state === "permanent_business_skip") {
            const replay = replayResult(frozen.database, row);
            frozen.database.exec("ROLLBACK");
            transactionOpen = false;
            return replay;
        }
        if (row.state !== "pending" && row.state !== "retryable_failed") {
            return authorityInvalid("state");
        }
        assertEffectTransition(row.state, "processing");
        frozen.database
            .prepare(`UPDATE effect_outbox
         SET state = 'processing', attempt_count = attempt_count + 1, updated_at = ?
         WHERE outbox_id = ? AND state = ?`)
            .run(frozen.now, row.outbox_id, row.state);
        const changes = frozen.database.prepare("SELECT changes() AS count").get();
        if (changes.count !== 1)
            return authorityInvalid("claim_compare_and_set");
        injectFault(frozenOptions, "after_claim");
        const intent = parseIntent(row);
        const result = intent.kind === "inventory_add"
            ? applyAdd(frozen.database, row, intent, frozen.now)
            : applyDeduct(frozen.database, row, intent, frozen.now);
        injectFault(frozenOptions, "after_business_writes");
        updateOutbox(frozen.database, result, frozen.now);
        injectFault(frozenOptions, "after_outbox");
        finalizeBundleIfTerminal(frozen.database, row, frozen.now);
        injectFault(frozenOptions, "after_bundle");
        injectFault(frozenOptions, "before_commit");
        frozen.database.exec("COMMIT");
        transactionOpen = false;
        committed = true;
        if (frozenOptions.fault === "after_commit_before_reply") {
            throw new Error("INVENTORY_EFFECT_RESPONSE_LOST:after_commit_before_reply");
        }
        return result;
    }
    catch (error) {
        if (transactionOpen) {
            try {
                frozen.database.exec("ROLLBACK");
            }
            catch {
                // Preserve the primary effect failure.
            }
        }
        if (committed)
            throw error;
        throw error;
    }
}
