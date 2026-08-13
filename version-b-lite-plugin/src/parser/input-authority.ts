import { isProxy } from "node:util/types";

import type {
  CoreContextEntry,
  CoreContextItem,
  CoreParseInput,
  CoreScene,
  OffsetIsoTimestamp,
} from "./types.js";

const MAX_ARRAY_LENGTH = 64;
const MAX_ID_LENGTH = 256;
const MAX_SOURCE_TEXT_LENGTH = 4_096;
const MAX_CONTEXT_TEXT_LENGTH = 256;
const MAX_UNIT_LENGTH = 64;
const MAX_ISO_TIMESTAMP_LENGTH = 64;
const OFFSET_ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;

function invalid(reason: string): never {
  throw new TypeError(`CORE_INPUT_AUTHORITY_INVALID:${reason}`);
}

interface InspectedObject {
  readonly descriptors: Readonly<Record<string, PropertyDescriptor>>;
}

function nullRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function defineCloneValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function inspectObject(
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): InspectedObject {
  if (typeof value !== "object" || value === null) {
    return invalid(`${path}:shape`);
  }
  if (isProxy(value)) return invalid(`${path}:proxy`);
  if (Array.isArray(value)) return invalid(`${path}:shape`);
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return invalid(`${path}:prototype`);
  }

  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    return invalid(`${path}:keys`);
  }
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (
    keys.length < requiredKeys.length ||
    keys.some((key) => !allowed.has(key as string)) ||
    requiredKeys.some((key) => !keys.includes(key))
  ) {
    return invalid(`${path}:keys`);
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys as string[]) {
    const descriptor = Object.hasOwn(descriptors, key)
      ? descriptors[key]
      : undefined;
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      return invalid(`${path}.${key}:descriptor`);
    }
  }
  return { descriptors };
}

function descriptorValue(inspected: InspectedObject, key: string): unknown {
  if (!Object.hasOwn(inspected.descriptors, key)) return undefined;
  const descriptor = inspected.descriptors[key];
  if (!Object.hasOwn(descriptor, "value")) return undefined;
  return descriptor.value;
}

function boundedString(
  value: unknown,
  path: string,
  maxLength: number,
): string {
  if (typeof value !== "string") return invalid(`${path}:string`);
  if (value.trim().length === 0 || value.length > maxLength) {
    return invalid(`${path}:length`);
  }
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return boundedString(value, path, MAX_UNIT_LENGTH);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function offsetIsoTimestamp(value: unknown, path: string): OffsetIsoTimestamp {
  if (typeof value !== "string" || value.length > MAX_ISO_TIMESTAMP_LENGTH) {
    return invalid(`${path}:iso_timestamp`);
  }
  const match = OFFSET_ISO_PATTERN.exec(value);
  if (match === null) return invalid(`${path}:iso_timestamp`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === "Z" ? 0 : Number(match[9]);
  const offsetMinute = match[7] === "Z" ? 0 : Number(match[10]);
  if (
    year < 1_000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalid(`${path}:iso_timestamp`);
  }
  return value as OffsetIsoTimestamp;
}

function finiteSafeNumber(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (Number.isInteger(value) && !Number.isSafeInteger(value))
  ) {
    return invalid(`${path}:number`);
  }
  return value;
}

function nullableNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  return finiteSafeNumber(value, path);
}

function literalValue<const T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return invalid(`${path}:value`);
  }
  return value as T;
}

function inspectArray(value: unknown, path: string): readonly unknown[] {
  if (typeof value !== "object" || value === null) {
    return invalid(`${path}:shape`);
  }
  if (isProxy(value)) return invalid(`${path}:proxy`);
  if (!Array.isArray(value)) return invalid(`${path}:shape`);
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return invalid(`${path}:prototype`);
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !Object.hasOwn(lengthDescriptor, "value") ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return invalid(`${path}:array_keys`);
  }
  const length = lengthDescriptor.value;
  if (length > MAX_ARRAY_LENGTH) return invalid(`${path}:array_length`);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== length + 1 ||
    !keys.includes("length") ||
    keys.some((key) => {
      if (key === "length") return false;
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) return true;
      const index = Number(key);
      return !Number.isSafeInteger(index) || index < 0 || index >= length;
    })
  ) {
    return invalid(`${path}:array_keys`);
  }

  const cloned: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      return invalid(`${path}:array_keys`);
    }
    cloned.push(descriptor.value);
  }
  return cloned;
}

function cloneContextItem(value: unknown, path: string): Readonly<CoreContextItem> {
  const inspected = inspectObject(
    value,
    path,
    ["normalized_name", "quantity", "unit"],
  );
  const result = nullRecord();
  defineCloneValue(
    result,
    "normalized_name",
    boundedString(
      descriptorValue(inspected, "normalized_name"),
      `${path}.normalized_name`,
      MAX_CONTEXT_TEXT_LENGTH,
    ),
  );
  defineCloneValue(
    result,
    "quantity",
    nullableNumber(
      descriptorValue(inspected, "quantity"),
      `${path}.quantity`,
    ),
  );
  defineCloneValue(
    result,
    "unit",
    nullableString(descriptorValue(inspected, "unit"), `${path}.unit`),
  );
  return Object.freeze(result) as unknown as Readonly<CoreContextItem>;
}

