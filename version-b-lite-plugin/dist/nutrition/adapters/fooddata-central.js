import { freezeNutritionData, } from "../types.js";
const CAPABILITY = freezeNutritionData({
    source_id: "public.usda_fooddata_central",
    tier: "authoritative_public_database",
    rank: 4,
    backend_id: "fooddata-central",
    backend_version: "api-v1",
    network: true,
    request_fields: ["normalized_food_name", "processing_state", "minimum_food_category", "locale"],
});
export class FoodDataCentralAdapter {
    #transport;
    #credentialRef;
    constructor(transport, credentialRef) {
        if (credentialRef.length === 0)
            throw new TypeError("NUTRITION_ADAPTER_INVALID:credential_ref");
        this.#transport = transport;
        this.#credentialRef = credentialRef;
    }
    describe() { return CAPABILITY; }
    async probe(context) {
        const credential = context.credential(this.#credentialRef);
        if (credential === undefined)
            return freezeNutritionData({ source_id: CAPABILITY.source_id, status: "missing", reason: "credential_missing" });
        try {
            const ok = await this.#transport.probe({ signal: context.signal, credential: new Uint8Array(credential.value) });
            return freezeNutritionData({ source_id: CAPABILITY.source_id, status: ok ? "ok" : "broken", reason: ok ? null : "source_unavailable" });
        }
        catch {
            return freezeNutritionData({ source_id: CAPABILITY.source_id, status: context.signal.aborted ? "timeout" : "error", reason: "source_unavailable" });
        }
    }
    async resolve(request, context) {
        const credential = context.credential(this.#credentialRef);
        if (credential === undefined)
            return freezeNutritionData({
                status: "auth_failed", source_id: CAPABILITY.source_id, tier: CAPABILITY.tier,
                source_record_id: null, source_version: null, retained_fields_sha256: null,
                evidence: null, reason: "credential_missing",
            });
        try {
            return freezeNutritionData(await this.#transport.resolve({
                request: freezeNutritionData(request),
                signal: context.signal,
                credential: new Uint8Array(credential.value),
            }));
        }
        catch {
            return freezeNutritionData({
                status: context.signal.aborted ? "timeout" : "error", source_id: CAPABILITY.source_id,
                tier: CAPABILITY.tier, source_record_id: null, source_version: null,
                retained_fields_sha256: null, evidence: null, reason: "source_unavailable",
            });
        }
    }
}
