import { canonicalJson } from "../authority/canonical-json.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
const QUERY_FIELDS = ["batchId", "database"];
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
