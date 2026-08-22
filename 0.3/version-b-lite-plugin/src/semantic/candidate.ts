import { types as utilTypes } from "node:util";

import type { DietManagerAction } from "../contracts/actions.js";
import type { SemanticProposalV2 } from "../contracts/semantic-proposal-v2.js";

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

function optionalRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  minimumKeys = requiredKeys.length,
): PlainRecord {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const ownKeys = Reflect.ownKeys(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (ownKeys.length < minimumKeys ||
      ownKeys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
      requiredKeys.some((key) => !ownKeys.includes(key))) invalid();
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) invalid();
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
  if (Object.getPrototypeOf(value) !== Array.prototype) invalid();
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
  const copied: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) invalid();
    copied.push(descriptor.value);
  }
  return Object.freeze(copied);
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
  const otherSpans: string[] = [];
  for (const span of array(data(subject, "explicit_other_spans"), 0, 64)) {
    otherSpans.push(string(span, 1, 256));
  }
  const items: SemanticMealCandidateV1["items"][number][] = [];
  for (const item of array(data(source, "items"), 1, 64)) {
    items.push(cloneItem(item));
  }
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

export function cloneSemanticProposalV2(
  value: unknown,
  _action: DietManagerAction,
  sourceText: string,
): SemanticProposalV2 {
  const cloneSubject = (subjectValue: unknown) => {
    const source = record(subjectValue, ["kind", "basis", "evidence_span", "explicit_other_spans"]);
    const basis = data(source, "basis");
    if (basis !== "explicit" && basis !== "private_agent_default") invalid();
    const otherSpans = array(data(source, "explicit_other_spans"), 0, 64)
      .map((span) => string(span, 1, 256));
    return Object.freeze({
      kind: literal(data(source, "kind"), "self"),
      basis,
      evidence_span: nullableEvidence(data(source, "evidence_span")),
      explicit_other_spans: Object.freeze(otherSpans),
    });
  };
  const cloneTime = (timeValue: unknown) => {
    const source = record(timeValue, ["kind", "evidence_span"]);
    const kind = data(source, "kind");
    const evidenceSpan = data(source, "evidence_span");
    if (kind === "source_text") {
      return Object.freeze({ kind, evidence_span: string(evidenceSpan, 1, 256) });
    }
    if (kind !== "unspecified" || evidenceSpan !== null) invalid();
    return Object.freeze({ kind, evidence_span: null });
  };
  const cloneProduct = (productValue: unknown) => {
    const source = record(productValue, ["raw_name", "normalized_hint", "evidence_span"]);
    return Object.freeze({
      raw_name: string(data(source, "raw_name"), 1, 256),
      normalized_hint: string(data(source, "normalized_hint"), 1, 256),
      evidence_span: string(data(source, "evidence_span"), 1, 256),
    });
  };
  const cloneStringValue = (fieldValue: unknown) => {
    const source = record(fieldValue, ["value", "evidence_span"]);
    return Object.freeze({
      value: string(data(source, "value"), 1, 128),
      evidence_span: string(data(source, "evidence_span"), 1, 256),
    });
  };
  const cloneNumberValue = (fieldValue: unknown) => {
    const source = record(fieldValue, ["value", "evidence_span"]);
    const numberValue = data(source, "value");
    if (typeof numberValue !== "number" || !Number.isFinite(numberValue) || numberValue <= 0) invalid();
    return Object.freeze({
      value: numberValue,
      evidence_span: string(data(source, "evidence_span"), 1, 256),
    });
  };
  const cloneEvidenceFields = (
    fieldsValue: unknown,
    allowedFields: readonly string[],
    numberFields: ReadonlySet<string>,
    minimumKeys: number,
  ) => {
    const source = optionalRecord(fieldsValue, [], allowedFields, minimumKeys);
    const cloned: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(source) as string[]) {
      const fieldValue = data(source, key);
      cloned[key] = fieldValue === null
        ? null
        : numberFields.has(key)
          ? cloneNumberValue(fieldValue)
          : cloneStringValue(fieldValue);
    }
    return Object.freeze(cloned);
  };

  const root = optionalRecord(value, ["kind"], [
    "subject", "occurrence", "meal_slot", "items", "occurred_at", "amount",
    "product", "package_amount", "per_package_content", "location", "expires_at", "price",
    "operation", "values", "target", "replacement",
  ]);
  const kind = data(root, "kind");
  let cloned: unknown;
  if (kind === "meal") {
    const source = record(value, ["kind", "subject", "occurrence", "meal_slot", "items", "occurred_at"]);
    const mealSlot = data(source, "meal_slot");
    if (!["breakfast", "lunch", "dinner", "snack", "unknown"].includes(mealSlot as string)) invalid();
    const items = array(data(source, "items"), 1, 64).map((itemValue) => {
      const item = record(itemValue, ["raw_name", "normalized_hint", "amount"]);
      return Object.freeze({
        raw_name: string(data(item, "raw_name"), 1, 256),
        normalized_hint: string(data(item, "normalized_hint"), 1, 256),
        amount: cloneAmount(data(item, "amount")),
      });
    });
    cloned = Object.freeze({
      kind, subject: cloneSubject(data(source, "subject")),
      occurrence: literal(data(source, "occurrence"), "completed"),
      meal_slot: mealSlot,
      items: Object.freeze(items),
      occurred_at: cloneTime(data(source, "occurred_at")),
    });
  } else if (kind === "water") {
    const source = record(value, ["kind", "subject", "amount", "occurred_at"]);
    cloned = Object.freeze({
      kind, subject: cloneSubject(data(source, "subject")),
      amount: cloneAmount(data(source, "amount")),
      occurred_at: cloneTime(data(source, "occurred_at")),
    });
  } else if (kind === "inventory") {
    const source = record(value, [
      "kind", "product", "package_amount", "per_package_content", "location",
      "expires_at", "price",
    ]);
    const perPackage = data(source, "per_package_content");
    const locationValue = data(source, "location");
    const expiresAt = data(source, "expires_at");
    const priceValue = data(source, "price");
    const packageAmount = cloneAmount(data(source, "package_amount"));
    const perPackageContent = perPackage === null ? null : cloneAmount(perPackage);
    if (packageAmount.kind !== "exact" || perPackageContent?.kind === "unknown") invalid();
    let price = null;
    if (priceValue !== null) {
      const priceSource = record(priceValue, ["amount", "currency", "evidence_span"]);
      const amount = data(priceSource, "amount");
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) invalid();
      price = Object.freeze({
        amount,
        currency: literal(data(priceSource, "currency"), "CNY"),
        evidence_span: string(data(priceSource, "evidence_span"), 1, 256),
      });
    }
    cloned = Object.freeze({
      kind,
      product: cloneProduct(data(source, "product")),
      package_amount: packageAmount,
      per_package_content: perPackageContent,
      location: locationValue === null ? null : cloneStringValue(locationValue),
      expires_at: expiresAt === null ? null : cloneTime(expiresAt),
      price,
    });
  } else if (kind === "profile") {
    const source = record(value, ["kind", "operation", "values"]);
    const operation = data(source, "operation");
    if (operation !== "update" && operation !== "clear") invalid();
    const fields = ["sex", "age_years", "height_cm", "weight_kg", "activity_level", "goal_direction"];
    const values = cloneEvidenceFields(
      data(source, "values"), fields,
      new Set(["age_years", "height_cm", "weight_kg"]), 1,
    ) as Record<string, unknown>;
    if (values.sex !== undefined && values.sex !== null) {
      const sex = values.sex as Readonly<{ value: string; evidence_span: string }>;
      if (sex.value !== "female" && sex.value !== "male") invalid();
    }
    cloned = Object.freeze({ kind, operation, values });
  } else if (kind === "goal") {
    const source = record(value, ["kind", "operation", "values"]);
    const operation = data(source, "operation");
    if (operation !== "confirm" && operation !== "update" && operation !== "clear") invalid();
    const fields = ["energy_kcal", "protein_g", "fat_g", "carbohydrate_g", "fiber_g", "water_ml"];
    cloned = Object.freeze({
      kind,
      operation,
      values: cloneEvidenceFields(data(source, "values"), fields, new Set(fields), 0),
    });
  } else if (kind === "record_mutation") {
    const source = optionalRecord(value, ["kind", "operation", "target"], ["replacement"]);
    const operation = data(source, "operation");
    if (operation !== "correct" && operation !== "undo" && operation !== "restore") invalid();
    const cloneMutationText = (textValue: unknown) => {
      const textSource = record(textValue, ["description", "evidence_span"]);
      return Object.freeze({
        description: string(data(textSource, "description"), 1, 512),
        evidence_span: string(data(textSource, "evidence_span"), 1, 256),
      });
    };
    const replacement = Reflect.ownKeys(source).includes("replacement")
      ? cloneMutationText(data(source, "replacement"))
      : undefined;
    cloned = Object.freeze({
      kind,
      operation,
      target: cloneMutationText(data(source, "target")),
      ...(replacement === undefined ? {} : { replacement }),
    });
  } else {
    invalid();
  }

  const assertEvidence = (nested: unknown): void => {
    if (Array.isArray(nested)) {
      for (const item of nested) assertEvidence(item);
      return;
    }
    if (nested === null || typeof nested !== "object") return;
    for (const [key, nestedValue] of Object.entries(nested)) {
      if (key === "evidence_span" && nestedValue !== null) {
        if (typeof nestedValue !== "string" || !sourceText.includes(nestedValue)) invalid();
      } else if (key === "explicit_other_spans") {
        if (!Array.isArray(nestedValue) || nestedValue.some((span) =>
          typeof span !== "string" || !sourceText.includes(span))) invalid();
      } else {
        assertEvidence(nestedValue);
      }
    }
  };
  assertEvidence(cloned);
  return cloned as SemanticProposalV2;
}
