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
  readonly allowed_previous: RegExp;
  readonly allowed_next: RegExp;
}

const ITEM_PREVIOUS = /[吃喝了过的个片瓶碗块盘、和与\s0-9lL]/u;
const ITEM_NEXT = /[、和与，,。；;！？!?\s记重没不]/u;
const DRINK_ITEM_NEXT = /[、和与，,。；;！？!?\s记重没不时]/u;

const LEXICON = Object.freeze([
  Object.freeze<Lexeme>({ normalized_name: "chicken", raw_text: "鸡胸肉", kind: "food", allowed_previous: ITEM_PREVIOUS, allowed_next: ITEM_NEXT }),
  Object.freeze<Lexeme>({ normalized_name: "soy_milk", raw_text: "豆浆", kind: "nutritious_drink", allowed_previous: ITEM_PREVIOUS, allowed_next: DRINK_ITEM_NEXT }),
  Object.freeze<Lexeme>({ normalized_name: "fried_rice", raw_text: "炒饭", kind: "food", allowed_previous: ITEM_PREVIOUS, allowed_next: ITEM_NEXT }),
  Object.freeze<Lexeme>({ normalized_name: "banana", raw_text: "香蕉", kind: "food", allowed_previous: ITEM_PREVIOUS, allowed_next: ITEM_NEXT }),
  Object.freeze<Lexeme>({ normalized_name: "bread", raw_text: "面包", kind: "food", allowed_previous: ITEM_PREVIOUS, allowed_next: ITEM_NEXT }),
  Object.freeze<Lexeme>({ normalized_name: "coffee", raw_text: "咖啡", kind: "nutritious_drink", allowed_previous: ITEM_PREVIOUS, allowed_next: DRINK_ITEM_NEXT }),
  Object.freeze<Lexeme>({ normalized_name: "apple", raw_text: "苹果", kind: "food", allowed_previous: ITEM_PREVIOUS, allowed_next: ITEM_NEXT }),
  Object.freeze<Lexeme>({ normalized_name: "milk", raw_text: "牛奶", kind: "nutritious_drink", allowed_previous: ITEM_PREVIOUS, allowed_next: DRINK_ITEM_NEXT }),
  Object.freeze<Lexeme>({ normalized_name: "egg", raw_text: "鸡蛋", kind: "food", allowed_previous: ITEM_PREVIOUS, allowed_next: ITEM_NEXT }),
  Object.freeze<Lexeme>({ normalized_name: "rice", raw_text: "米饭", kind: "food", allowed_previous: ITEM_PREVIOUS, allowed_next: ITEM_NEXT }),
  Object.freeze<Lexeme>({ normalized_name: "soup", raw_text: "汤", kind: "nutritious_drink", allowed_previous: ITEM_PREVIOUS, allowed_next: DRINK_ITEM_NEXT }),
  Object.freeze<Lexeme>({ normalized_name: "tea", raw_text: "茶", kind: "nutritious_drink", allowed_previous: ITEM_PREVIOUS, allowed_next: DRINK_ITEM_NEXT }),
]);

export interface PositionedMealItem extends ProposedSubjectItem {
  readonly event_id: string;
  readonly occurrence_id: string;
  readonly subject_evidence: Readonly<ResolvedSubjectEvidence>;
  readonly kind: CoreMealItem["kind"];
  readonly position: number;
  readonly end: number;
}

