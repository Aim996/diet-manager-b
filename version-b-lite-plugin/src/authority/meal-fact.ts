import { isProxy } from "node:util/types";

export const MEAL_EVIDENCE_OPTIONAL_FIELDS = Object.freeze([
  "source_text",
  "occurred_time",
  "subject",
  "context",
] as const);

const MAX_SOURCE_TEXT_LENGTH = 4_096;
const MAX_ARRAY_LENGTH = 64;
const MAX_ID_LENGTH = 256;
const MAX_CONTEXT_TEXT_LENGTH = 256;
const MAX_UNIT_LENGTH = 64;
const MAX_ISO_TIMESTAMP_LENGTH = 64;
const MAX_DEPTH = 32;
const MAX_NODES = 10_000;
const OFFSET_ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/u;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

export class MealFactAuthorityError extends TypeError {
  readonly reason: string;

  constructor(reason: string) {
    super(`MEAL_FACT_AUTHORITY_INVALID:${reason}`);
    this.name = "MealFactAuthorityError";
    this.reason = reason;
  }
}

function invalid(reason: string): never {
  throw new MealFactAuthorityError(reason);
}

interface CloneContext {
  readonly active: WeakSet<object>;
  nodes: number;
}

function ordinaryClone(
  value: unknown,
  path: string,
  depth: number,
  context: CloneContext,
): unknown {
  if (depth > MAX_DEPTH) return invalid(`${path}:depth`);
  context.nodes += 1;
  if (context.nodes > MAX_NODES) return invalid(`${path}:nodes`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      return invalid(`${path}:number`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") return invalid(`${path}:value`);
  if (isProxy(value)) return invalid(`${path}:proxy`);
  if (context.active.has(value)) return invalid(`${path}:cycle`);
  context.active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return invalid(`${path}:prototype`);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        !lengthDescriptor || !("value" in lengthDescriptor) ||
        typeof lengthDescriptor.value !== "number" ||
        !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
        lengthDescriptor.value > MAX_ARRAY_LENGTH
      ) return invalid(`${path}:array_length`);
      const length = lengthDescriptor.value as number;
      const keys = Reflect.ownKeys(value);
      if (
        keys.length !== length + 1 ||
        keys.some((key) => typeof key !== "string") ||
        !keys.includes("length")
      ) return invalid(`${path}:array_keys`);
      const clone: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
          return invalid(`${path}[${index}]:descriptor`);
        }
        clone.push(ordinaryClone(
          descriptor.value,
          `${path}[${index}]`,
          depth + 1,
          context,
        ));
      }
      return Object.freeze(clone);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid(`${path}:prototype`);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_ARRAY_LENGTH || keys.some((key) => typeof key !== "string")) {
      return invalid(`${path}:keys`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const clone: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
        return invalid(`${path}.${key}:descriptor`);
      }
      Object.defineProperty(clone, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: ordinaryClone(descriptor.value, `${path}.${key}`, depth + 1, context),
      });
    }
    return Object.freeze(clone);
  } catch (error) {
    if (error instanceof MealFactAuthorityError) throw error;
    return invalid(`${path}:reflection`);
  } finally {
    context.active.delete(value);
  }
}

function cloneMealFactJson(value: unknown, path: string): unknown {
  return ordinaryClone(value, path, 0, { active: new WeakSet<object>(), nodes: 0 });
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(`${path}:shape`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) return invalid(`${path}:keys`);
  return value as Record<string, unknown>;
}

function boundedText(
  value: unknown,
  path: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" || value.trim().length === 0 ||
    value.length > maxLength || value.includes("\u0000")
  ) return invalid(`${path}:text`);
  return value;
}

function nullableText(
  value: unknown,
  path: string,
  maxLength: number,
): string | null {
  return value === null ? null : boundedText(value, path, maxLength);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return invalid(`${path}:enum`);
  }
  return value as T;
}

function safeNonnegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalid(`${path}:integer`);
  }
  return value;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function evidenceTimestamp(
  value: unknown,
  path: string,
): { readonly epoch: number; readonly value: string } {
  if (typeof value !== "string" || value.length > MAX_ISO_TIMESTAMP_LENGTH) {
    return invalid(`${path}:timestamp`);
  }
  const match = OFFSET_ISO_PATTERN.exec(value);
  if (match === null) return invalid(`${path}:timestamp`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? "0").padEnd(3, "0"));
  const offsetHour = match[8] === "Z" ? 0 : Number(match[10]);
  const offsetMinute = match[8] === "Z" ? 0 : Number(match[11]);
  if (
    year < 1_000 || year > 9_999 || month < 1 || month > 12 ||
    day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 ||
    second > 59 || offsetHour > 14 || offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) return invalid(`${path}:timestamp`);
  const localEpoch = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const sign = match[8] === "Z" || match[9] === "+" ? 1 : -1;
  const epoch = localEpoch - sign * (offsetHour * 60 + offsetMinute) * 60_000;
  const shanghaiYear = new Date(epoch + SHANGHAI_OFFSET_MS).getUTCFullYear();
  if (!Number.isFinite(epoch) || shanghaiYear < 1_000 || shanghaiYear > 9_999) {
    return invalid(`${path}:timestamp`);
  }
  return Object.freeze({ epoch, value });
}

