import { canonicalJson } from "../authority/canonical-json.js";
import { validateAndFreezeMealFactPayload, validateAndFreezeOccurredTimeEvidence, } from "../authority/meal-fact.js";
const NUTRIENT_FIELDS = [
    "carbohydrate_mg",
    "energy_kcal_milli",
    "fat_mg",
    "fiber_mg",
    "protein_mg",
    "water_ml_milli",
];
const CONTRIBUTION_FIELDS = [
    "authority_kind",
    "base_generated_at",
    "contribution",
    "date",
    "mode",
    "reserved_progress",
    "timezone",
];
const REPLACEMENT_FIELDS = [
    "after",
    "authority_kind",
    "base_generated_at",
    "before",
    "date",
    "mode",
    "reserved_progress",
    "timezone",
];
const CORRECTION_FACT_FIELDS = [
    "affected_dates",
    "after_snapshot",
    "authority_kind",
    "base_revision",
    "before_snapshot",
    "change_set",
    "correction_id",
    "inventory_compensation_intent",
    "nutrition_delta",
    "operation",
    "request_id",
    "target_event_id",
];
function invalid(reason) {
    throw new Error(`PROGRESS_RESERVATION_AUTHORITY_INVALID:${reason}`);
}
function exactRecord(value, fields, reason) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return invalid(reason);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") ||
        keys.sort().join("\u0000") !== [...fields].sort().join("\u0000"))
        return invalid(reason);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const field of fields) {
        const descriptor = descriptors[field];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
            return invalid(reason);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        return invalid(reason);
    return Object.fromEntries(fields.map((field) => [field, descriptors[field].value]));
}
function deepFreeze(value) {
    if (Array.isArray(value)) {
        for (const item of value)
            deepFreeze(item);
        return Object.freeze(value);
    }
    if (typeof value === "object" && value !== null) {
        for (const child of Object.values(value))
            deepFreeze(child);
        return Object.freeze(value);
    }
    return value;
}
function date(value, reason) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return invalid(reason);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
        return invalid(reason);
    }
    return value;
}
function generatedAt(value, nullable) {
    if (value === null && nullable)
        return null;
    if (typeof value !== "string")
        return invalid("base_generated_at");
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
        return invalid("base_generated_at");
    }
    return value;
}
function progress(value, reason) {
    const record = exactRecord(value, ["coverage_status", "date", "nutrients", "timezone"], reason);
    const progressDate = date(record.date, reason);
    if (record.timezone !== "Asia/Shanghai" ||
        (record.coverage_status !== "complete" && record.coverage_status !== "partial"))
        return invalid(reason);
    const nutrients = exactRecord(record.nutrients, NUTRIENT_FIELDS, reason);
    const frozenNutrients = {};
    for (const field of NUTRIENT_FIELDS) {
        const candidate = nutrients[field];
        if (candidate !== null && (!Number.isSafeInteger(candidate) || candidate < 0)) {
            return invalid(reason);
        }
        frozenNutrients[field] = candidate;
    }
    const coverage = Object.values(frozenNutrients).every((candidate) => candidate !== null)
        ? "complete"
        : "partial";
    if (coverage !== record.coverage_status)
        return invalid(reason);
    return Object.freeze({
        coverage_status: coverage,
        date: progressDate,
        nutrients: Object.freeze(frozenNutrients),
        timezone: "Asia/Shanghai",
    });
}
export function parseProgressReservation(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return invalid("shape");
    }
    const modeDescriptor = Object.getOwnPropertyDescriptor(value, "mode");
    if (!modeDescriptor || !("value" in modeDescriptor) || !modeDescriptor.enumerable) {
        return invalid("descriptor");
    }
    if (modeDescriptor.value === "contribution") {
        const record = exactRecord(value, CONTRIBUTION_FIELDS, "shape");
        const reservationDate = date(record.date, "date");
        const contribution = progress(record.contribution, "contribution");
        const reserved = progress(record.reserved_progress, "reserved_progress");
        if (record.authority_kind !== "diet-manager/progress-reservation/v1" ||
            record.timezone !== "Asia/Shanghai" ||
            contribution.date !== reservationDate || reserved.date !== reservationDate ||
            contribution.timezone !== record.timezone || reserved.timezone !== record.timezone)
            return invalid("binding");
        return Object.freeze({
            authority_kind: "diet-manager/progress-reservation/v1",
            base_generated_at: generatedAt(record.base_generated_at, true),
            contribution,
            date: reservationDate,
            mode: "contribution",
            reserved_progress: reserved,
            timezone: "Asia/Shanghai",
        });
    }
    if (modeDescriptor.value === "replacement") {
        const record = exactRecord(value, REPLACEMENT_FIELDS, "shape");
        const reservationDate = date(record.date, "date");
        const before = progress(record.before, "before");
        const after = progress(record.after, "after");
        const reserved = progress(record.reserved_progress, "reserved_progress");
        if (record.authority_kind !== "diet-manager/progress-reservation/v1" ||
            record.timezone !== "Asia/Shanghai" ||
            before.date !== reservationDate || after.date !== reservationDate ||
            reserved.date !== reservationDate || before.timezone !== record.timezone ||
            after.timezone !== record.timezone || reserved.timezone !== record.timezone)
            return invalid("binding");
        const base = generatedAt(record.base_generated_at, false);
        if (base === null)
            return invalid("base_generated_at");
        return Object.freeze({
            after,
            authority_kind: "diet-manager/progress-reservation/v1",
            base_generated_at: base,
            before,
            date: reservationDate,
            mode: "replacement",
            reserved_progress: reserved,
            timezone: "Asia/Shanghai",
        });
    }
    return invalid("mode");
}
function add(previous, contribution) {
    if (previous !== null && previous.date !== contribution.date)
        return invalid("date");
    const nutrients = {};
    for (const field of NUTRIENT_FIELDS) {
        const left = previous === null ? 0 : previous.nutrients[field];
        const right = contribution.nutrients[field];
        if (left === null || right === null) {
            nutrients[field] = null;
            continue;
        }
        const sum = left + right;
        if (!Number.isSafeInteger(sum))
            return invalid("daily_progress_sum");
        nutrients[field] = sum;
    }
    return Object.freeze({
        coverage_status: Object.values(nutrients).every((candidate) => candidate !== null)
            ? "complete"
            : "partial",
        date: contribution.date,
        nutrients: Object.freeze(nutrients),
        timezone: "Asia/Shanghai",
    });
}
function replace(current, before, after) {
    if (current.date !== before.date || current.date !== after.date)
        return invalid("date");
    const nutrients = {};
    for (const field of NUTRIENT_FIELDS) {
        const currentValue = current.nutrients[field];
        const beforeValue = before.nutrients[field];
        const afterValue = after.nutrients[field];
        if (currentValue === null || beforeValue === null || afterValue === null) {
            nutrients[field] = null;
            continue;
        }
        const next = currentValue - beforeValue + afterValue;
        if (!Number.isSafeInteger(next) || next < 0)
            return invalid("daily_progress_delta");
        nutrients[field] = next;
    }
    return Object.freeze({
        coverage_status: Object.values(nutrients).every((candidate) => candidate !== null)
            ? "complete"
            : "partial",
        date: current.date,
        nutrients: Object.freeze(nutrients),
        timezone: "Asia/Shanghai",
    });
}
function latest(database, progressDate) {
    const row = database.prepare(`SELECT generated_at, payload_json FROM daily_progress_snapshots
     WHERE date = ? AND timezone = 'Asia/Shanghai'
     ORDER BY generated_at DESC, progress_snapshot_id DESC LIMIT 1`).get(progressDate);
    if (!row)
        return { progress: null, generated_at: null };
    let parsed;
    try {
        parsed = JSON.parse(row.payload_json);
    }
    catch {
        return invalid("daily_progress_previous");
    }
    if (canonicalJson(parsed) !== row.payload_json)
        return invalid("daily_progress_previous");
    const payload = exactRecord(parsed, ["authority_kind", "coverage_status", "date", "nutrients", "timezone"], "daily_progress_previous");
    if (payload.authority_kind !== "diet-manager/daily-progress/v1") {
        return invalid("daily_progress_previous");
    }
    return {
        generated_at: generatedAt(row.generated_at, false),
        progress: progress({
            coverage_status: payload.coverage_status,
            date: payload.date,
            nutrients: payload.nutrients,
            timezone: payload.timezone,
        }, "daily_progress_previous"),
    };
}
export function createContributionProgressReservation(database, value) {
    const contribution = progress(value, "contribution");
    const previous = latest(database, contribution.date);
    return Object.freeze({
        authority_kind: "diet-manager/progress-reservation/v1",
        base_generated_at: previous.generated_at,
        contribution,
        date: contribution.date,
        mode: "contribution",
        reserved_progress: add(previous.progress, contribution),
        timezone: "Asia/Shanghai",
    });
}
export function createReplacementProgressReservation(database, progressDate, beforeValue, afterValue) {
    const before = progress(beforeValue, "before");
    const after = progress(afterValue, "after");
    const previous = latest(database, date(progressDate, "date"));
    if (previous.progress === null || previous.generated_at === null) {
        return invalid("daily_progress_missing");
    }
    return Object.freeze({
        after,
        authority_kind: "diet-manager/progress-reservation/v1",
        base_generated_at: previous.generated_at,
        before,
        date: progressDate,
        mode: "replacement",
        reserved_progress: replace(previous.progress, before, after),
        timezone: "Asia/Shanghai",
    });
}
export function reservationFromEventPayload(value, eventType) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return invalid("fact_payload");
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string"))
        return invalid("fact_payload");
    const authorityDescriptor = Object.getOwnPropertyDescriptor(value, "authority_kind");
    if (!authorityDescriptor) {
        if (keys.includes("progress_reservation"))
            return invalid("fact_payload");
        return undefined;
    }
    if (!("value" in authorityDescriptor) || !authorityDescriptor.enumerable) {
        return invalid(eventType === "diet_meal"
            ? "meal_fact"
            : eventType === "inventory_stock"
                ? "purchase_fact"
                : eventType === "diet_correction"
                    ? "correction_fact"
                    : "fact_payload");
    }
    const authorityKind = authorityDescriptor.value;
    if (eventType === "diet_meal" && authorityKind === "diet-manager/meal-fact/v1") {
        let payload;
        try {
            payload = validateAndFreezeMealFactPayload(value);
        }
        catch {
            return invalid("meal_fact");
        }
        const hasReservation = Object.hasOwn(payload, "progress_reservation");
        if (!hasReservation)
            return undefined;
        const reservation = parseProgressReservation(payload.progress_reservation);
        if (reservation.mode !== "contribution")
            return invalid("meal_reservation_mode");
        return reservation;
    }
    if (eventType === "inventory_stock" && authorityKind === "diet-manager/purchase-fact/v1") {
        const hasReservation = keys.includes("progress_reservation");
        const payload = exactRecord(value, hasReservation
            ? ["authority_kind", "effect_inputs", "progress_reservation", "result"]
            : ["authority_kind", "effect_inputs", "result"], "purchase_fact");
        if (!hasReservation)
            return undefined;
        const reservation = parseProgressReservation(payload.progress_reservation);
        if (reservation.mode !== "contribution")
            return invalid("purchase_reservation_mode");
        return reservation;
    }
    if (eventType === "diet_water" && authorityKind === "diet-manager/water-fact/v1") {
        const hasReservation = keys.includes("progress_reservation");
        const payload = exactRecord(value, hasReservation
            ? ["amount_evidence", "authority_kind", "estimated", "occurred_time", "plain_water_ml_milli", "progress_reservation", "source_text", "timezone"]
            : ["amount_evidence", "authority_kind", "estimated", "occurred_time", "plain_water_ml_milli", "source_text", "timezone"], "water_fact");
        try {
            validateAndFreezeOccurredTimeEvidence(payload.occurred_time, {
                path: "water_fact.occurred_time",
                requireExact: true,
            });
        }
        catch {
            return invalid("water_fact");
        }
        if (!hasReservation)
            return undefined;
        const reservation = parseProgressReservation(payload.progress_reservation);
        if (reservation.mode !== "contribution")
            return invalid("water_reservation_mode");
        return reservation;
    }
    if (eventType === "diet_correction" && authorityKind === "diet-manager/correction-fact/v1") {
        const payload = exactRecord(value, CORRECTION_FACT_FIELDS, "correction_fact");
        const deltaValue = payload.nutrition_delta;
        if (typeof deltaValue !== "object" || deltaValue === null || Array.isArray(deltaValue)) {
            return invalid("correction_fact");
        }
        const hasReservation = Reflect.ownKeys(deltaValue).includes("progress_reservation");
        const delta = exactRecord(deltaValue, hasReservation ? ["items", "progress_reservation"] : ["items"], "correction_fact");
        if (!hasReservation)
            return undefined;
        const reservation = parseProgressReservation(delta.progress_reservation);
        if (reservation.mode !== "replacement")
            return invalid("correction_reservation_mode");
        if (!Array.isArray(payload.affected_dates) ||
            payload.affected_dates.length !== 1 ||
            !Object.hasOwn(payload.affected_dates, 0) ||
            date(Object.getOwnPropertyDescriptor(payload.affected_dates, "0")?.value, "correction_fact") !==
                reservation.date)
            return invalid("correction_reservation_date");
        return reservation;
    }
    if (keys.includes("progress_reservation") ||
        authorityKind === "diet-manager/meal-fact/v1" ||
        authorityKind === "diet-manager/purchase-fact/v1" ||
        authorityKind === "diet-manager/correction-fact/v1")
        return invalid("fact_authority");
    return undefined;
}
function parseEventPayload(payloadJson, eventType, occurredAtText) {
    let payload;
    try {
        payload = JSON.parse(payloadJson);
    }
    catch {
        return invalid("fact_json");
    }
    if (canonicalJson(payload) !== payloadJson)
        return invalid("fact_canonical");
    if (eventType === "diet_water") {
        if (occurredAtText === null || typeof payload !== "object" || payload === null || Array.isArray(payload)) {
            return invalid("water_fact");
        }
        try {
            validateAndFreezeOccurredTimeEvidence(payload.occurred_time, {
                occurredAt: occurredAtText,
                path: "water_fact.occurred_time",
                requireExact: true,
            });
        }
        catch {
            return invalid("water_fact");
        }
    }
    return reservationFromEventPayload(payload, eventType);
}
function activeReservations(database) {
    const rows = database.prepare(`SELECT e.envelope_id, e.event_type, e.occurred_at_text, e.payload_json
     FROM event_records e
     JOIN command_envelopes c ON c.envelope_id = e.envelope_id
     WHERE c.state <> 'finalized'
     ORDER BY e.envelope_id, e.committed_at, e.event_id`).all();
    const reservations = [];
    for (const row of rows) {
        const reservation = parseEventPayload(row.payload_json, row.event_type, row.occurred_at_text);
        if (reservation)
            reservations.push({ envelope_id: row.envelope_id, reservation });
    }
    return reservations;
}
function naturalDate(occurredAt) {
    const parsed = new Date(occurredAt);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== occurredAt) {
        return invalid("occurred_at");
    }
    return new Date(parsed.valueOf() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}
