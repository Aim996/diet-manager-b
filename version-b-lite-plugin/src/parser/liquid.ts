import type {
  CoreLiquidClassification,
  CoreMealItem,
} from "./types.js";
import { parseIngestionPredicateFrames } from "./predicate-frame.js";
import { resolvePredicateFrameSubject } from "./subject.js";
import type { PredicateFrameSubjectResolution } from "./subject.js";

export interface PlainWaterMatch {
  readonly event_id: string;
  readonly occurrence_id: string;
  readonly start: number;
  readonly end: number;
  readonly raw_text: string;
  readonly quantity_ml: number;
}

const DIRECT_OR_COORDINATED_WATER = /(?:^|和|与|、)\s*([0-9]+)\s*ml\s*(白水|水)(?=$|[\s,，。；;！!？?、和与又吗么嘛呢时"'”’」』》】）)\]}])/gu;
const ADJUNCT_START = /(?:时|后)?(?:看见|看到|拿着|放着|旁边|桌上|还有|使用|用了)/u;
const PUNCTUATED_WATER_CONTINUATION = /^\s*[，,]\s*([0-9]+)\s*ml\s*(白水|水)(?=$|[\s,，。；;！!？?、和与又吗么嘛呢"'”’」』》】）)\]}])/u;

function frozenRecord<T extends object>(entries: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), entries)) as Readonly<T>;
}

function plainWaterMatch(entries: {
  readonly event_id: string;
  readonly occurrence_id: string;
  readonly start: number;
  readonly end: number;
  readonly raw_text: string;
  readonly quantity_text: string;
}): Readonly<PlainWaterMatch> | null {
  const quantity = Number(entries.quantity_text);
  if (
    !Number.isSafeInteger(quantity) || quantity <= 0 ||
    !Number.isSafeInteger(quantity * 1_000)
  ) return null;
  return frozenRecord({
    event_id: entries.event_id,
    occurrence_id: entries.occurrence_id,
    start: entries.start,
    end: entries.end,
    raw_text: entries.raw_text,
    quantity_ml: quantity,
  });
}

export interface WaterFrameScan {
  readonly self_matches: readonly Readonly<PlainWaterMatch>[];
  readonly non_self_direct_count: number;
}

export function resolveWaterFrames(sourceText: string): Readonly<WaterFrameScan> {
  const selfMatches: Readonly<PlainWaterMatch>[] = [];
  let nonSelfDirectCount = 0;
  let inherited: PredicateFrameSubjectResolution | null = null;
  for (const frame of parseIngestionPredicateFrames(sourceText)) {
    const subject = resolvePredicateFrameSubject(frame, inherited);
    inherited = subject;
    if (frame.predicate !== "drink") continue;
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
      const waterText = direct[2];
      if (quantityText === undefined || waterText === undefined) continue;
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
      if (match === null) continue;
      if (subject.disposition === "resolved") selfMatches.push(match);
      else nonSelfDirectCount += 1;
    }
    if (subject.disposition !== "resolved") continue;
    const afterFrame = sourceText.slice(frame.frame_span.end);
    const punctuated = PUNCTUATED_WATER_CONTINUATION.exec(afterFrame);
    if (punctuated !== null) {
      const quantityText = punctuated[1];
      if (quantityText === undefined) continue;
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
      if (match !== null) selfMatches.push(match);
    }
  }
  return frozenRecord({
    self_matches: Object.freeze(selfMatches),
    non_self_direct_count: nonSelfDirectCount,
  });
}

/** Recognize only explicit drinking of plain water in the frozen core grammar. */
export function matchExplicitPlainWater(sourceText: string): Readonly<PlainWaterMatch> | null {
  return matchExplicitPlainWaters(sourceText)[0] ?? null;
}

/** Return every independently stated plain-water record in source order. */
export function matchExplicitPlainWaters(
  sourceText: string,
): readonly Readonly<PlainWaterMatch>[] {
  return resolveWaterFrames(sourceText).self_matches;
}

export function hasNonSelfExplicitPlainWater(sourceText: string): boolean {
  return resolveWaterFrames(sourceText).non_self_direct_count > 0;
}

/** Classify nutrition liquids as food and never as plain-water events. */
export function classifyMealLiquid(
  items: readonly CoreMealItem[],
): Readonly<CoreLiquidClassification> | null {
  const liquids = items.filter((item) => item.kind === "nutritious_drink");
  if (liquids.length === 0) return null;
  const knownMl = liquids.every((item) =>
    item.unit === "ml" && item.quantity !== null
  )
    ? liquids.reduce((total, item) => total + (item.quantity ?? 0), 0)
    : null;
  return Object.freeze({
    plain_water: false,
    plain_water_contribution_ml: 0,
    ...(knownMl === null ? {} : { food_water_upper_bound_ml: knownMl }),
  });
}