function validateOccurredTime(
  value: unknown,
  path: string,
  occurredAt?: string,
): void {
  const evidence = exactRecord(value, [
    "raw_text",
    "resolved_start",
    "resolved_end",
    "precision",
    "timezone",
    "resolution_basis",
    "resolution_anchor",
    "resolver_version",
  ], path);
  nullableText(evidence.raw_text, `${path}.raw_text`, MAX_SOURCE_TEXT_LENGTH);
  const precision = enumValue(evidence.precision, [
    "exact", "date", "meal_period", "approximate", "unknown",
  ], `${path}.precision`);
  enumValue(evidence.timezone, ["Asia/Shanghai"], `${path}.timezone`);
  const basis = enumValue(evidence.resolution_basis, [
    "explicit", "relative_to_received_at", "default_received_at", "needs_clarification",
  ], `${path}.resolution_basis`);
  evidenceTimestamp(evidence.resolution_anchor, `${path}.resolution_anchor`);
  enumValue(
    evidence.resolver_version,
    ["diet-manager/time-parser-v1"],
    `${path}.resolver_version`,
  );
  if (
    basis === "needs_clarification" || precision === "unknown" ||
    evidence.resolved_start === null || evidence.resolved_end === null
  ) return invalid(`${path}.resolved_interval`);
  const start = evidenceTimestamp(evidence.resolved_start, `${path}.resolved_start`);
  const end = evidenceTimestamp(evidence.resolved_end, `${path}.resolved_end`);
  if (end.epoch <= start.epoch) return invalid(`${path}.resolved_interval`);
  if (occurredAt !== undefined && new Date(start.epoch).toISOString() !== occurredAt) {
    return invalid(`${path}.occurred_at`);
  }
}

function validateSubject(value: unknown, path: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(`${path}:shape`);
  }
  const source = value as Record<string, unknown>;
  const optionals = [
    "subject_entity_created",
    "excluded_non_self_share_count",
    "self_participated",
  ].filter((key) => Object.hasOwn(source, key));
  const subject = exactRecord(value, [
    "kind", "resolution_basis", ...optionals, "matched_span", "rule_version",
  ], path);
  enumValue(subject.kind, ["self"], `${path}.kind`);
  const basis = enumValue(subject.resolution_basis, [
    "omitted_subject_default",
    "explicit_self",
    "explicit_self_share",
    "collective_self_participation",
  ], `${path}.resolution_basis`);
  if (Object.hasOwn(subject, "subject_entity_created") && subject.subject_entity_created !== false) {
    return invalid(`${path}.subject_entity_created`);
  }
  if (Object.hasOwn(subject, "excluded_non_self_share_count")) {
    const count = safeNonnegativeInteger(
      subject.excluded_non_self_share_count,
      `${path}.excluded_non_self_share_count`,
    );
    if (count === 0 || basis !== "explicit_self_share") {
      return invalid(`${path}.excluded_non_self_share_count`);
    }
  } else if (basis === "explicit_self_share") {
    return invalid(`${path}.excluded_non_self_share_count`);
  }
  if (Object.hasOwn(subject, "self_participated")) {
    if (subject.self_participated !== true || basis !== "collective_self_participation") {
      return invalid(`${path}.self_participated`);
    }
  } else if (basis === "collective_self_participation") {
    return invalid(`${path}.self_participated`);
  }
  const matchedSpan = nullableText(subject.matched_span, `${path}.matched_span`, MAX_SOURCE_TEXT_LENGTH);
  if (
    (basis === "omitted_subject_default" && matchedSpan !== null) ||
    (basis !== "omitted_subject_default" && matchedSpan === null)
  ) return invalid(`${path}.matched_span`);
  enumValue(subject.rule_version, ["diet-manager/subject-v1"], `${path}.rule_version`);
}

function validateContextItem(value: unknown, path: string): void {
  const item = exactRecord(value, ["normalized_name", "quantity", "unit"], path);
  boundedText(item.normalized_name, `${path}.normalized_name`, MAX_CONTEXT_TEXT_LENGTH);
  if (
    item.quantity !== null &&
    (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) ||
      item.quantity < 0 ||
      (Number.isInteger(item.quantity) && !Number.isSafeInteger(item.quantity)))
  ) return invalid(`${path}.quantity`);
  if (item.unit !== null) boundedText(item.unit, `${path}.unit`, MAX_UNIT_LENGTH);
}

