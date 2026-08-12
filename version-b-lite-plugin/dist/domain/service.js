import { canonicalJson } from "../authority/canonical-json.js";
import { createServerPreview, authorizeRepositoryPreview } from "../preview/store.js";
import { appendPreparedOperationFact, sealPreparedEnvelopeFacts, } from "../repository/fact-commit.js";
import { finalizeEnvelope, } from "../repository/envelope-finalize.js";
import { computeRepositoryDataRevision } from "../repository/revision.js";
import { applyMealEffects, markMealEffectsRetryable, applyPurchaseEffect, applyCorrectionEffects, prepareCorrectionOperation, readAppliedCorrectionResult, preflightMealOperation, prepareMealOperation, preparePurchaseOperation, } from "./effect-bundle.js";
import { deriveDomainId, digestDomainEnvelope } from "./identity.js";
import { queryDomainReadModel } from "./read-model.js";
import { buildQuickPrompt, buildReceiptData, } from "./receipt.js";
function invalid(reason) {
    throw new TypeError(`DIET_DOMAIN_REQUEST_INVALID:${reason}`);
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
function record(value, keys, field) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return invalid(field);
    const actual = Object.keys(value).sort();
    if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])) {
        return invalid(field);
    }
    return value;
}
function text(value, field) {
    if (typeof value !== "string" || value.length === 0 || value.length > 256 || /[\u0000-\u001F\u007F]/.test(value)) {
        return invalid(field);
    }
    return value;
}
function safeNonnegativeInteger(value, field) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        return invalid(field);
    }
    return value;
}
function nullableSafeNonnegativeInteger(value, field) {
    return value === null ? null : safeNonnegativeInteger(value, field);
}
function enumValue(value, allowed, field) {
    if (typeof value !== "string" || !allowed.includes(value))
        return invalid(field);
    return value;
}
function validateNutritionVector(value, field) {
    const candidate = record(value, [
        "energy_kcal_milli", "protein_mg", "fat_mg", "carbohydrate_mg", "fiber_mg", "water_ml_milli",
    ], field);
    for (const key of Object.keys(candidate)) {
        nullableSafeNonnegativeInteger(candidate[key], `${field}.${key}`);
    }
}
function validateNutritionSources(value, field) {
    if (!Array.isArray(value))
        return invalid(field);
    for (const [index, source] of value.entries()) {
        const candidate = record(source, [
            "source_type", "source_ref", "profile_version", "applicable_product_id", "basis_kind",
            "basis_microunits", "basis_unit", "nutrients",
        ], `${field}.${index}`);
        enumValue(candidate.source_type, ["product_label", "public_fixture"], `${field}.${index}.source_type`);
        text(candidate.source_ref, `${field}.${index}.source_ref`);
        const version = safeNonnegativeInteger(candidate.profile_version, `${field}.${index}.profile_version`);
        if (version < 1)
            return invalid(`${field}.${index}.profile_version`);
        if (candidate.applicable_product_id !== null)
            text(candidate.applicable_product_id, `${field}.${index}.applicable_product_id`);
        enumValue(candidate.basis_kind, [
            "per_100g", "per_100ml", "per_serving", "per_item", "per_package", "custom_recipe",
        ], `${field}.${index}.basis_kind`);
        const basis = safeNonnegativeInteger(candidate.basis_microunits, `${field}.${index}.basis_microunits`);
        if (basis === 0)
            return invalid(`${field}.${index}.basis_microunits`);
        text(candidate.basis_unit, `${field}.${index}.basis_unit`);
        validateNutritionVector(candidate.nutrients, `${field}.${index}.nutrients`);
    }
}
function validateStructuredAmount(value, field) {
    const amount = record(value, [
        "unit", "observed_microunits", "nutrition_adoption_microunits",
        "inventory_deduction_microunits", "template_reference_microunits", "evidence",
    ], field);
    text(amount.unit, `${field}.unit`);
    safeNonnegativeInteger(amount.observed_microunits, `${field}.observed_microunits`);
    nullableSafeNonnegativeInteger(amount.nutrition_adoption_microunits, `${field}.nutrition_adoption_microunits`);
    nullableSafeNonnegativeInteger(amount.inventory_deduction_microunits, `${field}.inventory_deduction_microunits`);
    nullableSafeNonnegativeInteger(amount.template_reference_microunits, `${field}.template_reference_microunits`);
    enumValue(amount.evidence, ["explicit", "estimated_upper_bound"], `${field}.evidence`);
}
function validateOperation(value, field) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return invalid(field);
    const operation = value;
    const kind = operation.kind;
    if (kind === "add_inventory") {
        const candidate = record(value, ["kind", "operation_id", "product", "batch_id", "amount", "nutrition_sources"], field);
        text(candidate.operation_id, `${field}.operation_id`);
        text(candidate.batch_id, `${field}.batch_id`);
        const product = record(candidate.product, ["product_id", "normalized_name", "product_type"], `${field}.product`);
        text(product.product_id, `${field}.product.product_id`);
        text(product.normalized_name, `${field}.product.normalized_name`);
        text(product.product_type, `${field}.product.product_type`);
        validateStructuredAmount(candidate.amount, `${field}.amount`);
        validateNutritionSources(candidate.nutrition_sources, `${field}.nutrition_sources`);
        return;
    }
    if (kind === "record_meal") {
        const candidate = record(value, ["kind", "operation_id", "occurred_at", "meal_slot", "location", "items"], field);
        text(candidate.operation_id, `${field}.operation_id`);
        timestamp(candidate.occurred_at, `${field}.occurred_at`);
        text(candidate.meal_slot, `${field}.meal_slot`);
        enumValue(candidate.location, ["home", "outside"], `${field}.location`);
        if (!Array.isArray(candidate.items) || candidate.items.length === 0)
            return invalid(`${field}.items`);
        for (const [index, item] of candidate.items.entries()) {
            const mealItem = record(item, ["normalized_name", "item_type", "amount", "nutrition_sources"], `${field}.items.${index}`);
            text(mealItem.normalized_name, `${field}.items.${index}.normalized_name`);
            enumValue(mealItem.item_type, ["dish", "food", "nutrition_drink"], `${field}.items.${index}.item_type`);
            validateStructuredAmount(mealItem.amount, `${field}.items.${index}.amount`);
            validateNutritionSources(mealItem.nutrition_sources, `${field}.items.${index}.nutrition_sources`);
        }
        return;
    }
    if (kind === "correct_record") {
        const candidate = record(value, ["kind", "operation_id", "target_event_id", "base_revision", "item_order", "replacement_amount"], field);
        text(candidate.operation_id, `${field}.operation_id`);
        text(candidate.target_event_id, `${field}.target_event_id`);
        safeNonnegativeInteger(candidate.base_revision, `${field}.base_revision`);
        safeNonnegativeInteger(candidate.item_order, `${field}.item_order`);
        validateStructuredAmount(candidate.replacement_amount, `${field}.replacement_amount`);
        return;
    }
    if (kind === "undo_record") {
        const candidate = record(value, ["kind", "operation_id", "target_event_id", "base_revision"], field);
        text(candidate.operation_id, `${field}.operation_id`);
        text(candidate.target_event_id, `${field}.target_event_id`);
        safeNonnegativeInteger(candidate.base_revision, `${field}.base_revision`);
        return;
    }
    if (kind === "query_inventory") {
        text(record(value, ["kind", "operation_id"], field).operation_id, `${field}.operation_id`);
        return;
    }
    if (kind === "query_meals" || kind === "query_daily_summary") {
        const candidate = record(value, ["kind", "operation_id", "date", "timezone"], field);
        text(candidate.operation_id, `${field}.operation_id`);
        text(candidate.date, `${field}.date`);
        enumValue(candidate.timezone, ["Asia/Shanghai"], `${field}.timezone`);
        return;
    }
    return invalid(`${field}.kind`);
}
function unsafeClone(path, reason) {
    return invalid(`${path.replaceAll(".", "_")}_${reason}`);
}
function objectPrototype(value, path) {
    try {
        return Object.getPrototypeOf(value);
    }
    catch {
        return unsafeClone(path, "clone");
    }
}
function descriptors(value, path) {
    try {
        return Object.getOwnPropertyDescriptors(value);
    }
    catch {
        return unsafeClone(path, "clone");
    }
}
function ownKeys(value, path) {
    try {
        return Reflect.ownKeys(value);
    }
    catch {
        return unsafeClone(path, "clone");
    }
}
function dataDescriptor(value, path) {
    if (!value || !("value" in value) || value.get !== undefined || value.set !== undefined) {
        return unsafeClone(path, "descriptor");
    }
    return value.value;
}
function cloneUntrustedJson(value, path) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            return unsafeClone(path, "number");
        return value;
    }
    if (typeof value !== "object")
        return unsafeClone(path, "value");
    if (Array.isArray(value)) {
        if (objectPrototype(value, path) !== Array.prototype)
            return unsafeClone(path, "prototype");
        const source = descriptors(value, path);
        const length = dataDescriptor(source.length, path);
        if (!Number.isSafeInteger(length) || length < 0)
            return unsafeClone(path, "length");
        const keys = ownKeys(value, path);
        if (keys.some((key) => typeof key === "symbol"))
            return unsafeClone(path, "symbols");
        const names = keys;
        const expected = ["length", ...Array.from({ length: length }, (_, index) => String(index))];
        if (names.length !== expected.length || expected.some((name) => !Object.hasOwn(source, name))) {
            return unsafeClone(path, "shape");
        }
        const lengthDescriptor = source.length;
        if (!lengthDescriptor || lengthDescriptor.enumerable !== false || lengthDescriptor.configurable !== false || typeof lengthDescriptor.writable !== "boolean") {
            return unsafeClone(path, "length_descriptor");
        }
        const clone = [];
        for (let index = 0; index < length; index += 1) {
            const descriptor = source[String(index)];
            if (!descriptor || descriptor.enumerable !== true || typeof descriptor.configurable !== "boolean" || typeof descriptor.writable !== "boolean") {
                return unsafeClone(`${path}.${index}`, "descriptor");
            }
            clone.push(cloneUntrustedJson(dataDescriptor(descriptor, `${path}.${index}`), `${path}.${index}`));
        }
        return Object.freeze(clone);
    }
    if (objectPrototype(value, path) !== Object.prototype)
        return unsafeClone(path, "prototype");
    const source = descriptors(value, path);
    const clone = {};
    const keys = ownKeys(value, path);
    if (keys.some((key) => typeof key === "symbol"))
        return unsafeClone(path, "symbols");
    for (const name of keys) {
        const descriptor = source[name];
        if (descriptor?.enumerable !== true)
            return unsafeClone(path, "descriptor");
        Object.defineProperty(clone, name, {
            value: cloneUntrustedJson(dataDescriptor(descriptor, path), `${path}.${name}`),
            enumerable: true,
            configurable: false,
            writable: false,
        });
    }
    return Object.freeze(clone);
}
function validateAndFreezeEnvelope(value) {
    const cloned = cloneUntrustedJson(value, "envelope");
    const envelope = record(cloned, [
        "envelope_id", "idempotency_key", "command_type", "subject_scope", "source_message_id",
        "conversation_id", "received_at", "timezone", "operations",
    ], "envelope");
    text(envelope.envelope_id, "envelope.envelope_id");
    text(envelope.idempotency_key, "envelope.idempotency_key");
    enumValue(envelope.command_type, [
        "record_meal", "record_water", "add_inventory", "query_inventory", "query_meals",
        "query_daily_summary", "correct_record", "undo_record",
    ], "envelope.command_type");
    text(envelope.subject_scope, "envelope.subject_scope");
    text(envelope.source_message_id, "envelope.source_message_id");
    text(envelope.conversation_id, "envelope.conversation_id");
    timestamp(envelope.received_at, "envelope.received_at");
    enumValue(envelope.timezone, ["Asia/Shanghai"], "envelope.timezone");
    if (!Array.isArray(envelope.operations) || envelope.operations.length === 0)
        return invalid("envelope.operations");
    for (let index = 0; index < envelope.operations.length; index += 1) {
        validateOperation(envelope.operations[index], `envelope.operations.${index}`);
    }
    return envelope;
}
function preflightWriteOperations(database, operations) {
    if (operations.length === 2) {
        const [purchase, meal] = operations;
        preflightMealOperation(database, meal, new Map([[purchase.product.normalized_name, Object.freeze([{
                        batch_id: purchase.batch_id,
                        product_id: purchase.product.product_id,
                        available_microunits: purchase.amount.observed_microunits,
                        unit: purchase.amount.unit,
                    }])]]));
        return;
    }
    for (const operation of operations) {
        if (operation.kind === "record_meal")
            preflightMealOperation(database, operation);
    }
}
function quickPromptIssueCode(value) {
    switch (value) {
        case "inventory_multiple_candidates":
        case "inventory_insufficient":
        case "inventory_unit_incompatible":
        case "inventory_amount_unknown":
            return value;
        default:
            throw new Error("DIET_DOMAIN_RESULT_INVALID:issue_code");
    }
}
function buildMealQuickPrompts(database, result, idempotencyKey, generatedAt) {
    const expiresAt = new Date(Date.parse(generatedAt) + 60 * 60 * 1_000).toISOString();
    return Object.freeze(result.meal_items.flatMap((item) => item.issue_codes.map((code) => {
        const issueId = deriveDomainId("issue", idempotencyKey, item.item_order);
        const row = database.prepare("SELECT issue_id, issue_code, revision, detected_at, status FROM issues WHERE issue_id = ?").get(issueId);
        if (!row || row.issue_id !== issueId || row.issue_code !== code || row.revision !== 1 ||
            row.detected_at !== generatedAt || row.status !== "open")
            throw new Error("DIET_DOMAIN_RESULT_INVALID:issue_authority");
        return buildQuickPrompt({
            issue_id: row.issue_id,
            issue_code: quickPromptIssueCode(row.issue_code),
            revision: row.revision,
            generated_at: row.detected_at,
            expires_at: expiresAt,
        });
    })));
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
function writeOperations(envelope) {
    if (envelope.command_type === "record_meal" &&
        envelope.operations.length === 2 &&
        envelope.operations[0]?.kind === "add_inventory" &&
        envelope.operations[1]?.kind === "record_meal") {
        return Object.freeze([envelope.operations[0], envelope.operations[1]]);
    }
    if (envelope.operations.length !== 1)
        return invalid("operation_count");
    const operation = envelope.operations[0];
    if ((envelope.command_type === "add_inventory" && operation.kind === "add_inventory") ||
        (envelope.command_type === "record_meal" && operation.kind === "record_meal") ||
        (envelope.command_type === "correct_record" && operation.kind === "correct_record") ||
        (envelope.command_type === "undo_record" && operation.kind === "undo_record"))
        return Object.freeze([operation]);
    return invalid("command_operation");
}
function timestampAfter(value, offsetMilliseconds) {
    return new Date(Date.parse(value) + offsetMilliseconds).toISOString();
}
function storedFinalizedExecution(database, envelopeId) {
    const row = database.prepare(`SELECT result_status, receipt_id, finalized_at, frozen_at, payload_json
     FROM envelope_finalizations WHERE envelope_id = ?`).get(envelopeId);
    if (!row ||
        (row.result_status !== "committed" && row.result_status !== "committed_with_issues") ||
        row.receipt_id === null || row.finalized_at === null || row.frozen_at === null)
        throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_missing");
    const parsed = JSON.parse(row.payload_json);
    if (canonicalJson(parsed) !== row.payload_json || parsed.status !== row.result_status) {
        throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_payload");
    }
    return {
        payload: parsed,
        resultStatus: row.result_status,
        receiptId: row.receipt_id,
        finalizedAt: row.finalized_at,
        frozenAt: row.frozen_at,
    };
}
function storedMixedItems(database, envelopeId) {
    const rows = database.prepare(`SELECT sequence, operation_id, idempotency_key, command_type, status, error_code, payload_json
     FROM mixed_item_results WHERE envelope_id = ? ORDER BY sequence`).all(envelopeId);
    return Object.freeze(rows.map((row, index) => {
        const payload = JSON.parse(row.payload_json);
        if (row.sequence !== index || canonicalJson(payload) !== row.payload_json ||
            (row.command_type !== "add_inventory" && row.command_type !== "record_meal") ||
            (row.status !== "committed" && row.status !== "committed_with_issues" && row.status !== "failed"))
            throw new Error("DIET_DOMAIN_RESULT_INVALID:mixed_items");
        return Object.freeze({
            sequence: row.sequence,
            operation_id: row.operation_id,
            idempotency_key: row.idempotency_key,
            command_type: row.command_type,
            status: row.status,
            error_code: row.error_code,
            payload,
        });
    }));
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
        input.fault !== "after_inventory_business_writes" &&
        input.fault !== "after_meal_nutrition" &&
        input.fault !== "after_meal_first_item" &&
        input.fault !== "after_mixed_meal_effect_commit" &&
        input.fault !== "after_mixed_seal" &&
        input.fault !== "after_mixed_finalize_commit") {
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
            const validatedEnvelope = validateAndFreezeEnvelope(envelope);
            const operations = writeOperations(validatedEnvelope);
            preflightWriteOperations(options.database, operations);
            const inputDigest = digestDomainEnvelope(validatedEnvelope);
            const dataRevision = computeRepositoryDataRevision(options.database);
            const now = timestamp(options.now(), "clock");
            const preview = createServerPreview({
                database: options.database,
                secret: options.secret,
                previewId: validatedEnvelope.envelope_id,
                idempotencyKey: validatedEnvelope.idempotency_key,
                inputDigest,
                subjectScope: validatedEnvelope.subject_scope,
                commandType: validatedEnvelope.command_type,
                dataRevision,
                sourceMessageId: validatedEnvelope.source_message_id,
                conversationId: validatedEnvelope.conversation_id,
                previewMaterial: Object.freeze({
                    authority_kind: "diet-manager/domain-preview/v1",
                    envelope: validatedEnvelope,
                }),
                now,
            });
            return Object.freeze({
                envelope_id: validatedEnvelope.envelope_id,
                token: preview.token,
                input_digest: inputDigest,
                data_revision: dataRevision,
                reused: preview.reused,
            });
        },
        execute(execution) {
            const envelope = validateAndFreezeEnvelope(execution.envelope);
            const operations = writeOperations(envelope);
            preflightWriteOperations(options.database, operations);
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
            if (operations.length === 2) {
                const [purchaseOperation, mealOperation] = operations;
                const traceId = deriveDomainId("trace", envelope.idempotency_key, 0);
                if (authority.envelope_state === "finalized") {
                    const stored = storedFinalizedExecution(options.database, envelope.envelope_id);
                    return finalizeEnvelope({
                        database: options.database,
                        secret: options.secret,
                        token: execution.token,
                        inputDigest,
                        subjectScope: envelope.subject_scope,
                        commandType: envelope.command_type,
                        dataRevision: execution.data_revision,
                        traceId,
                        resultStatus: stored.resultStatus,
                        receiptId: stored.receiptId,
                        finalizedAt: stored.finalizedAt,
                        frozenAt: stored.frozenAt,
                        payload: stored.payload,
                        mixedItems: storedMixedItems(options.database, envelope.envelope_id),
                    }).payload;
                }
                if (authority.envelope_state !== "received" &&
                    authority.envelope_state !== "effects_stable") {
                    throw new Error(`DIET_DOMAIN_EXECUTION_PENDING:${authority.envelope_state}`);
                }
                const purchaseIdentityKey = deriveDomainId("idempotency", envelope.idempotency_key, 0);
                const mealIdentityKey = deriveDomainId("idempotency", envelope.idempotency_key, 1);
                const purchaseAt = timestampAfter(committedAt, 0);
                const mealAt = timestampAfter(committedAt, 1);
                const finalizedAt = timestampAfter(committedAt, 2);
                const preparedPurchase = preparePurchaseOperation({
                    database: options.database,
                    secret: options.secret,
                    token: execution.token,
                    inputDigest,
                    dataRevision: execution.data_revision,
                    subjectScope: envelope.subject_scope,
                    commandType: envelope.command_type,
                    idempotencyKey: envelope.idempotency_key,
                    effectIdentityKey: purchaseIdentityKey,
                    sourceMessageId: envelope.source_message_id,
                    conversationId: envelope.conversation_id,
                    receivedAt: envelope.received_at,
                    committedAt: purchaseAt,
                    sequence: 0,
                    operation: purchaseOperation,
                });
                if (options.fault === "before_fact_commit") {
                    emitFailure(options.failureSink, {
                        stage: "FactCommit",
                        error_code: "DIET_DOMAIN_EXECUTION_FAILED",
                        trace_id: traceId,
                        input_digest: inputDigest,
                    });
                    throw new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
                }
                if (authority.envelope_state === "received") {
                    appendPreparedOperationFact(preparedPurchase.fact);
                    applyPurchaseEffect(options.database, preparedPurchase.outbox_id, purchaseAt, options.fault === "after_inventory_business_writes"
                        ? "after_business_writes"
                        : undefined);
                }
                const preparedMeal = prepareMealOperation({
                    database: options.database,
                    secret: options.secret,
                    token: execution.token,
                    inputDigest,
                    dataRevision: execution.data_revision,
                    subjectScope: envelope.subject_scope,
                    commandType: envelope.command_type,
                    idempotencyKey: envelope.idempotency_key,
                    effectIdentityKey: mealIdentityKey,
                    sourceMessageId: envelope.source_message_id,
                    conversationId: envelope.conversation_id,
                    receivedAt: envelope.received_at,
                    committedAt: mealAt,
                    sequence: 1,
                    operation: mealOperation,
                });
                if (authority.envelope_state === "received") {
                    appendPreparedOperationFact(preparedMeal.fact);
                }
                const mealResult = applyMealEffects({
                    database: options.database,
                    envelopeId: envelope.envelope_id,
                    operationId: mealOperation.operation_id,
                    operationSequence: 1,
                    idempotencyKey: mealIdentityKey,
                    now: mealAt,
                    location: mealOperation.location,
                    ...(options.fault === "after_meal_nutrition"
                        ? { fault: "after_nutrition" }
                        : options.fault === "after_meal_first_item"
                            ? { fault: "after_first_item" }
                            : {}),
                });
                if (authority.envelope_state === "received" &&
                    options.fault === "after_mixed_meal_effect_commit") {
                    throw new Error("DIET_DOMAIN_EXECUTION_FAILED:after_mixed_meal_effect_commit");
                }
                if (authority.envelope_state === "received") {
                    sealPreparedEnvelopeFacts({
                        database: options.database,
                        secret: options.secret,
                        token: execution.token,
                        inputDigest,
                        subjectScope: envelope.subject_scope,
                        commandType: envelope.command_type,
                        dataRevision: execution.data_revision,
                        traceId,
                        expectedOperationIds: Object.freeze([
                            purchaseOperation.operation_id,
                            mealOperation.operation_id,
                        ]),
                        sealedAt: finalizedAt,
                    });
                    if (options.fault === "after_mixed_seal") {
                        throw new Error("DIET_DOMAIN_EXECUTION_FAILED:after_mixed_seal");
                    }
                }
                const quickPrompts = buildMealQuickPrompts(options.database, mealResult, mealIdentityKey, mealAt);
                const receiptData = buildReceiptData({
                    status: mealResult.status,
                    date: mealResult.daily_progress.date,
                    meal_slot: mealOperation.meal_slot,
                    items: mealResult.meal_items,
                    quick_prompts: quickPrompts,
                    daily_progress: mealResult.daily_progress,
                });
                const status = mealResult.status;
                const result = Object.freeze({
                    envelope_id: envelope.envelope_id,
                    input_digest: inputDigest,
                    status,
                    items: Object.freeze([preparedPurchase.result, mealResult]),
                    payload: Object.freeze({
                        authority_kind: "diet-manager/domain-execution/v1",
                        daily_progress: mealResult.daily_progress,
                        daily_progress_by_date: mealResult.daily_progress_by_date,
                        quick_prompts: quickPrompts,
                        receipt_data: receiptData,
                    }),
                });
                return finalizeEnvelope({
                    database: options.database,
                    secret: options.secret,
                    token: execution.token,
                    inputDigest,
                    subjectScope: envelope.subject_scope,
                    commandType: envelope.command_type,
                    dataRevision: execution.data_revision,
                    traceId,
                    resultStatus: status,
                    receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
                    finalizedAt,
                    frozenAt: finalizedAt,
                    payload: result,
                    mixedItems: Object.freeze([
                        Object.freeze({
                            sequence: 0,
                            operation_id: purchaseOperation.operation_id,
                            idempotency_key: purchaseIdentityKey,
                            command_type: "add_inventory",
                            status: preparedPurchase.result.status,
                            error_code: preparedPurchase.result.error_code,
                            payload: preparedPurchase.result,
                        }),
                        Object.freeze({
                            sequence: 1,
                            operation_id: mealOperation.operation_id,
                            idempotency_key: mealIdentityKey,
                            command_type: "record_meal",
                            status: mealResult.status,
                            error_code: mealResult.error_code,
                            payload: mealResult,
                        }),
                    ]),
                }, options.fault === "after_mixed_finalize_commit"
                    ? { fault: "after_commit_before_reply" }
                    : undefined).payload;
            }
            const operation = operations[0];
            if (operation.kind === "correct_record" || operation.kind === "undo_record") {
                const traceId = deriveDomainId("trace", envelope.idempotency_key, 0);
                if (authority.envelope_state === "finalized") {
                    const row = options.database.prepare("SELECT payload_json FROM envelope_finalizations WHERE envelope_id = ?").get(envelope.envelope_id);
                    if (!row)
                        throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_missing");
                    const parsed = JSON.parse(row.payload_json);
                    if (canonicalJson(parsed) !== row.payload_json ||
                        (parsed.status !== "committed" && parsed.status !== "committed_with_issues")) {
                        throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_payload");
                    }
                    return finalizeEnvelope({
                        database: options.database,
                        secret: options.secret,
                        token: execution.token,
                        inputDigest,
                        subjectScope: envelope.subject_scope,
                        commandType: envelope.command_type,
                        dataRevision: execution.data_revision,
                        traceId,
                        resultStatus: parsed.status,
                        receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
                        finalizedAt: committedAt,
                        frozenAt: committedAt,
                        payload: parsed,
                        mixedItems: Object.freeze([]),
                    }).payload;
                }
                if (authority.envelope_state !== "received" &&
                    authority.envelope_state !== "effects_stable") {
                    throw new Error(`DIET_DOMAIN_EXECUTION_PENDING:${authority.envelope_state}`);
                }
                const existingFact = options.database.prepare(`SELECT event_id, event_type FROM event_records
           WHERE envelope_id = ? AND operation_id = ?`).get(envelope.envelope_id, operation.operation_id);
                if (existingFact) {
                    if (existingFact.event_id !== deriveDomainId("event", envelope.idempotency_key, 0) ||
                        existingFact.event_type !== "diet_correction") {
                        throw new Error("DIET_DOMAIN_RESULT_INVALID:correction_fact_identity");
                    }
                }
                else if (authority.envelope_state === "received") {
                    const preparedCorrection = prepareCorrectionOperation({
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
                    if (options.fault === "before_fact_commit") {
                        emitFailure(options.failureSink, {
                            stage: "FactCommit",
                            error_code: "DIET_DOMAIN_EXECUTION_FAILED",
                            trace_id: traceId,
                            input_digest: inputDigest,
                        });
                        throw new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
                    }
                    appendPreparedOperationFact(preparedCorrection.fact, {
                        failureSink: (entry) => emitFailure(options.failureSink, {
                            stage: "FactCommit",
                            error_code: entry.error_code,
                            trace_id: entry.trace_id,
                            input_digest: entry.input_digest,
                        }),
                    });
                }
                let correctionResult;
                if (authority.envelope_state === "effects_stable") {
                    correctionResult = readAppliedCorrectionResult({
                        database: options.database,
                        envelopeId: envelope.envelope_id,
                        operationId: operation.operation_id,
                        operationSequence: 0,
                        idempotencyKey: envelope.idempotency_key,
                    });
                }
                else {
                    try {
                        correctionResult = applyCorrectionEffects({
                            database: options.database,
                            envelopeId: envelope.envelope_id,
                            operationId: operation.operation_id,
                            operationSequence: 0,
                            idempotencyKey: envelope.idempotency_key,
                            now: committedAt,
                        });
                    }
                    catch (error) {
                        const code = (error instanceof Error ? error.message : "CORRECTION_EFFECT_FAILED")
                            .split(":", 1)[0];
                        emitFailure(options.failureSink, {
                            stage: "EffectBundle",
                            error_code: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "CORRECTION_EFFECT_FAILED",
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
                const correctionExecution = Object.freeze({
                    envelope_id: envelope.envelope_id,
                    input_digest: inputDigest,
                    status: correctionResult.status,
                    items: Object.freeze([correctionResult]),
                    payload: Object.freeze({
                        authority_kind: "diet-manager/domain-execution/v1",
                        daily_progress: correctionResult.daily_progress,
                        daily_progress_by_date: correctionResult.daily_progress_by_date,
                    }),
                });
                return finalizeEnvelope({
                    database: options.database,
                    secret: options.secret,
                    token: execution.token,
                    inputDigest,
                    subjectScope: envelope.subject_scope,
                    commandType: envelope.command_type,
                    dataRevision: execution.data_revision,
                    traceId,
                    resultStatus: correctionResult.status,
                    receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
                    finalizedAt: committedAt,
                    frozenAt: committedAt,
                    payload: correctionExecution,
                    mixedItems: Object.freeze([]),
                }).payload;
            }
            if (operation.kind === "record_meal") {
                const preparedMeal = prepareMealOperation({
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
                if (authority.envelope_state === "finalized") {
                    const row = options.database
                        .prepare("SELECT payload_json FROM envelope_finalizations WHERE envelope_id = ?")
                        .get(envelope.envelope_id);
                    if (!row)
                        throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_missing");
                    const parsed = JSON.parse(row.payload_json);
                    if (canonicalJson(parsed) !== row.payload_json) {
                        throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_payload");
                    }
                    if (parsed.status !== "committed" && parsed.status !== "committed_with_issues") {
                        throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_status");
                    }
                    return finalizeEnvelope({
                        database: options.database,
                        secret: options.secret,
                        token: execution.token,
                        inputDigest,
                        subjectScope: envelope.subject_scope,
                        commandType: envelope.command_type,
                        dataRevision: execution.data_revision,
                        traceId: preparedMeal.fact.traceId,
                        resultStatus: parsed.status,
                        receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
                        finalizedAt: committedAt,
                        frozenAt: committedAt,
                        payload: parsed,
                        mixedItems: Object.freeze([]),
                    }).payload;
                }
                if (authority.envelope_state !== "received" && authority.envelope_state !== "effects_pending") {
                    throw new Error(`DIET_DOMAIN_EXECUTION_PENDING:${authority.envelope_state}`);
                }
                if (authority.envelope_state === "received" && options.fault === "before_fact_commit") {
                    emitFailure(options.failureSink, {
                        stage: "FactCommit",
                        error_code: "DIET_DOMAIN_EXECUTION_FAILED",
                        trace_id: preparedMeal.fact.traceId,
                        input_digest: inputDigest,
                    });
                    throw new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
                }
                if (authority.envelope_state === "received") {
                    appendPreparedOperationFact(preparedMeal.fact, {
                        failureSink: (entry) => emitFailure(options.failureSink, {
                            stage: "FactCommit",
                            error_code: entry.error_code,
                            trace_id: entry.trace_id,
                            input_digest: entry.input_digest,
                        }),
                    });
                }
                let mealResult;
                try {
                    mealResult = applyMealEffects({
                        database: options.database,
                        envelopeId: envelope.envelope_id,
                        operationId: operation.operation_id,
                        operationSequence: 0,
                        idempotencyKey: envelope.idempotency_key,
                        now: committedAt,
                        location: operation.location,
                        ...(options.fault === "after_meal_nutrition"
                            ? { fault: "after_nutrition" }
                            : options.fault === "after_meal_first_item"
                                ? { fault: "after_first_item" }
                                : {}),
                    });
                }
                catch (error) {
                    const code = (error instanceof Error ? error.message : "MEAL_EFFECT_FAILED").split(":", 1)[0];
                    if (authority.envelope_state === "received") {
                        markMealEffectsRetryable({
                            database: options.database,
                            envelopeId: envelope.envelope_id,
                            operationId: operation.operation_id,
                            operationSequence: 0,
                            idempotencyKey: envelope.idempotency_key,
                            inputDigest,
                            now: committedAt,
                            location: operation.location,
                            errorCode: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "MEAL_EFFECT_FAILED",
                        });
                    }
                    emitFailure(options.failureSink, {
                        stage: "EffectBundle",
                        error_code: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "MEAL_EFFECT_FAILED",
                        trace_id: preparedMeal.fact.traceId,
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
                    traceId: preparedMeal.fact.traceId,
                    expectedOperationIds: Object.freeze([operation.operation_id]),
                    sealedAt: committedAt,
                });
                const quickPrompts = buildMealQuickPrompts(options.database, mealResult, envelope.idempotency_key, committedAt);
                const receiptData = buildReceiptData({
                    status: mealResult.status,
                    date: mealResult.daily_progress.date,
                    meal_slot: operation.meal_slot,
                    items: mealResult.meal_items,
                    quick_prompts: quickPrompts,
                    daily_progress: mealResult.daily_progress,
                });
                const mealExecution = Object.freeze({
                    envelope_id: envelope.envelope_id,
                    input_digest: inputDigest,
                    status: mealResult.status,
                    items: Object.freeze([mealResult]),
                    payload: Object.freeze({
                        authority_kind: "diet-manager/domain-execution/v1",
                        daily_progress: mealResult.daily_progress,
                        daily_progress_by_date: mealResult.daily_progress_by_date,
                        quick_prompts: quickPrompts,
                        receipt_data: receiptData,
                    }),
                });
                const finalizedMeal = finalizeEnvelope({
                    database: options.database,
                    secret: options.secret,
                    token: execution.token,
                    inputDigest,
                    subjectScope: envelope.subject_scope,
                    commandType: envelope.command_type,
                    dataRevision: execution.data_revision,
                    traceId: preparedMeal.fact.traceId,
                    resultStatus: mealResult.status,
                    receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
                    finalizedAt: committedAt,
                    frozenAt: committedAt,
                    payload: mealExecution,
                    mixedItems: Object.freeze([]),
                });
                return finalizedMeal.payload;
            }
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
