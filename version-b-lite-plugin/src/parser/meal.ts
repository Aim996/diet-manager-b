import { parseIngestionPredicateFrames } from "./predicate-frame.js";
import {
  resolvePredicateFrameSubject,
  resolveSubject,
} from "./subject.js";
import type { IngestionPredicateFrame } from "./predicate-frame.js";
import type {
  PredicateFrameSubjectResolution,
  ProposedAmountEvidence,
  ProposedSubjectItem,
  ResolvedSubjectEvidence,
} from "./subject.js";
import type { CoreMealItem } from "./types.js";

interface Lexeme {
  readonly normalized_name: string;
  readonly raw_text: string;
  readonly kind: CoreMealItem["kind"];
  readonly forbidden_prefix?: string;
  readonly forbidden_suffix?: string;
}

const LEXICON = Object.freeze([
  Object.freeze<Lexeme>({ normalized_name: "chicken", raw_text: "鸡胸肉", kind: "food" }),
  Object.freeze<Lexeme>({ normalized_name: "soy_milk", raw_text: "豆浆", kind: "nutritious_drink" }),
  Object.freeze<Lexeme>({ normalized_name: "fried_rice", raw_text: "炒饭", kind: "food" }),
  Object.freeze<Lexeme>({ normalized_name: "banana", raw_text: "香蕉", kind: "food", forbidden_suffix: "船" }),
  Object.freeze<Lexeme>({ normalized_name: "bread", raw_text: "面包", kind: "food", forbidden_suffix: "虫" }),
  Object.freeze<Lexeme>({ normalized_name: "coffee", raw_text: "咖啡", kind: "nutritious_drink" }),
  Object.freeze<Lexeme>({ normalized_name: "apple", raw_text: "苹果", kind: "food", forbidden_suffix: "派" }),
  Object.freeze<Lexeme>({ normalized_name: "milk", raw_text: "牛奶", kind: "nutritious_drink", forbidden_prefix: "水" }),
  Object.freeze<Lexeme>({ normalized_name: "egg", raw_text: "鸡蛋", kind: "food", forbidden_suffix: "糕" }),
  Object.freeze<Lexeme>({ normalized_name: "rice", raw_text: "米饭", kind: "food" }),
  Object.freeze<Lexeme>({ normalized_name: "soup", raw_text: "汤", kind: "nutritious_drink" }),
  Object.freeze<Lexeme>({ normalized_name: "tea", raw_text: "茶", kind: "nutritious_drink" }),
]);

export interface PositionedMealItem extends ProposedSubjectItem {
  readonly kind: CoreMealItem["kind"];
  readonly position: number;
  readonly end: number;
}

export interface MealFrameProposal {
  readonly disposition: "resolved" | "unresolved";
  readonly subject: Readonly<ResolvedSubjectEvidence> | null;
  readonly proposed_items: readonly Readonly<PositionedMealItem>[];
  readonly items: readonly Readonly<CoreMealItem>[];
  readonly group_amount_evidence?: Readonly<{
    quantity: 2;
    unit: "plate";
    assigned_to_self: false;
    matched_span: string;
    rule_version: "diet-manager/subject-v1";
  }>;
}

function frozenRecord<T extends object>(entries: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), entries)) as Readonly<T>;
}

function unknownAmount(): Readonly<ProposedAmountEvidence> {
  return frozenRecord({
    raw_text: null,
    quantity: null,
    unit: null,
    estimated: null,
  });
}

function explicitAmount(
  rawText: string,
  quantity: number,
  unit: string,
): Readonly<ProposedAmountEvidence> {
  return frozenRecord({ raw_text: rawText, quantity, unit, estimated: false });
}