function cloneContextItems(value: unknown, path: string): readonly CoreContextItem[] {
  const inspected = inspectArray(value, path);
  return Object.freeze(
    inspected.map((item, index) => cloneContextItem(item, `${path}[${index}]`)),
  );
}

function cloneContextEntry(value: unknown, path: string): Readonly<CoreContextEntry> {
  const inspected = inspectObject(
    value,
    path,
    [
      "context_id",
      "conversation_id",
      "revision",
      "generated_at",
      "valid_until",
      "source_message_id",
      "rule_version",
      "scope",
    ],
    ["items", "scene"],
  );
  const revision = finiteSafeNumber(
    descriptorValue(inspected, "revision"),
    `${path}.revision`,
  );
  if (!Number.isInteger(revision) || revision < 0) {
    return invalid(`${path}.revision:number`);
  }

  const result = nullRecord() as Record<string, unknown> & {
    context_id: string;
    conversation_id: string;
    revision: number;
    generated_at: OffsetIsoTimestamp;
    valid_until: OffsetIsoTimestamp;
    source_message_id: string;
    rule_version: "diet-manager/context-v1";
    scope: "meal" | "meal_date";
    items?: readonly CoreContextItem[];
    scene?: CoreScene;
  };
  defineCloneValue(result, "context_id", boundedString(
      descriptorValue(inspected, "context_id"),
      `${path}.context_id`,
      MAX_ID_LENGTH,
  ));
  defineCloneValue(result, "conversation_id", boundedString(
      descriptorValue(inspected, "conversation_id"),
      `${path}.conversation_id`,
      MAX_ID_LENGTH,
  ));
  defineCloneValue(result, "revision", revision);
  defineCloneValue(result, "generated_at", offsetIsoTimestamp(
      descriptorValue(inspected, "generated_at"),
      `${path}.generated_at`,
  ));
  defineCloneValue(result, "valid_until", offsetIsoTimestamp(
      descriptorValue(inspected, "valid_until"),
      `${path}.valid_until`,
  ));
  defineCloneValue(result, "source_message_id", boundedString(
      descriptorValue(inspected, "source_message_id"),
      `${path}.source_message_id`,
      MAX_ID_LENGTH,
  ));
  defineCloneValue(result, "rule_version", literalValue(
      descriptorValue(inspected, "rule_version"),
      `${path}.rule_version`,
      ["diet-manager/context-v1"],
  ));
  defineCloneValue(result, "scope", literalValue(
      descriptorValue(inspected, "scope"),
      `${path}.scope`,
      ["meal", "meal_date"],
  ));
  if (Object.hasOwn(inspected.descriptors, "items")) {
    defineCloneValue(
      result,
      "items",
      cloneContextItems(
        descriptorValue(inspected, "items"),
        `${path}.items`,
      ),
    );
  }
  if (Object.hasOwn(inspected.descriptors, "scene")) {
    defineCloneValue(
      result,
      "scene",
      literalValue(
        descriptorValue(inspected, "scene"),
        `${path}.scene`,
        ["home", "outside", "company", "unknown"],
      ),
    );
  }
  return Object.freeze(result) as Readonly<CoreContextEntry>;
}

function clonePriorContext(value: unknown): readonly CoreContextEntry[] {
  const inspected = inspectArray(value, "input.prior_context");
  return Object.freeze(
    inspected.map((entry, index) =>
      cloneContextEntry(entry, `input.prior_context[${index}]`),
    ),
  );
}

export function cloneCoreParseInput(value: unknown): Readonly<CoreParseInput> {
  const inspected = inspectObject(value, "input", [
    "source_text",
    "received_at",
    "timezone",
    "operation_id",
    "source_message_id",
    "conversation_id",
    "prior_context",
  ]);

  const result = nullRecord();
  defineCloneValue(result, "source_text", boundedString(
      descriptorValue(inspected, "source_text"),
      "input.source_text",
      MAX_SOURCE_TEXT_LENGTH,
  ));
  defineCloneValue(result, "received_at", offsetIsoTimestamp(
      descriptorValue(inspected, "received_at"),
      "input.received_at",
  ));
  defineCloneValue(result, "timezone", literalValue(
      descriptorValue(inspected, "timezone"),
      "input.timezone",
      ["Asia/Shanghai"],
  ));
  defineCloneValue(result, "operation_id", boundedString(
      descriptorValue(inspected, "operation_id"),
      "input.operation_id",
      MAX_ID_LENGTH,
  ));
  defineCloneValue(result, "source_message_id", boundedString(
      descriptorValue(inspected, "source_message_id"),
      "input.source_message_id",
      MAX_ID_LENGTH,
  ));
  defineCloneValue(result, "conversation_id", boundedString(
      descriptorValue(inspected, "conversation_id"),
      "input.conversation_id",
      MAX_ID_LENGTH,
  ));
  defineCloneValue(result, "prior_context", clonePriorContext(
      descriptorValue(inspected, "prior_context"),
  ));
  return Object.freeze(result) as unknown as Readonly<CoreParseInput>;
}
