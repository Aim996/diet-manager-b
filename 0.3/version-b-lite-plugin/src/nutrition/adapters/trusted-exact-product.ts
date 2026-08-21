import {
  freezeNutritionData,
  SOURCE_TIER_RANK,
  type NutritionSourceAdapter,
  type SourceCapability,
  type SourceContext,
  type SourceHealth,
  type SourceRequest,
  type SourceResolution,
} from "../types.js";

export interface TrustedExactProductTransport {
  probe(input: Readonly<{ signal: AbortSignal; credential?: Uint8Array }>): Promise<boolean>;
  resolve(input: Readonly<{
    request: Readonly<SourceRequest>;
    signal: AbortSignal;
    credential?: Uint8Array;
  }>): Promise<Readonly<SourceResolution>>;
}

export interface TrustedExactProductRegistration {
  readonly source_id: "conditional.manufacturer_exact" | "trusted.open_food_facts_read_only";
  readonly backend_id: string;
  readonly backend_version: string;
  readonly enabled: boolean;
  readonly credential_ref: string | null;
  readonly request_fields: readonly string[];
}

export class TrustedExactProductAdapter implements NutritionSourceAdapter {
  readonly #registration: TrustedExactProductRegistration;
  readonly #transport: TrustedExactProductTransport;
  readonly #capability: Readonly<SourceCapability>;

  constructor(registration: TrustedExactProductRegistration, transport: TrustedExactProductTransport) {
    const tier = registration.source_id === "conditional.manufacturer_exact"
      ? "manufacturer_or_exact_product" as const
      : "allowlisted_trusted_internet" as const;
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

  describe(): Readonly<SourceCapability> { return this.#capability; }

  #credential(context: Readonly<SourceContext>): Uint8Array | undefined {
    if (this.#registration.credential_ref === null) return undefined;
    const capability = context.credential(this.#registration.credential_ref);
    return capability === undefined ? undefined : new Uint8Array(capability.value);
  }

  async probe(context: Readonly<SourceContext>): Promise<Readonly<SourceHealth>> {
    if (!this.#registration.enabled) return freezeNutritionData({ source_id: this.#capability.source_id, status: "missing", reason: "source_disabled" });
    try {
      const ok = await this.#transport.probe({ signal: context.signal, credential: this.#credential(context) });
      return freezeNutritionData({ source_id: this.#capability.source_id, status: ok ? "ok" : "broken", reason: ok ? null : "source_unavailable" });
    } catch {
      return freezeNutritionData({ source_id: this.#capability.source_id, status: context.signal.aborted ? "timeout" : "error", reason: "source_unavailable" });
    }
  }

  async resolve(request: Readonly<SourceRequest>, context: Readonly<SourceContext>): Promise<Readonly<SourceResolution>> {
    if (!this.#registration.enabled) return freezeNutritionData({
      status: "source_disabled", source_id: this.#capability.source_id, tier: this.#capability.tier,
      source_record_id: null, source_version: null, retained_fields_sha256: null,
      evidence: null, reason: "source_disabled",
    });
    try {
      const resolution = await this.#transport.resolve({
        request: freezeNutritionData(request), signal: context.signal, credential: this.#credential(context),
      });
      return freezeNutritionData(resolution);
    } catch {
      return freezeNutritionData({
        status: context.signal.aborted ? "timeout" : "error", source_id: this.#capability.source_id,
        tier: this.#capability.tier, source_record_id: null, source_version: null,
        retained_fields_sha256: null, evidence: null, reason: "source_unavailable",
      });
    }
  }
}
