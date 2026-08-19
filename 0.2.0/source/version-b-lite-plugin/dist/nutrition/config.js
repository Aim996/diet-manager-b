import { isProxy } from "node:util/types";
import { canonicalSha256 } from "../authority/canonical-json.js";
import { assertV1NutritionSource, freezeNutritionData, REGISTERED_SOURCE_TIERS, SOURCE_TIER_RANK, } from "./types.js";
const DEFAULT_POLICY_VERSION = "2026-08-09.1";
const DEFAULT_DEADLINE_MS = 2_000;
function invalid(reason) {
    throw new TypeError(`NUTRITION_CONFIG_INVALID:${reason}`);
}
function descriptors(value, allowed, required, path) {
    if (typeof value !== "object" || value === null)
        return invalid(`${path}:shape`);
    if (isProxy(value))
        return invalid("proxy");
    if (Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
        return invalid(`${path}:shape`);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || !allowed.includes(key)) ||
        required.some((key) => !keys.includes(key)))
        return invalid(`${path}:keys`);
    const result = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
        const descriptor = result[key];
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
            return invalid(`${path}.${key}:descriptor`);
        }
    }
    return result;
}
function cloneCredentialRefs(value) {
    if (typeof value !== "object" || value === null)
        return invalid("credential_refs:shape");
    if (isProxy(value))
        return invalid("proxy");
    if (Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
        return invalid("credential_refs:shape");
    const keys = Reflect.ownKeys(value);
    const sourceIds = keys.map((key) => {
        if (typeof key !== "string" || REGISTERED_SOURCE_TIERS[key] === undefined)
            return invalid("credential_refs:key");
        return key;
    });
    const all = Object.getOwnPropertyDescriptors(value);
    const copy = {};
    for (const sourceId of sourceIds) {
        const descriptor = all[sourceId];
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true ||
            typeof descriptor.value !== "string" || descriptor.value.length === 0 || descriptor.value.length > 128 ||
            /[\u0000-\u001F\u007F]/u.test(descriptor.value))
            return invalid(`credential_refs.${sourceId}`);
        copy[sourceId] = descriptor.value;
    }
    return Object.freeze(copy);
}
function cloneSources(value, refs) {
    if (typeof value !== "object" || value === null)
        return invalid("sources:shape");
    if (isProxy(value))
        return invalid("proxy");
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 32) {
        return invalid("sources:shape");
    }
    const seen = new Set();
    const entries = value.map((entry, index) => {
        const data = descriptors(entry, ["source_id", "enabled", "backend_id", "backend_version"], ["source_id", "enabled", "backend_id", "backend_version"], `sources.${index}`);
        const sourceId = data.source_id?.value;
        const enabled = data.enabled?.value;
        const backendId = data.backend_id?.value;
        const backendVersion = data.backend_version?.value;
        if (typeof sourceId !== "string" || REGISTERED_SOURCE_TIERS[sourceId] === undefined || seen.has(sourceId)) {
            return invalid(`sources.${index}.source_id`);
        }
        assertV1NutritionSource(sourceId);
        if (typeof enabled !== "boolean" || typeof backendId !== "string" || backendId.length === 0 || backendId.length > 128 ||
            typeof backendVersion !== "string" || backendVersion.length === 0 || backendVersion.length > 128) {
            return invalid(`sources.${index}:value`);
        }
        seen.add(sourceId);
        return Object.freeze({
            source_id: sourceId,
            enabled,
            backend_id: backendId,
            backend_version: backendVersion,
            credential_ref: refs[sourceId] ?? null,
        });
    });
    entries.sort((left, right) => {
        const rank = SOURCE_TIER_RANK[REGISTERED_SOURCE_TIERS[left.source_id]] -
            SOURCE_TIER_RANK[REGISTERED_SOURCE_TIERS[right.source_id]];
        return rank === 0 ? left.source_id.localeCompare(right.source_id, "en") : rank;
    });
    return Object.freeze(entries);
}
export function cloneNutritionRuntimeConfig(value) {
    if (value === undefined) {
        return cloneNutritionRuntimeConfig({
            policy_version: DEFAULT_POLICY_VERSION,
            resolution_deadline_ms: DEFAULT_DEADLINE_MS,
            sources: [],
        });
    }
    if (isProxy(value))
        return invalid("proxy");
    const data = descriptors(value, ["policy_version", "resolution_deadline_ms", "sources", "credential_refs"], ["policy_version", "sources"], "config");
    const policyVersion = data.policy_version?.value;
    const deadline = data.resolution_deadline_ms?.value ?? DEFAULT_DEADLINE_MS;
    if (typeof policyVersion !== "string" || policyVersion.length === 0 || policyVersion.length > 64 ||
        !Number.isInteger(deadline) || deadline < 500 || deadline > 5_000)
        return invalid("policy");
    const refs = data.credential_refs === undefined ? Object.freeze({}) : cloneCredentialRefs(data.credential_refs.value);
    const sources = cloneSources(data.sources?.value, refs);
    const digestMaterial = {
        policy_version: policyVersion,
        resolution_deadline_ms: deadline,
        sources: sources.map((entry) => ({
            source_id: entry.source_id,
            enabled: entry.enabled,
            backend_id: entry.backend_id,
            backend_version: entry.backend_version,
            credential_configured: entry.credential_ref !== null,
        })),
    };
    return freezeNutritionData({
        policy_version: policyVersion,
        resolution_deadline_ms: deadline,
        source_config_digest: canonicalSha256(digestMaterial),
        sources,
    });
}