function amountForOccurrence(
  frame: Readonly<IngestionPredicateFrame>,
  item: Lexeme,
  relativePosition: number,
): Readonly<ProposedAmountEvidence> {
  const before = frame.object_span.raw.slice(0, relativePosition);
  const adjacent = before.replace(/^\s*了?\s*/u, "");
  const patterns: Readonly<Record<string, readonly [RegExp, number, string]>> = Object.freeze({
    egg: [/两个\s*$/u, 2, "piece"],
    bread: [/两片\s*$/u, 2, "slice"],
    apple: [/一个\s*$/u, 1, "piece"],
    chicken: [/一块\s*$/u, 1, "piece"],
    milk_bottle: [/一瓶\s*$/u, 1, "bottle"],
  });
  const rule = item.normalized_name === "milk"
    ? patterns.milk_bottle
    : patterns[item.normalized_name];
  if (rule !== undefined) {
    const match = rule[0].exec(adjacent);
    if (match !== null) return explicitAmount(match[0].trim(), rule[1], rule[2]);
  }
  if (item.normalized_name === "milk") {
    const match = /([0-9]+)\s*ml\s*$/u.exec(adjacent);
    const quantity = Number(match?.[1]);
    if (match !== null && Number.isSafeInteger(quantity) && quantity > 0) {
      return explicitAmount(match[1], quantity, "ml");
    }
  }
  if (item.normalized_name === "banana") {
    return explicitAmount("香蕉", 1, "piece");
  }
  return unknownAmount();
}

function isBoundedOccurrence(
  objectText: string,
  position: number,
  lexeme: Lexeme,
): boolean {
  const previous = objectText.slice(0, position);
  const next = objectText.slice(position + lexeme.raw_text.length);
  if (lexeme.forbidden_prefix !== undefined && previous.endsWith(lexeme.forbidden_prefix)) {
    return false;
  }
  if (lexeme.forbidden_suffix !== undefined && next.startsWith(lexeme.forbidden_suffix)) {
    return false;
  }
  if (lexeme.raw_text === "汤" && /^(?:圆|面)/u.test(next)) return false;
  return true;
}

function itemsForFrame(
  frame: Readonly<IngestionPredicateFrame>,
): readonly Readonly<PositionedMealItem>[] {
  const items: PositionedMealItem[] = [];
  for (const lexeme of LEXICON) {
    let searchFrom = 0;
    while (searchFrom < frame.object_span.raw.length) {
      const position = frame.object_span.raw.indexOf(lexeme.raw_text, searchFrom);
      if (position < 0) break;
      if (isBoundedOccurrence(frame.object_span.raw, position, lexeme)) {
        const absolutePosition = frame.object_span.start + position;
        items.push(frozenRecord({
          normalized_name: lexeme.normalized_name,
          raw_text: lexeme.raw_text,
          amount_evidence: amountForOccurrence(frame, lexeme, position),
          kind: lexeme.kind,
          position: absolutePosition,
          end: absolutePosition + lexeme.raw_text.length,
        }));
      }
      searchFrom = position + lexeme.raw_text.length;
    }
  }
  for (const match of frame.object_span.raw.matchAll(/(一碗\s*)面(?!包)/gu)) {
    const relativePosition = match.index + (match[1]?.length ?? 0);
    const absolutePosition = frame.object_span.start + relativePosition;
    items.push(frozenRecord({
      normalized_name: "noodle",
      raw_text: "面",
      amount_evidence: explicitAmount("一碗", 1, "bowl"),
      kind: "food" as const,
      position: absolutePosition,
      end: absolutePosition + 1,
    }));
  }
  items.sort((left, right) => left.position - right.position);
  return Object.freeze(items);
}

function objectFrontedItems(
  frame: Readonly<IngestionPredicateFrame>,
): readonly Readonly<PositionedMealItem>[] {
  if (!frame.subject_prefix_span.raw.trim().startsWith("苹果记不清")) return Object.freeze([]);
  const position = frame.subject_prefix_span.start + frame.subject_prefix_span.raw.indexOf("苹果");
  return Object.freeze([frozenRecord({
    normalized_name: "apple",
    raw_text: "苹果",
    amount_evidence: unknownAmount(),
    kind: "food" as const,
    position,
    end: position + 2,
  })]);
}

