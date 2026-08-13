import { isProxy } from "node:util/types";
import { canonicalJson } from "../authority/canonical-json.js";
import { assertOffsetIsoTimestamp } from "../authority/offset-timestamp.js";
import { createMealFactIdentity, } from "../authority/meal-fact-identity.js";
import { createWaterFactIdentity } from "../authority/water-fact-identity.js";
import { MealFactAuthorityError, optionalMealEvidenceFields, validateAndFreezeOccurredTimeEvidence, validateMealOperationEvidence, } from "../authority/meal-fact.js";
import { authorizeRepositoryPreview, createServerPreview, reuseServerPreview, } from "../preview/store.js";
import { appendPreparedOperationFact, sealPreparedEnvelopeFacts, } from "../repository/fact-commit.js";
import { finalizeEnvelope, } from "../repository/envelope-finalize.js";
import { createContributionProgressReservation, readEnvelopeProgressReservation, } from "../repository/progress-reservation.js";
import { computeRepositoryDataRevision } from "../repository/revision.js";
import { applyMealEffects, applyWaterEffects, assertStoredWaterFactMatchesExpected, markWaterEffectsRetryable, markMealEffectsRetryable, applyPurchaseEffect, applyCorrectionEffects, assertStoredMealFactMatchesExpected, prepareCorrectionOperation, readAppliedMealResult, readAppliedCorrectionResult, preflightMealOperation, preflightWaterOperation, prepareMealOperation, prepareWaterOperation, preparePurchaseOperation, } from "./effect-bundle.js";
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
function receivedTimestamp(value, field) {
    return assertOffsetIsoTimestamp(value, () => invalid(field));
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
    if (amount.observed_microunits === null) {
        if (amount.nutrition_adoption_microunits !== null) {
            return invalid(`${field}.nutrition_adoption_microunits`);
        }
        if (amount.inventory_deduction_microunits !== null) {
            return invalid(`${field}.inventory_deduction_microunits`);
        }
        if (amount.template_reference_microunits !== null) {
            return invalid(`${field}.template_reference_microunits`);
        }
        if (amount.evidence !== "unknown")
            return invalid(`${field}.evidence`);
        return;
    }
    safeNonnegativeInteger(amount.observed_microunits, `${field}.observed_microunits`);
    nullableSafeNonnegativeInteger(amount.nutrition_adoption_microunits, `${field}.nutrition_adoption_microunits`);
    nullableSafeNonnegativeInteger(amount.inventory_deduction_microunits, `${field}.inventory_deduction_microunits`);
    nullableSafeNonnegativeInteger(amount.template_reference_microunits, `${field}.template_reference_microunits`);
    enumValue(amount.evidence, ["explicit", "estimated_upper_bound"], `${field}.evidence`);
}
function validateKnownStructuredAmount(value, field) {
    validateStructuredAmount(value, field);
    if (value.observed_microunits === null) {
        return invalid(`${field}.observed_microunits`);
    }
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
        validateKnownStructuredAmount(candidate.amount, `${field}.amount`);
        validateNutritionSources(candidate.nutrition_sources, `${field}.nutrition_sources`);
        return;
    }
    if (kind === "record_meal") {
        const candidate = record(value, [
            "kind", "operation_id", "occurred_at", "meal_slot", "location", "items",
            ...optionalMealEvidenceFields(operation),
        ], field);
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
        try {
            validateMealOperationEvidence(candidate, candidate.occurred_at, field);
        }
        catch (error) {
            if (error instanceof MealFactAuthorityError)
                return invalid(error.reason);
            throw error;
        }
        return;
    }
    if (kind === "record_water") {
        const candidate = record(value, [
            "kind", "operation_id", "occurred_time", "source_text", "plain_water_ml_milli", "amount_evidence",
        ], field);
        text(candidate.operation_id, `${field}.operation_id`);
        let occurredTime;
        try {
            occurredTime = validateAndFreezeOccurredTimeEvidence(candidate.occurred_time, {
                path: `${field}.occurred_time`,
                requireExact: true,
            });
        }
        catch (error) {
            if (error instanceof MealFactAuthorityError)
                return invalid(error.reason);
            throw error;
        }
        text(candidate.source_text, `${field}.source_text`);
        if (!Number.isSafeInteger(candidate.plain_water_ml_milli) ||
            candidate.plain_water_ml_milli <= 0 ||
            candidate.plain_water_ml_milli > 20_000_000)
            return invalid(`${field}.plain_water_ml_milli`);
        const evidence = record(candidate.amount_evidence, ["raw_text", "quantity", "unit", "estimated"], `${field}.amount_evidence`);
        text(evidence.raw_text, `${field}.amount_evidence.raw_text`);
        if (!Number.isSafeInteger(evidence.quantity) || evidence.quantity <= 0 || evidence.quantity > 20_000) {
            return invalid(`${field}.amount_evidence.quantity`);
        }
        if (evidence.unit !== "ml" || evidence.estimated !== false)
            return invalid(`${field}.amount_evidence`);
        if (evidence.quantity * 1_000 !== candidate.plain_water_ml_milli) {
            return invalid(`${field}.amount_evidence.quantity`);
        }
        return Object.freeze({ ...candidate, occurred_time: occurredTime });
    }
    if (kind === "correct_record") {
        const candidate = record(value, ["kind", "operation_id", "target_event_id", "base_revision", "item_order", "replacement_amount"], field);
        text(candidate.operation_id, `${field}.operation_id`);
        text(candidate.target_event_id, `${field}.target_event_id`);
        safeNonnegativeInteger(candidate.base_revision, `${field}.base_revision`);
        safeNonnegativeInteger(candidate.item_order, `${field}.item_order`);
        validateKnownStructuredAmount(candidate.replacement_amount, `${field}.replacement_amount`);
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
    if (isProxy(value))
        return unsafeClone(path, "proxy");
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
    receivedTimestamp(envelope.received_at, "envelope.received_at");
    enumValue(envelope.timezone, ["Asia/Shanghai"], "envelope.timezone");
    if (!Array.isArray(envelope.operations) || envelope.operations.length === 0)
        return invalid("envelope.operations");
    const operations = envelope.operations;
    const normalizedOperations = operations.map((operation, index) => validateOperation(operation, `envelope.operations.${index}`) ?? operation);
    if (normalizedOperations.some((operation, index) => operation !== operations[index])) {
        return Object.freeze({ ...envelope, operations: Object.freeze(normalizedOperations) });
    }
    return envelope;
}
function preflightWriteOperations(database, operations) {
    if (operations.length === 2) {
        const [purchase, meal] = operations;
        return Object.freeze([preflightMealOperation(database, meal, new Map([[purchase.product.normalized_name, Object.freeze([{
                            batch_id: purchase.batch_id,
                            product_id: purchase.product.product_id,
                            available_microunits: purchase.amount.observed_microunits,
                            unit: purchase.amount.unit,
                        }])]]))]);
    }
    const contributions = [];
    for (const operation of operations) {
        if (operation.kind === "record_meal")
            contributions.push(preflightMealOperation(database, operation));
    }
    return Object.freeze(contributions);
}
function createMealProgressReservation(database, contributions) {
    if (contributions.length === 0)
        return undefined;
    if (contributions.length !== 1) {
        throw new Error("DIET_DOMAIN_REQUEST_INVALID:progress_contribution_count");
    }
    try {
        return createContributionProgressReservation(database, contributions[0]);
    }
    catch (error) {
        if (error instanceof Error &&
            error.message === "PROGRESS_RESERVATION_AUTHORITY_INVALID:daily_progress_sum") {
            throw new Error("ENVELOPE_FINALIZE_AUTHORITY_INVALID:daily_progress_sum");
        }
        throw error;
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
function failureCode(error, fallback) {
    const code = (error instanceof Error ? error.message : fallback).split(":", 1)[0];
    return /^[A-Z][A-Z0-9_]*$/.test(code) ? code : fallback;
}
function appendFactWithFailure(input, sink, fault) {
    return appendPreparedOperationFact(input, {
        ...(fault === undefined ? {} : { fault }),
        failureSink: (entry) => emitFailure(sink, {
            stage: "FactCommit",
            error_code: entry.error_code,
            trace_id: entry.trace_id,
            input_digest: entry.input_digest,
        }),
    });
}
function runEffectWithFailure(run, sink, traceId, inputDigest, fallbackErrorCode) {
    try {
        return run();
    }
    catch (error) {
        emitFailure(sink, {
            stage: "EffectBundle",
            error_code: failureCode(error, fallbackErrorCode),
            trace_id: traceId,
            input_digest: inputDigest,
        });
        throw error;
    }
}
function envelopeFinalizeOptions(fault) {
    if (fault === "after_finalization_row" ||
        fault === "after_envelope" ||
        fault === "after_idempotency" ||
        fault === "before_commit")
        return Object.freeze({ fault });
    if (fault === "after_mixed_finalize_commit") {
        return Object.freeze({ fault: "after_commit_before_reply" });
    }
    return undefined;
}
function finalizeWithFailure(input, fault, sink) {
    try {
        return finalizeEnvelope(input, envelopeFinalizeOptions(fault));
    }
    catch (error) {
        emitFailure(sink, {
            stage: "EnvelopeFinalize",
            error_code: failureCode(error, "ENVELOPE_FINALIZE_FAILED"),
            trace_id: input.traceId,
            input_digest: input.inputDigest,
        });
        throw error;
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
        (envelope.command_type === "record_water" && operation.kind === "record_water") ||
        (envelope.command_type === "correct_record" && operation.kind === "correct_record") ||
        (envelope.command_type === "undo_record" && operation.kind === "undo_record"))
        return Object.freeze([operation]);
    return invalid("command_operation");
}
function mealFactPreviewMaterial(envelope, inputDigest) {
    const water = envelope.operations.find((operation) => operation.kind === "record_water");
    if (water) {
        if (water.occurred_time.resolved_start === null)
            return invalid("envelope.operations.0.occurred_time.resolved_interval");
        const occurredAtText = new Date(water.occurred_time.resolved_start).toISOString();
        return Object.freeze({
            authority_kind: "diet-manager/domain-preview/v3",
            input_digest: inputDigest,
            meal_fact_identities: Object.freeze([]),
            water_fact_identities: Object.freeze([createWaterFactIdentity({
                    sequence: 0, event_id: deriveDomainId("event", envelope.idempotency_key, 0), operation_id: water.operation_id,
                    schema_version: "domain/v2", event_type: "diet_water", fact_kind: "water",
                    source_message_id: envelope.source_message_id, conversation_id: envelope.conversation_id,
                    received_at: envelope.received_at, occurred_at_text: occurredAtText, meal_id: null, meal_slot: null,
                    payload: {
                        amount_evidence: water.amount_evidence, authority_kind: "diet-manager/water-fact/v1", estimated: false,
                        occurred_time: water.occurred_time, plain_water_ml_milli: water.plain_water_ml_milli,
                        source_text: water.source_text, timezone: "Asia/Shanghai",
                    },
                })]),
        });
    }
    const meals = envelope.operations.flatMap((operation, sequence) => operation.kind === "record_meal" ? [{ operation, sequence }] : []);
    const hasEvidence = meals.some(({ operation }) => ["source_text", "occurred_time", "subject", "context"].some((field) => Object.hasOwn(operation, field)));
    if (!hasEvidence) {
        return Object.freeze({
            authority_kind: "diet-manager/domain-preview/v1",
            envelope,
        });
    }
    return Object.freeze({
        authority_kind: "diet-manager/domain-preview/v2",
        input_digest: inputDigest,
        meal_fact_identities: Object.freeze(meals.map(({ operation, sequence }) => createMealFactIdentity({
            sequence,
            event_id: deriveDomainId("event", envelope.idempotency_key, sequence),
            operation_id: operation.operation_id,
            schema_version: "domain/v2",
            event_type: "diet_meal",
            fact_kind: "meal",
            source_message_id: envelope.source_message_id,
            conversation_id: envelope.conversation_id,
            received_at: envelope.received_at,
            occurred_at_text: operation.occurred_at,
            meal_id: deriveDomainId("meal", envelope.idempotency_key, sequence),
            meal_slot: operation.meal_slot,
            payload: {
                authority_kind: "diet-manager/meal-fact/v1",
                location: operation.location,
                ...(Object.hasOwn(operation, "source_text") ? { source_text: operation.source_text } : {}),
                ...(Object.hasOwn(operation, "occurred_time") ? { occurred_time: operation.occurred_time } : {}),
                ...(Object.hasOwn(operation, "subject") ? { subject: operation.subject } : {}),
                ...(Object.hasOwn(operation, "context") ? { context: operation.context } : {}),
                timezone: "Asia/Shanghai",
            },
            items: operation.items.map((item, itemOrder) => ({
                item_id: deriveDomainId("item", envelope.idempotency_key, itemOrder),
                item_order: itemOrder,
                item_type: item.item_type,
                normalized_name: item.normalized_name,
                payload: {
                    amount: item.amount,
                    authority_kind: "diet-manager/meal-item/v1",
                    nutrition_sources: item.nutrition_sources,
                },
            })),
        }))),
    });
}
function assertMealFactPreviewAuthority(authority, expected) {
    if (expected.authority_kind === "diet-manager/domain-preview/v1") {
        if (authority.preview_authority_kind !== "diet-manager/server-preview/v1") {
            throw new Error("PREVIEW_AUTHORITY_INVALID:meal_fact_identity");
        }
        return;
    }
    if (expected.authority_kind === "diet-manager/domain-preview/v3") {
        if (authority.preview_authority_kind !== "diet-manager/server-preview/v3" ||
            authority.water_fact_preview_material === undefined ||
            canonicalJson(authority.water_fact_preview_material) !== canonicalJson(expected)) {
            throw new Error("PREVIEW_AUTHORITY_INVALID:water_fact_identity");
        }
        return;
    }
    if (authority.preview_authority_kind !== "diet-manager/server-preview/v2" ||
        authority.meal_fact_preview_material === undefined ||
        canonicalJson(authority.meal_fact_preview_material) !== canonicalJson(expected)) {
        throw new Error("PREVIEW_AUTHORITY_INVALID:meal_fact_identity");
    }
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
    return receivedTimestamp(row.received_at, "stored_received_at");
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
        input.fault !== "after_meal_issue_write" &&
        input.fault !== "after_meal_progress_contribution_prepared" &&
        input.fault !== "after_water_event" &&
        input.fault !== "after_water_outbox" &&
        input.fault !== "after_water_progress_contribution_prepared" &&
        input.fault !== "after_correction_claim" &&
        input.fault !== "after_correction_compensation" &&
        input.fault !== "after_correction_nutrition_progress" &&
        input.fault !== "after_mixed_meal_effect_commit" &&
        input.fault !== "after_mixed_seal" &&
        input.fault !== "after_mixed_finalize_commit" &&
        input.fault !== "after_finalization_row" &&
        input.fault !== "after_envelope" &&
        input.fault !== "after_idempotency" &&
        input.fault !== "before_commit") {
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
    const finalize = (finalizerInput) => finalizeWithFailure(finalizerInput, options.fault, options.failureSink);
    return Object.freeze({
        preview(envelope) {
            const validatedEnvelope = validateAndFreezeEnvelope(envelope);
            const operations = writeOperations(validatedEnvelope);
            const inputDigest = digestDomainEnvelope(validatedEnvelope);
            const previewMaterial = mealFactPreviewMaterial(validatedEnvelope, inputDigest);
            const reused = reuseServerPreview({
                database: options.database,
                secret: options.secret,
                previewId: validatedEnvelope.envelope_id,
                idempotencyKey: validatedEnvelope.idempotency_key,
                inputDigest,
                subjectScope: validatedEnvelope.subject_scope,
                commandType: validatedEnvelope.command_type,
                sourceMessageId: validatedEnvelope.source_message_id,
                conversationId: validatedEnvelope.conversation_id,
                previewMaterial,
            });
            if (reused) {
                return Object.freeze({
                    envelope_id: validatedEnvelope.envelope_id,
                    token: reused.token,
                    input_digest: inputDigest,
                    data_revision: reused.binding.data_revision,
                    reused: true,
                });
            }
            preflightWriteOperations(options.database, operations);
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
                previewMaterial,
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
            const inputDigest = digestDomainEnvelope(envelope);
            if (execution.input_digest !== inputDigest)
                return invalid("input_digest");
            const expectedPreviewMaterial = mealFactPreviewMaterial(envelope, inputDigest);
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
            assertMealFactPreviewAuthority(authority, expectedPreviewMaterial);
            const existingProgressReservation = readEnvelopeProgressReservation(options.database, envelope.envelope_id);
            const firstOperation = operations[0];
            const progressReservation = existingProgressReservation ??
                (authority.envelope_state === "received"
                    ? firstOperation.kind === "record_water"
                        ? createContributionProgressReservation(options.database, preflightWaterOperation(firstOperation))
                        : createMealProgressReservation(options.database, preflightWriteOperations(options.database, operations))
                    : undefined);
            const committedAt = storedEnvelopeTime(options.database, envelope.envelope_id);
            if (operations.length === 2) {
                const [purchaseOperation, mealOperation] = operations;
                const traceId = deriveDomainId("trace", envelope.idempotency_key, 0);
                const purchaseIdentityKey = deriveDomainId("idempotency", envelope.idempotency_key, 0);
                const mealIdentityKey = deriveDomainId("idempotency", envelope.idempotency_key, 1);
                const purchaseAt = timestampAfter(committedAt, 0);
                const mealAt = timestampAfter(committedAt, 1);
                const finalizedAt = timestampAfter(committedAt, 2);
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
                if (authority.envelope_state !== "received") {
                    assertStoredMealFactMatchesExpected({
                        database: options.database,
                        envelopeId: envelope.envelope_id,
                        operationId: mealOperation.operation_id,
                        operationSequence: 1,
                        idempotencyKey: mealIdentityKey,
                        location: mealOperation.location,
                        expectedFact: preparedMeal.fact,
                    });
                }
                if (authority.envelope_state === "finalized") {
                    const stored = storedFinalizedExecution(options.database, envelope.envelope_id);
                    return finalize({
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
                    ...(progressReservation === undefined ? {} : { progressReservation }),
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
                    appendFactWithFailure(preparedPurchase.fact, options.failureSink);
                    runEffectWithFailure(() => applyPurchaseEffect(options.database, preparedPurchase.outbox_id, purchaseAt, options.fault === "after_inventory_business_writes"
                        ? "after_business_writes"
                        : undefined), options.failureSink, traceId, inputDigest, "INVENTORY_EFFECT_FAILED");
                }
                if (authority.envelope_state === "received") {
                    appendFactWithFailure(preparedMeal.fact, options.failureSink);
                }
                const mealResult = runEffectWithFailure(() => applyMealEffects({
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
                            : options.fault === "after_meal_issue_write"
                                ? { fault: "after_issue_write" }
                                : options.fault === "after_meal_progress_contribution_prepared"
                                    ? { fault: "after_progress_contribution_prepared" }
                                    : {}),
                }), options.failureSink, traceId, inputDigest, "MEAL_EFFECT_FAILED");
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
                return finalize({
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
                }).payload;
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
                    return finalize({
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
                    appendFactWithFailure(preparedCorrection.fact, options.failureSink);
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
                            ...(options.fault === "after_correction_claim"
                                ? { fault: "after_claim" }
                                : options.fault === "after_correction_compensation"
                                    ? { fault: "after_compensation" }
                                    : options.fault === "after_correction_nutrition_progress"
                                        ? { fault: "after_nutrition_progress" }
                                        : {}),
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
                return finalize({
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
            if (operation.kind === "record_water") {
                const preparedWater = prepareWaterOperation({
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
                    ...(progressReservation === undefined ? {} : { progressReservation }),
                });
                const traceId = preparedWater.fact.traceId;
                if (authority.envelope_state !== "received") {
                    assertStoredWaterFactMatchesExpected({
                        database: options.database, envelopeId: envelope.envelope_id,
                        operationId: operation.operation_id, expectedFact: preparedWater.fact,
                    });
                }
                if (authority.envelope_state === "finalized") {
                    const stored = storedFinalizedExecution(options.database, envelope.envelope_id);
                    return finalize({
                        database: options.database, secret: options.secret, token: execution.token,
                        inputDigest, subjectScope: envelope.subject_scope, commandType: envelope.command_type,
                        dataRevision: execution.data_revision, traceId, resultStatus: stored.resultStatus,
                        receiptId: stored.receiptId, finalizedAt: stored.finalizedAt, frozenAt: stored.frozenAt,
                        payload: stored.payload, mixedItems: Object.freeze([]),
                    }).payload;
                }
                if (authority.envelope_state !== "received" && authority.envelope_state !== "effects_pending" && authority.envelope_state !== "effects_stable") {
                    throw new Error(`DIET_DOMAIN_EXECUTION_PENDING:${authority.envelope_state}`);
                }
                if (authority.envelope_state === "received" && options.fault === "before_fact_commit") {
                    emitFailure(options.failureSink, { stage: "FactCommit", error_code: "DIET_DOMAIN_EXECUTION_FAILED", trace_id: traceId, input_digest: inputDigest });
                    throw new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
                }
                const storedWaterFact = options.database.prepare("SELECT event_id FROM event_records WHERE envelope_id = ? AND operation_id = ?").get(envelope.envelope_id, operation.operation_id);
                if (storedWaterFact) {
                    assertStoredWaterFactMatchesExpected({
                        database: options.database, envelopeId: envelope.envelope_id,
                        operationId: operation.operation_id, expectedFact: preparedWater.fact,
                    });
                }
                if (authority.envelope_state === "received" && !storedWaterFact)
                    appendFactWithFailure(preparedWater.fact, options.failureSink, options.fault === "after_water_event" ? "after_event"
                        : options.fault === "after_water_outbox" ? "after_effects" : undefined);
                let waterResult;
                try {
                    waterResult = applyWaterEffects({
                        database: options.database, envelopeId: envelope.envelope_id, operationId: operation.operation_id,
                        operationSequence: 0, idempotencyKey: envelope.idempotency_key, now: committedAt,
                        ...(options.fault === "after_water_progress_contribution_prepared"
                            ? { fault: "after_progress_contribution_prepared" } : {}),
                    });
                }
                catch (error) {
                    const code = (error instanceof Error ? error.message : "WATER_EFFECT_FAILED").split(":", 1)[0];
                    if (authority.envelope_state === "received") {
                        markWaterEffectsRetryable({
                            database: options.database, envelopeId: envelope.envelope_id, operationId: operation.operation_id,
                            operationSequence: 0, idempotencyKey: envelope.idempotency_key, now: committedAt,
                            inputDigest, errorCode: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "WATER_EFFECT_FAILED",
                        });
                    }
                    emitFailure(options.failureSink, { stage: "EffectBundle", error_code: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "WATER_EFFECT_FAILED", trace_id: traceId, input_digest: inputDigest });
                    throw error;
                }
                if (authority.envelope_state !== "effects_stable") {
                    sealPreparedEnvelopeFacts({
                        database: options.database, secret: options.secret, token: execution.token, inputDigest,
                        subjectScope: envelope.subject_scope, commandType: envelope.command_type,
                        dataRevision: execution.data_revision, traceId,
                        expectedOperationIds: Object.freeze([operation.operation_id]), sealedAt: committedAt,
                    });
                }
                const virtualWaterItem = Object.freeze({
                    item_order: 0, normalized_name: "plain water", unit: "ml", inventory_match: "skipped_outside",
                    inventory_transaction_id: null, issue_codes: Object.freeze([]), observed_microunits: operation.plain_water_ml_milli,
                    nutrition_adoption_microunits: null, inventory_deduction_microunits: null,
                    estimated_fields: Object.freeze([]), nutrition_source_type: "unknown", nutrition_profile_version: 0,
                    nutrients: waterResult.daily_progress.nutrients,
                });
                const receiptData = buildReceiptData({
                    status: "committed", date: waterResult.daily_progress.date, meal_slot: "water",
                    items: Object.freeze([virtualWaterItem]), quick_prompts: Object.freeze([]), daily_progress: waterResult.daily_progress,
                });
                const waterExecution = Object.freeze({
                    envelope_id: envelope.envelope_id, input_digest: inputDigest, status: "committed",
                    items: Object.freeze([waterResult]),
                    payload: Object.freeze({ authority_kind: "diet-manager/domain-execution/v1", daily_progress: waterResult.daily_progress,
                        daily_progress_by_date: waterResult.daily_progress_by_date, quick_prompts: Object.freeze([]), receipt_data: receiptData }),
                });
                return finalize({
                    database: options.database, secret: options.secret, token: execution.token, inputDigest,
                    subjectScope: envelope.subject_scope, commandType: envelope.command_type, dataRevision: execution.data_revision,
                    traceId, resultStatus: "committed", receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
                    finalizedAt: committedAt, frozenAt: committedAt, payload: waterExecution, mixedItems: Object.freeze([]),
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
                    ...(progressReservation === undefined ? {} : { progressReservation }),
                });
                const storedMealFactAuthority = Object.freeze({
                    database: options.database,
                    envelopeId: envelope.envelope_id,
                    operationId: operation.operation_id,
                    operationSequence: 0,
                    idempotencyKey: envelope.idempotency_key,
                    location: operation.location,
                    expectedFact: preparedMeal.fact,
                });
                if (authority.envelope_state === "finalized" ||
                    authority.envelope_state === "effects_pending") {
                    assertStoredMealFactMatchesExpected(storedMealFactAuthority);
                }
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
                    return finalize({
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
                if (authority.envelope_state !== "received" &&
                    authority.envelope_state !== "effects_pending" &&
                    authority.envelope_state !== "effects_stable") {
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
                    appendFactWithFailure(preparedMeal.fact, options.failureSink);
                }
                let mealResult;
                if (authority.envelope_state === "effects_stable") {
                    mealResult = readAppliedMealResult(storedMealFactAuthority);
                }
                else {
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
                                    : options.fault === "after_meal_issue_write"
                                        ? { fault: "after_issue_write" }
                                        : options.fault === "after_meal_progress_contribution_prepared"
                                            ? { fault: "after_progress_contribution_prepared" }
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
                }
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
                const finalizedMeal = finalize({
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
                return finalize(finalizerInput).payload;
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
                appendFactWithFailure(prepared.fact, options.failureSink);
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
            const finalized = finalize(finalizerInput);
            if (canonicalJson(finalized.payload) !== canonicalJson(result)) {
                throw new Error("DIET_DOMAIN_RESULT_INVALID:finalized_payload");
            }
            return finalized.payload;
        },
        query(operation) {
            return queryDomainReadModel(options.database, options.secret, operation);
        },
    });
}
