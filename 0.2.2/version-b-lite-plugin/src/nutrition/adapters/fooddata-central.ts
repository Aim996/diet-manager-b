import {
  freezeNutritionData,
  type NutritionSourceAdapter,
  type SourceCapability,
  type SourceContext,
  type SourceHealth,
  type SourceRequest,
  type SourceResolution,
} from "../types.js";

export interface FoodDataCentralTransport {
  probe(input: Readonly<{ signal: AbortSignal; credential: Uint8Array }>): Promise<boolean>;
  resolve(input: Readonly<{
    request: Readonly<SourceRequest>;
    signal: AbortSignal;
    credential: Uint8Array;
  }>): Promise<Readonly<SourceResolution>>;
}

const CAPABILITY: Readonly<SourceCapability> = freezeNutritionData({
  source_id: "public.usda_fooddata_central",
  tier: "authoritative_public_database",
  rank: 4,
  backend_id: "fooddata-central",
  backend_version: "api-v1",
  network: true,
  request_fields: ["normalized_food_name", "processing_state", "minimum_food_category", "locale"],
});

export class FoodDataCentralAdapter implements NutritionSourceAdapter {
  readonly #transport: FoodDataCentralTransport;
  readonly #credentialRef: string;

  constructor(transport: FoodDataCentralTransport, credentialRef: string) {
    if (credentialRef.length === 0) throw new TypeError("NUTRITION_ADAPTER_INVALID:credential_ref");
    this.#transport = transport;
    this.#credentialRef = credentialRef;
  }

  describe(): Readonly<SourceCapability> { return CAPABILITY; }

  async probe(context: Readonly<SourceContext>): Promise<Readonly<SourceHealth>> {
    const credential = context.credential(this.#credentialRef);
    if (credential === undefined) return freezeNutritionData({ source_id: CAPABILITY.source_id, status: "missing", reason: "credential_missing" });
    try {
      const ok = await this.#transport.probe({ signal: context.signal, credential: new Uint8Array(credential.value) });
      return freezeNutritionData({ source_id: CAPABILITY.source_id, status: ok ? "ok" : "broken", reason: ok ? null : "source_unavailable" });
    } catch {
      return freezeNutritionData({ source_id: CAPABILITY.source_id, status: context.signal.aborted ? "timeout" : "error", reason: "source_unavailable" });
    }
  }

  async resolve(request: Readonly<SourceRequest>, context: Readonly<SourceContext>): Promise<Readonly<SourceResolution>> {
    const credential = context.credential(this.#credentialRef);
    if (credential === undefined) return freezeNutritionData({
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
    } catch {
      return freezeNutritionData({
        status: context.signal.aborted ? "timeout" : "error", source_id: CAPABILITY.source_id,
        tier: CAPABILITY.tier, source_record_id: null, source_version: null,
        retained_fields_sha256: null, evidence: null, reason: "source_unavailable",
      });
    }
  }
}
