import type {
  CoreMealItem,
} from "./types.js";
import type {
  ProposedAmountEvidence,
  ProposedSubjectItem,
} from "./subject.js";

interface Lexeme {
  readonly normalized_name: string;
  readonly raw_text: string;
  readonly kind: CoreMealItem["kind"];
}

const LEXICON = Object.freeze([
  Object.freeze<Lexeme>({ normalized_name: "chicken", raw_text: "鸡胸肉", kind: "food" }),
  Object.freeze<Lexeme>({ normalized_name: "soy_milk", raw_text: "豆浆", kind: "nutritious_drink" }),
  Object.freeze<Lexeme>({ normalized_name: "fried_rice", raw_text: "炒饭", kind: "food" }),
  Object.freeze<Lexeme>({ normalized_name: "banana", raw_text: "香蕉", kind: "food" }),
  Object.freeze<Lexeme>({ normalized_name: "bread", raw_text: "面包", kind: "food" }),
  Object.freeze<Lexeme>({ normalized_name: "coffee", raw_text: "咖啡", kind: "nutritious_drink" }),
  Object.freeze<Lexeme>({ normalized_name: "apple", raw_text: "苹果", kind: "food" }),
  Object.freeze<Lexeme>({ normalized_name: "milk", raw_text: "牛奶", kind: "nutritious_drink" }),
  Object.freeze<Lexeme>({ normalized_name: "egg", raw_text: "鸡蛋", kind: "food" }),
  Object.freeze<Lexeme>({ normalized_name: "rice", raw_text: "米饭", kind: "food" }),
  Object.freeze<Lexeme>({ normalized_name: "soup", raw_text: "汤", kind: "nutritious_drink" }),
  Object.freeze<Lexeme>({ normalized_name: "tea", raw_text: "茶", kind: "nutritious_drink" }),
]);

interface PositionedItem extends ProposedSubjectItem {
  readonly kind: CoreMealItem["kind"];
  readonly position: number;
}

interface MealClause {
  readonly raw: string;
  readonly start: number;
}

const COMPLETION_CLAUSE = /(?:吃|喝)(?:了|过)?/u;
const SELF_SHARE_CLAUSE = /我\s*和\s*朋友\s*一人\s*一\s*瓶/u;
const COLLECTIVE_SELF_CLAUSE = /我们\s*(?:吃|喝)/u;
const OBJECT_FRONTED_COMPLETION = /记不清\s*是\s*在\s*公司\s*还是\s*回家后\s*(?:吃|喝)的/u;
const ALLOWED_PREVIOUS = /[吃喝了过的个片瓶碗块盘和与、，,。；;！？!?\s0-9lL]/u;
const ALLOWED_NEXT = /[和与、，,。；;！？!?\s记重没不]/u;
const OMITTED_SUBJECT_SUFFIX = /(?:今天|昨天|前天|刚才|刚刚|已经|今早|昨晚|今晚|早上|上午|中午|下午|晚上|夜里|早餐|午餐|晚餐|回家后|后来|还是|准备|不想|没有)$/u;

function splitMealClauses(sourceText: string): readonly MealClause[] {
  const clauses: MealClause[] = [];
  const delimiter = /[，,。；;！？!?\r\n]+/gu;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = delimiter.exec(sourceText)) !== null) {
    const raw = sourceText.slice(start, match.index);
    if (raw.trim().length > 0) clauses.push(Object.freeze({ raw, start }));
    start = match.index + match[0].length;
  }
  const raw = sourceText.slice(start);
  if (raw.trim().length > 0) clauses.push(Object.freeze({ raw, start }));
  return Object.freeze(clauses);
}

function lastKnownNonSelfPosition(prefix: string): number {
  let lastPosition = -1;
  for (const match of prefix.matchAll(/朋友|孩子|同事|家人|他们|他|她|老师|阿姨/gu)) {
    lastPosition = Math.max(lastPosition, match.index);
  }
  return lastPosition;
}

function lastUnknownNominalPosition(prefix: string, selfPosition: number): number {
  const trimmed = prefix.trimEnd();
  if (OMITTED_SUBJECT_SUFFIX.test(trimmed)) return -1;
  const match = /([\p{Script=Han}]{2})$/u.exec(trimmed);
  const nominal = match?.[1];
  if (match === null || nominal === undefined || nominal.includes("我")) return -1;
  const position = trimmed.length - nominal.length;
  if (position === 0 || (selfPosition >= 0 && position > selfPosition)) {
    return position;
  }
  return -1;
}

function isCurrentUserIngestion(
  clauseText: string,
  ingestionPosition: number,
): boolean {
  const prefix = clauseText.slice(0, ingestionPosition);
  const selfPosition = prefix.lastIndexOf("我");
  const nonSelfPosition = Math.max(
    lastKnownNonSelfPosition(prefix),
    lastUnknownNominalPosition(prefix, selfPosition),
  );
  if (nonSelfPosition > selfPosition) return false;
  if (selfPosition >= 0) return true;
  return nonSelfPosition < 0;
}

function isCurrentUserItemPosition(
  clause: MealClause,
  itemPosition: number,
): boolean {
  if (SELF_SHARE_CLAUSE.test(clause.raw)) return true;
  if (COLLECTIVE_SELF_CLAUSE.test(clause.raw)) return true;
  if (OBJECT_FRONTED_COMPLETION.test(clause.raw)) return true;
  if (/买/u.test(clause.raw) && !COMPLETION_CLAUSE.test(clause.raw)) return false;

  let nearestIngestionPosition = -1;
  for (const match of clause.raw.matchAll(/[吃喝]/gu)) {
    if (match.index > itemPosition) break;
    nearestIngestionPosition = match.index;
  }
  return nearestIngestionPosition >= 0 &&
    isCurrentUserIngestion(clause.raw, nearestIngestionPosition);
}

