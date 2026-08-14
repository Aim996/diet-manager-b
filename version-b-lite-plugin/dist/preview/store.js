import { createHmac, timingSafeEqual } from "node:crypto";
import { dietManagerActions, } from "../contracts.js";
import { canonicalJson, canonicalSha256 } from "../authority/canonical-json.js";
import { parseMealFactPreviewMaterial, } from "../authority/meal-fact-identity.js";
import { parseWaterFactPreviewMaterial, } from "../authority/water-fact-identity.js";
import { parsePurchaseFactPreviewMaterial, } from "../authority/purchase-fact-identity.js";
import { parseInventoryAdjustmentFactPreviewMaterial, } from "../authority/inventory-adjustment-fact-identity.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
import { freezePreviewBinding, issuePreviewToken, verifyPreviewToken, } from "./token.js";
const CREATE_FIELDS = [
    "commandType",
    "conversationId",
    "dataRevision",
    "database",
    "idempotencyKey",
    "inputDigest",
    "now",
    "previewId",
    "previewMaterial",
    "secret",
    "sourceMessageId",
    "subjectScope",
];
const AUTHORIZE_FIELDS = [
    "commandType",
    "dataRevision",
    "database",
    "inputDigest",
    "secret",
    "subjectScope",
    "token",
];
const REUSE_FIELDS = [
    "commandType",
    "conversationId",
    "database",
    "idempotencyKey",
    "inputDigest",
    "previewId",
    "previewMaterial",
    "secret",
    "sourceMessageId",
    "subjectScope",
];
function requestInvalid(reason) {
    throw new TypeError(`PREVIEW_REQUEST_INVALID:${reason}`);
}
function authorityInvalid(reason) {
    throw new Error(`PREVIEW_AUTHORITY_INVALID:${reason}`);
}
function exactDataProperties(value, fields) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return requestInvalid("shape");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") ||
        keys.sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
        return requestInvalid("shape");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const field of fields) {
        const descriptor = descriptors[field];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            return requestInvalid("descriptor");
        }
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        return requestInvalid("prototype");
    return descriptors;
}
function visibleAscii(value, field, maxLength = 256) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > maxLength ||
        !/^[\x20-\x7E]+$/.test(value)) {
        return requestInvalid(field);
    }
    return value;
}
function digest(value) {
    if (typeof value !== "string" || !/^[A-F0-9]{64}$/.test(value)) {
        return requestInvalid("input_digest");
    }
    return value;
}
function command(value) {
    if (typeof value !== "string" ||
        !dietManagerActions.includes(value)) {
        return requestInvalid("command_type");
    }
    return value;
}
function database(value) {
    if (typeof value !== "object" || value === null)
        return requestInvalid("database");
    return value;
}
function secret(value) {
    if (!(value instanceof Uint8Array))
        return requestInvalid("secret");
    return Uint8Array.from(value);
}
function isoTimestamp(value) {
    if (typeof value !== "string")
        return requestInvalid("now");
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
        return requestInvalid("now");
    }
    return value;
}
function freezeCreateInput(value) {
    const fields = exactDataProperties(value, CREATE_FIELDS);
    const inputDigest = digest(fields.inputDigest.value);
    const previewMaterial = fields.previewMaterial.value;
    const previewHash = canonicalSha256(previewMaterial);
    let previewMaterialV2;
    let previewMaterialV3;
    let previewMaterialV4;
    let previewMaterialV5;
    if (typeof previewMaterial === "object" && previewMaterial !== null &&
        !Array.isArray(previewMaterial) &&
        previewMaterial.authority_kind ===
            "diet-manager/domain-preview/v2") {
        previewMaterialV2 = parseMealFactPreviewMaterial(previewMaterial);
        if (previewMaterialV2.input_digest !== inputDigest) {
            return requestInvalid("preview_material_input_digest");
        }
    }
    if (typeof previewMaterial === "object" && previewMaterial !== null && !Array.isArray(previewMaterial) &&
        previewMaterial.authority_kind === "diet-manager/domain-preview/v3") {
        previewMaterialV3 = parseWaterFactPreviewMaterial(previewMaterial);
        if (previewMaterialV3.input_digest !== inputDigest)
            return requestInvalid("preview_material_input_digest");
    }
    if (typeof previewMaterial === "object" && previewMaterial !== null && !Array.isArray(previewMaterial) &&
        previewMaterial.authority_kind === "diet-manager/domain-preview/v4") {
        previewMaterialV4 = parsePurchaseFactPreviewMaterial(previewMaterial);
        if (previewMaterialV4.input_digest !== inputDigest)
            return requestInvalid("preview_material_input_digest");
    }
    if (typeof previewMaterial === "object" && previewMaterial !== null && !Array.isArray(previewMaterial) &&
        previewMaterial.authority_kind === "diet-manager/domain-preview/v5") {
        previewMaterialV5 = parseInventoryAdjustmentFactPreviewMaterial(previewMaterial);
        if (previewMaterialV5.input_digest !== inputDigest)
            return requestInvalid("preview_material_input_digest");
    }
    return Object.freeze({
        database: database(fields.database.value),
        secret: secret(fields.secret.value),
        previewId: visibleAscii(fields.previewId.value, "preview_id", 128),
        idempotencyKey: visibleAscii(fields.idempotencyKey.value, "idempotency_key"),
        inputDigest,
        subjectScope: visibleAscii(fields.subjectScope.value, "subject_scope"),
        commandType: command(fields.commandType.value),
        dataRevision: visibleAscii(fields.dataRevision.value, "data_revision"),
        sourceMessageId: visibleAscii(fields.sourceMessageId.value, "source_message_id"),
        conversationId: visibleAscii(fields.conversationId.value, "conversation_id"),
        previewHash,
        ...(previewMaterialV2 === undefined ? {} : { previewMaterialV2 }),
        ...(previewMaterialV3 === undefined ? {} : { previewMaterialV3 }),
        ...(previewMaterialV4 === undefined ? {} : { previewMaterialV4 }),
        ...(previewMaterialV5 === undefined ? {} : { previewMaterialV5 }),
        now: isoTimestamp(fields.now.value),
    });
}
function freezeAuthorizeInput(value) {
    const fields = exactDataProperties(value, AUTHORIZE_FIELDS);
    return Object.freeze({
        database: database(fields.database.value),
        secret: secret(fields.secret.value),
        token: visibleAscii(fields.token.value, "token", 4096),
        inputDigest: digest(fields.inputDigest.value),
        subjectScope: visibleAscii(fields.subjectScope.value, "subject_scope"),
        commandType: command(fields.commandType.value),
        dataRevision: visibleAscii(fields.dataRevision.value, "data_revision"),
    });
}
function freezeReuseInput(value) {
    const fields = exactDataProperties(value, REUSE_FIELDS);
    return Object.freeze({
        database: database(fields.database.value),
        secret: secret(fields.secret.value),
        previewId: visibleAscii(fields.previewId.value, "preview_id", 128),
        idempotencyKey: visibleAscii(fields.idempotencyKey.value, "idempotency_key"),
        inputDigest: digest(fields.inputDigest.value),
        subjectScope: visibleAscii(fields.subjectScope.value, "subject_scope"),
        commandType: command(fields.commandType.value),
        sourceMessageId: visibleAscii(fields.sourceMessageId.value, "source_message_id"),
        conversationId: visibleAscii(fields.conversationId.value, "conversation_id"),
        previewHash: canonicalSha256(fields.previewMaterial.value),
    });
}
function authorityPayload(binding, authoritySecret, material, materialV3, materialV4, materialV5) {
    if (materialV5 !== undefined)
        return canonicalJson({
            authority_kind: "diet-manager/server-preview/v5",
            binding,
            input_digest: materialV5.input_digest,
            inventory_adjustment_fact_identities: materialV5.inventory_adjustment_fact_identities,
            fact_identity_mac: inventoryAdjustmentFactIdentityMac(binding, materialV5, authoritySecret),
        });
    if (materialV4 !== undefined)
        return canonicalJson({
            authority_kind: "diet-manager/server-preview/v4", binding,
            committed_at_base: materialV4.committed_at_base,
            input_digest: materialV4.input_digest,
            meal_fact_identities: materialV4.meal_fact_identities,
            purchase_fact_identities: materialV4.purchase_fact_identities,
            fact_identity_mac: purchaseFactIdentityMac(binding, materialV4, authoritySecret),
        });
    if (materialV3 !== undefined)
        return canonicalJson({
            authority_kind: "diet-manager/server-preview/v3", binding, input_digest: materialV3.input_digest,
            meal_fact_identities: materialV3.meal_fact_identities, water_fact_identities: materialV3.water_fact_identities,
            fact_identity_mac: waterFactIdentityMac(binding, materialV3, authoritySecret),
        });
    return material === undefined
        ? canonicalJson({
            authority_kind: "diet-manager/server-preview/v1",
            binding,
        })
        : canonicalJson({
            authority_kind: "diet-manager/server-preview/v2",
            binding,
            input_digest: material.input_digest,
            meal_fact_identities: material.meal_fact_identities,
            meal_fact_identity_mac: mealFactIdentityMac(binding, material, authoritySecret),
        });
}
function inventoryAdjustmentFactIdentityMac(binding, material, authoritySecret) {
    return createHmac("sha256", secret(authoritySecret))
        .update("diet-manager/fact-preview-authority/v5\n", "ascii")
        .update(canonicalJson({
        authority_kind: "diet-manager/server-preview/v5",
        binding,
        input_digest: material.input_digest,
        inventory_adjustment_fact_identities: material.inventory_adjustment_fact_identities,
    }), "utf8")
        .digest("hex")
        .toUpperCase();
}
function purchaseFactIdentityMac(binding, material, authoritySecret) {
    return createHmac("sha256", secret(authoritySecret))
        .update("diet-manager/fact-preview-authority/v4\n", "ascii")
        .update(canonicalJson({
        authority_kind: "diet-manager/server-preview/v4",
        binding,
        committed_at_base: material.committed_at_base,
        input_digest: material.input_digest,
        meal_fact_identities: material.meal_fact_identities,
        purchase_fact_identities: material.purchase_fact_identities,
    }), "utf8")
        .digest("hex").toUpperCase();
}
function waterFactIdentityMac(binding, material, authoritySecret) {
    return createHmac("sha256", secret(authoritySecret))
        .update("diet-manager/fact-preview-authority/v3\n", "ascii")
        .update(canonicalJson({ authority_kind: "diet-manager/server-preview/v3", binding,
        input_digest: material.input_digest, meal_fact_identities: material.meal_fact_identities,
        water_fact_identities: material.water_fact_identities }), "utf8")
        .digest("hex").toUpperCase();
}
function mealFactIdentityMac(binding, material, authoritySecret) {
    return createHmac("sha256", secret(authoritySecret))
        .update("diet-manager/meal-fact-preview-authority/v1\n", "ascii")
        .update(canonicalJson({
        authority_kind: "diet-manager/server-preview/v2",
        binding,
        input_digest: material.input_digest,
        meal_fact_identities: material.meal_fact_identities,
    }), "utf8")
        .digest("hex")
        .toUpperCase();
}
function storedPreviewAuthority(payloadJson, authoritySecret) {
    let parsed;
    try {
        parsed = JSON.parse(payloadJson);
    }
    catch {
        return authorityInvalid("binding");
    }
    if (canonicalJson(parsed) !== payloadJson)
        return authorityInvalid("binding");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return authorityInvalid("binding");
    }
    const candidate = parsed;
    const keys = Object.keys(candidate).sort().join("\u0000");
    const v1 = candidate.authority_kind === "diet-manager/server-preview/v1" &&
        keys === "authority_kind\u0000binding";
    const v2 = candidate.authority_kind === "diet-manager/server-preview/v2" &&
        keys ===
            "authority_kind\u0000binding\u0000input_digest\u0000meal_fact_identities\u0000meal_fact_identity_mac";
    const v3 = candidate.authority_kind === "diet-manager/server-preview/v3" && keys ===
        "authority_kind\u0000binding\u0000fact_identity_mac\u0000input_digest\u0000meal_fact_identities\u0000water_fact_identities";
    const v4 = candidate.authority_kind === "diet-manager/server-preview/v4" && keys ===
        "authority_kind\u0000binding\u0000committed_at_base\u0000fact_identity_mac\u0000input_digest\u0000meal_fact_identities\u0000purchase_fact_identities";
    const v5 = candidate.authority_kind === "diet-manager/server-preview/v5" && keys ===
        "authority_kind\u0000binding\u0000fact_identity_mac\u0000input_digest\u0000inventory_adjustment_fact_identities";
    if (!v1 && !v2 && !v3 && !v4 && !v5) {
        return authorityInvalid("binding");
    }
    try {
        const binding = freezePreviewBinding(candidate.binding);
        if (v5) {
            const material = parseInventoryAdjustmentFactPreviewMaterial({
                authority_kind: "diet-manager/domain-preview/v5",
                input_digest: candidate.input_digest,
                inventory_adjustment_fact_identities: candidate.inventory_adjustment_fact_identities,
            });
            if (binding.input_digest !== material.input_digest ||
                binding.preview_hash !== canonicalSha256(material) ||
                typeof candidate.fact_identity_mac !== "string" ||
                !/^[A-F0-9]{64}$/.test(candidate.fact_identity_mac))
                return authorityInvalid("fact_identity_mac");
            const supplied = Buffer.from(candidate.fact_identity_mac, "hex");
            const expected = Buffer.from(inventoryAdjustmentFactIdentityMac(binding, material, authoritySecret), "hex");
            if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
                return authorityInvalid("fact_identity_mac");
            }
            return Object.freeze({
                binding,
                preview_authority_kind: "diet-manager/server-preview/v5",
                inventory_adjustment_fact_preview_material: material,
            });
        }
        if (v4) {
            const material = parsePurchaseFactPreviewMaterial({
                authority_kind: "diet-manager/domain-preview/v4",
                committed_at_base: candidate.committed_at_base,
                input_digest: candidate.input_digest,
                meal_fact_identities: candidate.meal_fact_identities,
                purchase_fact_identities: candidate.purchase_fact_identities,
            });
            if (binding.input_digest !== material.input_digest || binding.preview_hash !== canonicalSha256(material) ||
                typeof candidate.fact_identity_mac !== "string" || !/^[A-F0-9]{64}$/.test(candidate.fact_identity_mac)) {
                return authorityInvalid("fact_identity_mac");
            }
            const supplied = Buffer.from(candidate.fact_identity_mac, "hex");
            const expected = Buffer.from(purchaseFactIdentityMac(binding, material, authoritySecret), "hex");
            if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
                return authorityInvalid("fact_identity_mac");
            }
            return Object.freeze({
                binding,
                preview_authority_kind: "diet-manager/server-preview/v4",
                purchase_fact_preview_material: material,
            });
        }
        if (v3) {
            const material = parseWaterFactPreviewMaterial({ authority_kind: "diet-manager/domain-preview/v3",
                input_digest: candidate.input_digest, meal_fact_identities: candidate.meal_fact_identities,
                water_fact_identities: candidate.water_fact_identities });
            if (binding.input_digest !== material.input_digest || binding.preview_hash !== canonicalSha256(material) ||
                typeof candidate.fact_identity_mac !== "string" || !/^[A-F0-9]{64}$/.test(candidate.fact_identity_mac))
                return authorityInvalid("fact_identity_mac");
            const supplied = Buffer.from(candidate.fact_identity_mac, "hex");
            const expected = Buffer.from(waterFactIdentityMac(binding, material, authoritySecret), "hex");
            if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
                return authorityInvalid("fact_identity_mac");
            return Object.freeze({ binding, preview_authority_kind: "diet-manager/server-preview/v3", water_fact_preview_material: material });
        }
        if (v2) {
            const material = parseMealFactPreviewMaterial({
                authority_kind: "diet-manager/domain-preview/v2",
                input_digest: candidate.input_digest,
                meal_fact_identities: candidate.meal_fact_identities,
            });
            if (binding.input_digest !== material.input_digest ||
                binding.preview_hash !== canonicalSha256(material))
                return authorityInvalid("binding");
            if (typeof candidate.meal_fact_identity_mac !== "string" ||
                !/^[A-F0-9]{64}$/.test(candidate.meal_fact_identity_mac))
                return authorityInvalid("meal_fact_identity_mac");
            const suppliedMac = Buffer.from(candidate.meal_fact_identity_mac, "hex");
            const expectedMac = Buffer.from(mealFactIdentityMac(binding, material, authoritySecret), "hex");
            if (suppliedMac.length !== expectedMac.length ||
                !timingSafeEqual(suppliedMac, expectedMac))
                return authorityInvalid("meal_fact_identity_mac");
            return Object.freeze({
                binding,
                preview_authority_kind: "diet-manager/server-preview/v2",
                meal_fact_preview_material: material,
            });
        }
        return Object.freeze({
            binding,
            preview_authority_kind: "diet-manager/server-preview/v1",
        });
    }
    catch {
        return authorityInvalid("binding");
    }
}
export function authenticateStoredPreviewAuthority(payloadJson, authoritySecret) {
    return storedPreviewAuthority(payloadJson, secret(authoritySecret));
}
function storedBinding(payloadJson, authoritySecret) {
    return storedPreviewAuthority(payloadJson, authoritySecret).binding;
}
function findAuthorityByIdempotencyKey(database, idempotencyKey) {
    return database
        .prepare(`SELECT
        e.envelope_id,
        e.idempotency_key AS envelope_idempotency_key,
        e.input_digest AS envelope_input_digest,
        e.state AS envelope_state,
        e.result_status,
        e.committed_at,
        e.source_message_id,
        e.conversation_id,
        e.payload_json,
        i.idempotency_key,
        i.operation_id,
        i.input_digest AS idempotency_input_digest,
        i.state AS idempotency_state,
        i.terminal_result_json
      FROM idempotency_records i
      LEFT JOIN command_envelopes e ON e.envelope_id = i.operation_id
      WHERE i.idempotency_key = ?`)
        .get(idempotencyKey);
}
function findAuthorityByPreviewId(database, previewId) {
    return database
        .prepare(`SELECT
        e.envelope_id,
        e.idempotency_key AS envelope_idempotency_key,
        e.input_digest AS envelope_input_digest,
        e.state AS envelope_state,
        e.result_status,
        e.committed_at,
        e.source_message_id,
        e.conversation_id,
        e.payload_json,
        i.idempotency_key,
        i.operation_id,
        i.input_digest AS idempotency_input_digest,
        i.state AS idempotency_state,
        i.terminal_result_json
      FROM command_envelopes e
      LEFT JOIN idempotency_records i ON i.operation_id = e.envelope_id
      WHERE e.envelope_id = ?`)
        .get(previewId);
}
function assertPreviewReadyRow(row) {
    if (!row || !row.envelope_id || !row.idempotency_key)
        return authorityInvalid("missing");
    if (row.envelope_id !== row.operation_id ||
        row.envelope_idempotency_key !== row.idempotency_key ||
        row.envelope_input_digest !== row.idempotency_input_digest) {
        return authorityInvalid("identity");
    }
    if (row.envelope_state !== "received" ||
        row.result_status !== "preview_ready" ||
        row.committed_at !== null ||
        row.idempotency_state !== "preview_ready" ||
        row.terminal_result_json !== null) {
        return authorityInvalid("state");
    }
    return row;
}
function assertPreviewIdentityConflicts(row, binding, inputDigest, subjectScope, commandType) {
    if (row.idempotency_input_digest !== inputDigest) {
        throw new Error("IDEMPOTENCY_CONFLICT:input_digest");
    }
    if (binding.subject_scope !== subjectScope) {
        throw new Error("IDEMPOTENCY_CONFLICT:subject_scope");
    }
    if (binding.command_type !== commandType) {
        throw new Error("IDEMPOTENCY_CONFLICT:command_type");
    }
}
function isTerminalAuthorityCandidate(row) {
    return (row.envelope_state === "finalized" &&
        row.idempotency_state === "finalized" &&
        typeof row.terminal_result_json === "string" &&
        row.terminal_result_json.length > 0);
}
function reuseFinalizedPreview(row, input) {
    if (!isTerminalAuthorityCandidate(row))
        return undefined;
    const authority = assertRepositoryAuthorityRow(row, input.secret);
    if (authority.envelope_state !== "finalized")
        return authorityInvalid("state");
    if (row.envelope_id !== input.previewId) {
        throw new Error("IDEMPOTENCY_CONFLICT:preview_id");
    }
    if (authority.idempotency_key !== input.idempotencyKey) {
        throw new Error("IDEMPOTENCY_CONFLICT:idempotency_key");
    }
    if (row.source_message_id !== input.sourceMessageId) {
        throw new Error("IDEMPOTENCY_CONFLICT:source_message_id");
    }
    if (row.conversation_id !== input.conversationId) {
        throw new Error("IDEMPOTENCY_CONFLICT:conversation_id");
    }
    assertPreviewIdentityConflicts(row, authority.binding, input.inputDigest, input.subjectScope, input.commandType);
    if (authority.binding.preview_hash !== input.previewHash) {
        throw new Error("PREVIEW_CONFLICT:preview_hash");
    }
    return Object.freeze({
        binding: authority.binding,
        token: issuePreviewToken(authority.binding, input.secret),
        reused: true,
    });
}
function bindingEquals(left, right) {
    return canonicalJson(left) === canonicalJson(right);
}
function assertRepositoryAuthorityRow(row, authoritySecret, expectedBinding) {
    if (!row || !row.envelope_id || !row.idempotency_key) {
        return authorityInvalid("missing");
    }
    if (row.envelope_id !== row.operation_id ||
        row.envelope_idempotency_key !== row.idempotency_key ||
        row.envelope_input_digest !== row.idempotency_input_digest) {
        return authorityInvalid("identity");
    }
    const previewReady = row.envelope_state === "received" &&
        row.result_status === "preview_ready" &&
        row.committed_at === null &&
        row.idempotency_state === "preview_ready" &&
        row.terminal_result_json === null;
    const factsCommitted = row.envelope_state === "effects_pending" &&
        row.result_status === "facts_committed_effects_pending" &&
        typeof row.committed_at === "string" &&
        row.committed_at.length > 0 &&
        row.idempotency_state === "effects_pending" &&
        row.terminal_result_json === null;
    const effectsStable = row.envelope_state === "effects_stable" &&
        row.result_status === "effects_stable" &&
        typeof row.committed_at === "string" &&
        row.committed_at.length > 0 &&
        row.idempotency_state === "effects_stable" &&
        row.terminal_result_json === null;
    const finalized = row.envelope_state === "finalized" &&
        (row.result_status === "committed" ||
            row.result_status === "committed_with_issues") &&
        typeof row.committed_at === "string" &&
        row.committed_at.length > 0 &&
        row.idempotency_state === "finalized" &&
        typeof row.terminal_result_json === "string" &&
        row.terminal_result_json.length > 0;
    if (!previewReady && !factsCommitted && !effectsStable && !finalized) {
        return authorityInvalid("state");
    }
    const previewAuthority = storedPreviewAuthority(row.payload_json, authoritySecret);
    const binding = previewAuthority.binding;
    if (binding.preview_id !== row.envelope_id ||
        binding.input_digest !== row.envelope_input_digest ||
        (expectedBinding !== undefined && !bindingEquals(binding, expectedBinding))) {
        return authorityInvalid("binding");
    }
    return {
        binding,
        idempotency_key: row.idempotency_key,
        preview_authority_kind: previewAuthority.preview_authority_kind,
        ...(previewAuthority.meal_fact_preview_material === undefined
            ? {}
            : { meal_fact_preview_material: previewAuthority.meal_fact_preview_material }),
        ...(previewAuthority.water_fact_preview_material === undefined
            ? {}
            : { water_fact_preview_material: previewAuthority.water_fact_preview_material }),
        ...(previewAuthority.purchase_fact_preview_material === undefined
            ? {}
            : { purchase_fact_preview_material: previewAuthority.purchase_fact_preview_material }),
        ...(previewAuthority.inventory_adjustment_fact_preview_material === undefined
            ? {}
            : {
                inventory_adjustment_fact_preview_material: previewAuthority.inventory_adjustment_fact_preview_material,
            }),
        envelope_state: previewReady
            ? "received"
            : finalized
                ? "finalized"
                : effectsStable
                    ? "effects_stable"
                    : "effects_pending",
        result_status: previewReady
            ? "preview_ready"
            : finalized
                ? row.result_status
                : effectsStable
                    ? "effects_stable"
                    : "facts_committed_effects_pending",
    };
}
export function reuseServerPreview(input) {
    const frozen = freezeReuseInput(input);
    assertCurrentMigrationAuthority(frozen.database);
    const existing = findAuthorityByIdempotencyKey(frozen.database, frozen.idempotencyKey);
    if (!existing)
        return undefined;
    const finalized = reuseFinalizedPreview(existing, frozen);
    if (finalized !== undefined)
        return finalized;
    const row = assertPreviewReadyRow(existing);
    const binding = storedBinding(row.payload_json, frozen.secret);
    if (row.envelope_id !== frozen.previewId)
        throw new Error("IDEMPOTENCY_CONFLICT:preview_id");
    if (row.idempotency_input_digest !== frozen.inputDigest) {
        throw new Error("IDEMPOTENCY_CONFLICT:input_digest");
    }
    if (row.source_message_id !== frozen.sourceMessageId) {
        throw new Error("IDEMPOTENCY_CONFLICT:source_message_id");
    }
    if (row.conversation_id !== frozen.conversationId) {
        throw new Error("IDEMPOTENCY_CONFLICT:conversation_id");
    }
    if (binding.input_digest !== frozen.inputDigest)
        return authorityInvalid("binding");
    if (binding.subject_scope !== frozen.subjectScope) {
        throw new Error("IDEMPOTENCY_CONFLICT:subject_scope");
    }
    if (binding.command_type !== frozen.commandType) {
        throw new Error("IDEMPOTENCY_CONFLICT:command_type");
    }
    if (binding.preview_hash !== frozen.previewHash) {
        throw new Error("PREVIEW_CONFLICT:preview_hash");
    }
    return Object.freeze({
        binding,
        token: issuePreviewToken(binding, frozen.secret),
        reused: true,
    });
}
export function createServerPreview(input, fault) {
    if (fault !== undefined && fault !== "after_envelope") {
        return requestInvalid("fault");
    }
    const frozen = freezeCreateInput(input);
    const candidateBinding = freezePreviewBinding({
        preview_id: frozen.previewId,
        preview_version: 1,
        preview_hash: frozen.previewHash,
        input_digest: frozen.inputDigest,
        subject_scope: frozen.subjectScope,
        command_type: frozen.commandType,
        data_revision: frozen.dataRevision,
    });
    const candidateToken = issuePreviewToken(candidateBinding, frozen.secret);
    let transactionOpen = false;
    try {
        frozen.database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        assertCurrentMigrationAuthority(frozen.database);
        const existing = findAuthorityByIdempotencyKey(frozen.database, frozen.idempotencyKey);
        if (existing) {
            const finalized = reuseFinalizedPreview(existing, frozen);
            if (finalized !== undefined) {
                frozen.database.exec("ROLLBACK");
                transactionOpen = false;
                return finalized;
            }
            const row = assertPreviewReadyRow(existing);
            const originalBinding = storedBinding(row.payload_json, frozen.secret);
            if (row.idempotency_input_digest !== frozen.inputDigest) {
                throw new Error("IDEMPOTENCY_CONFLICT:input_digest");
            }
            if (originalBinding.subject_scope !== frozen.subjectScope) {
                throw new Error("IDEMPOTENCY_CONFLICT:subject_scope");
            }
            if (originalBinding.command_type !== frozen.commandType) {
                throw new Error("IDEMPOTENCY_CONFLICT:command_type");
            }
            if (originalBinding.preview_hash !== frozen.previewHash) {
                throw new Error("PREVIEW_CONFLICT:preview_hash");
            }
            if (originalBinding.data_revision !== frozen.dataRevision) {
                throw new Error("PREVIEW_STALE:data_revision");
            }
            if (originalBinding.input_digest !== frozen.inputDigest) {
                return authorityInvalid("binding");
            }
            frozen.database.exec("ROLLBACK");
            transactionOpen = false;
            return Object.freeze({
                binding: originalBinding,
                token: issuePreviewToken(originalBinding, frozen.secret),
                reused: true,
            });
        }
        frozen.database
            .prepare(`INSERT INTO command_envelopes(
          envelope_id, idempotency_key, input_digest, source_message_id,
          conversation_id, state, result_status, received_at, committed_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, 'received', 'preview_ready', ?, NULL, ?)`)
            .run(candidateBinding.preview_id, frozen.idempotencyKey, frozen.inputDigest, frozen.sourceMessageId, frozen.conversationId, frozen.now, authorityPayload(candidateBinding, frozen.secret, frozen.previewMaterialV2, frozen.previewMaterialV3, frozen.previewMaterialV4, frozen.previewMaterialV5));
        if (fault === "after_envelope") {
            throw new Error("PREVIEW_STORE_FAILED:after_envelope");
        }
        frozen.database
            .prepare(`INSERT INTO idempotency_records(
          idempotency_key, operation_id, input_digest, state,
          terminal_result_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'preview_ready', NULL, ?, ?)`)
            .run(frozen.idempotencyKey, candidateBinding.preview_id, frozen.inputDigest, frozen.now, frozen.now);
        frozen.database.exec("COMMIT");
        transactionOpen = false;
        return Object.freeze({
            binding: candidateBinding,
            token: candidateToken,
            reused: false,
        });
    }
    catch (error) {
        if (transactionOpen) {
            try {
                frozen.database.exec("ROLLBACK");
            }
            catch {
                // The original authority failure remains primary.
            }
        }
        throw error;
    }
}
export function authorizeServerPreview(input) {
    const frozen = freezeAuthorizeInput(input);
    assertCurrentMigrationAuthority(frozen.database);
    const tokenBinding = verifyPreviewToken(frozen.token, frozen.secret);
    if (tokenBinding.input_digest !== frozen.inputDigest) {
        throw new Error("PREVIEW_BINDING_MISMATCH:input_digest");
    }
    if (tokenBinding.subject_scope !== frozen.subjectScope) {
        throw new Error("PREVIEW_BINDING_MISMATCH:subject_scope");
    }
    if (tokenBinding.command_type !== frozen.commandType) {
        throw new Error("PREVIEW_BINDING_MISMATCH:command_type");
    }
    if (tokenBinding.data_revision !== frozen.dataRevision) {
        throw new Error("PREVIEW_STALE:data_revision");
    }
    const row = assertPreviewReadyRow(findAuthorityByPreviewId(frozen.database, tokenBinding.preview_id));
    const authoritativeBinding = storedBinding(row.payload_json, frozen.secret);
    if (!bindingEquals(authoritativeBinding, tokenBinding)) {
        return authorityInvalid("binding");
    }
    if (row.envelope_input_digest !== tokenBinding.input_digest) {
        return authorityInvalid("identity");
    }
    return Object.freeze({
        binding: authoritativeBinding,
        idempotency_key: row.idempotency_key,
        envelope_state: "received",
        result_status: "preview_ready",
    });
}
export function authorizeRepositoryPreview(input) {
    const frozen = freezeAuthorizeInput(input);
    assertCurrentMigrationAuthority(frozen.database);
    const tokenBinding = verifyPreviewToken(frozen.token, frozen.secret);
    if (tokenBinding.input_digest !== frozen.inputDigest) {
        throw new Error("PREVIEW_BINDING_MISMATCH:input_digest");
    }
    if (tokenBinding.subject_scope !== frozen.subjectScope) {
        throw new Error("PREVIEW_BINDING_MISMATCH:subject_scope");
    }
    if (tokenBinding.command_type !== frozen.commandType) {
        throw new Error("PREVIEW_BINDING_MISMATCH:command_type");
    }
    if (tokenBinding.data_revision !== frozen.dataRevision) {
        throw new Error("PREVIEW_STALE:data_revision");
    }
    const row = findAuthorityByPreviewId(frozen.database, tokenBinding.preview_id);
    const authority = assertRepositoryAuthorityRow(row, frozen.secret, tokenBinding);
    return Object.freeze({
        binding: authority.binding,
        idempotency_key: authority.idempotency_key,
        preview_authority_kind: authority.preview_authority_kind,
        ...(authority.meal_fact_preview_material === undefined
            ? {}
            : { meal_fact_preview_material: authority.meal_fact_preview_material }),
        ...(authority.water_fact_preview_material === undefined
            ? {}
            : { water_fact_preview_material: authority.water_fact_preview_material }),
        ...(authority.purchase_fact_preview_material === undefined
            ? {}
            : { purchase_fact_preview_material: authority.purchase_fact_preview_material }),
        ...(authority.inventory_adjustment_fact_preview_material === undefined
            ? {}
            : {
                inventory_adjustment_fact_preview_material: authority.inventory_adjustment_fact_preview_material,
            }),
        envelope_state: authority.envelope_state,
        result_status: authority.result_status,
    });
}
