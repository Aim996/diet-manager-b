import {
  freezeNutritionData,
  SOURCE_TIER_RANK,
  type NutritionSourceAdapter,
  type SourceCapability,
  type SourceContext,
  type SourceHealth,
  type SourceRequest,
  type SourceResolution,
  type SourceTier,
} from "../types.js";

const LOCAL_TIERS = new Set<SourceTier>([
  "current_exact_label", "confirmed_same_product_history",
  "versioned_common_dish_template", "generic_estimate", "unknown",
]);

export interface LocalEvidenceRegistration {
  readonly source_id: string;
  readonly tier: SourceTier;
  readonly backend_id: string;
  readonly backend_version: string;
  readonly request_fields: readonly string[];
  readonly resolve: (
    request: Readonly<SourceRequest>,
    context: Readonly<SourceContext>,
  ) => Promise<Readonly<SourceResolution>> | Readonly<SourceResolution>;
}

export class LocalEvidenceAdapter implements NutritionSourceAdapter {
  readonly #registration: LocalEvidenceRegistration;
  readonly #capability: Readonly<SourceCapability>;

  constructor(registration: LocalEvidenceRegistration) {
    if (!LOCAL_TIERS.has(registration.tier)) throw new TypeError("NUTRITION_ADAPTER_INVALID:local_tier");
    this.#registration = registration;
    this.#capability = freezeNutritionData({
      source_id: registration.source_id,
      tier: registration.tier,
      rank: SOURCE_TIER_RANK[registration.tier],
      backend_id: registration.backend_id,
      backend_version: registration.backend_version,
      network: false,
      request_fields: [...registration.request_fields],
    });
  }

  describe(): Readonly<SourceCapability> {
    return this.#capability;
  }

  async probe(_context: Readonly<SourceContext>): Promise<Readonly<SourceHealth>> {
    return freezeNutritionData({ source_id: this.#capability.source_id, status: "ok", reason: null });
  }

  async resolve(request: Readonly<SourceRequest>, context: Readonly<SourceContext>): Promise<Readonly<SourceResolution>> {
    try {
      return freezeNutritionData(await this.#registration.resolve(request, context));
    } catch {
      return freezeNutritionData({
        status: "error", source_id: this.#capability.source_id, tier: this.#capability.tier,
        source_record_id: null, source_version: null, retained_fields_sha256: null,
        evidence: null, reason: "source_unavailable",
      });
    }
  }
}

export function createLocalEvidenceAdapters(
  registrations: readonly LocalEvidenceRegistration[],
): readonly NutritionSourceAdapter[] {
  return Object.freeze(registrations.map((registration) => new LocalEvidenceAdapter(registration)));
}
