import {
  assertV1NutritionSource,
  freezeNutritionData,
  SOURCE_TIER_RANK,
  type NutritionRuntimeConfig,
  type NutritionSourceAdapter,
  type ResolvedNutritionEvidence,
  type SourceContext,
  type SourceRequest,
  type SourceResolution,
  unknownNutritionEvidence,
  validateAndFreezeResolvedNutritionEvidence,
} from "./types.js";
import {
  nutritionSourceStage,
  orderNutritionSourceCapabilities,
} from "../domain/nutrition-source-policy.js";

export interface ResolveNutritionOptions {
  readonly adapters: readonly NutritionSourceAdapter[];
  readonly config?: Readonly<NutritionRuntimeConfig>;
  readonly reusableWebEvidence?: (
    request: Readonly<SourceRequest>,
  ) => Readonly<ResolvedNutritionEvidence> | undefined;
  readonly onWebResolution?: (
    request: Readonly<SourceRequest>,
    resolution: Readonly<SourceResolution>,
    evidence: Readonly<ResolvedNutritionEvidence>,
  ) => Readonly<ResolvedNutritionEvidence> | undefined;
}

function orderedAdapters(adapters: readonly NutritionSourceAdapter[]): readonly NutritionSourceAdapter[] {
  const seen = new Set<string>();
  const registered = adapters.map((adapter) => {
    const capability = adapter.describe();
    if (seen.has(capability.source_id) || capability.rank !== SOURCE_TIER_RANK[capability.tier]) {
      throw new TypeError("NUTRITION_SOURCE_INVALID:capability");
    }
    assertV1NutritionSource(capability.source_id);
    seen.add(capability.source_id);
    return Object.freeze({ adapter, capability });
  });
  const ordered = orderNutritionSourceCapabilities(registered.map(({ capability }) => capability));
  const bySource = new Map(registered.map((entry) => [entry.capability.source_id, entry.adapter]));
  return Object.freeze(ordered.map((capability) => bySource.get(capability.source_id)!));
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise<T | undefined>((resolve, reject) => {
    const onAbort = (): void => resolve(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

function acceptedEvidence(
  resolution: Readonly<SourceResolution>,
  sourceId: string,
  tier: string,
): Readonly<ResolvedNutritionEvidence> | undefined {
  if (resolution.source_id !== sourceId || resolution.tier !== tier) {
    throw new TypeError("NUTRITION_SOURCE_INVALID:resolution_identity");
  }
  if ((resolution.status === "ok" || resolution.status === "partial") && resolution.evidence !== null) {
    if (resolution.evidence.source_id !== sourceId) {
      throw new TypeError("NUTRITION_SOURCE_INVALID:evidence_identity");
    }
    assertV1NutritionSource(sourceId, resolution.evidence.source_type);
    return validateAndFreezeResolvedNutritionEvidence(resolution.evidence);
  }
  return undefined;
}

export async function resolveNutrition(
  request: Readonly<SourceRequest>,
  context: Readonly<SourceContext>,
  options: Readonly<ResolveNutritionOptions>,
): Promise<Readonly<ResolvedNutritionEvidence>> {
  const deadline = Date.parse(context.deadline_at);
  if (!Number.isFinite(deadline)) throw new TypeError("NUTRITION_SOURCE_INVALID:deadline");
  const controller = new AbortController();
  const abortFromParent = (): void => controller.abort(context.signal.reason);
  if (context.signal.aborted) abortFromParent();
  else context.signal.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("nutrition_deadline")), Math.max(0, deadline - Date.now()));
  const runtimeContext: SourceContext = Object.freeze({
    signal: controller.signal,
    deadline_at: context.deadline_at,
    now: context.now,
    credential: context.credential,
  });
  const configured = options.config === undefined
    ? undefined
    : new Map(options.config.sources.map((entry) => [entry.source_id, entry]));
  try {
    let reusableWebChecked = false;
    let webEstimateFallback: Readonly<ResolvedNutritionEvidence> | undefined;
    for (const adapter of orderedAdapters(options.adapters)) {
      if (controller.signal.aborted) break;
      const capability = adapter.describe();
      const stage = nutritionSourceStage(capability);
      if (stage !== "traceable_web" && webEstimateFallback !== undefined) {
        return webEstimateFallback;
      }
      const entry = configured?.get(capability.source_id);
      if (capability.network && configured !== undefined && (entry === undefined || !entry.enabled)) continue;
      if (entry !== undefined && (entry.backend_id !== capability.backend_id ||
          entry.backend_version !== capability.backend_version)) {
        continue;
      }
      if (!reusableWebChecked && stage === "traceable_web") {
        reusableWebChecked = true;
        try {
          const reusable = options.reusableWebEvidence?.(request);
          if (reusable !== undefined) {
            assertV1NutritionSource(reusable.source_id, reusable.source_type);
            const validatedReusable = validateAndFreezeResolvedNutritionEvidence(reusable);
            const reusableEntry = configured?.get(reusable.source_id);
            if (configured === undefined || (reusableEntry !== undefined && reusableEntry.enabled)) {
              return validatedReusable;
            }
          }
        } catch {
          // A damaged or unavailable cache is never authoritative; continue to the provider.
        }
      }
      let resolution: Readonly<SourceResolution> | undefined;
      let evidence: Readonly<ResolvedNutritionEvidence> | undefined;
      try {
        resolution = await awaitWithAbort(adapter.resolve(request, runtimeContext), controller.signal);
        if (resolution !== undefined) {
          evidence = acceptedEvidence(resolution, capability.source_id, capability.tier);
        }
      } catch {
        if (controller.signal.aborted) break;
        continue;
      }
      if (resolution === undefined) break;
      if (evidence !== undefined) {
        if (stage === "traceable_web") {
          try {
            if (options.onWebResolution !== undefined) {
              const adopted = options.onWebResolution(request, resolution, evidence);
              if (adopted === undefined) continue;
              const validated = validateAndFreezeResolvedNutritionEvidence(adopted);
              if (validated.source_type === "generic_estimate") {
                webEstimateFallback ??= validated;
                continue;
              }
              return validated;
            }
          } catch {
            // A web result that cannot be audited is not adopted.
            continue;
          }
        }
        return evidence;
      }
    }
    return webEstimateFallback ?? unknownNutritionEvidence();
  } finally {
    clearTimeout(timeout);
    context.signal.removeEventListener("abort", abortFromParent);
    if (!controller.signal.aborted) controller.abort();
  }
}
