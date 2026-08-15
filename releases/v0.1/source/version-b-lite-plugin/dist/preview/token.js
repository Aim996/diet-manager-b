import { createHmac, timingSafeEqual } from "node:crypto";
import { dietManagerActions, } from "../contracts.js";
import { canonicalJson } from "../authority/canonical-json.js";
const TOKEN_PREFIX = "dm-b-preview-v1";
const BINDING_FIELDS = [
    "command_type",
    "data_revision",
    "input_digest",
    "preview_hash",
    "preview_id",
    "preview_version",
    "subject_scope",
];
function tokenInvalid(reason) {
    throw new TypeError(`PREVIEW_TOKEN_INVALID:${reason}`);
}
function bindingInvalid(reason) {
    throw new TypeError(`PREVIEW_BINDING_INVALID:${reason}`);
}
function assertVisibleAscii(value, field, maxLength) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > maxLength ||
        !/^[\x20-\x7E]+$/.test(value)) {
        return bindingInvalid(field);
    }
    return value;
}
export function freezePreviewBinding(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return bindingInvalid("shape");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") ||
        keys.sort().join("\u0000") !== BINDING_FIELDS.join("\u0000")) {
        return bindingInvalid("shape");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const field of BINDING_FIELDS) {
        const descriptor = descriptors[field];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            return bindingInvalid("descriptor");
        }
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return bindingInvalid("prototype");
    }
    const previewId = assertVisibleAscii(descriptors.preview_id.value, "preview_id", 128);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(previewId)) {
        return bindingInvalid("preview_id");
    }
    if (descriptors.preview_version.value !== 1) {
        return bindingInvalid("preview_version");
    }
    const previewHash = descriptors.preview_hash.value;
    if (typeof previewHash !== "string" || !/^[A-F0-9]{64}$/.test(previewHash)) {
        return bindingInvalid("preview_hash");
    }
    const inputDigest = descriptors.input_digest.value;
    if (typeof inputDigest !== "string" || !/^[A-F0-9]{64}$/.test(inputDigest)) {
        return bindingInvalid("input_digest");
    }
    const subjectScope = assertVisibleAscii(descriptors.subject_scope.value, "subject_scope", 256);
    const commandType = descriptors.command_type.value;
    if (typeof commandType !== "string" ||
        !dietManagerActions.includes(commandType)) {
        return bindingInvalid("command_type");
    }
    const dataRevision = assertVisibleAscii(descriptors.data_revision.value, "data_revision", 256);
    return Object.freeze({
        preview_id: previewId,
        preview_version: 1,
        preview_hash: previewHash,
        input_digest: inputDigest,
        subject_scope: subjectScope,
        command_type: commandType,
        data_revision: dataRevision,
    });
}
function freezeSecret(secret) {
    if (!(secret instanceof Uint8Array) || secret.byteLength < 32 || secret.byteLength > 1024) {
        return tokenInvalid("secret");
    }
    return Buffer.from(secret);
}
function signature(signingInput, secret) {
    return createHmac("sha256", secret).update(signingInput, "ascii").digest();
}
function decodeCanonicalBase64Url(value, reason) {
    if (!/^[A-Za-z0-9_-]+$/.test(value))
        return tokenInvalid(reason);
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length === 0 || decoded.toString("base64url") !== value) {
        return tokenInvalid(reason);
    }
    return decoded;
}
export function issuePreviewToken(binding, secret) {
    const frozenBinding = freezePreviewBinding(binding);
    const key = freezeSecret(secret);
    const payload = Buffer.from(canonicalJson(frozenBinding), "utf8").toString("base64url");
    const signingInput = `${TOKEN_PREFIX}.${payload}`;
    return `${signingInput}.${signature(signingInput, key).toString("base64url")}`;
}
export function verifyPreviewToken(token, secret) {
    if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
        return tokenInvalid("format");
    }
    const segments = token.split(".");
    if (segments.length !== 3 || segments[0] !== TOKEN_PREFIX) {
        return tokenInvalid("format");
    }
    const payloadBytes = decodeCanonicalBase64Url(segments[1], "payload");
    if (payloadBytes.length > 2048)
        return tokenInvalid("payload");
    const suppliedSignature = decodeCanonicalBase64Url(segments[2], "signature");
    const key = freezeSecret(secret);
    const expectedSignature = signature(`${segments[0]}.${segments[1]}`, key);
    if (suppliedSignature.length !== expectedSignature.length ||
        !timingSafeEqual(suppliedSignature, expectedSignature)) {
        return tokenInvalid("signature");
    }
    const payloadText = payloadBytes.toString("utf8");
    let parsed;
    try {
        parsed = JSON.parse(payloadText);
    }
    catch {
        return tokenInvalid("payload");
    }
    const frozenBinding = freezePreviewBinding(parsed);
    if (canonicalJson(frozenBinding) !== payloadText) {
        return tokenInvalid("canonical");
    }
    return frozenBinding;
}
