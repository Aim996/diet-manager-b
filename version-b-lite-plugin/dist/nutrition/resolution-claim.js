import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson, canonicalSha256 } from "../authority/canonical-json.js";
import { freezeNutritionData } from "./types.js";
const DIGEST = /^[A-F0-9]{64}$/u;
function invalid(reason) {
    throw new Error(`NUTRITION_RESOLUTION_AUTHORITY_INVALID:${reason}`);
}
function exactKeys(value, expected, reason) {
    const keys = Object.keys(value).sort();
    const sorted = [...expected].sort();
    if (keys.length !== sorted.length || keys.some((key, index) => key !== sorted[index]))
        invalid(reason);
}
function text(value, reason, max = 256) {
    if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u001F\u007F]/u.test(value)) {
        return invalid(reason);
    }
    return value;
}
function timestamp(value, reason) {
    const result = text(value, reason, 64);
    if (new Date(result).toISOString() !== result)
        return invalid(reason);
    return result;
}
function secret(value) {
    if (!(value instanceof Uint8Array) || value.byteLength !== 32)
        return invalid("secret");
    return Buffer.from(value);
}
function mac(material, authoritySecret) {
    return createHmac("sha256", secret(authoritySecret)).update(canonicalJson(material), "utf8").digest("hex").toUpperCase();
}
function matchesMac(material, supplied, authoritySecret) {
    if (typeof supplied !== "string" || !DIGEST.test(supplied))
        return false;
    const expected = Buffer.from(mac(material, authoritySecret), "hex");
    const actual = Buffer.from(supplied, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function pendingAuthority(input, generation) {
    if (!DIGEST.test(input.base_input_digest) || !DIGEST.test(input.source_config_digest))
        invalid("digest");
    timestamp(input.now, "now");
    timestamp(input.lease_expires_at, "lease");
    if (Date.parse(input.lease_expires_at) <= Date.parse(input.now))
        invalid("lease_order");
    return freezeNutritionData({
        authority_kind: "diet-manager/nutrition-resolution/v6",
        base_input_digest: input.base_input_digest,
        source_config_digest: input.source_config_digest,
        owner_nonce: text(input.owner_nonce, "owner_nonce", 128),
        generation,
        lease_expires_at: input.lease_expires_at,
        operation_id: text(input.operation_id, "operation_id"),
        source_message_id: text(input.source_message_id, "source_message_id"),
        conversation_id: text(input.conversation_id, "conversation_id"),
    });
}
function pendingPayload(authority, authoritySecret) {
    return canonicalJson({ authority, authority_mac: mac(authority, authoritySecret) });
}
function parsePendingPayload(value, authoritySecret) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        return invalid("pending_json");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        return invalid("pending_shape");
    const wrapper = parsed;
    exactKeys(wrapper, ["authority", "authority_mac"], "pending_keys");
    const raw = wrapper.authority;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        return invalid("pending_authority");
    const authority = raw;
    exactKeys(authority, [
        "authority_kind", "base_input_digest", "conversation_id", "generation", "lease_expires_at",
        "operation_id", "owner_nonce", "source_config_digest", "source_message_id",
    ], "pending_authority_keys");
    if (authority.authority_kind !== "diet-manager/nutrition-resolution/v6" ||
        typeof authority.base_input_digest !== "string" || !DIGEST.test(authority.base_input_digest) ||
        typeof authority.source_config_digest !== "string" || !DIGEST.test(authority.source_config_digest) ||
        !Number.isSafeInteger(authority.generation) || authority.generation < 1)
        invalid("pending_authority_value");
    text(authority.owner_nonce, "pending_owner", 128);
    text(authority.operation_id, "pending_operation");
    text(authority.source_message_id, "pending_message");
    text(authority.conversation_id, "pending_conversation");
    timestamp(authority.lease_expires_at, "pending_lease");
    if (!matchesMac(authority, wrapper.authority_mac, authoritySecret) || canonicalJson(parsed) !== value)
        invalid("pending_mac");
    return freezeNutritionData(authority);
}
export function parseNutritionPreviewMaterialV6(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return invalid("material_shape");
    const material = value;
    exactKeys(material, [
        "authority_kind", "base_input_digest", "conversation_id", "effect_identities", "meal_fact_identities",
        "nutrition_evidence", "operation_id", "resolved_evidence_digest", "source_config_digest", "source_message_id",
    ], "material_keys");
    if (material.authority_kind !== "diet-manager/domain-preview/v6" ||
        typeof material.base_input_digest !== "string" || !DIGEST.test(material.base_input_digest) ||
        typeof material.resolved_evidence_digest !== "string" || !DIGEST.test(material.resolved_evidence_digest) ||
        typeof material.source_config_digest !== "string" || !DIGEST.test(material.source_config_digest) ||
        !Array.isArray(material.meal_fact_identities) || !Array.isArray(material.nutrition_evidence) ||
        !Array.isArray(material.effect_identities))
        return invalid("material_value");
    text(material.operation_id, "material_operation");
    text(material.source_message_id, "material_message");
    text(material.conversation_id, "material_conversation");
    const frozen = freezeNutritionData(material);
    if (canonicalSha256(frozen.nutrition_evidence) !== frozen.resolved_evidence_digest)
        invalid("evidence_digest");
    return frozen;
}
function finalPayload(material, authoritySecret) {
    return canonicalJson({
        authority_kind: "diet-manager/nutrition-preview-store/v6",
        material,
        material_mac: mac(material, authoritySecret),
    });
}
function parseFinalPayload(value, authoritySecret) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        return invalid("final_json");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        return invalid("final_shape");
    const wrapper = parsed;
    exactKeys(wrapper, ["authority_kind", "material", "material_mac"], "final_keys");
    if (wrapper.authority_kind !== "diet-manager/nutrition-preview-store/v6")
        invalid("final_kind");
    const material = parseNutritionPreviewMaterialV6(wrapper.material);
    if (!matchesMac(material, wrapper.material_mac, authoritySecret) || canonicalJson(parsed) !== value)
        invalid("final_mac");
    return material;
}
function selectByIdempotency(database, idempotencyKey) {
    return database.prepare(`
    SELECT e.envelope_id, e.idempotency_key, e.input_digest AS envelope_input_digest,
      e.source_message_id, e.conversation_id, e.state AS envelope_state, e.result_status,
      e.payload_json, i.operation_id AS idempotency_operation_id,
      i.input_digest AS idempotency_input_digest, i.state AS idempotency_state
    FROM idempotency_records i
    JOIN command_envelopes e ON e.envelope_id = i.operation_id
    WHERE i.idempotency_key = ?
  `).get(idempotencyKey);
}
function selectByEnvelope(database, envelopeId) {
    return database.prepare(`
    SELECT e.envelope_id, e.idempotency_key, e.input_digest AS envelope_input_digest,
      e.source_message_id, e.conversation_id, e.state AS envelope_state, e.result_status,
      e.payload_json, i.operation_id AS idempotency_operation_id,
      i.input_digest AS idempotency_input_digest, i.state AS idempotency_state
    FROM command_envelopes e
    JOIN idempotency_records i ON i.operation_id = e.envelope_id
    WHERE e.envelope_id = ?
  `).get(envelopeId);
}
function assertRowIdentity(row) {
    if (row.envelope_id !== row.idempotency_operation_id || row.envelope_input_digest !== row.idempotency_input_digest ||
        row.envelope_state !== "received")
        invalid("row_identity");
}
export function claimNutritionResolution(input) {
    const authority = pendingAuthority(input, 1);
    text(input.envelope_id, "envelope_id");
    text(input.idempotency_key, "idempotency_key");
    let open = false;
    try {
        input.database.exec("BEGIN IMMEDIATE");
        open = true;
        const row = selectByIdempotency(input.database, input.idempotency_key);
        if (row === undefined) {
            input.database.prepare(`INSERT INTO command_envelopes(
        envelope_id,idempotency_key,input_digest,source_message_id,conversation_id,state,result_status,
        received_at,committed_at,payload_json
      ) VALUES (?, ?, ?, ?, ?, 'received', 'nutrition_resolving', ?, NULL, ?)`)
                .run(input.envelope_id, input.idempotency_key, input.base_input_digest, input.source_message_id, input.conversation_id, input.now, pendingPayload(authority, input.authority_secret));
            input.database.prepare(`INSERT INTO idempotency_records(
        idempotency_key,operation_id,input_digest,state,terminal_result_json,created_at,updated_at
      ) VALUES (?, ?, ?, 'nutrition_resolving', NULL, ?, ?)`)
                .run(input.idempotency_key, input.envelope_id, input.base_input_digest, input.now, input.now);
            input.database.exec("COMMIT");
            open = false;
            return Object.freeze({ kind: "owner", envelope_id: input.envelope_id, owner_nonce: input.owner_nonce, generation: 1 });
        }
        assertRowIdentity(row);
        if (row.result_status === "preview_ready" && row.idempotency_state === "preview_ready") {
            const material = parseFinalPayload(row.payload_json, input.authority_secret);
            if (material.base_input_digest !== input.base_input_digest)
                throw new Error("IDEMPOTENCY_CONFLICT:base_input_digest");
            if (material.operation_id !== input.operation_id || material.source_message_id !== input.source_message_id ||
                material.conversation_id !== input.conversation_id || row.source_message_id !== input.source_message_id ||
                row.conversation_id !== input.conversation_id)
                throw new Error("IDEMPOTENCY_CONFLICT:binding");
            input.database.exec("ROLLBACK");
            open = false;
            return Object.freeze({ kind: "complete", envelope_id: row.envelope_id, material });
        }
        if (row.result_status !== "nutrition_resolving" || row.idempotency_state !== "nutrition_resolving")
            invalid("row_state");
        const stored = parsePendingPayload(row.payload_json, input.authority_secret);
        if (stored.base_input_digest !== input.base_input_digest || row.envelope_input_digest !== input.base_input_digest) {
            throw new Error("IDEMPOTENCY_CONFLICT:base_input_digest");
        }
        if (stored.operation_id !== input.operation_id || stored.source_message_id !== input.source_message_id ||
            stored.conversation_id !== input.conversation_id || row.source_message_id !== input.source_message_id ||
            row.conversation_id !== input.conversation_id)
            throw new Error("IDEMPOTENCY_CONFLICT:binding");
        const remaining = Date.parse(stored.lease_expires_at) - Date.parse(input.now);
        if (remaining > 0) {
            input.database.exec("ROLLBACK");
            open = false;
            return Object.freeze({ kind: "pending", envelope_id: row.envelope_id, retry_after_ms: remaining });
        }
        const next = pendingAuthority(input, stored.generation + 1);
        const updatedEnvelope = input.database.prepare(`UPDATE command_envelopes SET payload_json = ?
      WHERE envelope_id = ? AND payload_json = ? AND result_status = 'nutrition_resolving'`)
            .run(pendingPayload(next, input.authority_secret), row.envelope_id, row.payload_json);
        const updatedIdempotency = input.database.prepare(`UPDATE idempotency_records SET updated_at = ?
      WHERE idempotency_key = ? AND state = 'nutrition_resolving' AND updated_at <= ?`)
            .run(input.now, input.idempotency_key, input.now);
        if (updatedEnvelope.changes !== 1 || updatedIdempotency.changes !== 1)
            invalid("takeover_cas");
        input.database.exec("COMMIT");
        open = false;
        return Object.freeze({ kind: "owner", envelope_id: row.envelope_id, owner_nonce: input.owner_nonce, generation: next.generation });
    }
    catch (error) {
        if (open)
            try {
                input.database.exec("ROLLBACK");
            }
            catch { /* preserve authority error */ }
        throw error;
    }
}
export function completeNutritionResolution(input) {
    timestamp(input.now, "complete_now");
    if (!Number.isSafeInteger(input.generation) || input.generation < 1)
        invalid("complete_generation");
    const material = parseNutritionPreviewMaterialV6(input.material);
    let open = false;
    try {
        input.database.exec("BEGIN IMMEDIATE");
        open = true;
        const row = selectByEnvelope(input.database, input.envelope_id);
        if (row === undefined)
            invalid("complete_missing");
        assertRowIdentity(row);
        if (row.result_status === "preview_ready" && row.idempotency_state === "preview_ready") {
            const winner = parseFinalPayload(row.payload_json, input.authority_secret);
            input.database.exec("ROLLBACK");
            open = false;
            return Object.freeze({ material: winner, won: false });
        }
        const pending = parsePendingPayload(row.payload_json, input.authority_secret);
        if (pending.owner_nonce !== input.owner_nonce || pending.generation !== input.generation) {
            throw new Error("NUTRITION_RESOLUTION_PENDING:owner_changed");
        }
        if (material.base_input_digest !== pending.base_input_digest ||
            material.source_config_digest !== pending.source_config_digest ||
            material.operation_id !== pending.operation_id || material.source_message_id !== pending.source_message_id ||
            material.conversation_id !== pending.conversation_id)
            invalid("complete_binding");
        const payload = finalPayload(material, input.authority_secret);
        const changedEnvelope = input.database.prepare(`UPDATE command_envelopes
      SET result_status = 'preview_ready', payload_json = ?
      WHERE envelope_id = ? AND result_status = 'nutrition_resolving' AND payload_json = ?`)
            .run(payload, input.envelope_id, row.payload_json);
        const changedIdempotency = input.database.prepare(`UPDATE idempotency_records
      SET state = 'preview_ready', updated_at = ?
      WHERE operation_id = ? AND state = 'nutrition_resolving'`)
            .run(input.now, input.envelope_id);
        if (changedEnvelope.changes !== 1 || changedIdempotency.changes !== 1)
            invalid("complete_cas");
        input.database.exec("COMMIT");
        open = false;
        return Object.freeze({ material, won: true });
    }
    catch (error) {
        if (open)
            try {
                input.database.exec("ROLLBACK");
            }
            catch { /* preserve authority error */ }
        throw error;
    }
}
