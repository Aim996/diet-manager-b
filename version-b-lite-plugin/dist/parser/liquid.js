import { parseIngestionPredicateFrames } from "./predicate-frame.js";
import { resolvePredicateFrameSubject } from "./subject.js";
const DIRECT_OR_COORDINATED_WATER = /(?:^|和|与|、)\s*(?:([0-9]+)\s*(?:ml|毫升)\s*)?(白水|水)(?=$|[\s,，。；;！!？?、和与又吗么嘛呢时"'”’」』》】）)\]}])/gu;
const NATURAL_UNIT_WATER = /(?:^|和|与|、)\s*(?:[0-9]+|[一二两三四五六七八九十]+)\s*(?:杯|口|瓶)\s*(?:白水|水)(?=$|[\s,，。；;！!？?、和与又吗么嘛呢时"'”’」』》】）)\]}])/gu;
const ADJUNCT_START = /(?:时|后)?(?:看见|看到|拿着|放着|旁边|桌上|还有|使用|用了)/u;
const PUNCTUATED_WATER_CONTINUATION = /^\s*[，,]\s*([0-9]+)\s*(?:ml|毫升)\s*(白水|水)(?=$|[\s,，。；;！!？?、和与又吗么嘛呢"'”’」』》】）)\]}])/u;
const MAX_WATER_OCCURRENCES = 256;
function frozenRecord(entries) {
    return Object.freeze(Object.assign(Object.create(null), entries));
}
function plainWaterMatch(entries) {
    const quantity = Number(entries.quantity_text);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 ||
        !Number.isSafeInteger(quantity * 1_000))
        return null;
    return frozenRecord({
        event_id: entries.event_id,
        occurrence_id: entries.occurrence_id,
        start: entries.start,
        end: entries.end,
        raw_text: entries.raw_text,
        quantity_ml: quantity,
    });
}
export function resolveWaterFrames(sourceText) {
    const selfMatches = [];
    let selfUnquantifiedCount = 0;
    let nonSelfDirectCount = 0;
    let occurrenceLimitExceeded = false;
    let inherited = null;
    for (const frame of parseIngestionPredicateFrames(sourceText)) {
        const subject = resolvePredicateFrameSubject(frame, inherited);
        inherited = subject;
        if (frame.predicate !== "drink")
            continue;
        const aspect = /^\s*(?:了|过|完)?\s*/u.exec(frame.object_span.raw);
        const directStart = frame.object_span.start + (aspect?.[0].length ?? 0);
        const unboundedDirect = sourceText.slice(directStart, frame.object_span.end);
        const adjunct = ADJUNCT_START.exec(unboundedDirect);
        const directText = adjunct === null
            ? unboundedDirect
            : unboundedDirect.slice(0, adjunct.index);
        let waterIndex = 0;
        for (const direct of directText.matchAll(DIRECT_OR_COORDINATED_WATER)) {
            const quantityText = direct[1];
            if (quantityText === undefined) {
                if (subject.disposition === "resolved")
                    selfUnquantifiedCount += 1;
                continue;
            }
            const quantityOffset = direct[0].indexOf(quantityText);
            const tokenStart = directStart + direct.index + quantityOffset;
            const tokenEnd = directStart + direct.index + direct[0].length;
            const rawStart = direct.index === 0
                ? frame.predicate_span.start
                : directStart + direct.index;
            const match = plainWaterMatch({
                event_id: frame.event_id,
                occurrence_id: `water:${frame.event_index}:${waterIndex}:${tokenStart}-${tokenEnd}`,
                start: tokenStart,
                end: tokenEnd,
                raw_text: sourceText.slice(rawStart, tokenEnd),
                quantity_text: quantityText,
            });
            waterIndex += 1;
            if (match === null)
                continue;
            if (subject.disposition === "resolved") {
                if (selfMatches.length >= MAX_WATER_OCCURRENCES) {
                    occurrenceLimitExceeded = true;
                }
                else {
                    selfMatches.push(match);
                }
            }
            else if (subject.disposition === "non_self" &&
                nonSelfDirectCount >= MAX_WATER_OCCURRENCES) {
                occurrenceLimitExceeded = true;
            }
            else if (subject.disposition === "non_self") {
                nonSelfDirectCount += 1;
            }
        }
        if (subject.disposition === "resolved") {
            for (const _naturalUnit of directText.matchAll(NATURAL_UNIT_WATER)) {
                selfUnquantifiedCount += 1;
            }
        }
        if (subject.disposition !== "resolved")
            continue;
        const afterFrame = sourceText.slice(frame.frame_span.end);
        const punctuated = PUNCTUATED_WATER_CONTINUATION.exec(afterFrame);
        if (punctuated !== null) {
            const quantityText = punctuated[1];
            if (quantityText === undefined)
                continue;
            const quantityOffset = punctuated[0].indexOf(quantityText);
            const tokenStart = frame.frame_span.end + quantityOffset;
            const tokenEnd = frame.frame_span.end + punctuated[0].length;
            const match = plainWaterMatch({
                event_id: frame.event_id,
                occurrence_id: `water:${frame.event_index}:${waterIndex}:${tokenStart}-${tokenEnd}`,
                start: tokenStart,
                end: tokenEnd,
                raw_text: punctuated[0],
                quantity_text: quantityText,
            });
            if (match !== null) {
                if (selfMatches.length >= MAX_WATER_OCCURRENCES) {
                    occurrenceLimitExceeded = true;
                }
                else {
                    selfMatches.push(match);
                }
            }
        }
    }
    return frozenRecord({
        self_matches: Object.freeze(selfMatches),
        self_unquantified_count: selfUnquantifiedCount,
        non_self_direct_count: nonSelfDirectCount,
        occurrence_limit_exceeded: occurrenceLimitExceeded,
    });
}
/** Recognize only explicit drinking of plain water in the frozen core grammar. */
export function matchExplicitPlainWater(sourceText) {
    return matchExplicitPlainWaters(sourceText)[0] ?? null;
}
/** Return every independently stated plain-water record in source order. */
export function matchExplicitPlainWaters(sourceText) {
    return resolveWaterFrames(sourceText).self_matches;
}
export function hasNonSelfExplicitPlainWater(sourceText) {
    return resolveWaterFrames(sourceText).non_self_direct_count > 0;
}
/** Classify nutrition liquids as food and never as plain-water events. */
export function classifyMealLiquid(items) {
    const liquids = items.filter((item) => item.kind === "nutritious_drink");
    if (liquids.length === 0)
        return null;
    let knownMl = 0;
    for (const item of liquids) {
        if (knownMl === null)
            break;
        if (item.unit !== "ml" || item.quantity === null) {
            knownMl = null;
            break;
        }
        const nextTotal = knownMl + item.quantity;
        if (!Number.isSafeInteger(nextTotal) || nextTotal <= 0) {
            knownMl = null;
            break;
        }
        knownMl = nextTotal;
    }
    return frozenRecord({
        plain_water: false,
        plain_water_contribution_ml: 0,
        ...(knownMl === null ? {} : { food_water_upper_bound_ml: knownMl }),
    });
}
