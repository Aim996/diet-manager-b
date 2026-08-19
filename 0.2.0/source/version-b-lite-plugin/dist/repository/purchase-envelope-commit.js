import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
import { appendPreparedOperationFactInOpenTransaction, sealPreparedEnvelopeFactsInOpenTransaction, } from "./fact-commit.js";
import { processInventoryEffectInOpenTransaction } from "./inventory-effects.js";
function invalid(reason) {
    throw new TypeError(`PURCHASE_ENVELOPE_REQUEST_INVALID:${reason}`);
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
function freezeCommit(value) {
    const fields = exactDataProperties(value, ["operations", "seal", "effect_times"]);
    if (!Array.isArray(fields.operations.value) || fields.operations.value.length === 0) {
        return invalid("operations");
    }
    const operations = fields.operations.value;
    const seal = fields.seal.value;
    if (typeof seal !== "object" || seal === null || Array.isArray(seal)) {
        return invalid("seal");
    }
    const database = seal.database;
    if (typeof database !== "object" || database === null) {
        return invalid("database");
    }
    if (!Array.isArray(fields.effect_times.value)) {
        return invalid("effect_times");
    }
    const effectTimes = fields.effect_times.value;
    if (effectTimes.length !== operations.length) {
        return invalid("effect_times_count");
    }
    for (const operation of operations) {
        if (typeof operation !== "object" || operation === null || Array.isArray(operation)) {
            return invalid("operation");
        }
    }
    for (const effectTime of effectTimes) {
        if (typeof effectTime !== "string" || effectTime.length === 0) {
            return invalid("effect_time");
        }
    }
    return Object.freeze({
        database: database,
        operations: Object.freeze([...operations]),
        seal: seal,
        effect_times: Object.freeze([...effectTimes]),
    });
}
function exactCommitOptions(value) {
    if (value === undefined)
        return Object.freeze({ faultSequence: 0 });
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return invalid("options");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") ||
        keys.some((key) => key !== "fault" && key !== "faultSequence")) {
        return invalid("options");
    }
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            return invalid("options");
        }
    }
    const fault = descriptors.fault?.value;
    if (fault !== undefined &&
        ![
            "after_operation_fact",
            "after_operation_effect",
            "before_seal",
            "before_commit",
            "after_commit_before_reply",
        ].includes(String(fault))) {
        return invalid("fault");
    }
    const faultSequence = descriptors.faultSequence?.value ?? 0;
    if (!Number.isSafeInteger(faultSequence) || faultSequence < 0) {
        return invalid("fault_sequence");
    }
    return Object.freeze({
        ...(fault === undefined ? {} : { fault: fault }),
        faultSequence: faultSequence,
    });
}
export function commitPreparedPurchaseEnvelope(input, options) {
    const frozen = freezeCommit(input);
    const frozenOptions = exactCommitOptions(options);
    let transactionOpen = false;
    try {
        frozen.database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        assertCurrentMigrationAuthority(frozen.database);
        frozen.operations.forEach((operation, index) => {
            appendPreparedOperationFactInOpenTransaction(operation);
            if (frozenOptions.fault === "after_operation_fact" && frozenOptions.faultSequence === index) {
                throw new Error("FACT_COMMIT_FAILED:after_operation_fact");
            }
            const effect = operation.effects[0];
            if (!effect)
                return invalid("effect_missing");
            processInventoryEffectInOpenTransaction({
                database: frozen.database,
                outboxId: effect.outboxId,
                now: frozen.effect_times[index],
            }, {
                deferEnvelopeStability: true,
                ...(frozenOptions.fault === "after_operation_effect" &&
                    frozenOptions.faultSequence === index
                    ? { fault: "after_business_writes" }
                    : {}),
            });
        });
        if (frozenOptions.fault === "before_seal") {
            throw new Error("PURCHASE_ENVELOPE_FAILED:before_seal");
        }
        const result = sealPreparedEnvelopeFactsInOpenTransaction(frozen.seal);
        if (frozenOptions.fault === "before_commit") {
            throw new Error("PURCHASE_ENVELOPE_FAILED:before_commit");
        }
        frozen.database.exec("COMMIT");
        transactionOpen = false;
        if (frozenOptions.fault === "after_commit_before_reply") {
            throw new Error("PURCHASE_ENVELOPE_RESPONSE_LOST:after_commit_before_reply");
        }
        return result;
    }
    catch (error) {
        if (transactionOpen) {
            try {
                frozen.database.exec("ROLLBACK");
            }
            catch {
                // Preserve the primary envelope failure.
            }
        }
        throw error;
    }
}