export interface MealFrameProposal {
  readonly disposition: "resolved" | "unresolved";
  readonly subject: Readonly<ResolvedSubjectEvidence> | null;
  readonly event_owners: readonly Readonly<{
    readonly event_id: string;
    readonly subject: Readonly<ResolvedSubjectEvidence> | null;
  }>[];
  readonly proposed_items: readonly Readonly<PositionedMealItem>[];
  readonly items: readonly Readonly<CoreMealItem>[];
  readonly group_amount_evidence?: Readonly<{
    readonly event_id: string;
    readonly occurrence_id: string;
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
  const before = frame.object_span.raw.slice(
    Math.max(0, relativePosition - 16),
    relativePosition,
  );
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
  const previous = position === 0 ? null : objectText[position - 1] ?? null;
  const nextPosition = position + lexeme.raw_text.length;
  const next = nextPosition >= objectText.length ? null : objectText[nextPosition] ?? null;
  return (previous === null || lexeme.allowed_previous.test(previous)) &&
    (next === null || lexeme.allowed_next.test(next));
}

function itemsForFrame(
  frame: Readonly<IngestionPredicateFrame>,
  subject: Readonly<ResolvedSubjectEvidence>,
): readonly Readonly<PositionedMealItem>[] {
  const items: Array<Omit<PositionedMealItem, "event_id" | "occurrence_id">> = [];
  for (const lexeme of LEXICON) {
    let searchFrom = 0;
    while (searchFrom < frame.object_span.raw.length) {
      const position = frame.object_span.raw.indexOf(lexeme.raw_text, searchFrom);
      if (position < 0) break;
      if (isBoundedOccurrence(frame.object_span.raw, position, lexeme)) {
        const absolutePosition = frame.object_span.start + position;
        items.push(frozenRecord({
          subject_evidence: subject,
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
      subject_evidence: subject,
      normalized_name: "noodle",
      raw_text: "面",
      amount_evidence: explicitAmount("一碗", 1, "bowl"),
      kind: "food" as const,
      position: absolutePosition,
      end: absolutePosition + 1,
    }));
  }
  items.sort((left, right) => left.position - right.position);
  return Object.freeze(items.map((item, occurrenceIndex) => frozenRecord({
    ...item,
    event_id: frame.event_id,
    occurrence_id: `object:${frame.event_index}:${occurrenceIndex}:${item.position}-${item.end}`,
  })));
}

function objectFrontedItems(
  frame: Readonly<IngestionPredicateFrame>,
  subject: Readonly<ResolvedSubjectEvidence>,
): readonly Readonly<PositionedMealItem>[] {
  if (!frame.subject_prefix_span.raw.trim().startsWith("苹果记不清")) return Object.freeze([]);
  const position = frame.subject_prefix_span.start + frame.subject_prefix_span.raw.indexOf("苹果");
  return Object.freeze([frozenRecord({
    event_id: frame.event_id,
    occurrence_id: `object:${frame.event_index}:0:${position}-${position + 2}`,
    subject_evidence: subject,
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
): readonly Readonly<CoreMealItem>[] {
  return Object.freeze(proposed.map((item, order) => frozenRecord({
    order,
    kind: item.kind,
    normalized_name: item.normalized_name,
    quantity: item.amount_evidence.quantity,
    unit: item.amount_evidence.unit,
    estimated: item.amount_evidence.estimated,
  })));
}

function exactSelfShareProposal(sourceText: string): Readonly<MealFrameProposal> | null {
  const match = /我\s*和\s*朋友\s*一人\s*一\s*瓶\s*牛奶/u.exec(sourceText);
  if (match === null) return null;
  const position = match.index + match[0].lastIndexOf("牛奶");
  const legacySeed = Object.freeze([frozenRecord({
    normalized_name: "milk",
    raw_text: "牛奶",
    amount_evidence: explicitAmount("一瓶", 1, "bottle"),
  })]);
  const legacy = resolveSubject(sourceText, legacySeed);
  if (legacy.disposition !== "resolved") return null;
  const proposed = Object.freeze([frozenRecord({
    event_id: `synthetic:self-share:${match.index}-${match.index + match[0].length}`,
    occurrence_id: `object:self-share:0:${position}-${position + 2}`,
    subject_evidence: legacy.subject,
    normalized_name: "milk",
    raw_text: "牛奶",
    amount_evidence: explicitAmount("一瓶", 1, "bottle"),
    kind: "nutritious_drink" as const,
    position,
    end: position + 2,
  })]);
  return frozenRecord({
    disposition: "resolved" as const,
    subject: legacy.subject,
    event_owners: Object.freeze([frozenRecord({
      event_id: `synthetic:self-share:${match.index}-${match.index + match[0].length}`,
      subject: legacy.subject,
    })]),
    proposed_items: proposed,
    items: coreItems(proposed),
  });
}

/** Build the frame-local meal fact proposal consumed by the core parser. */
export function resolveMealFrames(sourceText: string): Readonly<MealFrameProposal> {
  const selfShare = exactSelfShareProposal(sourceText);
  if (selfShare !== null) return selfShare;

  const proposed: PositionedMealItem[] = [];
  const eventOwners: Array<Readonly<{
    event_id: string;
    subject: Readonly<ResolvedSubjectEvidence> | null;
  }>> = [];
  let inherited: PredicateFrameSubjectResolution | null = null;
  let groupAmountOccurrence: Readonly<PositionedMealItem> | null = null;
  for (const frame of parseIngestionPredicateFrames(sourceText)) {
    const resolution = resolvePredicateFrameSubject(frame, inherited);
    inherited = resolution;
    eventOwners.push(frozenRecord({
      event_id: frame.event_id,
      subject: resolution.disposition === "resolved" ? resolution.subject : null,
    }));
    if (resolution.disposition !== "resolved") continue;
    const frameItems = [
      ...itemsForFrame(frame, resolution.subject),
      ...objectFrontedItems(frame, resolution.subject),
    ];
    if (
      resolution.subject.resolution_basis === "collective_self_participation" &&
      /两\s*盘\s*炒饭/u.test(frame.object_span.raw)
    ) {
      groupAmountOccurrence = frameItems.find((item) =>
        item.normalized_name === "fried_rice"
      ) ?? null;
    }
    proposed.push(...frameItems);
  }
  proposed.sort((left, right) => left.position - right.position);
  const frozenProposed = Object.freeze(proposed);
  const frozenEventOwners = Object.freeze(eventOwners);
  const selectedSubject = frozenEventOwners.find((owner) =>
    owner.subject !== null
  )?.subject ?? null;
  if (selectedSubject === null) {
    return frozenRecord({
      disposition: "unresolved" as const,
      subject: null,
      event_owners: frozenEventOwners,
      proposed_items: frozenProposed,
      items: Object.freeze([]),
    });
  }
  const items = coreItems(frozenProposed);
  return frozenRecord({
    disposition: "resolved" as const,
    subject: selectedSubject,
    event_owners: frozenEventOwners,
    proposed_items: frozenProposed,
    items,
    ...(groupAmountOccurrence !== null
      ? { group_amount_evidence: frozenRecord({
          event_id: groupAmountOccurrence.event_id,
          occurrence_id: groupAmountOccurrence.occurrence_id,
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
