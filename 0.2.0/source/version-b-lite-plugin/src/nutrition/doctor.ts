import {
  freezeNutritionData,
  REGISTERED_SOURCE_TIERS,
  type NutritionDoctorResult,
  type NutritionRuntimeConfig,
  type NutritionSourceAdapter,
  type SourceContext,
} from "./types.js";

export interface NutritionDoctorOptions {
  readonly now?: () => string;
  readonly credential?: SourceContext["credential"];
  readonly signal?: AbortSignal;
}

function healthAction(health: string, reason: string | null): string | null {
  if (health === "ok") return null;
  if (reason === "source_disabled") return "enable_source_if_authorized";
  if (reason === "adapter_missing") return "install_registered_backend";
  if (reason === "credential_missing") return "configure_credential_reference";
  if (health === "timeout") return "check_source_availability";
  return "check_backend_configuration";
}

function probeWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise<T | undefined>((resolve) => {
    const onAbort = (): void => resolve(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      () => { signal.removeEventListener("abort", onAbort); resolve(undefined); },
    );
  });
}

export async function runNutritionDoctor(
  config: Readonly<NutritionRuntimeConfig>,
  adapters: readonly NutritionSourceAdapter[],
  options: Readonly<NutritionDoctorOptions> = {},
): Promise<Readonly<NutritionDoctorResult>> {
  const adapterBySource = new Map(adapters.map((adapter) => [adapter.describe().source_id, adapter]));
  const controller = new AbortController();
  const parentSignal = options.signal;
  const abortFromParent = (): void => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted === true) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const startedAt = Date.now();
  const deadlineAt = new Date(startedAt + config.resolution_deadline_ms).toISOString();
  const timer = setTimeout(() => controller.abort(new Error("nutrition_doctor_deadline")), config.resolution_deadline_ms);
  const context: SourceContext = Object.freeze({
    signal: controller.signal,
    deadline_at: deadlineAt,
    now: options.now ?? (() => new Date().toISOString()),
    credential: options.credential ?? (() => undefined),
  });
  try {
    const sources = [];
    for (let index = 0; index < config.sources.length; index += 1) {
      const entry = config.sources[index]!;
      const adapter = adapterBySource.get(entry.source_id);
      let health: "missing" | "broken" | "timeout" | "error" | "ok" = "missing";
      let reason: string | null = null;
      if (!entry.enabled) {
        reason = "source_disabled";
      } else if (adapter === undefined) {
        reason = "adapter_missing";
      } else if (adapter.describe().backend_id !== entry.backend_id ||
          adapter.describe().backend_version !== entry.backend_version) {
        health = "broken";
        reason = "backend_identity_mismatch";
      } else if (controller.signal.aborted) {
        health = "timeout";
        reason = "source_unavailable";
      } else {
        try {
          const result = await probeWithAbort(adapter.probe(context), controller.signal);
          if (result === undefined) {
            health = controller.signal.aborted ? "timeout" : "error";
            reason = controller.signal.aborted ? "source_unavailable" : "probe_error";
          } else if (result.source_id !== entry.source_id) {
            health = "broken";
            reason = "probe_identity_mismatch";
          } else {
            health = result.status;
            reason = result.reason;
          }
        } catch {
          health = controller.signal.aborted ? "timeout" : "error";
          reason = controller.signal.aborted ? "source_unavailable" : "probe_error";
        }
      }
      const next = config.sources.slice(index + 1).find((candidate) => candidate.enabled);
      sources.push({
        source_id: entry.source_id,
        tier: REGISTERED_SOURCE_TIERS[entry.source_id] ?? "unknown",
        backend_id: entry.backend_id,
        backend_version: entry.backend_version,
        health,
        reason,
        next_backend: next?.backend_id ?? null,
        action: healthAction(health, reason),
      });
    }
    return freezeNutritionData({
      policy_version: config.policy_version,
      source_config_digest: config.source_config_digest,
      sources,
    });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
    if (!controller.signal.aborted) controller.abort();
  }
}