function unfinalizedProgressOwners(database) {
    const owners = new Map(activeReservations(database).map(({ envelope_id, reservation }) => [
        envelope_id,
        { envelope_id, date: reservation.date },
    ]));
    const envelopeRows = database.prepare(`SELECT DISTINCT o.envelope_id
     FROM effect_outbox o
     JOIN command_envelopes c ON c.envelope_id = o.envelope_id
     WHERE c.state <> 'finalized'
       AND o.effect_kind IN ('daily_progress_contribution', 'daily_progress_replacement')
     ORDER BY o.envelope_id`).all();
    for (const { envelope_id } of envelopeRows) {
        if (owners.has(envelope_id))
            continue;
        const reservation = readEnvelopeProgressReservation(database, envelope_id);
        if (reservation) {
            owners.set(envelope_id, { envelope_id, date: reservation.date });
            continue;
        }
        const row = database.prepare(`SELECT e.event_type, e.occurred_at_text, e.payload_json, o.effect_kind
       FROM effect_outbox o
       JOIN event_records e
         ON e.envelope_id = o.envelope_id AND e.operation_id = o.operation_id
       WHERE o.envelope_id = ?
         AND o.effect_kind IN ('daily_progress_contribution', 'daily_progress_replacement')`).get(envelope_id);
        if (!row)
            return invalid("progress_owner");
        if (row.effect_kind === "daily_progress_contribution") {
            if ((row.event_type !== "diet_meal" && row.event_type !== "diet_water") || row.occurred_at_text === null) {
                return invalid("progress_owner");
            }
            owners.set(envelope_id, { envelope_id, date: naturalDate(row.occurred_at_text) });
            continue;
        }
        let payload;
        try {
            payload = JSON.parse(row.payload_json);
        }
        catch {
            return invalid("progress_owner");
        }
        if (canonicalJson(payload) !== row.payload_json)
            return invalid("progress_owner");
        const correction = exactRecord(payload, CORRECTION_FACT_FIELDS, "progress_owner");
        if (row.event_type !== "diet_correction" ||
            !Array.isArray(correction.affected_dates) || correction.affected_dates.length !== 1)
            return invalid("progress_owner");
        owners.set(envelope_id, {
            envelope_id,
            date: date(correction.affected_dates[0], "progress_owner"),
        });
    }
    return [...owners.values()];
}
function assertCurrentProjection(database, reservation) {
    const previous = latest(database, reservation.date);
    if (previous.generated_at !== reservation.base_generated_at)
        return invalid("base_changed");
    const projected = reservation.mode === "contribution"
        ? add(previous.progress, reservation.contribution)
        : previous.progress === null
            ? invalid("daily_progress_missing")
            : replace(previous.progress, reservation.before, reservation.after);
    if (canonicalJson(projected) !== canonicalJson(reservation.reserved_progress)) {
        return invalid("projection");
    }
}
export function assertProgressReservationFactCommitAuthority(database, envelopeId, value) {
    const reservation = parseProgressReservation(value);
    const conflict = unfinalizedProgressOwners(database).find((candidate) => candidate.envelope_id !== envelopeId &&
        candidate.date === reservation.date);
    if (conflict)
        throw new Error("PROGRESS_RESERVATION_CONFLICT:active");
    assertCurrentProjection(database, reservation);
}
export function readEnvelopeProgressReservation(database, envelopeId) {
    const rows = database.prepare(`SELECT event_type, occurred_at_text, payload_json FROM event_records
     WHERE envelope_id = ? ORDER BY committed_at, event_id`).all(envelopeId);
    const reservations = rows
        .map((row) => parseEventPayload(row.payload_json, row.event_type, row.occurred_at_text))
        .filter((candidate) => candidate !== undefined);
    if (reservations.length > 1)
        return invalid("reservation_count");
    return reservations[0];
}
function terminalProgressBinding(database, envelopeId) {
    const rows = database.prepare(`SELECT b.payload_json, o.effect_id, o.effect_kind
     FROM effect_bundle_commits b
     JOIN effect_outbox o
       ON o.envelope_id = b.envelope_id AND o.operation_id = b.operation_id
     WHERE b.envelope_id = ?
       AND o.effect_kind IN ('daily_progress_contribution', 'daily_progress_replacement')`).all(envelopeId);
    if (rows.length === 0)
        return undefined;
    if (rows.length !== 1)
        return invalid("terminal_progress_count");
    const row = rows[0];
    let parsed;
    try {
        parsed = JSON.parse(row.payload_json);
    }
    catch {
        return invalid("terminal_bundle");
    }
    if (canonicalJson(parsed) !== row.payload_json)
        return invalid("terminal_bundle");
    const bundle = exactRecord(parsed, ["authority_kind", "data_revision", "effects", "operation_sequence"], "terminal_bundle");
    if (bundle.authority_kind !== "diet-manager/effect-bundle/v1" || !Array.isArray(bundle.effects)) {
        return invalid("terminal_bundle");
    }
    const effectValue = bundle.effects.find((candidate) => typeof candidate === "object" && candidate !== null && !Array.isArray(candidate) &&
        Object.getOwnPropertyDescriptor(candidate, "effect_id")?.value === row.effect_id);
    if (row.effect_kind === "daily_progress_contribution") {
        const effect = exactRecord(effectValue, ["contribution", "effect_id", "state"], "terminal_effect");
        const contribution = progress(effect.contribution, "terminal_effect");
        return { date: contribution.date, mode: "contribution", contribution };
    }
    const effect = exactRecord(effectValue, ["delta", "effect_id", "replacement", "state"], "terminal_effect");
    const delta = exactRecord(effect.delta, ["after", "before"], "terminal_effect");
    const replacement = progress(effect.replacement, "terminal_effect");
    return {
        after: progress(delta.after, "terminal_effect"),
        before: progress(delta.before, "terminal_effect"),
        date: replacement.date,
        mode: "replacement",
        replacement,
    };
}
export function assertProgressReservationFinalizerAuthority(database, envelopeId) {
    const binding = terminalProgressBinding(database, envelopeId);
    if (!binding)
        return;
    const reservation = readEnvelopeProgressReservation(database, envelopeId);
    const conflicts = activeReservations(database).filter((candidate) => candidate.envelope_id !== envelopeId &&
        candidate.reservation.date === binding.date);
    if (conflicts.length > 0)
        throw new Error("PROGRESS_RESERVATION_CONFLICT:active");
    if (!reservation)
        return;
    if (reservation.mode !== binding.mode || reservation.date !== binding.date) {
        return invalid("terminal_binding");
    }
    assertCurrentProjection(database, reservation);
    if (reservation.mode === "contribution" &&
        canonicalJson(reservation.contribution) !== canonicalJson(binding.contribution))
        return invalid("terminal_binding");
    if (reservation.mode === "replacement" &&
        (canonicalJson(reservation.before) !== canonicalJson(binding.before) ||
            canonicalJson(reservation.after) !== canonicalJson(binding.after) ||
            canonicalJson(reservation.reserved_progress) !== canonicalJson(binding.replacement)))
        return invalid("terminal_binding");
}
export function cloneProgressReservation(value) {
    return deepFreeze(JSON.parse(canonicalJson(parseProgressReservation(value))));
}