function validateAcceptedContext(
  value: unknown,
  path: string,
): "home" | "outside" | "company" | "unknown" {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(`${path}:shape`);
  }
  const source = value as Record<string, unknown>;
  const optionals = ["items", "scene"].filter((key) => Object.hasOwn(source, key));
  const context = exactRecord(value, [
    "context_id",
    "conversation_id",
    "revision",
    "generated_at",
    "valid_until",
    "source_message_id",
    "rule_version",
    "scope",
    ...optionals,
  ], path);
  for (const key of ["context_id", "conversation_id", "source_message_id"] as const) {
    boundedText(context[key], `${path}.${key}`, MAX_ID_LENGTH);
  }
  const revision = safeNonnegativeInteger(context.revision, `${path}.revision`);
  if (revision < 1) return invalid(`${path}.revision`);
  const generated = evidenceTimestamp(context.generated_at, `${path}.generated_at`);
  const validUntil = evidenceTimestamp(context.valid_until, `${path}.valid_until`);
  if (generated.epoch >= validUntil.epoch) return invalid(`${path}.valid_interval`);
  enumValue(context.rule_version, ["diet-manager/context-v1"], `${path}.rule_version`);
  enumValue(context.scope, ["meal", "meal_date"], `${path}.scope`);
  if (Object.hasOwn(context, "items")) {
    if (!Array.isArray(context.items) || context.items.length > MAX_ARRAY_LENGTH) {
      return invalid(`${path}.items`);
    }
    context.items.forEach((item, index) =>
      validateContextItem(item, `${path}.items[${index}]`));
  }
  return Object.hasOwn(context, "scene")
    ? enumValue(
        context.scene,
        ["home", "outside", "company", "unknown"],
        `${path}.scene`,
      )
    : "unknown";
}

function validateContext(value: unknown, path: string): void {
  const context = exactRecord(value, [
    "scene", "expired_context_ids", "inventory_read", "accepted_context", "rule_version",
  ], path);
  const scene = enumValue(
    context.scene,
    ["home", "outside", "company", "unknown"],
    `${path}.scene`,
  );
  if (!Array.isArray(context.expired_context_ids) || context.expired_context_ids.length > MAX_ARRAY_LENGTH) {
    return invalid(`${path}.expired_context_ids`);
  }
  const expiredIds = context.expired_context_ids.map((id, index) => boundedText(
    id,
    `${path}.expired_context_ids[${index}]`,
    MAX_ID_LENGTH,
  ));
  if (new Set(expiredIds).size !== expiredIds.length) {
    return invalid(`${path}.expired_context_ids`);
  }
  if (typeof context.inventory_read !== "boolean") return invalid(`${path}.inventory_read`);
  const acceptedScene = context.accepted_context === null
    ? "unknown"
    : validateAcceptedContext(context.accepted_context, `${path}.accepted_context`);
  if (scene !== acceptedScene) return invalid(`${path}.scene`);
  enumValue(context.rule_version, ["diet-manager/context-v1"], `${path}.rule_version`);
}

export function optionalMealEvidenceFields(
  value: Record<string, unknown>,
): readonly (typeof MEAL_EVIDENCE_OPTIONAL_FIELDS)[number][] {
  return MEAL_EVIDENCE_OPTIONAL_FIELDS.filter((field) => Object.hasOwn(value, field));
}

export function validateMealOperationEvidence(
  value: Record<string, unknown>,
  occurredAt: string,
  path: string,
): void {
  if (Object.hasOwn(value, "source_text")) {
    boundedText(value.source_text, `${path}.source_text`, MAX_SOURCE_TEXT_LENGTH);
  }
  if (Object.hasOwn(value, "occurred_time")) {
    validateOccurredTime(value.occurred_time, `${path}.occurred_time`, occurredAt);
  }
  if (Object.hasOwn(value, "subject")) {
    validateSubject(value.subject, `${path}.subject`);
  }
  if (Object.hasOwn(value, "context")) {
    validateContext(value.context, `${path}.context`);
  }
}

export function validateAndFreezeMealFactPayload(
  value: unknown,
  options: {
    readonly occurredAt?: string;
    readonly path?: string;
  } = {},
): Readonly<Record<string, unknown>> {
  const path = options.path ?? "meal_fact";
  const cloned = cloneMealFactJson(value, path);
  if (typeof cloned !== "object" || cloned === null || Array.isArray(cloned)) {
    return invalid(`${path}:shape`);
  }
  const source = cloned as Record<string, unknown>;
  const optionals = [
    ...optionalMealEvidenceFields(source),
    ...(Object.hasOwn(source, "progress_reservation") ? ["progress_reservation"] : []),
  ];
  const payload = exactRecord(cloned, [
    "authority_kind", "location", ...optionals, "timezone",
  ], path);
  enumValue(
    payload.authority_kind,
    ["diet-manager/meal-fact/v1"],
    `${path}.authority_kind`,
  );
  enumValue(payload.location, ["home", "outside"], `${path}.location`);
  enumValue(payload.timezone, ["Asia/Shanghai"], `${path}.timezone`);
  if (Object.hasOwn(payload, "source_text")) {
    boundedText(payload.source_text, `${path}.source_text`, MAX_SOURCE_TEXT_LENGTH);
  }
  if (Object.hasOwn(payload, "occurred_time")) {
    validateOccurredTime(
      payload.occurred_time,
      `${path}.occurred_time`,
      options.occurredAt,
    );
  }
  if (Object.hasOwn(payload, "subject")) validateSubject(payload.subject, `${path}.subject`);
  if (Object.hasOwn(payload, "context")) validateContext(payload.context, `${path}.context`);
  return payload;
}
