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

function amount(
  sourceText: string,
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
    const match = /(一碗)\s*面(?!包)/u.exec(sourceText);
    return match === null
      ? Object.freeze({ raw_text: null, quantity: null, unit: null, estimated: null })
      : Object.freeze({ raw_text: match[1], quantity: 1, unit: "bowl", estimated: false });
  }
  const itemRules = rules[item.normalized_name] ?? [];
  for (const [pattern, frozenQuantity, unit] of itemRules) {
    const match = pattern.exec(sourceText);
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
  for (const entry of LEXICON) {
    const position = sourceText.indexOf(entry.raw_text);
    if (position < 0) continue;
    found.push(Object.freeze({
      normalized_name: entry.normalized_name,
      raw_text: entry.raw_text,
      amount_evidence: amount(sourceText, entry),
      kind: entry.kind,
      position,
    }));
  }
  const noodleMatch = /面(?!包)/u.exec(sourceText);
  if (noodleMatch !== null) {
    const noodle = Object.freeze<Lexeme>({
      normalized_name: "noodle",
      raw_text: noodleMatch[0],
      kind: "food",
    });
    found.push(Object.freeze({
      normalized_name: noodle.normalized_name,
      raw_text: noodle.raw_text,
      amount_evidence: amount(sourceText, noodle),
      kind: noodle.kind,
      position: noodleMatch.index,
    }));
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
