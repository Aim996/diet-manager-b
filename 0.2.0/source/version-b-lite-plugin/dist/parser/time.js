export const TIME_RESOLVER_VERSION = "diet-manager/time-parser-v1";
const SHANGHAI_OFFSET_MINUTES = 8 * 60;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const OFFSET_ISO_PATTERN = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})/u;
const FULL_OFFSET_ISO_PATTERN = new RegExp(`^${OFFSET_ISO_PATTERN.source}$`, "u");
const OFFSET_ISO_SHAPE_PATTERN = /(?<!\d)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})(?!\d)/u;
const AMBIGUOUS_LATE_NIGHT_PATTERN = /凌晨\s*\d{1,2}\s*点(?:\s*补记\s*昨天\s*夜宵|[^。！？!?]*(?:记不清)[^。！？!?]*昨晚[^。！？!?]*今早)/u;
const RICH_LAST_NIGHT_PATTERN = /昨晚\s*\d{1,2}\s*点\s*(?:半|多|\d{1,2}\s*分)/u;
const LAST_NIGHT_PATTERN = /昨晚\s*(\d{1,2})\s*点(?=$|[\s，。；：！？、,:;.!?]|[吃喝])/u;
function parseOffsetMinutes(zone) {
    if (zone === "Z")
        return 0;
    const sign = zone[0] === "+" ? 1 : -1;
    const hour = Number(zone.slice(1, 3));
    const minute = Number(zone.slice(4, 6));
    if (hour > 14 || minute > 59 || (hour === 14 && minute !== 0))
        return null;
    return sign * (hour * 60 + minute);
}
function parseOffsetIso(value) {
    const match = FULL_OFFSET_ISO_PATTERN.exec(value);
    if (match === null)
        return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const millisecond = Number((match[7] ?? "0").padEnd(3, "0"));
    const offsetMinutes = parseOffsetMinutes(match[8]);
    if (year < 1_000 || month < 1 || month > 12 || day < 1 || day > 31 ||
        hour > 23 || minute > 59 || second > 59 || offsetMinutes === null)
        return null;
    const localEpoch = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    const check = new Date(localEpoch);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day || check.getUTCHours() !== hour ||
        check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second ||
        check.getUTCMilliseconds() !== millisecond)
        return null;
    return Object.freeze({ epoch_ms: localEpoch - offsetMinutes * MINUTE_MS });
}
function twoDigits(value) {
    return String(value).padStart(2, "0");
}
function formatShanghai(epochMs) {
    const local = new Date(epochMs + SHANGHAI_OFFSET_MINUTES * MINUTE_MS);
    const fractional = local.getUTCMilliseconds() === 0
        ? ""
        : `.${String(local.getUTCMilliseconds()).padStart(3, "0")}`;
    return `${local.getUTCFullYear()}-${twoDigits(local.getUTCMonth() + 1)}-${twoDigits(local.getUTCDate())}` +
        `T${twoDigits(local.getUTCHours())}:${twoDigits(local.getUTCMinutes())}:${twoDigits(local.getUTCSeconds())}${fractional}+08:00`;
}
function isSupportedShanghaiInstant(epochMs) {
    const year = new Date(epochMs + SHANGHAI_OFFSET_MINUTES * MINUTE_MS).getUTCFullYear();
    return year >= 1_000 && year <= 9_999;
}
function hasSupportedEvidenceInterval(startEpochMs) {
    return isSupportedShanghaiInstant(startEpochMs) &&
        isSupportedShanghaiInstant(startEpochMs + MINUTE_MS);
}
function evidence(rawText, startEpochMs, precision, resolutionBasis, anchor) {
    return Object.freeze({
        raw_text: rawText,
        resolved_start: startEpochMs === null ? null : formatShanghai(startEpochMs),
        resolved_end: startEpochMs === null ? null : formatShanghai(startEpochMs + MINUTE_MS),
        precision,
        timezone: "Asia/Shanghai",
        resolution_basis: resolutionBasis,
        resolution_anchor: anchor,
        resolver_version: TIME_RESOLVER_VERSION,
    });
}
/** Resolve only the bounded PRODUCT-0.1 occurrence forms. */
export function resolveOccurredTime(sourceText, receivedAt) {
    const received = parseOffsetIso(receivedAt);
    if (received === null || !hasSupportedEvidenceInterval(received.epoch_ms)) {
        throw new Error("CORE_TIME_INVALID:received_at");
    }
    const anchor = formatShanghai(received.epoch_ms);
    const ambiguous = AMBIGUOUS_LATE_NIGHT_PATTERN.exec(sourceText);
    if (ambiguous !== null) {
        return evidence(ambiguous[0], null, "unknown", "needs_clarification", anchor);
    }
    const explicit = OFFSET_ISO_SHAPE_PATTERN.exec(sourceText);
    if (explicit !== null) {
        const parsed = parseOffsetIso(explicit[0]);
        return parsed === null || !hasSupportedEvidenceInterval(parsed.epoch_ms)
            ? evidence(explicit[0], null, "unknown", "needs_clarification", anchor)
            : evidence(explicit[0], parsed.epoch_ms, "exact", "explicit", anchor);
    }
    const richerLastNight = RICH_LAST_NIGHT_PATTERN.exec(sourceText);
    if (richerLastNight !== null) {
        return evidence(richerLastNight[0], null, "unknown", "needs_clarification", anchor);
    }
    const lastNight = LAST_NIGHT_PATTERN.exec(sourceText);
    if (lastNight !== null) {
        const statedHour = Number(lastNight[1]);
        if (statedHour >= 1 && statedHour <= 12) {
            const receivedShanghai = new Date(received.epoch_ms + SHANGHAI_OFFSET_MINUTES * MINUTE_MS);
            const priorDate = new Date(Date.UTC(receivedShanghai.getUTCFullYear(), receivedShanghai.getUTCMonth(), receivedShanghai.getUTCDate()) - DAY_MS);
            const resolvedHour = statedHour === 12 ? 0 : statedHour + 12;
            const localEpoch = Date.UTC(priorDate.getUTCFullYear(), priorDate.getUTCMonth(), priorDate.getUTCDate(), resolvedHour);
            const resolvedEpoch = localEpoch - SHANGHAI_OFFSET_MINUTES * MINUTE_MS;
            if (!hasSupportedEvidenceInterval(resolvedEpoch)) {
                return evidence(lastNight[0], null, "unknown", "needs_clarification", anchor);
            }
            return evidence(lastNight[0], resolvedEpoch, "exact", "relative_to_received_at", anchor);
        }
    }
    return evidence(null, received.epoch_ms, "exact", "default_received_at", anchor);
}