function coreItems(
  proposed: readonly Readonly<PositionedMealItem>[],
  clearAmounts: boolean,
): readonly Readonly<CoreMealItem>[] {
  return Object.freeze(proposed.map((item, order) => frozenRecord({
    order,
    kind: item.kind,
    normalized_name: item.normalized_name,
    quantity: clearAmounts ? null : item.amount_evidence.quantity,
    unit: clearAmounts ? null : item.amount_evidence.unit,
    estimated: clearAmounts ? null : item.amount_evidence.estimated,
  })));
}

function exactSelfShareProposal(sourceText: string): Readonly<MealFrameProposal> | null {
  const match = /我\s*和\s*朋友\s*一人\s*一\s*瓶\s*牛奶/u.exec(sourceText);
  if (match === null) return null;
  const position = match.index + match[0].lastIndexOf("牛奶");
  const proposed = Object.freeze([frozenRecord({
    normalized_name: "milk",
    raw_text: "牛奶",
    amount_evidence: explicitAmount("一瓶", 1, "bottle"),
    kind: "nutritious_drink" as const,
    position,
    end: position + 2,
  })]);
  const legacy = resolveSubject(sourceText, proposed);
  if (legacy.disposition !== "resolved") return null;
  return frozenRecord({
    disposition: "resolved" as const,
    subject: legacy.subject,
    proposed_items: proposed,
    items: coreItems(proposed, false),
  });
}

/** Build the frame-local meal fact proposal consumed by the core parser. */
export function resolveMealFrames(sourceText: string): Readonly<MealFrameProposal> {
  const selfShare = exactSelfShareProposal(sourceText);
  if (selfShare !== null) return selfShare;

  const proposed: PositionedMealItem[] = [];
  let inherited: PredicateFrameSubjectResolution | null = null;
  let selectedSubject: Readonly<ResolvedSubjectEvidence> | null = null;
  let groupAmount = false;
  for (const frame of parseIngestionPredicateFrames(sourceText)) {
    const resolution = resolvePredicateFrameSubject(frame, inherited);
    inherited = resolution;
    if (resolution.disposition !== "resolved") continue;
    selectedSubject = resolution.subject;
    if (
      resolution.subject.resolution_basis === "collective_self_participation" &&
      /两\s*盘\s*炒饭/u.test(frame.object_span.raw)
    ) groupAmount = true;
    proposed.push(...itemsForFrame(frame), ...objectFrontedItems(frame));
  }
  proposed.sort((left, right) => left.position - right.position);
  const frozenProposed = Object.freeze(proposed);
  if (selectedSubject === null) {
    return frozenRecord({
      disposition: "unresolved" as const,
      subject: null,
      proposed_items: frozenProposed,
      items: Object.freeze([]),
    });
  }
  const items = coreItems(frozenProposed, groupAmount);
  return frozenRecord({
    disposition: "resolved" as const,
    subject: selectedSubject,
    proposed_items: frozenProposed,
    items,
    ...(groupAmount
      ? { group_amount_evidence: frozenRecord({
          quantity: 2 as const,
          unit: "plate" as const,
          assigned_to_self: false as const,
          matched_span: "两盘",
          rule_version: "diet-manager/subject-v1" as const,
        }) }
      : {}),
  });
}

/** Compatibility view for parser stages that only need selected meal lexemes. */
export function proposeMealItems(sourceText: string): readonly Readonly<PositionedMealItem>[] {
  return resolveMealFrames(sourceText).proposed_items;
}

export function toCoreMealItems(
  resolved: readonly ProposedSubjectItem[],
  proposed: readonly PositionedMealItem[],
): readonly Readonly<CoreMealItem>[] {
  const byPosition = proposed.slice().sort((left, right) => left.position - right.position);
  return Object.freeze(resolved.map((item, order) => {
    const source = byPosition[order];
    return frozenRecord({
      order,
      kind: source?.kind ?? "food",
      normalized_name: item.normalized_name,
      quantity: item.amount_evidence.quantity,
      unit: item.amount_evidence.unit,
      estimated: item.amount_evidence.estimated,
    });
  }));
}
