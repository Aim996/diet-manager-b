import { canonicalJson } from "../authority/canonical-json.js";
import { dietManagerActions, } from "../contracts.js";
import { authorizeRepositoryPreview } from "../preview/store.js";
import { assertEnvelopeTransition } from "../state/transition-guard.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
import { computeRepositoryDataRevision } from "./revision.js";
const INPUT_FIELDS = [
    "commandType",
    "dataRevision",
    "database",
    "effects",
    "event",
    "inputDigest",
    "items",
    "secret",
    "subjectScope",
    "token",
    "traceId",
];
const OPERATION_INPUT_FIELDS = [
    "commandType",
    "dataRevision",
    "database",
    "effects",
    "event",
    "inputDigest",
    "items",
    "operationId",
    "secret",
    "sequence",
    "subjectScope",
    "token",
    "traceId",
];
const SEAL_INPUT_FIELDS = [
    "commandType",
    "dataRevision",
    "database",
    "expectedOperationIds",
    "inputDigest",
    "sealedAt",
    "secret",
    "subjectScope",
    "token",
    "traceId",
];
const EVENT_FIELDS = [
    "committedAt",
    "conversationId",
    "eventId",
    "eventType",
    "factKind",
    "mealId",
    "mealSlot",
    "occurredAtText",
    "operationId",
    "payload",
    "receivedAt",
    "schemaVersion",
    "sourceMessageId",
];
const ITEM_FIELDS = [
    "itemId",
    "itemOrder",
    "itemType",
    "normalizedName",
    "payload",
];
const EFFECT_FIELDS = [
    "effectId",
    "effectKind",
    "outboxId",
    "previousState",
    "reason",
];
function requestInvalid(reason) {
    throw new TypeError(`FACT_COMMIT_REQUEST_INVALID:${reason}`);
}
function exactDataProperties(value, fields) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return requestInvalid("shape");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") ||
        keys.sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
        return requestInvalid("shape");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const field of fields) {
        const descriptor = descriptors[field];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            return requestInvalid("descriptor");
        }
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return requestInvalid("prototype");
    }
    return descriptors;
}
function exactOptions(value) {
    if (value === undefined)
        return Object.freeze({});
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return requestInvalid("options");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return requestInvalid("options");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string"))
        return requestInvalid("options");
    for (const key of keys) {
        if (key !== "fault" && key !== "failureSink")
            return requestInvalid("options");
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            return requestInvalid("options");
        }
    }
    const fault = descriptors.fault?.value;
    if (fault !== undefined &&
        ![
            "after_event",
            "after_items",
            "after_effects",
            "after_facts_transition",
            "after_pending_transition",
            "after_idempotency",
            "before_commit",
            "after_commit_before_reply",
        ].includes(String(fault))) {
        return requestInvalid("fault");
    }
    const failureSink = descriptors.failureSink?.value;
    if (failureSink !== undefined && typeof failureSink !== "function") {
        return requestInvalid("failure_sink");
    }
    return Object.freeze({
        ...(fault === undefined ? {} : { fault }),
        ...(failureSink === undefined ? {} : { failureSink }),
    });
}
function injectFault(options, point) {
    if (options.fault === point)
        throw new Error(`FACT_COMMIT_FAILED:${point}`);
}
function ascii(value, field, maxLength = 256) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > maxLength ||
        !/^[\x20-\x7E]+$/.test(value)) {
        return requestInvalid(field);
    }
    return value;
}
function text(value, field, maxLength = 512) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > maxLength ||
        /[\u0000-\u001F\u007F]/.test(value)) {
        return requestInvalid(field);
    }
    return value;
}
function nullableText(value, field, maxLength = 512) {
    return value === null ? null : text(value, field, maxLength);
}
function digest(value) {
    if (typeof value !== "string" || !/^[A-F0-9]{64}$/.test(value)) {
        return requestInvalid("input_digest");
    }
    return value;
}
function timestamp(value, field) {
    if (typeof value !== "string")
        return requestInvalid(field);
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
        return requestInvalid(field);
    }
    return value;
}
function database(value) {
    if (typeof value !== "object" || value === null)
        return requestInvalid("database");
    return value;
}
function secret(value) {
    if (!(value instanceof Uint8Array))
        return requestInvalid("secret");
    return Uint8Array.from(value);
}
function command(value) {
    if (typeof value !== "string" ||
        !dietManagerActions.includes(value)) {
        return requestInvalid("command_type");
    }
    return value;
}
function denseArray(value, field, maxLength) {
    if (!Array.isArray(value) || value.length > maxLength)
        return requestInvalid(field);
    for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index))
            return requestInvalid(field);
    }
    return value;
}
function freezeEvent(value) {
    const fields = exactDataProperties(value, EVENT_FIELDS);
    const eventType = ascii(fields.eventType.value, "event_type", 128);
    const mealId = nullableText(fields.mealId.value, "meal_id", 256);
    const mealSlot = nullableText(fields.mealSlot.value, "meal_slot", 128);
    if (eventType === "diet_meal" && (mealId === null || mealSlot === null)) {
        return requestInvalid("meal_identity");
    }
    return Object.freeze({
        eventId: ascii(fields.eventId.value, "event_id"),
        operationId: ascii(fields.operationId.value, "operation_id"),
        schemaVersion: ascii(fields.schemaVersion.value, "schema_version", 128),
        eventType,
        factKind: ascii(fields.factKind.value, "fact_kind", 128),
        sourceMessageId: ascii(fields.sourceMessageId.value, "source_message_id"),
        conversationId: ascii(fields.conversationId.value, "conversation_id"),
        receivedAt: timestamp(fields.receivedAt.value, "received_at"),
        committedAt: timestamp(fields.committedAt.value, "committed_at"),
        occurredAtText: nullableText(fields.occurredAtText.value, "occurred_at_text", 128),
        mealId,
        mealSlot,
        payloadJson: canonicalJson(fields.payload.value),
    });
}
function freezeItems(value) {
    const items = denseArray(value, "items", 256).map((candidate, index) => {
        const fields = exactDataProperties(candidate, ITEM_FIELDS);
        if (!Number.isSafeInteger(fields.itemOrder.value) || fields.itemOrder.value !== index) {
            return requestInvalid("item_order");
        }
        return Object.freeze({
            itemId: ascii(fields.itemId.value, "item_id"),
            itemOrder: index,
            itemType: ascii(fields.itemType.value, "item_type", 128),
            normalizedName: text(fields.normalizedName.value, "normalized_name"),
            payloadJson: canonicalJson(fields.payload.value),
        });
    });
    if (new Set(items.map((item) => item.itemId)).size !== items.length) {
        return requestInvalid("item_id_duplicate");
    }
    return Object.freeze(items);
}
function freezeEffects(value) {
    const effects = denseArray(value, "effects", 256).map((candidate) => {
        const fields = exactDataProperties(candidate, EFFECT_FIELDS);
        return Object.freeze({
            outboxId: ascii(fields.outboxId.value, "outbox_id"),
            effectId: ascii(fields.effectId.value, "effect_id"),
            effectKind: ascii(fields.effectKind.value, "effect_kind", 128),
            previousState: nullableText(fields.previousState.value, "previous_state", 128),
            reason: nullableText(fields.reason.value, "reason", 512),
        });
    });
    if (new Set(effects.map((effect) => effect.outboxId)).size !== effects.length) {
        return requestInvalid("outbox_id_duplicate");
    }
    if (new Set(effects.map((effect) => effect.effectId)).size !== effects.length) {
        return requestInvalid("effect_id_duplicate");
    }
    return Object.freeze(effects);
}
function freezeInput(value) {
    const fields = exactDataProperties(value, INPUT_FIELDS);
    const event = freezeEvent(fields.event.value);
    const items = freezeItems(fields.items.value);
    const effects = freezeEffects(fields.effects.value);
    if (event.eventType === "diet_meal" && items.length === 0) {
        return requestInvalid("items");
    }
    if (effects.length === 0)
        return requestInvalid("effects");
    return Object.freeze({
        database: database(fields.database.value),
        secret: secret(fields.secret.value),
        token: ascii(fields.token.value, "token", 4096),
        inputDigest: digest(fields.inputDigest.value),
        subjectScope: ascii(fields.subjectScope.value, "subject_scope"),
        commandType: command(fields.commandType.value),
        dataRevision: ascii(fields.dataRevision.value, "data_revision"),
        traceId: ascii(fields.traceId.value, "trace_id"),
        event,
        items,
        effects,
    });
}
function freezeOperation(value) {
    const fields = exactDataProperties(value, OPERATION_INPUT_FIELDS);
    const event = freezeEvent(fields.event.value);
    const items = freezeItems(fields.items.value);
    const effects = freezeEffects(fields.effects.value);
    if (event.eventType === "diet_meal" && items.length === 0) {
        return requestInvalid("items");
    }
    if (!Number.isSafeInteger(fields.sequence.value) || fields.sequence.value < 0) {
        return requestInvalid("sequence");
    }
    const operationId = ascii(fields.operationId.value, "operation_id");
    if (event.operationId !== operationId)
        return requestInvalid("operation_identity");
    return Object.freeze({
        database: database(fields.database.value),
        secret: secret(fields.secret.value),
        token: ascii(fields.token.value, "token", 4096),
        inputDigest: digest(fields.inputDigest.value),
        subjectScope: ascii(fields.subjectScope.value, "subject_scope"),
        commandType: command(fields.commandType.value),
        dataRevision: ascii(fields.dataRevision.value, "data_revision"),
        traceId: ascii(fields.traceId.value, "trace_id"),
        sequence: fields.sequence.value,
        operationId,
        event,
        items,
        effects,
    });
}
function freezeSeal(value) {
    const fields = exactDataProperties(value, SEAL_INPUT_FIELDS);
    const expectedOperationIds = denseArray(fields.expectedOperationIds.value, "expected_operation_ids", 256).map((candidate) => ascii(candidate, "operation_id"));
    if (expectedOperationIds.length === 0 ||
        new Set(expectedOperationIds).size !== expectedOperationIds.length) {
        return requestInvalid("expected_operation_ids");
    }
    return Object.freeze({
        database: database(fields.database.value),
        secret: secret(fields.secret.value),
        token: ascii(fields.token.value, "token", 4096),
        inputDigest: digest(fields.inputDigest.value),
        subjectScope: ascii(fields.subjectScope.value, "subject_scope"),
        commandType: command(fields.commandType.value),
        dataRevision: ascii(fields.dataRevision.value, "data_revision"),
        traceId: ascii(fields.traceId.value, "trace_id"),
        expectedOperationIds: Object.freeze(expectedOperationIds),
        sealedAt: timestamp(fields.sealedAt.value, "sealed_at"),
    });
}
function resultFor(input, envelopeId, idempotencyKey) {
    return Object.freeze({
        envelope_id: envelopeId,
        event_id: input.event.eventId,
        operation_id: input.event.operationId,
        idempotency_key: idempotencyKey,
        input_digest: input.inputDigest,
        envelope_state: "effects_pending",
        result_status: "facts_committed_effects_pending",
        item_ids: Object.freeze(input.items.map((item) => item.itemId)),
        effect_ids: Object.freeze(input.effects.map((effect) => effect.effectId)),
    });
}
function sameValue(actual, expected) {
    return actual === expected;
}
function assertReplayRows(input, envelopeId, idempotencyKey) {
    const eventRows = input.database
        .prepare("SELECT * FROM event_records WHERE envelope_id = ? ORDER BY event_id")
        .all(envelopeId);
    if (eventRows.length !== 1)
        throw new Error("FACT_COMMIT_AUTHORITY_INVALID:event_count");
    const row = eventRows[0];
    const event = input.event;
    const eventMatches = sameValue(row.event_id, event.eventId) &&
        sameValue(row.operation_id, event.operationId) &&
        sameValue(row.schema_version, event.schemaVersion) &&
        sameValue(row.event_type, event.eventType) &&
        sameValue(row.fact_kind, event.factKind) &&
        sameValue(row.source_message_id, event.sourceMessageId) &&
        sameValue(row.conversation_id, event.conversationId) &&
        sameValue(row.received_at, event.receivedAt) &&
        sameValue(row.committed_at, event.committedAt) &&
        sameValue(row.occurred_at_text, event.occurredAtText) &&
        sameValue(row.result_status, "facts_committed_effects_pending") &&
        sameValue(row.lifecycle_status, "active") &&
        sameValue(row.meal_id, event.mealId) &&
        sameValue(row.meal_slot, event.mealSlot) &&
        sameValue(row.payload_json, event.payloadJson);
    if (!eventMatches)
        throw new Error("IDEMPOTENCY_CONFLICT:fact_identity");
    const itemRows = input.database
        .prepare("SELECT * FROM meal_items WHERE event_id = ? ORDER BY item_order")
        .all(event.eventId);
    if (itemRows.length !== input.items.length ||
        itemRows.some((itemRow, index) => {
            const expected = input.items[index];
            return !(itemRow.item_id === expected.itemId &&
                itemRow.event_id === event.eventId &&
                itemRow.item_order === expected.itemOrder &&
                itemRow.item_type === expected.itemType &&
                itemRow.normalized_name === expected.normalizedName &&
                itemRow.payload_json === expected.payloadJson);
        })) {
        throw new Error("IDEMPOTENCY_CONFLICT:fact_items");
    }
    const effectRows = input.database
        .prepare("SELECT * FROM effect_outbox WHERE envelope_id = ? ORDER BY outbox_id")
        .all(envelopeId);
    const expectedEffects = [...input.effects].sort((left, right) => left.outboxId.localeCompare(right.outboxId, "en-US"));
    if (effectRows.length !== expectedEffects.length ||
        effectRows.some((effectRow, index) => {
            const expected = expectedEffects[index];
            return !(effectRow.outbox_id === expected.outboxId &&
                effectRow.envelope_id === envelopeId &&
                effectRow.operation_id === event.operationId &&
                effectRow.effect_id === expected.effectId &&
                effectRow.effect_kind === expected.effectKind &&
                effectRow.previous_state === expected.previousState &&
                [
                    "pending",
                    "processing",
                    "succeeded",
                    "retryable_failed",
                    "permanent_business_skip",
                ].includes(effectRow.state) &&
                Number.isSafeInteger(effectRow.attempt_count) &&
                effectRow.attempt_count >= 0 &&
                (effectRow.state === "permanent_business_skip" ||
                    effectRow.reason === expected.reason) &&
                effectRow.created_at === event.committedAt &&
                typeof effectRow.updated_at === "string");
        })) {
        throw new Error("IDEMPOTENCY_CONFLICT:fact_effects");
    }
    return resultFor(input, envelopeId, idempotencyKey);
}
function changed(database) {
    const row = database.prepare("SELECT changes() AS count").get();
    return row.count;
}
function errorCode(error) {
    if (!(error instanceof Error) || error.message.length === 0)
        return "FACT_COMMIT_FAILED";
    const code = error.message.split(":", 1)[0];
    return /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "FACT_COMMIT_FAILED";
}
function emitFailure(sink, input, error) {
    if (!sink)
        return;
    const entry = Object.freeze({
        phase: "fact_commit",
        error_code: errorCode(error),
        trace_id: input.traceId,
        input_digest: input.inputDigest,
    });
    try {
        sink(entry);
    }
    catch {
        // A diagnostic sink is outside the business transaction and never replaces its error.
    }
}
function operationResultFor(input, envelopeId, idempotencyKey) {
    return Object.freeze({
        envelope_id: envelopeId,
        sequence: input.sequence,
        event_id: input.event.eventId,
        operation_id: input.operationId,
        idempotency_key: idempotencyKey,
        input_digest: input.inputDigest,
        item_ids: Object.freeze(input.items.map((item) => item.itemId)),
        effect_ids: Object.freeze(input.effects.map((effect) => effect.effectId)),
    });
}
function orderedEnvelopeEvents(database, envelopeId) {
    return database
        .prepare(`SELECT * FROM event_records
       WHERE envelope_id = ?
       ORDER BY committed_at, event_id`)
        .all(envelopeId);
}
function assertOperationReplay(input, envelopeId, idempotencyKey, events) {
    const matching = events.filter((row) => row.operation_id === input.operationId);
    if (matching.length === 0)
        return undefined;
    if (matching.length !== 1 || events[input.sequence]?.operation_id !== input.operationId) {
        throw new Error("IDEMPOTENCY_CONFLICT:operation_sequence");
    }
    const row = matching[0];
    const event = input.event;
    if (row.event_id !== event.eventId ||
        row.schema_version !== event.schemaVersion ||
        row.event_type !== event.eventType ||
        row.fact_kind !== event.factKind ||
        row.source_message_id !== event.sourceMessageId ||
        row.conversation_id !== event.conversationId ||
        row.received_at !== event.receivedAt ||
        row.committed_at !== event.committedAt ||
        row.occurred_at_text !== event.occurredAtText ||
        row.result_status !== "facts_committed_effects_pending" ||
        row.lifecycle_status !== "active" ||
        row.meal_id !== event.mealId ||
        row.meal_slot !== event.mealSlot ||
        row.payload_json !== event.payloadJson) {
        throw new Error("IDEMPOTENCY_CONFLICT:fact_identity");
    }
    const items = input.database
        .prepare("SELECT * FROM meal_items WHERE event_id = ? ORDER BY item_order")
        .all(event.eventId);
    if (items.length !== input.items.length ||
        items.some((item, index) => {
            const expected = input.items[index];
            return (item.item_id !== expected.itemId ||
                item.event_id !== event.eventId ||
                item.item_order !== expected.itemOrder ||
                item.item_type !== expected.itemType ||
                item.normalized_name !== expected.normalizedName ||
                item.payload_json !== expected.payloadJson);
        })) {
        throw new Error("IDEMPOTENCY_CONFLICT:fact_items");
    }
    const effects = input.database
        .prepare(`SELECT * FROM effect_outbox
       WHERE envelope_id = ? AND operation_id = ?
       ORDER BY outbox_id`)
        .all(envelopeId, input.operationId);
    const expectedEffects = [...input.effects].sort((left, right) => left.outboxId.localeCompare(right.outboxId, "en-US"));
    if (effects.length !== expectedEffects.length ||
        effects.some((effect, index) => {
            const expected = expectedEffects[index];
            return (effect.outbox_id !== expected.outboxId ||
                effect.effect_id !== expected.effectId ||
                effect.effect_kind !== expected.effectKind ||
                effect.previous_state !== expected.previousState ||
                ![
                    "pending",
                    "processing",
                    "succeeded",
                    "retryable_failed",
                    "permanent_business_skip",
                ].includes(effect.state) ||
                !Number.isSafeInteger(effect.attempt_count) ||
                effect.attempt_count < 0 ||
                (effect.state !== "permanent_business_skip" && effect.reason !== expected.reason) ||
                effect.created_at !== event.committedAt);
        })) {
        throw new Error("IDEMPOTENCY_CONFLICT:fact_effects");
    }
    return operationResultFor(input, envelopeId, idempotencyKey);
}
function parseTerminalBundleRevision(row, expectedSequence) {
    let payload;
    try {
        payload = JSON.parse(row.payload_json);
    }
    catch {
        throw new Error("FACT_COMMIT_AUTHORITY_INVALID:bundle_payload");
    }
    if (canonicalJson(payload) !== row.payload_json ||
        typeof payload !== "object" ||
        payload === null ||
        Array.isArray(payload)) {
        throw new Error("FACT_COMMIT_AUTHORITY_INVALID:bundle_payload");
    }
    const record = payload;
    if (Object.keys(record).sort().join("\u0000") !==
        ["authority_kind", "data_revision", "effects", "operation_sequence"]
            .sort()
            .join("\u0000") ||
        record.authority_kind !== "diet-manager/effect-bundle/v1" ||
        !Array.isArray(record.effects) ||
        record.operation_sequence !== expectedSequence ||
        typeof record.data_revision !== "string" ||
        !record.data_revision.startsWith("repository-v1:") ||
        row.completed_at === null ||
        (row.effect_state !== "succeeded" && row.effect_state !== "permanent_business_skip") ||
        (row.result_status !== "applied" && row.result_status !== "applied_with_issues")) {
        throw new Error("FACT_COMMIT_AUTHORITY_INVALID:bundle_payload");
    }
    return record.data_revision;
}
function parsePendingBundleRevision(row, expectedSequence) {
    let payload;
    try {
        payload = JSON.parse(row.payload_json);
    }
    catch {
        throw new Error("FACT_COMMIT_AUTHORITY_INVALID:bundle_payload");
    }
    if (canonicalJson(payload) !== row.payload_json ||
        typeof payload !== "object" ||
        payload === null ||
        Array.isArray(payload)) {
        throw new Error("FACT_COMMIT_AUTHORITY_INVALID:bundle_payload");
    }
    const record = payload;
    if (Object.keys(record).sort().join("\u0000") !==
        ["authority_kind", "data_revision", "effects", "operation_sequence"]
            .sort()
            .join("\u0000") ||
        record.authority_kind !== "diet-manager/effect-bundle-checkpoint/v1" ||
        !Array.isArray(record.effects) ||
        record.operation_sequence !== expectedSequence ||
        typeof record.data_revision !== "string" ||
        !record.data_revision.startsWith("repository-v1:") ||
        row.completed_at !== null ||
        row.effect_state !== "pending" ||
        row.result_status !== "facts_committed_effects_pending") {
        throw new Error("FACT_COMMIT_AUTHORITY_INVALID:bundle_payload");
    }
    return record.data_revision;
}
function assertOperationRevisionHandoff(input, envelopeId, bindingRevision, events) {
    if (events.length !== input.sequence) {
        throw new Error("FACT_COMMIT_AUTHORITY_INVALID:operation_sequence");
    }
    const currentRevision = computeRepositoryDataRevision(input.database);
    if (events.length === 0) {
        if (currentRevision !== bindingRevision)
            throw new Error("PREVIEW_STALE:data_revision");
        const unexpectedBundles = changedCount(input.database, "SELECT COUNT(*) AS count FROM effect_bundle_commits WHERE envelope_id = ?", envelopeId);
        if (unexpectedBundles !== 0) {
            throw new Error("FACT_COMMIT_AUTHORITY_INVALID:bundle_count");
        }
        return;
    }
    const bundles = input.database
        .prepare(`SELECT operation_id, effect_state, result_status, completed_at, payload_json
       FROM effect_bundle_commits
       WHERE envelope_id = ?
       ORDER BY operation_id`)
        .all(envelopeId);
    if (bundles.length !== events.length) {
        throw new Error("FACT_COMMIT_AUTHORITY_INVALID:previous_operation_not_stable");
    }
    const byOperation = new Map(bundles.map((row) => [row.operation_id, row]));
    let expectedRevision = bindingRevision;
    events.forEach((event, index) => {
        const bundle = byOperation.get(event.operation_id);
        if (!bundle) {
            throw new Error("FACT_COMMIT_AUTHORITY_INVALID:previous_operation_not_stable");
        }
        expectedRevision = parseTerminalBundleRevision(bundle, index);
    });
    if (currentRevision !== expectedRevision)
        throw new Error("PREVIEW_STALE:data_revision");
    const previous = events[events.length - 1];
    if (input.event.committedAt <= previous.committed_at) {
        throw new Error("FACT_COMMIT_REQUEST_INVALID:committed_at_order");
    }
}
function changedCount(database, sql, value) {
    const row = database.prepare(sql).get(value);
    return Number(row.count);
}
function insertOperationCheckpoint(input, envelopeId) {
    const effects = [...input.effects]
        .map((effect) => ({ effect_id: effect.effectId, state: "pending" }))
        .sort((left, right) => left.effect_id.localeCompare(right.effect_id, "en-US"));
    const dataRevision = computeRepositoryDataRevision(input.database);
    const terminal = effects.length === 0;
    input.database
        .prepare(`INSERT INTO effect_bundle_commits(
        envelope_id, operation_id, stage, effect_state, result_status,
        completed_at, payload_json
      ) VALUES (?, ?, 'EffectBundle', ?, ?, ?, ?)`)
        .run(envelopeId, input.operationId, terminal ? "succeeded" : "pending", terminal ? "applied" : "facts_committed_effects_pending", terminal ? input.event.committedAt : null, canonicalJson({
        authority_kind: terminal
            ? "diet-manager/effect-bundle/v1"
            : "diet-manager/effect-bundle-checkpoint/v1",
        data_revision: dataRevision,
        effects,
        operation_sequence: input.sequence,
    }));
}
export function appendPreparedOperationFact(input, options) {
    const frozen = freezeOperation(input);
    const frozenOptions = exactOptions(options);
    let transactionOpen = false;
    let transactionCommitted = false;
    try {
        frozen.database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        assertCurrentMigrationAuthority(frozen.database);
        const authority = authorizeRepositoryPreview({
            database: frozen.database,
            secret: frozen.secret,
            token: frozen.token,
            inputDigest: frozen.inputDigest,
            subjectScope: frozen.subjectScope,
            commandType: frozen.commandType,
            dataRevision: frozen.dataRevision,
        });
        if (authority.envelope_state !== "received") {
            throw new Error("FACT_COMMIT_AUTHORITY_INVALID:envelope_sealed");
        }
        const events = orderedEnvelopeEvents(frozen.database, authority.binding.preview_id);
        const replay = assertOperationReplay(frozen, authority.binding.preview_id, authority.idempotency_key, events);
        if (replay) {
            frozen.database.exec("ROLLBACK");
            transactionOpen = false;
            return replay;
        }
        assertOperationRevisionHandoff(frozen, authority.binding.preview_id, authority.binding.data_revision, events);
        const event = frozen.event;
        frozen.database
            .prepare(`INSERT INTO event_records(
          event_id, envelope_id, operation_id, schema_version, event_type, fact_kind,
          source_message_id, conversation_id, received_at, committed_at, occurred_at_text,
          result_status, lifecycle_status, meal_id, meal_slot, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(event.eventId, authority.binding.preview_id, event.operationId, event.schemaVersion, event.eventType, event.factKind, event.sourceMessageId, event.conversationId, event.receivedAt, event.committedAt, event.occurredAtText, "facts_committed_effects_pending", "active", event.mealId, event.mealSlot, event.payloadJson);
        injectFault(frozenOptions, "after_event");
        const insertItem = frozen.database.prepare(`INSERT INTO meal_items(
        item_id, event_id, item_order, item_type, normalized_name, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)`);
        for (const item of frozen.items) {
            insertItem.run(item.itemId, event.eventId, item.itemOrder, item.itemType, item.normalizedName, item.payloadJson);
        }
        injectFault(frozenOptions, "after_items");
        const insertEffect = frozen.database.prepare(`INSERT INTO effect_outbox(
        outbox_id, envelope_id, operation_id, effect_id, effect_kind,
        previous_state, state, attempt_count, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`);
        for (const effect of frozen.effects) {
            insertEffect.run(effect.outboxId, authority.binding.preview_id, event.operationId, effect.effectId, effect.effectKind, effect.previousState, effect.reason, event.committedAt, event.committedAt);
        }
        injectFault(frozenOptions, "after_effects");
        insertOperationCheckpoint(frozen, authority.binding.preview_id);
        injectFault(frozenOptions, "before_commit");
        frozen.database.exec("COMMIT");
        transactionOpen = false;
        transactionCommitted = true;
        const result = operationResultFor(frozen, authority.binding.preview_id, authority.idempotency_key);
        if (frozenOptions.fault === "after_commit_before_reply") {
            throw new Error("FACT_COMMIT_RESPONSE_LOST:after_commit_before_reply");
        }
        return result;
    }
    catch (error) {
        if (transactionOpen) {
            try {
                frozen.database.exec("ROLLBACK");
            }
            catch {
                // Preserve the primary repository failure.
            }
        }
        if (!transactionCommitted)
            emitFailure(frozenOptions.failureSink, frozen, error);
        throw error;
    }
}
export function sealPreparedEnvelopeFacts(input) {
    const frozen = freezeSeal(input);
    let transactionOpen = false;
    try {
        frozen.database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        assertCurrentMigrationAuthority(frozen.database);
        const authority = authorizeRepositoryPreview({
            database: frozen.database,
            secret: frozen.secret,
            token: frozen.token,
            inputDigest: frozen.inputDigest,
            subjectScope: frozen.subjectScope,
            commandType: frozen.commandType,
            dataRevision: frozen.dataRevision,
        });
        const events = orderedEnvelopeEvents(frozen.database, authority.binding.preview_id);
        const operationIds = events.map((event) => event.operation_id);
        if (operationIds.length !== frozen.expectedOperationIds.length ||
            operationIds.some((operationId, index) => operationId !== frozen.expectedOperationIds[index])) {
            throw new Error("FACT_COMMIT_AUTHORITY_INVALID:operation_sequence");
        }
        const checkpointRows = frozen.database
            .prepare(`SELECT operation_id, effect_state, result_status, completed_at, payload_json
         FROM effect_bundle_commits
         WHERE envelope_id = ?
         ORDER BY operation_id`)
            .all(authority.binding.preview_id);
        if (checkpointRows.length !== events.length) {
            throw new Error("FACT_COMMIT_AUTHORITY_INVALID:bundle_count");
        }
        const checkpointByOperation = new Map(checkpointRows.map((row) => [row.operation_id, row]));
        let latestCheckpointRevision = authority.binding.data_revision;
        events.forEach((event, index) => {
            const checkpoint = checkpointByOperation.get(event.operation_id);
            if (!checkpoint)
                throw new Error("FACT_COMMIT_AUTHORITY_INVALID:bundle_count");
            if (checkpoint.completed_at === null) {
                if (index !== events.length - 1) {
                    throw new Error("FACT_COMMIT_AUTHORITY_INVALID:previous_operation_not_stable");
                }
                latestCheckpointRevision = parsePendingBundleRevision(checkpoint, index);
            }
            else {
                latestCheckpointRevision = parseTerminalBundleRevision(checkpoint, index);
            }
        });
        if (computeRepositoryDataRevision(frozen.database) !== latestCheckpointRevision) {
            throw new Error("PREVIEW_STALE:data_revision");
        }
        const outboxes = frozen.database
            .prepare("SELECT operation_id, state FROM effect_outbox WHERE envelope_id = ?")
            .all(authority.binding.preview_id);
        const allTerminal = outboxes.every((row) => row.state === "succeeded" || row.state === "permanent_business_skip");
        const bundleOperations = frozen.database
            .prepare(`SELECT operation_id FROM effect_bundle_commits
         WHERE envelope_id = ? AND completed_at IS NOT NULL
         ORDER BY operation_id`)
            .all(authority.binding.preview_id);
        const everyOperationBundled = bundleOperations.length === operationIds.length &&
            new Set(bundleOperations.map((row) => row.operation_id)).size === operationIds.length &&
            operationIds.every((operationId) => bundleOperations.some((row) => row.operation_id === operationId));
        const stable = allTerminal && everyOperationBundled;
        if (authority.envelope_state === "received") {
            assertEnvelopeTransition("received", "facts_committed");
            frozen.database
                .prepare(`UPDATE command_envelopes
           SET state = 'facts_committed', result_status = 'facts_committed', committed_at = ?
           WHERE envelope_id = ? AND state = 'received' AND result_status = 'preview_ready'`)
                .run(frozen.sealedAt, authority.binding.preview_id);
            if (changed(frozen.database) !== 1) {
                throw new Error("FACT_COMMIT_AUTHORITY_INVALID:received_compare_and_set");
            }
            assertEnvelopeTransition("facts_committed", "effects_pending");
            frozen.database
                .prepare(`UPDATE command_envelopes
           SET state = 'effects_pending', result_status = 'facts_committed_effects_pending'
           WHERE envelope_id = ? AND state = 'facts_committed' AND result_status = 'facts_committed'`)
                .run(authority.binding.preview_id);
            if (changed(frozen.database) !== 1) {
                throw new Error("FACT_COMMIT_AUTHORITY_INVALID:effects_compare_and_set");
            }
            frozen.database
                .prepare(`UPDATE idempotency_records
           SET state = 'effects_pending', updated_at = ?
           WHERE idempotency_key = ? AND operation_id = ? AND input_digest = ?
             AND state = 'preview_ready' AND terminal_result_json IS NULL`)
                .run(frozen.sealedAt, authority.idempotency_key, authority.binding.preview_id, frozen.inputDigest);
            if (changed(frozen.database) !== 1) {
                throw new Error("FACT_COMMIT_AUTHORITY_INVALID:idempotency_compare_and_set");
            }
            if (stable) {
                assertEnvelopeTransition("effects_pending", "effects_stable");
                frozen.database
                    .prepare(`UPDATE command_envelopes
             SET state = 'effects_stable', result_status = 'effects_stable'
             WHERE envelope_id = ? AND state = 'effects_pending'
               AND result_status = 'facts_committed_effects_pending'`)
                    .run(authority.binding.preview_id);
                if (changed(frozen.database) !== 1) {
                    throw new Error("FACT_COMMIT_AUTHORITY_INVALID:stable_compare_and_set");
                }
                frozen.database
                    .prepare(`UPDATE idempotency_records
             SET state = 'effects_stable', updated_at = ?
             WHERE operation_id = ? AND state = 'effects_pending'
               AND terminal_result_json IS NULL`)
                    .run(frozen.sealedAt, authority.binding.preview_id);
                if (changed(frozen.database) !== 1) {
                    throw new Error("FACT_COMMIT_AUTHORITY_INVALID:stable_idempotency_compare_and_set");
                }
            }
        }
        else {
            if (authority.envelope_state === "effects_pending" && stable) {
                assertEnvelopeTransition("effects_pending", "effects_stable");
                frozen.database
                    .prepare(`UPDATE command_envelopes
             SET state = 'effects_stable', result_status = 'effects_stable'
             WHERE envelope_id = ? AND state = 'effects_pending'
               AND result_status = 'facts_committed_effects_pending'`)
                    .run(authority.binding.preview_id);
                if (changed(frozen.database) !== 1) {
                    throw new Error("FACT_COMMIT_AUTHORITY_INVALID:stable_compare_and_set");
                }
                frozen.database
                    .prepare(`UPDATE idempotency_records
             SET state = 'effects_stable', updated_at = ?
             WHERE operation_id = ? AND state = 'effects_pending'
               AND terminal_result_json IS NULL`)
                    .run(frozen.sealedAt, authority.binding.preview_id);
                if (changed(frozen.database) !== 1) {
                    throw new Error("FACT_COMMIT_AUTHORITY_INVALID:stable_idempotency_compare_and_set");
                }
            }
            else if (authority.envelope_state !== (stable ? "effects_stable" : "effects_pending")) {
                throw new Error("FACT_COMMIT_AUTHORITY_INVALID:seal_replay_state");
            }
        }
        frozen.database.exec("COMMIT");
        transactionOpen = false;
        return Object.freeze({
            envelope_id: authority.binding.preview_id,
            idempotency_key: authority.idempotency_key,
            input_digest: frozen.inputDigest,
            envelope_state: stable ? "effects_stable" : "effects_pending",
            result_status: stable ? "effects_stable" : "facts_committed_effects_pending",
            operation_ids: Object.freeze(operationIds),
        });
    }
    catch (error) {
        if (transactionOpen) {
            try {
                frozen.database.exec("ROLLBACK");
            }
            catch {
                // Preserve the primary seal failure.
            }
        }
        throw error;
    }
}
export function commitPreparedFact(input, options) {
    const frozen = freezeInput(input);
    const frozenOptions = exactOptions(options);
    let transactionOpen = false;
    let transactionCommitted = false;
    try {
        frozen.database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        assertCurrentMigrationAuthority(frozen.database);
        const authority = authorizeRepositoryPreview({
            database: frozen.database,
            secret: frozen.secret,
            token: frozen.token,
            inputDigest: frozen.inputDigest,
            subjectScope: frozen.subjectScope,
            commandType: frozen.commandType,
            dataRevision: frozen.dataRevision,
        });
        if (authority.envelope_state === "effects_pending" ||
            authority.envelope_state === "effects_stable") {
            const replay = assertReplayRows(frozen, authority.binding.preview_id, authority.idempotency_key);
            frozen.database.exec("ROLLBACK");
            transactionOpen = false;
            return replay;
        }
        if (authority.binding.data_revision !== computeRepositoryDataRevision(frozen.database)) {
            throw new Error("PREVIEW_STALE:data_revision");
        }
        const event = frozen.event;
        frozen.database
            .prepare(`INSERT INTO event_records(
          event_id, envelope_id, operation_id, schema_version, event_type, fact_kind,
          source_message_id, conversation_id, received_at, committed_at, occurred_at_text,
          result_status, lifecycle_status, meal_id, meal_slot, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(event.eventId, authority.binding.preview_id, event.operationId, event.schemaVersion, event.eventType, event.factKind, event.sourceMessageId, event.conversationId, event.receivedAt, event.committedAt, event.occurredAtText, "facts_committed_effects_pending", "active", event.mealId, event.mealSlot, event.payloadJson);
        injectFault(frozenOptions, "after_event");
        const insertItem = frozen.database.prepare(`INSERT INTO meal_items(
        item_id, event_id, item_order, item_type, normalized_name, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)`);
        for (const item of frozen.items) {
            insertItem.run(item.itemId, event.eventId, item.itemOrder, item.itemType, item.normalizedName, item.payloadJson);
        }
        injectFault(frozenOptions, "after_items");
        const insertEffect = frozen.database.prepare(`INSERT INTO effect_outbox(
        outbox_id, envelope_id, operation_id, effect_id, effect_kind,
        previous_state, state, attempt_count, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`);
        for (const effect of frozen.effects) {
            insertEffect.run(effect.outboxId, authority.binding.preview_id, event.operationId, effect.effectId, effect.effectKind, effect.previousState, effect.reason, event.committedAt, event.committedAt);
        }
        injectFault(frozenOptions, "after_effects");
        assertEnvelopeTransition("received", "facts_committed");
        frozen.database
            .prepare(`UPDATE command_envelopes
         SET state = 'facts_committed', result_status = 'facts_committed', committed_at = ?
         WHERE envelope_id = ? AND state = 'received' AND result_status = 'preview_ready'`)
            .run(event.committedAt, authority.binding.preview_id);
        if (changed(frozen.database) !== 1) {
            throw new Error("FACT_COMMIT_AUTHORITY_INVALID:received_compare_and_set");
        }
        injectFault(frozenOptions, "after_facts_transition");
        assertEnvelopeTransition("facts_committed", "effects_pending");
        frozen.database
            .prepare(`UPDATE command_envelopes
         SET state = 'effects_pending', result_status = 'facts_committed_effects_pending'
         WHERE envelope_id = ? AND state = 'facts_committed' AND result_status = 'facts_committed'`)
            .run(authority.binding.preview_id);
        if (changed(frozen.database) !== 1) {
            throw new Error("FACT_COMMIT_AUTHORITY_INVALID:effects_compare_and_set");
        }
        injectFault(frozenOptions, "after_pending_transition");
        frozen.database
            .prepare(`UPDATE idempotency_records
         SET state = 'effects_pending', updated_at = ?
         WHERE idempotency_key = ? AND operation_id = ? AND input_digest = ?
           AND state = 'preview_ready' AND terminal_result_json IS NULL`)
            .run(event.committedAt, authority.idempotency_key, authority.binding.preview_id, frozen.inputDigest);
        if (changed(frozen.database) !== 1) {
            throw new Error("FACT_COMMIT_AUTHORITY_INVALID:idempotency_compare_and_set");
        }
        injectFault(frozenOptions, "after_idempotency");
        injectFault(frozenOptions, "before_commit");
        frozen.database.exec("COMMIT");
        transactionOpen = false;
        transactionCommitted = true;
        const result = resultFor(frozen, authority.binding.preview_id, authority.idempotency_key);
        if (frozenOptions.fault === "after_commit_before_reply") {
            throw new Error("FACT_COMMIT_RESPONSE_LOST:after_commit_before_reply");
        }
        return result;
    }
    catch (error) {
        if (transactionOpen) {
            try {
                frozen.database.exec("ROLLBACK");
            }
            catch {
                // Preserve the primary repository failure.
            }
        }
        if (!transactionCommitted)
            emitFailure(frozenOptions.failureSink, frozen, error);
        throw error;
    }
}
