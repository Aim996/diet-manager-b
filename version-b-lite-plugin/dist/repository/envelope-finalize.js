import { canonicalJson } from "../authority/canonical-json.js";
import { dietManagerActions, } from "../contracts.js";
import { authorizeRepositoryPreview } from "../preview/store.js";
import { assertEnvelopeTransition } from "../state/transition-guard.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
const INPUT_FIELDS = [
    "commandType",
    "dataRevision",
    "database",
    "finalizedAt",
    "frozenAt",
    "inputDigest",
    "mixedItems",
    "payload",
    "receiptId",
    "resultStatus",
    "secret",
    "subjectScope",
    "token",
    "traceId",
];
const MIXED_ITEM_FIELDS = [
    "command_type",
    "error_code",
    "idempotency_key",
    "operation_id",
    "payload",
    "sequence",
    "status",
];
function invalid(reason) {
    throw new TypeError(`ENVELOPE_FINALIZE_REQUEST_INVALID:${reason}`);
}
function authorityInvalid(reason) {
    throw new Error(`ENVELOPE_FINALIZE_AUTHORITY_INVALID:${reason}`);
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
function ascii(value, field, maxLength = 256) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > maxLength ||
        !/^[\x20-\x7E]+$/.test(value)) {
        return invalid(field);
    }
    return value;
}
function timestamp(value, field) {
    if (typeof value !== "string")
        return invalid(field);
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
        return invalid(field);
    }
    return value;
}
function deepFreezeJson(value) {
    if (Array.isArray(value)) {
        for (const item of value)
            deepFreezeJson(item);
        return Object.freeze(value);
    }
    if (typeof value === "object" && value !== null) {
        for (const child of Object.values(value))
            deepFreezeJson(child);
        return Object.freeze(value);
    }
    return value;
}
function freezeMixedItems(value) {
    if (!Array.isArray(value) || value.length > 256)
        return invalid("mixed_items");
    const items = value.map((candidate, index) => {
        if (!Object.hasOwn(value, index))
            return invalid("mixed_items");
        const fields = exactDataProperties(candidate, MIXED_ITEM_FIELDS);
        if (fields.sequence.value !== index)
            return invalid("mixed_item_sequence");
        if (typeof fields.command_type.value !== "string" ||
            !dietManagerActions.includes(fields.command_type.value)) {
            return invalid("mixed_item_command_type");
        }
        if (fields.status.value !== "committed" &&
            fields.status.value !== "committed_with_issues" &&
            fields.status.value !== "failed") {
            return invalid("mixed_item_status");
        }
        const errorCode = fields.error_code.value === null
            ? null
            : ascii(fields.error_code.value, "mixed_item_error_code", 128);
        if ((fields.status.value === "failed" && errorCode === null) ||
            (fields.status.value !== "failed" && errorCode !== null)) {
            return invalid("mixed_item_error_code");
        }
        return Object.freeze({
            sequence: index,
            operation_id: ascii(fields.operation_id.value, "mixed_item_operation_id"),
            idempotency_key: ascii(fields.idempotency_key.value, "mixed_item_idempotency_key"),
            command_type: fields.command_type.value,
            status: fields.status.value,
            error_code: errorCode,
            payloadJson: canonicalJson(fields.payload.value),
        });
    });
    if (new Set(items.map((item) => item.operation_id)).size !== items.length ||
        new Set(items.map((item) => item.idempotency_key)).size !== items.length) {
        return invalid("mixed_item_identity");
    }
    return Object.freeze(items);
}
function freezeInput(value) {
    const fields = exactDataProperties(value, INPUT_FIELDS);
    if (typeof fields.database.value !== "object" || fields.database.value === null) {
        return invalid("database");
    }
    if (!(fields.secret.value instanceof Uint8Array))
        return invalid("secret");
    if (typeof fields.inputDigest.value !== "string" ||
        !/^[A-F0-9]{64}$/.test(fields.inputDigest.value)) {
        return invalid("input_digest");
    }
    if (typeof fields.commandType.value !== "string" ||
        !dietManagerActions.includes(fields.commandType.value)) {
        return invalid("command_type");
    }
    if (fields.resultStatus.value !== "committed" &&
        fields.resultStatus.value !== "committed_with_issues") {
        return invalid("result_status");
    }
    const payloadJson = canonicalJson(fields.payload.value);
    const payload = deepFreezeJson(JSON.parse(payloadJson));
    return Object.freeze({
        database: fields.database.value,
        secret: Uint8Array.from(fields.secret.value),
        token: ascii(fields.token.value, "token", 4096),
        inputDigest: fields.inputDigest.value,
        subjectScope: ascii(fields.subjectScope.value, "subject_scope"),
        commandType: fields.commandType.value,
        dataRevision: ascii(fields.dataRevision.value, "data_revision"),
        traceId: ascii(fields.traceId.value, "trace_id"),
        resultStatus: fields.resultStatus.value,
        receiptId: ascii(fields.receiptId.value, "receipt_id"),
        finalizedAt: timestamp(fields.finalizedAt.value, "finalized_at"),
        frozenAt: timestamp(fields.frozenAt.value, "frozen_at"),
        payloadJson,
        payload,
        mixedItems: freezeMixedItems(fields.mixedItems.value),
    });
}
function freezeOptions(value) {
    if (value === undefined)
        return Object.freeze({});
    const fields = exactDataProperties(value, ["fault"]);
    if (![
        "after_finalization_row",
        "after_envelope",
        "after_idempotency",
        "before_commit",
        "after_commit_before_reply",
    ].includes(String(fields.fault.value))) {
        return invalid("fault");
    }
    return Object.freeze({ fault: fields.fault.value });
}
function injectFault(options, point) {
    if (options.fault === point)
        throw new Error(`ENVELOPE_FINALIZE_FAILED:${point}`);
}
function resultFor(input, envelopeId, idempotencyKey) {
    return Object.freeze({
        envelope_id: envelopeId,
        idempotency_key: idempotencyKey,
        input_digest: input.inputDigest,
        envelope_state: "finalized",
        result_status: input.resultStatus,
        receipt_id: input.receiptId,
        finalized_at: input.finalizedAt,
        frozen_at: input.frozenAt,
        payload: input.payload,
    });
}
function readFinalization(database, envelopeId) {
    return database
        .prepare(`SELECT f.*, i.terminal_result_json
       FROM envelope_finalizations f
       JOIN idempotency_records i ON i.idempotency_key = f.idempotency_key
       WHERE f.envelope_id = ?`)
        .get(envelopeId);
}
function assertMixedOperationAuthority(input, envelopeId) {
    const events = input.database
        .prepare(`SELECT operation_id FROM event_records
       WHERE envelope_id = ?
       ORDER BY committed_at, event_id`)
        .all(envelopeId);
    if (input.mixedItems.length === 0) {
        if (events.length > 1)
            return authorityInvalid("mixed_item_operations");
        return;
    }
    if (events.length !== input.mixedItems.length ||
        events.some((event, index) => event.operation_id !== input.mixedItems[index].operation_id)) {
        return authorityInvalid("mixed_item_operations");
    }
}
function assertMixedReplayRows(input, envelopeId) {
    const rows = input.database
        .prepare(`SELECT * FROM mixed_item_results
       WHERE envelope_id = ?
       ORDER BY sequence`)
        .all(envelopeId);
    if (rows.length !== input.mixedItems.length ||
        rows.some((row, index) => {
            const expected = input.mixedItems[index];
            return (row.envelope_id !== envelopeId ||
                row.sequence !== expected.sequence ||
                row.operation_id !== expected.operation_id ||
                row.idempotency_key !== expected.idempotency_key ||
                row.command_type !== expected.command_type ||
                row.status !== expected.status ||
                row.error_code !== expected.error_code ||
                row.payload_json !== expected.payloadJson);
        })) {
        throw new Error("IDEMPOTENCY_CONFLICT:mixed_items");
    }
}
function assertReplay(input, envelopeId, idempotencyKey) {
    const row = readFinalization(input.database, envelopeId);
    const expected = resultFor(input, envelopeId, idempotencyKey);
    if (!row ||
        row.idempotency_key !== idempotencyKey ||
        row.input_digest !== input.inputDigest ||
        row.envelope_state !== "finalized" ||
        row.result_status !== input.resultStatus ||
        row.stage !== "EnvelopeFinalize" ||
        row.receipt_id !== input.receiptId ||
        row.error_code !== null ||
        row.finalized_at !== input.finalizedAt ||
        row.frozen_at !== input.frozenAt ||
        row.payload_json !== input.payloadJson ||
        row.terminal_result_json !== canonicalJson(expected)) {
        throw new Error("IDEMPOTENCY_CONFLICT:terminal_result");
    }
    assertMixedOperationAuthority(input, envelopeId);
    assertMixedReplayRows(input, envelopeId);
    return expected;
}
function changes(database) {
    return database.prepare("SELECT changes() AS count").get().count;
}
export function finalizeEnvelope(input, options) {
    const frozen = freezeInput(input);
    const frozenOptions = freezeOptions(options);
    let transactionOpen = false;
    let committed = false;
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
        if (authority.envelope_state === "finalized") {
            const replay = assertReplay(frozen, authority.binding.preview_id, authority.idempotency_key);
            frozen.database.exec("ROLLBACK");
            transactionOpen = false;
            return replay;
        }
        if (authority.envelope_state !== "effects_stable") {
            return authorityInvalid("effects_not_stable");
        }
        const result = resultFor(frozen, authority.binding.preview_id, authority.idempotency_key);
        assertMixedOperationAuthority(frozen, authority.binding.preview_id);
        frozen.database
            .prepare(`INSERT INTO envelope_finalizations(
          envelope_id, idempotency_key, input_digest, envelope_state,
          result_status, stage, receipt_id, error_code, finalized_at,
          frozen_at, payload_json
        ) VALUES (?, ?, ?, 'finalized', ?, 'EnvelopeFinalize', ?, NULL, ?, ?, ?)`)
            .run(authority.binding.preview_id, authority.idempotency_key, frozen.inputDigest, frozen.resultStatus, frozen.receiptId, frozen.finalizedAt, frozen.frozenAt, frozen.payloadJson);
        injectFault(frozenOptions, "after_finalization_row");
        const insertMixedItem = frozen.database.prepare(`INSERT INTO mixed_item_results(
        envelope_id, sequence, operation_id, idempotency_key,
        command_type, status, error_code, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const item of frozen.mixedItems) {
            insertMixedItem.run(authority.binding.preview_id, item.sequence, item.operation_id, item.idempotency_key, item.command_type, item.status, item.error_code, item.payloadJson);
        }
        assertEnvelopeTransition("effects_stable", "finalized");
        frozen.database
            .prepare(`UPDATE command_envelopes
         SET state = 'finalized', result_status = ?
         WHERE envelope_id = ? AND state = 'effects_stable'
           AND result_status = 'effects_stable'`)
            .run(frozen.resultStatus, authority.binding.preview_id);
        if (changes(frozen.database) !== 1)
            return authorityInvalid("envelope_compare_and_set");
        injectFault(frozenOptions, "after_envelope");
        frozen.database
            .prepare(`UPDATE idempotency_records
         SET state = 'finalized', terminal_result_json = ?, updated_at = ?
         WHERE idempotency_key = ? AND operation_id = ? AND input_digest = ?
           AND state = 'effects_stable' AND terminal_result_json IS NULL`)
            .run(canonicalJson(result), frozen.finalizedAt, authority.idempotency_key, authority.binding.preview_id, frozen.inputDigest);
        if (changes(frozen.database) !== 1) {
            return authorityInvalid("idempotency_compare_and_set");
        }
        injectFault(frozenOptions, "after_idempotency");
        injectFault(frozenOptions, "before_commit");
        frozen.database.exec("COMMIT");
        transactionOpen = false;
        committed = true;
        if (frozenOptions.fault === "after_commit_before_reply") {
            throw new Error("ENVELOPE_FINALIZE_RESPONSE_LOST:after_commit_before_reply");
        }
        return result;
    }
    catch (error) {
        if (transactionOpen) {
            try {
                frozen.database.exec("ROLLBACK");
            }
            catch {
                // Preserve the primary finalizer failure.
            }
        }
        if (committed)
            throw error;
        throw error;
    }
}
