import type {
  CoreLiquidClassification,
  CoreMealItem,
} from "./types.js";
import { parseIngestionPredicateFrames } from "./predicate-frame.js";
import { resolvePredicateFrameSubject } from "./subject.js";
import type { PredicateFrameSubjectResolution } from "./subject.js";

export interface PlainWaterMatch {
  readonly raw_text: string;
  readonly quantity_ml: number;
}

const DIRECT_WATER_OBJECT = /^\s*了?\s*([0-9]+)\s*ml\s*(白水|水)(?=$|[\s,，。；;！!？?、和与又吗么嘛呢"'”’」』》】）)\]}])/u;
const COORDINATED_WATER_OBJECT = /(?:和|与|、)\s*([0-9]+)\s*ml\s*(白水|水)(?=$|[\s,，。；;！!？?、和与又吗么嘛呢"'”’」』》】）)\]}])/gu;
const PUNCTUATED_WATER_CONTINUATION = /^\s*[，,]\s*([0-9]+)\s*ml\s*(白水|水)(?=$|[\s,，。；;！!？?、和与又吗么嘛呢"'”’」』》】）)\]}])/u;

function plainWaterMatch(
  match: RegExpExecArray,
  rawPrefix = "",
): Readonly<PlainWaterMatch> | null {
  const quantity = Number(match[1]);
  if (
    !Number.isSafeInteger(quantity) || quantity <= 0 ||
    !Number.isSafeInteger(quantity * 1_000)
  ) return null;
  return Object.freeze({ raw_text: `${rawPrefix}${match[0]}`, quantity_ml: quantity });
}

interface WaterFrameScan {
  readonly self_matches: readonly Readonly<PlainWaterMatch>[];
  readonly non_self_direct_count: number;
}

function scanWaterFrames(sourceText: string): Readonly<WaterFrameScan> {
  const selfMatches: Readonly<PlainWaterMatch>[] = [];
  let nonSelfDirectCount = 0;
  let inherited: PredicateFrameSubjectResolution | null = null;
  for (const frame of parseIngestionPredicateFrames(sourceText)) {
    const subject = resolvePredicateFrameSubject(frame, inherited);
    inherited = subject;
    if (frame.predicate !== "drink") continue;
    const direct = DIRECT_WATER_OBJECT.exec(frame.object_span.raw);
    if (direct === null) continue;
    if (subject.disposition !== "resolved") {
      nonSelfDirectCount += 1;
      continue;
    }
    const first = plainWaterMatch(direct, frame.predicate_span.raw);
    if (first !== null) selfMatches.push(first);
    for (const coordinated of frame.object_span.raw.matchAll(COORDINATED_WATER_OBJECT)) {
      const match = plainWaterMatch(coordinated);
      if (match !== null) selfMatches.push(match);
    }
    const afterFrame = sourceText.slice(frame.frame_span.end);
    const punctuated = PUNCTUATED_WATER_CONTINUATION.exec(afterFrame);
    if (punctuated !== null) {
      const match = plainWaterMatch(punctuated);
      if (match !== null) selfMatches.push(match);
    }
  }
  return Object.freeze({
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
  return scanWaterFrames(sourceText).self_matches;
}

export function hasNonSelfExplicitPlainWater(sourceText: string): boolean {
  return scanWaterFrames(sourceText).non_self_direct_count > 0;
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
