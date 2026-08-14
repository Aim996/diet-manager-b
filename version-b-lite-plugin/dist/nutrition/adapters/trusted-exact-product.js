import { freezeNutritionData, SOURCE_TIER_RANK, } from "../types.js";
export class TrustedExactProductAdapter {
    #registration;
    #transport;
    #capability;
    constructor(registration, transport) {
        const tier = registration.source_id === "conditional.manufacturer_exact"
            ? "manufacturer_or_exact_product"
            : "allowlisted_trusted_internet";
        this.#registration = registration;
        this.#transport = transport;
        this.#capability = freezeNutritionData({
            source_id: registration.source_id,
            tier,
            rank: SOURCE_TIER_RANK[tier],
            backend_id: registration.backend_id,
            backend_version: registration.backend_version,
            network: true,
            request_fields: [...registration.request_fields],
        });
    }
    describe() { return this.#capability; }
    #credential(context) {
        if (this.#registration.credential_ref === null)
            return undefined;
        const capability = context.credential(this.#registration.credential_ref);
        return capability === undefined ? undefined : new Uint8Array(capability.value);
    }
    async probe(context) {
        if (!this.#registration.enabled)
            return freezeNutritionData({ source_id: this.#capability.source_id, status: "missing", reason: "source_disabled" });
        try {
            const ok = await this.#transport.probe({ signal: context.signal, credential: this.#credential(context) });
            return freezeNutritionData({ source_id: this.#capability.source_id, status: ok ? "ok" : "broken", reason: ok ? null : "source_unavailable" });
        }
        catch {
            return freezeNutritionData({ source_id: this.#capability.source_id, status: context.signal.aborted ? "timeout" : "error", reason: "source_unavailable" });
        }
    }
    async resolve(request, context) {
        if (!this.#registration.enabled)
            return freezeNutritionData({
                status: "source_disabled", source_id: this.#capability.source_id, tier: this.#capability.tier,
                source_record_id: null, source_version: null, retained_fields_sha256: null,
                evidence: null, reason: "source_disabled",
            });
        try {
            return freezeNutritionData(await this.#transport.resolve({
                request: freezeNutritionData(request), signal: context.signal, credential: this.#credential(context),
            }));
        }
        catch {
            return freezeNutritionData({
                status: context.signal.aborted ? "timeout" : "error", source_id: this.#capability.source_id,
                tier: this.#capability.tier, source_record_id: null, source_version: null,
                retained_fields_sha256: null, evidence: null, reason: "source_unavailable",
            });
        }
    }
}
