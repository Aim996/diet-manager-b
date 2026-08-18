import { canonicalJson } from "../authority/canonical-json.js";
import { validateAndFreezeInventoryLocationCorrectionFactPayload } from "../domain/inventory-service.js";
import { dietManagerActions, } from "../contracts.js";
import { authorizeRepositoryPreview } from "../preview/store.js";
import { deriveDomainId } from "../domain/identity.js";
import { assertProgressReservationFinalizerAuthority } from "./progress-reservation.js";
import { assertAppliedInventoryLocationCorrectionAuthority } from "./inventory-location-correction-authority.js";
import { readAppliedCorrectionResult } from "../domain/effect-bundle.js";
import { freezeQuickPrompt, rebaseReceiptProgress, } from "../domain/receipt.js";
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
const DAILY_NUTRIENT_FIELDS = [
    "energy_kcal_milli",
    "protein_mg",
    "fat_mg",
    "carbohydrate_mg",
    "fiber_mg",
    "water_ml_milli",
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
function plainRecord(value, fields, reason) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return authorityInvalid(reason);
    const record = value;
    if (Object.keys(record).sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
        return authorityInvalid(reason);
    }
    return record;
}
function parseDailyProgress(value, reason) {
    const progress = plainRecord(value, ["coverage_status", "date", "nutrients", "timezone"], reason);
    if (typeof progress.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(progress.date) ||
        progress.timezone !== "Asia/Shanghai" ||
        (progress.coverage_status !== "complete" && progress.coverage_status !== "partial"))
        return authorityInvalid(reason);
    const nutrients = plainRecord(progress.nutrients, DAILY_NUTRIENT_FIELDS, reason);
    const frozenNutrients = {};
    for (const field of DAILY_NUTRIENT_FIELDS) {
        const candidate = nutrients[field];
        if (candidate !== null && (!Number.isSafeInteger(candidate) || candidate < 0)) {
            return authorityInvalid(reason);
        }
        frozenNutrients[field] = candidate;
    }
    return Object.freeze({
        date: progress.date,
        timezone: "Asia/Shanghai",
        coverage_status: progress.coverage_status,
        nutrients: Object.freeze(frozenNutrients),
    });
}
function addDailyProgress(previous, contribution) {
    if (previous !== null &&
        (previous.date !== contribution.date || previous.timezone !== contribution.timezone))
        return authorityInvalid("daily_progress_date");
    const nutrients = {};
    for (const field of DAILY_NUTRIENT_FIELDS) {
        const left = previous === null ? 0 : previous.nutrients[field];
        const right = contribution.nutrients[field];
        if (left === null || right === null) {
            nutrients[field] = null;
            continue;
        }
        const sum = left + right;
        if (!Number.isSafeInteger(sum))
            return authorityInvalid("daily_progress_sum");
        nutrients[field] = sum;
    }
    return Object.freeze({
        date: contribution.date,
        timezone: contribution.timezone,
        coverage_status: Object.values(nutrients).every((value) => value !== null)
            ? "complete"
            : "partial",
        nutrients: Object.freeze(nutrients),
    });
}
export function readLatestAuthoritativeDailyProgress(database, date, timezone) {
    const previousRow = database.prepare(`SELECT generated_at, payload_json FROM daily_progress_snapshots
     WHERE date = ? AND timezone = ?
     ORDER BY generated_at DESC, progress_snapshot_id DESC LIMIT 1`).get(date, timezone);
    if (!previousRow)
        return Object.freeze({ progress: null, generated_at: null });
    let value;
    try {
        value = JSON.parse(previousRow.payload_json);
    }
    catch {
        return authorityInvalid("daily_progress_previous");
    }
    if (canonicalJson(value) !== previousRow.payload_json) {
        return authorityInvalid("daily_progress_previous");
    }
    const record = plainRecord(value, ["authority_kind", "coverage_status", "date", "nutrients", "timezone"], "daily_progress_previous");
    if (record.authority_kind !== "diet-manager/daily-progress/v1") {
        return authorityInvalid("daily_progress_previous");
    }
    return Object.freeze({
        progress: parseDailyProgress({
            coverage_status: record.coverage_status,
            date: record.date,
            nutrients: record.nutrients,
            timezone: record.timezone,
        }, "daily_progress_previous"),
        generated_at: previousRow.generated_at,
    });
}
export function projectDailyProgressContribution(database, contribution, precedingContributions = Object.freeze([])) {
    const previous = readLatestAuthoritativeDailyProgress(database, contribution.date, contribution.timezone);
    let cumulative = previous.progress;
    for (const preceding of precedingContributions) {
        cumulative = addDailyProgress(cumulative, preceding);
    }
    return Object.freeze({
        progress: addDailyProgress(cumulative, contribution),
        previous_generated_at: previous.generated_at,
    });
}
function applyDailyProgressDelta(current, before, after) {
    if (current.date !== before.date || current.date !== after.date ||
        current.timezone !== before.timezone || current.timezone !== after.timezone)
        return authorityInvalid("correction_progress_date");
    const nutrients = {};
    for (const field of DAILY_NUTRIENT_FIELDS) {
        const currentValue = current.nutrients[field];
        const beforeValue = before.nutrients[field];
        const afterValue = after.nutrients[field];
        if (currentValue === null || beforeValue === null || afterValue === null) {
            nutrients[field] = null;
            continue;
        }
        const next = currentValue - beforeValue + afterValue;
        if (!Number.isSafeInteger(next) || next < 0) {
            return authorityInvalid("correction_progress_delta");
        }
        nutrients[field] = next;
    }
    return Object.freeze({
        date: current.date,
        timezone: current.timezone,
        coverage_status: Object.values(nutrients).every((value) => value !== null)
            ? "complete"
            : "partial",
        nutrients: Object.freeze(nutrients),
    });
}
function nextProgressGeneratedAt(database, date, timezone, baseTimestamp, previousTimestamp) {
    const base = Date.parse(baseTimestamp);
    if (!Number.isFinite(base))
        return authorityInvalid("daily_progress_timestamp");
    const previous = previousTimestamp === null ? null : Date.parse(previousTimestamp);
    if (previousTimestamp !== null &&
        (!Number.isFinite(previous) || new Date(previous).toISOString() !== previousTimestamp))
        return authorityInvalid("daily_progress_timestamp");
    const firstCandidate = previous === null ? base : Math.max(base, previous + 1);
    const occupied = new Set(database.prepare("SELECT generated_at FROM daily_progress_snapshots WHERE date = ? AND timezone = ?").all(date, timezone).map((row) => row.generated_at));
    for (let offset = 0; offset <= occupied.size; offset += 1) {
        const candidate = new Date(firstCandidate + offset).toISOString();
        if (!occupied.has(candidate))
            return candidate;
    }
    return authorityInvalid("daily_progress_timestamp");
}
function zeroDailyProgress(date, timezone) {
    return Object.freeze({
        date,
        timezone,
        coverage_status: "complete",
        nutrients: Object.freeze({
            energy_kcal_milli: 0,
            protein_mg: 0,
            fat_mg: 0,
            carbohydrate_mg: 0,
            fiber_mg: 0,
            water_ml_milli: 0,
        }),
    });
}
function freezeMealDailyProgress(input, envelopeId, idempotencyKey) {
    if (input.commandType !== "record_meal" && input.commandType !== "record_water")
        return input;
    if (typeof input.payload !== "object" || input.payload === null || Array.isArray(input.payload))
        return input;
    const execution = input.payload;
    if (typeof execution.payload !== "object" || execution.payload === null || Array.isArray(execution.payload)) {
        return input;
    }
    const domainPayload = execution.payload;
    if (domainPayload.authority_kind !== "diet-manager/domain-execution/v1")
        return input;
    plainRecord(execution, ["envelope_id", "input_digest", "items", "payload", "status"], "daily_progress_execution");
    plainRecord(domainPayload, ["authority_kind", "daily_progress", "daily_progress_by_date", "quick_prompts", "receipt_data"], "daily_progress_payload");
    const contribution = parseDailyProgress(domainPayload.daily_progress, "daily_progress_contribution");
    if (!Array.isArray(domainPayload.daily_progress_by_date) ||
        domainPayload.daily_progress_by_date.length !== 1 ||
        canonicalJson(domainPayload.daily_progress_by_date[0]) !== canonicalJson(contribution))
        return authorityInvalid("daily_progress_by_date");
    if (!Array.isArray(domainPayload.quick_prompts) || domainPayload.quick_prompts.length > 256) {
        return authorityInvalid("quick_prompts");
    }
    let quickPrompts;
    try {
        quickPrompts = Object.freeze(domainPayload.quick_prompts.map(freezeQuickPrompt));
    }
    catch {
        return authorityInvalid("quick_prompts");
    }
    const issueRows = input.database.prepare(`SELECT i.issue_id, i.issue_code, i.revision, i.detected_at, i.status
     FROM issues i
     JOIN meal_items m ON m.item_id = i.entity_id
     JOIN event_records e ON e.event_id = m.event_id
     WHERE e.envelope_id = ?
     ORDER BY m.item_order, i.issue_id`).all(envelopeId);
    if (issueRows.length !== quickPrompts.length ||
        issueRows.some((row, index) => {
            const prompt = quickPrompts[index];
            return row.issue_id !== prompt.issue_id || row.issue_code !== prompt.issue_code ||
                row.revision !== prompt.generated_from_revision || row.detected_at !== prompt.generated_at ||
                row.status !== "open";
        }))
        return authorityInvalid("quick_prompt_authority");
    if (typeof domainPayload.receipt_data !== "object" ||
        domainPayload.receipt_data === null ||
        Array.isArray(domainPayload.receipt_data))
        return authorityInvalid("receipt_data");
    const receipt = domainPayload.receipt_data;
    const receiptProgress = receipt.blocks?.at(-1);
    if (receiptProgress?.kind !== "progress" ||
        canonicalJson(receiptProgress.daily_progress) !== canonicalJson(contribution))
        return authorityInvalid("receipt_progress");
    const bundles = input.database.prepare(`SELECT operation_id, effect_state, result_status, completed_at, payload_json
     FROM effect_bundle_commits WHERE envelope_id = ? ORDER BY operation_id`).all(envelopeId);
    const progressOperations = input.database.prepare(`SELECT DISTINCT operation_id FROM effect_outbox
     WHERE envelope_id = ? AND effect_kind = 'daily_progress_contribution'
     ORDER BY operation_id`).all(envelopeId);
    if (bundles.length === 0 || progressOperations.length !== 1) {
        return authorityInvalid("daily_progress_bundle");
    }
    const bundle = bundles.find((candidate) => candidate.operation_id === progressOperations[0]?.operation_id);
    if (!bundle || bundle.completed_at === null ||
        (bundle.effect_state !== "succeeded" && bundle.effect_state !== "permanent_business_skip") ||
        (bundle.result_status !== "applied" && bundle.result_status !== "applied_with_issues"))
        return authorityInvalid("daily_progress_bundle");
    let bundleValue;
    try {
        bundleValue = JSON.parse(bundle.payload_json);
    }
    catch {
        return authorityInvalid("daily_progress_bundle");
    }
    if (canonicalJson(bundleValue) !== bundle.payload_json)
        return authorityInvalid("daily_progress_bundle");
    const bundlePayload = plainRecord(bundleValue, ["authority_kind", "data_revision", "effects", "operation_sequence"], "daily_progress_bundle");
    const mixedMeal = input.mixedItems.find((item) => item.operation_id === bundle.operation_id);
    const expectedSequence = input.mixedItems.length === 0 ? 0 : mixedMeal?.sequence;
    if (bundlePayload.authority_kind !== "diet-manager/effect-bundle/v1" ||
        typeof bundlePayload.data_revision !== "string" ||
        !bundlePayload.data_revision.startsWith("repository-v1:") ||
        expectedSequence === undefined || bundlePayload.operation_sequence !== expectedSequence ||
        !Array.isArray(bundlePayload.effects)) {
        return authorityInvalid("daily_progress_bundle");
    }
    const outboxes = input.database.prepare(`SELECT effect_id, effect_kind, state FROM effect_outbox
     WHERE envelope_id = ? AND operation_id = ? ORDER BY effect_id`).all(envelopeId, bundle.operation_id);
    if (bundlePayload.effects.length !== outboxes.length ||
        outboxes.length === 0 ||
        new Set(outboxes.map((outbox) => outbox.effect_id)).size !== outboxes.length)
        return authorityInvalid("daily_progress_bundle");
    let boundContribution = null;
    for (let index = 0; index < outboxes.length; index += 1) {
        const outbox = outboxes[index];
        const progressEffect = outbox.effect_kind === "daily_progress_contribution";
        const effect = plainRecord(bundlePayload.effects[index], progressEffect ? ["contribution", "effect_id", "state"] : ["effect_id", "state"], "daily_progress_bundle_effect");
        if (effect.effect_id !== outbox.effect_id ||
            effect.state !== outbox.state ||
            (outbox.state !== "succeeded" && outbox.state !== "permanent_business_skip"))
            return authorityInvalid("daily_progress_bundle");
        if (progressEffect) {
            if (outbox.state !== "succeeded" || boundContribution !== null) {
                return authorityInvalid("daily_progress_bundle");
            }
            boundContribution = parseDailyProgress(effect.contribution, "daily_progress_bundle");
        }
    }
    if (boundContribution === null ||
        canonicalJson(boundContribution) !== canonicalJson(contribution))
        return authorityInvalid("daily_progress_bundle");
    const projection = projectDailyProgressContribution(input.database, contribution);
    const cumulative = projection.progress;
    const generatedAt = nextProgressGeneratedAt(input.database, cumulative.date, cumulative.timezone, input.finalizedAt, projection.previous_generated_at);
    input.database.prepare(`INSERT INTO daily_progress_snapshots(
      progress_snapshot_id, idempotency_result_id, date, timezone,
      goal_version_id, coverage_status, generated_at, payload_json
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`).run(deriveDomainId("progress", idempotencyKey, 0), idempotencyKey, cumulative.date, cumulative.timezone, cumulative.coverage_status, generatedAt, canonicalJson({ authority_kind: "diet-manager/daily-progress/v1", ...cumulative }));
    const finalExecution = {
        ...execution,
        payload: {
            authority_kind: "diet-manager/domain-execution/v1",
            daily_progress: cumulative,
            daily_progress_by_date: [cumulative],
            quick_prompts: quickPrompts,
            receipt_data: rebaseReceiptProgress(receipt, cumulative),
        },
    };
    const payloadJson = canonicalJson(finalExecution);
    return Object.freeze({
        ...input,
        payloadJson,
        payload: deepFreezeJson(JSON.parse(payloadJson)),
    });
}
function freezeCorrectionDailyProgress(input, envelopeId, idempotencyKey) {
    if (input.commandType !== "correct_record" && input.commandType !== "undo_record")
        return input;
    if (typeof input.payload !== "object" || input.payload === null || Array.isArray(input.payload)) {
        return authorityInvalid("correction_progress_execution");
    }
    const execution = plainRecord(input.payload, ["envelope_id", "input_digest", "items", "payload", "status"], "correction_progress_execution");
    if (execution.envelope_id !== envelopeId ||
        execution.input_digest !== input.inputDigest ||
        execution.status !== input.resultStatus)
        return authorityInvalid("correction_progress_execution");
    if (input.commandType === "correct_record" &&
        typeof execution.payload === "object" && execution.payload !== null &&
        !Array.isArray(execution.payload) &&
        Object.hasOwn(execution.payload, "inventory_location_correction")) {
        const domainPayload = plainRecord(execution.payload, ["authority_kind", "inventory_location_correction"], "location_correction_payload");
        if (domainPayload.authority_kind !== "diet-manager/domain-execution/v1") {
            return authorityInvalid("location_correction_payload");
        }
        if (!Array.isArray(execution.items) || execution.items.length !== 1) {
            return authorityInvalid("location_correction_items");
        }
        const eventRows = input.database.prepare(`SELECT event_id, operation_id, event_type, fact_kind, payload_json
       FROM event_records WHERE envelope_id = ?`).all(envelopeId);
        const event = eventRows[0];
        if (eventRows.length !== 1 || !event || event.event_type !== "inventory_adjusted" ||
            event.fact_kind !== "inventory")
            return authorityInvalid("location_correction_event");
        let fact;
        try {
            const parsed = JSON.parse(event.payload_json);
            if (canonicalJson(parsed) !== event.payload_json)
                throw new Error("canonical");
            fact = validateAndFreezeInventoryLocationCorrectionFactPayload(parsed);
        }
        catch {
            return authorityInvalid("location_correction_event");
        }
        if (fact.result.operation_id !== event.operation_id ||
            canonicalJson(execution.items[0]) !== canonicalJson(fact.result) ||
            canonicalJson(domainPayload.inventory_location_correction) !== canonicalJson({
                batch_id: fact.batch_id,
                previous_location: fact.previous_location,
                current_location: fact.next_location,
                expiration: fact.next_expiration,
            }))
            return authorityInvalid("location_correction_result");
        const outboxes = input.database.prepare(`SELECT effect_kind, state FROM effect_outbox WHERE envelope_id = ? AND operation_id = ?`).all(envelopeId, event.operation_id);
        const projection = input.database.prepare(`SELECT last_event_id, payload_json FROM inventory_batch_projections WHERE batch_id = ?`).get(fact.batch_id);
        if (outboxes.length !== 1 || outboxes[0]?.effect_kind !== "inventory_location_correction" ||
            outboxes[0]?.state !== "succeeded" || !projection || projection.last_event_id !== event.event_id ||
            projection.payload_json !== fact.next_projection_json)
            return authorityInvalid("location_correction_effect");
        try {
            assertAppliedInventoryLocationCorrectionAuthority(input.database, envelopeId, event.operation_id, event.event_id);
        }
        catch {
            return authorityInvalid("location_correction_effect");
        }
        return input;
    }
    const domainPayload = plainRecord(execution.payload, ["authority_kind", "daily_progress", "daily_progress_by_date"], "correction_progress_payload");
    if (domainPayload.authority_kind !== "diet-manager/domain-execution/v1") {
        return authorityInvalid("correction_progress_payload");
    }
    const replacement = parseDailyProgress(domainPayload.daily_progress, "correction_progress_replacement");
    if (!Array.isArray(domainPayload.daily_progress_by_date) ||
        domainPayload.daily_progress_by_date.length === 0 ||
        canonicalJson(domainPayload.daily_progress_by_date[0]) !== canonicalJson(replacement))
        return authorityInvalid("correction_progress_by_date");
    const replacementsByDate = Object.freeze(domainPayload.daily_progress_by_date.map((candidate) => parseDailyProgress(candidate, "correction_progress_by_date")));
    const bundleRows = input.database.prepare(`SELECT operation_id, effect_state, result_status, completed_at, payload_json
     FROM effect_bundle_commits WHERE envelope_id = ?`).all(envelopeId);
    if (bundleRows.length !== 1)
        return authorityInvalid("correction_progress_bundle");
    const bundle = bundleRows[0];
    if (!bundle ||
        (bundle.effect_state !== "succeeded" && bundle.effect_state !== "permanent_business_skip") ||
        (bundle.result_status !== "applied" && bundle.result_status !== "applied_with_issues") ||
        (input.resultStatus === "committed" && bundle.result_status !== "applied") ||
        (input.resultStatus === "committed_with_issues" && bundle.result_status !== "applied_with_issues") ||
        bundle.completed_at === null)
        return authorityInvalid("correction_progress_bundle");
    let bundleValue;
    try {
        bundleValue = JSON.parse(bundle.payload_json);
    }
    catch {
        return authorityInvalid("correction_progress_bundle");
    }
    if (canonicalJson(bundleValue) !== bundle.payload_json) {
        return authorityInvalid("correction_progress_bundle");
    }
    const bundlePayload = plainRecord(bundleValue, ["authority_kind", "data_revision", "effects", "operation_sequence"], "correction_progress_bundle");
    if (bundlePayload.authority_kind !== "diet-manager/effect-bundle/v1" ||
        typeof bundlePayload.data_revision !== "string" ||
        !bundlePayload.data_revision.startsWith("repository-v1:") ||
        bundlePayload.operation_sequence !== 0 || !Array.isArray(bundlePayload.effects))
        return authorityInvalid("correction_progress_bundle");
    const authoritativeResult = readAppliedCorrectionResult({
        database: input.database,
        envelopeId,
        operationId: bundle.operation_id,
        operationSequence: 0,
        idempotencyKey,
    });
    const outboxes = input.database.prepare(`SELECT effect_id, effect_kind, state FROM effect_outbox
     WHERE envelope_id = ? AND operation_id = ? ORDER BY effect_id`).all(envelopeId, bundle.operation_id);
    if (bundlePayload.effects.length !== outboxes.length ||
        outboxes.filter((outbox) => outbox.effect_kind === "daily_progress_replacement").length !==
            replacementsByDate.length ||
        outboxes.some((outbox) => outbox.effect_kind !== "daily_progress_replacement" &&
            outbox.effect_kind !== "correction_inventory_compensation")) {
        return authorityInvalid("correction_progress_bundle");
    }
    const boundReplacements = [];
    const boundBefores = [];
    const boundAfters = [];
    for (let index = 0; index < outboxes.length; index += 1) {
        const outbox = outboxes[index];
        const progress = outbox.effect_kind === "daily_progress_replacement";
        const effect = plainRecord(bundlePayload.effects[index], progress
            ? ["delta", "effect_id", "replacement", "state"]
            : ["effect_id", "state"], "correction_progress_effect");
        if (effect.effect_id !== outbox.effect_id || effect.state !== outbox.state ||
            (outbox.state !== "succeeded" && outbox.state !== "permanent_business_skip"))
            return authorityInvalid("correction_progress_bundle");
        if (progress) {
            if (outbox.state !== "succeeded") {
                return authorityInvalid("correction_progress_bundle");
            }
            boundReplacements.push(parseDailyProgress(effect.replacement, "correction_progress_bundle"));
            const delta = plainRecord(effect.delta, ["after", "before"], "correction_progress_delta");
            boundBefores.push(parseDailyProgress(delta.before, "correction_progress_delta"));
            boundAfters.push(parseDailyProgress(delta.after, "correction_progress_delta"));
        }
    }
    // effect_id is a content hash, so `ORDER BY effect_id` is not monotonic in the
    // affected_dates sequence: the bound effects may arrive in a different order than
    // `replacementsByDate`. Re-key each bound effect by its date and align them to
    // `replacementsByDate` order before comparing/applying, so cross-date change_time
    // is independent of effect_id ordering.
    const boundByDate = new Map();
    for (let index = 0; index < boundReplacements.length; index += 1) {
        const replacement = boundReplacements[index];
        boundByDate.set(replacement.date, {
            replacement,
            before: boundBefores[index],
            after: boundAfters[index],
        });
    }
    const alignedReplacements = [];
    const alignedBefores = [];
    const alignedAfters = [];
    for (const byDate of replacementsByDate) {
        const bound = boundByDate.get(byDate.date);
        if (bound === undefined)
            return authorityInvalid("correction_progress_bundle");
        alignedReplacements.push(bound.replacement);
        alignedBefores.push(bound.before);
        alignedAfters.push(bound.after);
    }
    if (alignedReplacements.length !== replacementsByDate.length ||
        canonicalJson(alignedReplacements) !== canonicalJson(replacementsByDate)) {
        return authorityInvalid("correction_progress_bundle");
    }
    const finalizedReplacements = [];
    for (let index = 0; index < alignedReplacements.length; index += 1) {
        const boundReplacement = alignedReplacements[index];
        const boundBefore = alignedBefores[index];
        const boundAfter = alignedAfters[index];
        const previousRow = input.database.prepare(`SELECT generated_at, payload_json FROM daily_progress_snapshots
       WHERE date = ? AND timezone = ? ORDER BY generated_at DESC, progress_snapshot_id DESC LIMIT 1`).get(boundReplacement.date, boundReplacement.timezone);
        let previous;
        let previousGeneratedAt;
        if (previousRow === undefined) {
            // Cross-date change_time can move a meal into a previously-empty day; the
            // replacement delta then applies against an implicit all-zero baseline.
            previous = zeroDailyProgress(boundReplacement.date, boundReplacement.timezone);
            previousGeneratedAt = null;
        }
        else {
            let previousValue;
            try {
                previousValue = JSON.parse(previousRow.payload_json);
            }
            catch {
                return authorityInvalid("correction_progress_previous");
            }
            if (canonicalJson(previousValue) !== previousRow.payload_json) {
                return authorityInvalid("correction_progress_previous");
            }
            const previousRecord = plainRecord(previousValue, ["authority_kind", "coverage_status", "date", "nutrients", "timezone"], "correction_progress_previous");
            if (previousRecord.authority_kind !== "diet-manager/daily-progress/v1") {
                return authorityInvalid("correction_progress_previous");
            }
            previous = parseDailyProgress({
                coverage_status: previousRecord.coverage_status,
                date: previousRecord.date,
                nutrients: previousRecord.nutrients,
                timezone: previousRecord.timezone,
            }, "correction_progress_previous");
            previousGeneratedAt = previousRow.generated_at;
        }
        const finalizedReplacement = applyDailyProgressDelta(previous, boundBefore, boundAfter);
        if (canonicalJson(finalizedReplacement) !== canonicalJson(boundReplacement)) {
            return authorityInvalid("correction_progress_bundle");
        }
        const generatedAt = nextProgressGeneratedAt(input.database, finalizedReplacement.date, finalizedReplacement.timezone, input.finalizedAt, previousGeneratedAt);
        input.database.prepare(`INSERT INTO daily_progress_snapshots(
        progress_snapshot_id, idempotency_result_id, date, timezone,
        goal_version_id, coverage_status, generated_at, payload_json
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`).run(deriveDomainId("progress", idempotencyKey, index), idempotencyKey, finalizedReplacement.date, finalizedReplacement.timezone, finalizedReplacement.coverage_status, generatedAt, canonicalJson({ authority_kind: "diet-manager/daily-progress/v1", ...finalizedReplacement }));
        finalizedReplacements.push(finalizedReplacement);
    }
    if (!Array.isArray(execution.items) || execution.items.length !== 1) {
        return authorityInvalid("correction_progress_items");
    }
    const item = plainRecord(execution.items[0], [
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
    ], "correction_progress_item");
    if (canonicalJson(item.daily_progress) !== canonicalJson(replacement) ||
        !Array.isArray(item.daily_progress_by_date) ||
        item.daily_progress_by_date.length !== replacementsByDate.length ||
        canonicalJson(item.daily_progress_by_date) !== canonicalJson(replacementsByDate) ||
        item.status !== input.resultStatus ||
        canonicalJson(item) !== canonicalJson(authoritativeResult))
        return authorityInvalid("correction_progress_item");
    const finalizedByDate = Object.freeze(finalizedReplacements);
    const finalExecution = {
        ...execution,
        items: [{
                ...item,
                daily_progress: finalizedByDate[0],
                daily_progress_by_date: finalizedByDate,
            }],
        payload: {
            authority_kind: "diet-manager/domain-execution/v1",
            daily_progress: finalizedByDate[0],
            daily_progress_by_date: finalizedByDate,
        },
        status: input.resultStatus,
    };
    const payloadJson = canonicalJson(finalExecution);
    return Object.freeze({
        ...input,
        payloadJson,
        payload: deepFreezeJson(JSON.parse(payloadJson)),
    });
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
function assertInventoryLocationCorrectionTerminalAuthority(input, envelopeId) {
    if (input.commandType !== "correct_record" ||
        typeof input.payload !== "object" || input.payload === null || Array.isArray(input.payload))
        return;
    const execution = input.payload;
    if (typeof execution.payload !== "object" || execution.payload === null ||
        Array.isArray(execution.payload) ||
        !Object.hasOwn(execution.payload, "inventory_location_correction"))
        return;
    const events = input.database.prepare(`SELECT event_id, operation_id FROM event_records
     WHERE envelope_id = ? AND event_type = 'inventory_adjusted' AND fact_kind = 'inventory'`).all(envelopeId);
    const event = events[0];
    if (events.length !== 1 || !event)
        return authorityInvalid("location_correction_event");
    try {
        assertAppliedInventoryLocationCorrectionAuthority(input.database, envelopeId, event.operation_id, event.event_id, { requireCurrentProjection: false });
    }
    catch {
        return authorityInvalid("location_correction_effect");
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
            assertInventoryLocationCorrectionTerminalAuthority(frozen, authority.binding.preview_id);
            const replay = assertReplay(frozen, authority.binding.preview_id, authority.idempotency_key);
            frozen.database.exec("ROLLBACK");
            transactionOpen = false;
            return replay;
        }
        if (authority.envelope_state !== "effects_stable") {
            return authorityInvalid("effects_not_stable");
        }
        try {
            assertProgressReservationFinalizerAuthority(frozen.database, authority.binding.preview_id);
        }
        catch (error) {
            if (error instanceof Error &&
                error.message.startsWith("PROGRESS_RESERVATION_AUTHORITY_INVALID:terminal_")) {
                return authorityInvalid(frozen.commandType === "correct_record" || frozen.commandType === "undo_record"
                    ? "correction_progress_bundle"
                    : "daily_progress_bundle");
            }
            throw error;
        }
        const finalizedInput = freezeCorrectionDailyProgress(freezeMealDailyProgress(frozen, authority.binding.preview_id, authority.idempotency_key), authority.binding.preview_id, authority.idempotency_key);
        const result = resultFor(finalizedInput, authority.binding.preview_id, authority.idempotency_key);
        assertMixedOperationAuthority(finalizedInput, authority.binding.preview_id);
        finalizedInput.database
            .prepare(`INSERT INTO envelope_finalizations(
          envelope_id, idempotency_key, input_digest, envelope_state,
          result_status, stage, receipt_id, error_code, finalized_at,
          frozen_at, payload_json
        ) VALUES (?, ?, ?, 'finalized', ?, 'EnvelopeFinalize', ?, NULL, ?, ?, ?)`)
            .run(authority.binding.preview_id, authority.idempotency_key, finalizedInput.inputDigest, finalizedInput.resultStatus, finalizedInput.receiptId, finalizedInput.finalizedAt, finalizedInput.frozenAt, finalizedInput.payloadJson);
        injectFault(frozenOptions, "after_finalization_row");
        const insertMixedItem = finalizedInput.database.prepare(`INSERT INTO mixed_item_results(
        envelope_id, sequence, operation_id, idempotency_key,
        command_type, status, error_code, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const item of finalizedInput.mixedItems) {
            insertMixedItem.run(authority.binding.preview_id, item.sequence, item.operation_id, item.idempotency_key, item.command_type, item.status, item.error_code, item.payloadJson);
        }
        assertEnvelopeTransition("effects_stable", "finalized");
        finalizedInput.database
            .prepare(`UPDATE command_envelopes
         SET state = 'finalized', result_status = ?
         WHERE envelope_id = ? AND state = 'effects_stable'
           AND result_status = 'effects_stable'`)
            .run(finalizedInput.resultStatus, authority.binding.preview_id);
        if (changes(finalizedInput.database) !== 1)
            return authorityInvalid("envelope_compare_and_set");
        injectFault(frozenOptions, "after_envelope");
        finalizedInput.database
            .prepare(`UPDATE idempotency_records
         SET state = 'finalized', terminal_result_json = ?, updated_at = ?
         WHERE idempotency_key = ? AND operation_id = ? AND input_digest = ?
           AND state = 'effects_stable' AND terminal_result_json IS NULL`)
            .run(canonicalJson(result), finalizedInput.finalizedAt, authority.idempotency_key, authority.binding.preview_id, finalizedInput.inputDigest);
        if (changes(finalizedInput.database) !== 1) {
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
