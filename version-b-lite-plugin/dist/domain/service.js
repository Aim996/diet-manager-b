import { canonicalJson } from "../authority/canonical-json.js";
import { createServerPreview, authorizeRepositoryPreview } from "../preview/store.js";
import { appendPreparedOperationFact, sealPreparedEnvelopeFacts, } from "../repository/fact-commit.js";
import { finalizeEnvelope } from "../repository/envelope-finalize.js";
import { computeRepositoryDataRevision } from "../repository/revision.js";
import { applyPurchaseEffect, preparePurchaseOperation } from "./effect-bundle.js";
import { deriveDomainId, digestDomainEnvelope } from "./identity.js";
import { queryDomainReadModel } from "./read-model.js";
function invalid(reason) {
    throw new TypeError(`DIET_DOMAIN_REQUEST_INVALID:${reason}`);
}
function timestamp(value, field) {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
        return invalid(field);
    }
    return value;
}
function emitFailure(sink, entry) {
    if (!sink)
        return;
    try {
        sink(Object.freeze(entry));
    }
    catch {
        // Diagnostics are outside the business transaction and cannot replace its error.
    }
}
function purchaseOperation(envelope) {
    if (envelope.command_type !== "add_inventory" || envelope.operations.length !== 1) {
        return invalid("purchase_envelope");
    }
    const operation = envelope.operations[0];
    if (operation.kind !== "add_inventory")
        return invalid("purchase_operation");
    return operation;
}
function storedEnvelopeTime(database, envelopeId) {
    const row = database
        .prepare("SELECT received_at FROM command_envelopes WHERE envelope_id = ?")
        .get(envelopeId);
    if (!row)
        return invalid("envelope_missing");
    return timestamp(row.received_at, "stored_received_at");
}
function frozenExecutionResult(envelope, inputDigest, item) {
    return Object.freeze({
        envelope_id: envelope.envelope_id,
        input_digest: inputDigest,
        status: "committed",
        items: Object.freeze([item]),
        payload: Object.freeze({
            authority_kind: "diet-manager/domain-execution/v1",
            inventory: Object.freeze({
                batch_id: item.batch_id,
                product_id: item.product_id,
                quantity_microunits: item.inventory_quantity_microunits,
                unit: item.unit,
            }),
        }),
    });
}
function freezeCreator(input) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return invalid("service_options");
    }
    if (typeof input.database !== "object" || input.database === null)
        return invalid("database");
    if (!(input.secret instanceof Uint8Array) || input.secret.byteLength < 16) {
        return invalid("secret");
    }
    if (typeof input.now !== "function")
        return invalid("clock");
    if (input.fault !== undefined &&
        input.fault !== "before_fact_commit" &&
        input.fault !== "after_inventory_business_writes") {
        return invalid("fault");
    }
    if (input.failureSink !== undefined && typeof input.failureSink !== "function") {
        return invalid("failure_sink");
    }
    return {
        database: input.database,
        secret: Uint8Array.from(input.secret),
        now: input.now,
        ...(input.fault === undefined ? {} : { fault: input.fault }),
        ...(input.failureSink === undefined ? {} : { failureSink: input.failureSink }),
    };
}
export function createDietDomainService(input) {
    const options = freezeCreator(input);
    return Object.freeze({
        preview(envelope) {
            purchaseOperation(envelope);
            const inputDigest = digestDomainEnvelope(envelope);
            const dataRevision = computeRepositoryDataRevision(options.database);
            const now = timestamp(options.now(), "clock");
            const preview = createServerPreview({
                database: options.database,
                secret: options.secret,
                previewId: envelope.envelope_id,
                idempotencyKey: envelope.idempotency_key,
                inputDigest,
                subjectScope: envelope.subject_scope,
                commandType: envelope.command_type,
                dataRevision,
                sourceMessageId: envelope.source_message_id,
                conversationId: envelope.conversation_id,
                previewMaterial: Object.freeze({
                    authority_kind: "diet-manager/domain-preview/v1",
                    envelope,
                }),
                now,
            });
            return Object.freeze({
                envelope_id: envelope.envelope_id,
                token: preview.token,
                input_digest: inputDigest,
                data_revision: dataRevision,
                reused: preview.reused,
            });
        },
        execute(execution) {
            const envelope = execution.envelope;
            const operation = purchaseOperation(envelope);
            const inputDigest = digestDomainEnvelope(envelope);
            if (execution.input_digest !== inputDigest)
                return invalid("input_digest");
            const authority = authorizeRepositoryPreview({
                database: options.database,
                secret: options.secret,
                token: execution.token,
                inputDigest,
                subjectScope: envelope.subject_scope,
                commandType: envelope.command_type,
                dataRevision: execution.data_revision,
            });
            if (authority.binding.preview_id !== envelope.envelope_id) {
                return invalid("envelope_id");
            }
            const committedAt = storedEnvelopeTime(options.database, envelope.envelope_id);
            const prepared = preparePurchaseOperation({
                database: options.database,
                secret: options.secret,
                token: execution.token,
                inputDigest,
                dataRevision: execution.data_revision,
                subjectScope: envelope.subject_scope,
                commandType: envelope.command_type,
                idempotencyKey: envelope.idempotency_key,
                sourceMessageId: envelope.source_message_id,
                conversationId: envelope.conversation_id,
                receivedAt: envelope.received_at,
                committedAt,
                sequence: 0,
                operation,
            });
            const traceId = prepared.fact.traceId;
            const result = frozenExecutionResult(envelope, inputDigest, prepared.result);
            const finalizerInput = {
                database: options.database,
                secret: options.secret,
                token: execution.token,
                inputDigest,
                subjectScope: envelope.subject_scope,
                commandType: envelope.command_type,
                dataRevision: execution.data_revision,
                traceId,
                resultStatus: "committed",
                receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
                finalizedAt: committedAt,
                frozenAt: committedAt,
                payload: result,
                mixedItems: Object.freeze([]),
            };
            if (authority.envelope_state === "finalized") {
                return finalizeEnvelope(finalizerInput).payload;
            }
            if (authority.envelope_state === "received") {
                if (options.fault === "before_fact_commit") {
                    emitFailure(options.failureSink, {
                        stage: "FactCommit",
                        error_code: "DIET_DOMAIN_EXECUTION_FAILED",
                        trace_id: traceId,
                        input_digest: inputDigest,
                    });
                    throw new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
                }
                appendPreparedOperationFact(prepared.fact, {
                    failureSink: (entry) => emitFailure(options.failureSink, {
                        stage: "FactCommit",
                        error_code: entry.error_code,
                        trace_id: entry.trace_id,
                        input_digest: entry.input_digest,
                    }),
                });
                try {
                    applyPurchaseEffect(options.database, prepared.outbox_id, committedAt, options.fault === "after_inventory_business_writes"
                        ? "after_business_writes"
                        : undefined);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : "INVENTORY_EFFECT_FAILED";
                    const code = message.split(":", 1)[0];
                    emitFailure(options.failureSink, {
                        stage: "EffectBundle",
                        error_code: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "INVENTORY_EFFECT_FAILED",
                        trace_id: traceId,
                        input_digest: inputDigest,
                    });
                    throw error;
                }
                sealPreparedEnvelopeFacts({
                    database: options.database,
                    secret: options.secret,
                    token: execution.token,
                    inputDigest,
                    subjectScope: envelope.subject_scope,
                    commandType: envelope.command_type,
                    dataRevision: execution.data_revision,
                    traceId,
                    expectedOperationIds: Object.freeze([operation.operation_id]),
                    sealedAt: committedAt,
                });
            }
            const state = authorizeRepositoryPreview({
                database: options.database,
                secret: options.secret,
                token: execution.token,
                inputDigest,
                subjectScope: envelope.subject_scope,
                commandType: envelope.command_type,
                dataRevision: execution.data_revision,
            });
            if (state.envelope_state !== "effects_stable") {
                throw new Error(`DIET_DOMAIN_EXECUTION_PENDING:${state.envelope_state}`);
            }
            const finalized = finalizeEnvelope(finalizerInput);
            if (canonicalJson(finalized.payload) !== canonicalJson(result)) {
                throw new Error("DIET_DOMAIN_RESULT_INVALID:finalized_payload");
            }
            return finalized.payload;
        },
        query(operation) {
            return queryDomainReadModel(options.database, operation);
        },
    });
}
