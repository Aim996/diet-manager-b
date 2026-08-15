import { assertV1NutritionSource, freezeNutritionData, SOURCE_TIER_RANK, unknownNutritionEvidence, } from "./types.js";
function orderedAdapters(adapters) {
    const seen = new Set();
    return Object.freeze([...adapters].sort((left, right) => {
        const a = left.describe();
        const b = right.describe();
        const rank = a.rank - b.rank;
        if (rank !== 0)
            return rank;
        if (a.network !== b.network)
            return a.network ? 1 : -1;
        return a.source_id.localeCompare(b.source_id, "en");
    }).map((adapter) => {
        const capability = adapter.describe();
        if (seen.has(capability.source_id) || capability.rank !== SOURCE_TIER_RANK[capability.tier]) {
            throw new TypeError("NUTRITION_SOURCE_INVALID:capability");
        }
        assertV1NutritionSource(capability.source_id);
        seen.add(capability.source_id);
        return adapter;
    }));
}
function awaitWithAbort(promise, signal) {
    if (signal.aborted)
        return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
        const onAbort = () => resolve(undefined);
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then((value) => { signal.removeEventListener("abort", onAbort); resolve(value); }, (error) => { signal.removeEventListener("abort", onAbort); reject(error); });
    });
}
function acceptedEvidence(resolution, sourceId, tier) {
    if (resolution.source_id !== sourceId || resolution.tier !== tier) {
        throw new TypeError("NUTRITION_SOURCE_INVALID:resolution_identity");
    }
    if ((resolution.status === "ok" || resolution.status === "partial") && resolution.evidence !== null) {
        if (resolution.evidence.source_id !== sourceId) {
            throw new TypeError("NUTRITION_SOURCE_INVALID:evidence_identity");
        }
        assertV1NutritionSource(sourceId, resolution.evidence.source_type);
        return freezeNutritionData(resolution.evidence);
    }
    return undefined;
}
export async function resolveNutrition(request, context, options) {
    const deadline = Date.parse(context.deadline_at);
    if (!Number.isFinite(deadline))
        throw new TypeError("NUTRITION_SOURCE_INVALID:deadline");
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(context.signal.reason);
    if (context.signal.aborted)
        abortFromParent();
    else
        context.signal.addEventListener("abort", abortFromParent, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error("nutrition_deadline")), Math.max(0, deadline - Date.now()));
    const runtimeContext = Object.freeze({
        signal: controller.signal,
        deadline_at: context.deadline_at,
        now: context.now,
        credential: context.credential,
    });
    const configured = options.config === undefined
        ? undefined
        : new Map(options.config.sources.map((entry) => [entry.source_id, entry]));
    try {
        for (const adapter of orderedAdapters(options.adapters)) {
            if (controller.signal.aborted)
                break;
            const capability = adapter.describe();
            const entry = configured?.get(capability.source_id);
            if (configured !== undefined && (entry === undefined || !entry.enabled))
                continue;
            if (entry !== undefined && (entry.backend_id !== capability.backend_id ||
                entry.backend_version !== capability.backend_version)) {
                continue;
            }
            let resolution;
            try {
                resolution = await awaitWithAbort(adapter.resolve(request, runtimeContext), controller.signal);
            }
            catch {
                if (controller.signal.aborted)
                    break;
                continue;
            }
            if (resolution === undefined)
                break;
            const evidence = acceptedEvidence(resolution, capability.source_id, capability.tier);
            if (evidence !== undefined)
                return evidence;
        }
        return unknownNutritionEvidence();
    }
    finally {
        clearTimeout(timeout);
        context.signal.removeEventListener("abort", abortFromParent);
        if (!controller.signal.aborted)
            controller.abort();
    }
}