function firstCurrentUserLexemePosition(
  clause: MealClause,
  rawText: string,
): number {
  let searchFrom = 0;
  while (searchFrom < clause.raw.length) {
    const position = clause.raw.indexOf(rawText, searchFrom);
    if (position < 0) return -1;
    if (isCurrentUserItemPosition(clause, position)) return position;
    searchFrom = position + rawText.length;
  }
  return -1;
}

function hasLexemeBoundary(
  sourceText: string,
  position: number,
  rawText: string,
): boolean {
  const previous = position === 0 ? null : sourceText[position - 1];
  const nextPosition = position + rawText.length;
  const next = nextPosition >= sourceText.length ? null : sourceText[nextPosition];
  return (previous === null || ALLOWED_PREVIOUS.test(previous)) &&
    (next === null || ALLOWED_NEXT.test(next));
}

function amount(
  clauseText: string,
  item: Lexeme,
): Readonly<ProposedAmountEvidence> {
  type AmountRule = readonly [RegExp, number, string];
  const rules: Readonly<Record<string, readonly AmountRule[]>> = Object.freeze({
    egg: Object.freeze([[/(两个)\s*鸡蛋/u, 2, "piece"]] as const),
    bread: Object.freeze([[/(两片)\s*面包/u, 2, "slice"]] as const),
    milk: Object.freeze([
      [/([0-9]+)\s*ml\s*牛奶/u, Number.NaN, "ml"],
      [/(一瓶)\s*牛奶/u, 1, "bottle"],
    ] as const),
    apple: Object.freeze([[/(一个)\s*苹果/u, 1, "piece"]] as const),
    banana: Object.freeze([[/吃(?:了)?\s*(香蕉)/u, 1, "piece"]] as const),
    chicken: Object.freeze([[/(一块)\s*鸡胸肉/u, 1, "piece"]] as const),
  });
  if (item.normalized_name === "noodle") {
    const match = /(一碗)\s*面(?!包)/u.exec(clauseText);
    return match === null
      ? Object.freeze({ raw_text: null, quantity: null, unit: null, estimated: null })
      : Object.freeze({ raw_text: match[1], quantity: 1, unit: "bowl", estimated: false });
  }
  const itemRules = rules[item.normalized_name] ?? [];
  for (const [pattern, frozenQuantity, unit] of itemRules) {
    const match = pattern.exec(clauseText);
    if (match === null) continue;
    const quantity = Number.isNaN(frozenQuantity) ? Number(match[1]) : frozenQuantity;
    if (!Number.isSafeInteger(quantity) || quantity <= 0) continue;
    return Object.freeze({
      raw_text: match[1],
      quantity,
      unit,
      estimated: false,
    });
  }
  return Object.freeze({ raw_text: null, quantity: null, unit: null, estimated: null });
}

/** Extract only the explicit PRODUCT-0.1 food vocabulary, in source order. */
export function proposeMealItems(sourceText: string): readonly Readonly<PositionedItem>[] {
  const found: PositionedItem[] = [];
  for (const clause of splitMealClauses(sourceText)) {
    for (const entry of LEXICON) {
      const relativePosition = firstCurrentUserLexemePosition(
        clause,
        entry.raw_text,
      );
      if (relativePosition < 0) continue;
      const position = clause.start + relativePosition;
      if (!hasLexemeBoundary(sourceText, position, entry.raw_text)) continue;
      found.push(Object.freeze({
        normalized_name: entry.normalized_name,
        raw_text: entry.raw_text,
        amount_evidence: amount(clause.raw, entry),
        kind: entry.kind,
        position,
      }));
    }
    const noodleMatch = Array.from(
      clause.raw.matchAll(/(一碗\s*)面(?!包)/gu),
    ).find((match) =>
      isCurrentUserItemPosition(
        clause,
        match.index + (match[1]?.length ?? 0),
      )
    ) ?? null;
    if (noodleMatch !== null) {
      const rawTextPosition = noodleMatch.index + noodleMatch[1].length;
      const position = clause.start + rawTextPosition;
      const noodle = Object.freeze<Lexeme>({
        normalized_name: "noodle",
        raw_text: "面",
        kind: "food",
      });
      found.push(Object.freeze({
        normalized_name: noodle.normalized_name,
        raw_text: noodle.raw_text,
        amount_evidence: amount(clause.raw, noodle),
        kind: noodle.kind,
        position,
      }));
    }
  }
  found.sort((left, right) => left.position - right.position);
  return Object.freeze(found);
}

export function toCoreMealItems(
  resolved: readonly ProposedSubjectItem[],
  proposed: readonly PositionedItem[],
): readonly Readonly<CoreMealItem>[] {
  const kindByIdentity = new Map(
    proposed.map((item) => [`${item.normalized_name}\u0000${item.raw_text}`, item.kind]),
  );
  return Object.freeze(resolved.map((item, order) => Object.freeze({
    order,
    kind: kindByIdentity.get(`${item.normalized_name}\u0000${item.raw_text}`) ?? "food",
    normalized_name: item.normalized_name,
    quantity: item.amount_evidence.quantity,
    unit: item.amount_evidence.unit,
    estimated: item.amount_evidence.estimated,
  })));
}
