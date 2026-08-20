import { types as utilTypes } from "node:util";

export interface SemanticMealCandidateV1 {
  readonly schema_version: "diet-manager/semantic-candidate/v1";
  readonly intent: "record_meal";
  readonly source_text: string;
  readonly subject: Readonly<{
    readonly kind: "self";
    readonly basis: "explicit" | "private_agent_default";
    readonly evidence_span: string | null;
    readonly explicit_other_spans: readonly string[];
  }>;
  readonly items: readonly Readonly<{
    readonly raw_name: string;
    readonly normalized_hint: string;
    readonly amount:
      | Readonly<{ readonly kind: "exact"; readonly value: number; readonly unit: string; readonly evidence_span: string }>
      | Readonly<{ readonly kind: "unknown" }>;
  }>[];
  readonly time: Readonly<{
    readonly kind: "source_text" | "unspecified";
    readonly evidence_span: string | null;
  }>;
}

type PlainRecord = Record<string, unknown>;

function invalid(): never {
  throw new TypeError("SEMANTIC_CANDIDATE_INVALID");
}

function record(value: unknown, keys: readonly string[]): PlainRecord {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) invalid();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) invalid();
  }
  return value as PlainRecord;
}

function data(recordValue: PlainRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(recordValue, key);
  if (descriptor === undefined || !("value" in descriptor)) invalid();
  return descriptor.value;
}

function array(value: unknown, minimum: number, maximum: number): readonly unknown[] {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value) || !Array.isArray(value)) invalid();
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) invalid();
  const length = lengthDescriptor.value;
  if (!Number.isInteger(length) || length < minimum || length > maximum) invalid();
  const ownKeys = Reflect.ownKeys(value);
  const expectedKeys = ["length", ...Array.from({ length }, (_, index) => String(index))];
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) invalid();
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) invalid();
  }
  return value;
}

function string(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) invalid();
  return value;
}

function literal<T extends string>(value: unknown, expected: T): T {
  if (value !== expected) invalid();
  return expected;
}

function nullableEvidence(value: unknown): string | null {
  return value === null ? null : string(value, 1, 256);
}

function cloneAmount(value: unknown): SemanticMealCandidateV1["items"][number]["amount"] {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value)) invalid();
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
  if (kindDescriptor === undefined || !("value" in kindDescriptor)) invalid();
  if (kindDescriptor.value === "unknown") {
    record(value, ["kind"]);
    return Object.freeze({ kind: "unknown" as const });
  }
  const source = record(value, ["kind", "value", "unit", "evidence_span"]);
  literal(data(source, "kind"), "exact");
  const amountValue = data(source, "value");
  if (typeof amountValue !== "number" || !Number.isFinite(amountValue) || amountValue <= 0) invalid();
  return Object.freeze({
    kind: "exact" as const,
    value: amountValue,
    unit: string(data(source, "unit"), 1, 64),
    evidence_span: string(data(source, "evidence_span"), 1, 256),
  });
}

function cloneItem(value: unknown): SemanticMealCandidateV1["items"][number] {
  const source = record(value, ["raw_name", "normalized_hint", "amount"]);
  return Object.freeze({
    raw_name: string(data(source, "raw_name"), 1, 256),
    normalized_hint: string(data(source, "normalized_hint"), 1, 256),
    amount: cloneAmount(data(source, "amount")),
  });
}

export function cloneSemanticCandidate(value: unknown): SemanticMealCandidateV1 {
  const source = record(value, ["schema_version", "intent", "source_text", "subject", "items", "time"]);
  const subject = record(data(source, "subject"), [
    "kind", "basis", "evidence_span", "explicit_other_spans",
  ]);
  const basis = data(subject, "basis");
  if (basis !== "explicit" && basis !== "private_agent_default") invalid();
  const otherSpans = array(data(subject, "explicit_other_spans"), 0, 64)
    .map((span) => string(span, 1, 256));
  const items = array(data(source, "items"), 1, 64).map(cloneItem);
  const time = record(data(source, "time"), ["kind", "evidence_span"]);
  const timeKind = data(time, "kind");
  if (timeKind !== "source_text" && timeKind !== "unspecified") invalid();

  return Object.freeze({
    schema_version: literal(data(source, "schema_version"), "diet-manager/semantic-candidate/v1"),
    intent: literal(data(source, "intent"), "record_meal"),
    source_text: string(data(source, "source_text"), 1, 4096),
    subject: Object.freeze({
      kind: literal(data(subject, "kind"), "self"),
      basis,
      evidence_span: nullableEvidence(data(subject, "evidence_span")),
      explicit_other_spans: Object.freeze(otherSpans),
    }),
    items: Object.freeze(items),
    time: Object.freeze({
      kind: timeKind,
      evidence_span: nullableEvidence(data(time, "evidence_span")),
    }),
  });
}
