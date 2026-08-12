import { canonicalJson } from "../authority/canonical-json.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
const QUERY_FIELDS = ["batchId", "database"];
const LIST_QUERY_FIELDS = ["database"];
const DATE_QUERY_FIELDS = ["database", "date", "timezone"];
const PROJECTION_PAYLOAD_FIELDS = [
    "authority_kind",
    "batch_id",
    "product_id",
    "quantity_microunits",
    "unit",
];
function invalid(reason) {
    throw new Error(`INVENTORY_PROJECTION_INVALID:${reason}`);
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
function ordinaryJsonObject(value, fields) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return invalid("payload_shape");
    }
    const record = value;
    if (Object.keys(record).sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
        return invalid("payload_shape");
    }
    return record;
}
function parseProjection(row) {
    let parsed;
    try {
        parsed = JSON.parse(row.payload_json);
    }
    catch {
        return invalid("payload_json");
    }
    if (canonicalJson(parsed) !== row.payload_json)
        return invalid("payload_canonical");
    const payload = ordinaryJsonObject(parsed, PROJECTION_PAYLOAD_FIELDS);
    if (payload.authority_kind !== "diet-manager/inventory-projection/v1" ||
        payload.batch_id !== row.batch_id ||
        typeof payload.product_id !== "string" ||
        typeof payload.unit !== "string" ||
        !Number.isSafeInteger(payload.quantity_microunits) ||
        payload.quantity_microunits < 0) {
        return invalid("payload_authority");
    }
    const quantityMicrounits = payload.quantity_microunits;
    const empty = quantityMicrounits === 0;
    if (row.quantity_status !== (empty ? "empty" : "available") ||
        row.effective_status !== (empty ? "empty" : "active")) {
        return invalid("status");
    }
    return Object.freeze({
        batch_id: row.batch_id,
        product_id: payload.product_id,
        quantity_microunits: quantityMicrounits,
        unit: payload.unit,
        quantity_status: row.quantity_status,
        effective_status: row.effective_status,
        last_event_id: row.last_event_id,
        last_changed_at: row.last_changed_at,
    });
}
export function getInventoryProjection(input) {
    const fields = exactDataProperties(input, QUERY_FIELDS);
    if (typeof fields.database.value !== "object" || fields.database.value === null) {
        return invalid("database");
    }
    if (typeof fields.batchId.value !== "string" ||
        fields.batchId.value.length === 0 ||
        fields.batchId.value.length > 256 ||
        !/^[\x20-\x7E]+$/.test(fields.batchId.value)) {
        return invalid("batch_id");
    }
    const database = fields.database.value;
    assertCurrentMigrationAuthority(database);
    const row = database
        .prepare("SELECT * FROM inventory_batch_projections WHERE batch_id = ?")
        .get(fields.batchId.value);
    return row ? parseProjection(row) : null;
}
export function parseInventoryProjectionRow(row) {
    return parseProjection(row);
}
function assertCanonicalObject(value, label) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        return invalid(`${label}_json`);
    }
    if (typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed) ||
        canonicalJson(parsed) !== value) {
        return invalid(`${label}_canonical`);
    }
}
function ordinalCompare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function dateQuery(input) {
    const fields = exactDataProperties(input, DATE_QUERY_FIELDS);
    if (typeof fields.database.value !== "object" || fields.database.value === null) {
        return invalid("database");
    }
    if (typeof fields.date.value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(fields.date.value) ||
        fields.timezone.value !== "Asia/Shanghai") {
        return invalid("date_query");
    }
    const dateProbe = new Date(`${fields.date.value}T00:00:00.000Z`);
    if (!Number.isFinite(dateProbe.valueOf()) ||
        dateProbe.toISOString().slice(0, 10) !== fields.date.value)
        return invalid("date");
    const startMilliseconds = Date.parse(`${fields.date.value}T00:00:00+08:00`);
    if (!Number.isFinite(startMilliseconds))
        return invalid("date");
    const start = new Date(startMilliseconds).toISOString();
    const end = new Date(startMilliseconds + 86_400_000).toISOString();
    if (start.slice(0, 10) === end.slice(0, 10))
        return invalid("date_range");
    return {
        database: fields.database.value,
        date: fields.date.value,
        timezone: "Asia/Shanghai",
        start,
        end,
    };
}
function readOnly(database, action) {
    let transactionOpen = false;
    try {
        database.exec("BEGIN DEFERRED");
        transactionOpen = true;
        assertCurrentMigrationAuthority(database);
        const result = action();
        database.exec("ROLLBACK");
        transactionOpen = false;
        return result;
    }
    catch (error) {
        if (transactionOpen) {
            try {
                database.exec("ROLLBACK");
            }
            catch {
                // Preserve the primary read-model error.
            }
        }
        throw error;
    }
}
function parseCanonicalRecord(value, label) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        return invalid(`${label}_json`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
        canonicalJson(parsed) !== value)
        return invalid(`${label}_canonical`);
    return parsed;
}
export function listMealProjection(input) {
    const query = dateQuery(input);
    return readOnly(query.database, () => {
        const rows = query.database.prepare(`SELECT event_id, occurred_at_text, meal_slot, payload_json
       FROM event_records
       WHERE event_type = 'diet_meal' AND lifecycle_status = 'active'
         AND occurred_at_text >= ? AND occurred_at_text < ?
       ORDER BY occurred_at_text, event_id`).all(query.start, query.end);
        return Object.freeze(rows.flatMap((row) => {
            const eventPayload = parseCanonicalRecord(row.payload_json, "meal_event");
            if (eventPayload.authority_kind !== "diet-manager/meal-fact/v1" ||
                (eventPayload.location !== "home" && eventPayload.location !== "outside"))
                return invalid("meal_event_authority");
            const latestCorrection = query.database.prepare(`SELECT c.base_revision, c.payload_json
         FROM correction_events c
         JOIN event_records e ON e.operation_id = c.request_id AND e.event_type = 'diet_correction'
         JOIN effect_bundle_commits b
           ON b.envelope_id = e.envelope_id AND b.operation_id = e.operation_id
         WHERE c.target_event_id = ? AND (
           (b.effect_state = 'succeeded' AND b.result_status = 'applied') OR
           (b.effect_state = 'permanent_business_skip' AND b.result_status = 'applied_with_issues')
         )
         ORDER BY c.base_revision DESC LIMIT 1`).get(row.event_id);
            if (latestCorrection) {
                const correction = parseCanonicalRecord(latestCorrection.payload_json, "meal_correction");
                if (correction.authority_kind !== "diet-manager/correction-fact/v1" ||
                    correction.target_event_id !== row.event_id ||
                    correction.base_revision !== latestCorrection.base_revision ||
                    typeof correction.after_snapshot !== "object" || correction.after_snapshot === null ||
                    Array.isArray(correction.after_snapshot))
                    return invalid("meal_correction_authority");
                const snapshot = correction.after_snapshot;
                if (!snapshot.active)
                    return [];
                if (snapshot.occurred_at !== row.occurred_at_text ||
                    snapshot.meal_slot !== row.meal_slot ||
                    snapshot.location !== eventPayload.location ||
                    snapshot.timezone !== "Asia/Shanghai" ||
                    !Array.isArray(snapshot.items))
                    return invalid("meal_correction_snapshot");
                const items = snapshot.items.map((item, index) => {
                    if (item.item_order !== index || typeof item.item_type !== "string" ||
                        typeof item.normalized_name !== "string" || typeof item.amount !== "object" ||
                        item.amount === null || Array.isArray(item.amount))
                        return invalid("meal_correction_item");
                    return Object.freeze({
                        item_order: item.item_order,
                        item_type: item.item_type,
                        normalized_name: item.normalized_name,
                        amount: Object.freeze({ ...item.amount }),
                    });
                });
                return [Object.freeze({
                        occurred_at: snapshot.occurred_at,
                        meal_slot: snapshot.meal_slot,
                        location: snapshot.location,
                        items: Object.freeze(items),
                    })];
            }
            const itemRows = query.database.prepare(`SELECT item_order, item_type, normalized_name, payload_json
         FROM meal_items WHERE event_id = ? ORDER BY item_order`).all(row.event_id);
            const items = itemRows.map((item, index) => {
                if (item.item_order !== index)
                    return invalid("meal_item_order");
                const payload = parseCanonicalRecord(item.payload_json, "meal_item");
                if (payload.authority_kind !== "diet-manager/meal-item/v1" ||
                    typeof payload.amount !== "object" || payload.amount === null ||
                    Array.isArray(payload.amount))
                    return invalid("meal_item_authority");
                return Object.freeze({
                    item_order: item.item_order,
                    item_type: item.item_type,
                    normalized_name: item.normalized_name,
                    amount: Object.freeze({ ...payload.amount }),
                });
            });
            return [Object.freeze({
                    occurred_at: row.occurred_at_text,
                    meal_slot: row.meal_slot,
                    location: eventPayload.location,
                    items: Object.freeze(items),
                })];
        }));
    });
}
const NUTRIENT_FIELDS = [
    "energy_kcal_milli",
    "protein_mg",
    "fat_mg",
    "carbohydrate_mg",
    "fiber_mg",
    "water_ml_milli",
];
export function summarizeDailyProgress(input) {
    const query = dateQuery(input);
    return readOnly(query.database, () => {
        const rows = query.database.prepare(`SELECT coverage_status, payload_json FROM daily_progress_snapshots
       WHERE date = ? AND timezone = ?
       ORDER BY generated_at DESC, progress_snapshot_id DESC LIMIT 1`).all(query.date, query.timezone);
        const sums = {
            energy_kcal_milli: rows.length === 0 ? null : 0,
            protein_mg: rows.length === 0 ? null : 0,
            fat_mg: rows.length === 0 ? null : 0,
            carbohydrate_mg: rows.length === 0 ? null : 0,
            fiber_mg: rows.length === 0 ? null : 0,
            water_ml_milli: rows.length === 0 ? null : 0,
        };
        let partial = rows.length === 0;
        for (const row of rows) {
            const payload = parseCanonicalRecord(row.payload_json, "daily_progress");
            if (payload.authority_kind !== "diet-manager/daily-progress/v1" ||
                payload.date !== query.date || payload.timezone !== query.timezone ||
                typeof payload.nutrients !== "object" || payload.nutrients === null ||
                Array.isArray(payload.nutrients) ||
                (row.coverage_status !== "complete" && row.coverage_status !== "partial") ||
                payload.coverage_status !== row.coverage_status)
                return invalid("daily_progress_authority");
            if (row.coverage_status === "partial")
                partial = true;
            const nutrients = payload.nutrients;
            if (Object.keys(nutrients).sort().join("\u0000") !== [...NUTRIENT_FIELDS].sort().join("\u0000")) {
                return invalid("daily_progress_nutrients");
            }
            for (const field of NUTRIENT_FIELDS) {
                const value = nutrients[field];
                if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
                    return invalid(`daily_progress_${field}`);
                }
                sums[field] = sums[field] === null || value === null
                    ? null
                    : sums[field] + value;
                if (sums[field] !== null && !Number.isSafeInteger(sums[field])) {
                    return invalid(`daily_progress_${field}_sum`);
                }
            }
        }
        return Object.freeze({
            coverage_status: rows.length === 0 ? "unknown" : partial ? "partial" : "complete",
            nutrients: Object.freeze({ ...sums }),
        });
    });
}
export function listInventoryProjection(input) {
    const fields = exactDataProperties(input, LIST_QUERY_FIELDS);
    if (typeof fields.database.value !== "object" || fields.database.value === null) {
        return invalid("database");
    }
    const database = fields.database.value;
    let transactionOpen = false;
    try {
        database.exec("BEGIN DEFERRED");
        transactionOpen = true;
        assertCurrentMigrationAuthority(database);
        const rows = database
            .prepare(`SELECT
          p.product_id, p.normalized_name, p.product_type,
          p.payload_json AS product_payload_json,
          b.payload_json AS batch_payload_json,
          i.*
         FROM inventory_batch_projections i
         JOIN inventory_batches b ON b.batch_id = i.batch_id
         JOIN products p ON p.product_id = b.product_id`)
            .all();
        const items = rows.map((row) => {
            assertCanonicalObject(row.product_payload_json, "product_payload");
            assertCanonicalObject(row.batch_payload_json, "batch_payload");
            const projection = parseProjection(row);
            if (projection.product_id !== row.product_id)
                return invalid("product_identity");
            return Object.freeze({
                ...projection,
                normalized_name: row.normalized_name,
                product_type: row.product_type,
            });
        });
        items.sort((left, right) => ordinalCompare(left.normalized_name, right.normalized_name) ||
            ordinalCompare(left.batch_id, right.batch_id));
        database.exec("ROLLBACK");
        transactionOpen = false;
        return Object.freeze(items);
    }
    catch (error) {
        if (transactionOpen) {
            try {
                database.exec("ROLLBACK");
            }
            catch {
                // Preserve the primary read-model error.
            }
        }
        throw error;
    }
}
