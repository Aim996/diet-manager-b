import { isProxy } from "node:util/types";

import type {
  CoreContextEntry,
  CoreContextItem,
  CoreParseInput,
  CoreScene,
} from "./types.js";

function invalid(reason: string): never {
  throw new TypeError(`CORE_INPUT_AUTHORITY_INVALID:${reason}`);
}

interface InspectedObject {
  readonly descriptors: Readonly<Record<string, PropertyDescriptor>>;
}

function inspectObject(
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): InspectedObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(`${path}:shape`);
  }
  if (isProxy(value)) return invalid(`${path}:proxy`);
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
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return invalid(`${path}.${key}:descriptor`);
    }
  }
  return { descriptors };
}

function descriptorValue(inspected: InspectedObject, key: string): unknown {
  return inspected.descriptors[key]?.value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") return invalid(`${path}:string`);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return stringValue(value, path);
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
  if (!Array.isArray(value)) return invalid(`${path}:shape`);
  if (isProxy(value)) return invalid(`${path}:proxy`);
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return invalid(`${path}:prototype`);
  }

  const keys = Reflect.ownKeys(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return invalid(`${path}:array_keys`);
  }
  const length = lengthDescriptor.value;
  const expectedKeys = new Set<string>([
    ...Array.from({ length }, (_, index) => String(index)),
    "length",
  ]);
  if (
    keys.length !== expectedKeys.size ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    return invalid(`${path}:array_keys`);
  }

  const cloned: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
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
  return Object.freeze({
    normalized_name: stringValue(
      descriptorValue(inspected, "normalized_name"),
      `${path}.normalized_name`,
    ),
    quantity: nullableNumber(
      descriptorValue(inspected, "quantity"),
      `${path}.quantity`,
    ),
    unit: nullableString(descriptorValue(inspected, "unit"), `${path}.unit`),
  });
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

  const result: {
    context_id: string;
    conversation_id: string;
    revision: number;
    generated_at: string;
    valid_until: string;
    source_message_id: string;
    rule_version: "diet-manager/context-v1";
    scope: "meal" | "meal_date";
    items?: readonly CoreContextItem[];
    scene?: CoreScene;
  } = {
    context_id: stringValue(
      descriptorValue(inspected, "context_id"),
      `${path}.context_id`,
    ),
    conversation_id: stringValue(
      descriptorValue(inspected, "conversation_id"),
      `${path}.conversation_id`,
    ),
    revision,
    generated_at: stringValue(
      descriptorValue(inspected, "generated_at"),
      `${path}.generated_at`,
    ),
    valid_until: stringValue(
      descriptorValue(inspected, "valid_until"),
      `${path}.valid_until`,
    ),
    source_message_id: stringValue(
      descriptorValue(inspected, "source_message_id"),
      `${path}.source_message_id`,
    ),
    rule_version: literalValue(
      descriptorValue(inspected, "rule_version"),
      `${path}.rule_version`,
      ["diet-manager/context-v1"],
    ),
    scope: literalValue(
      descriptorValue(inspected, "scope"),
      `${path}.scope`,
      ["meal", "meal_date"],
    ),
  };
  if (inspected.descriptors.items !== undefined) {
    result.items = cloneContextItems(
      descriptorValue(inspected, "items"),
      `${path}.items`,
    );
  }
  if (inspected.descriptors.scene !== undefined) {
    result.scene = literalValue(
      descriptorValue(inspected, "scene"),
      `${path}.scene`,
      ["home", "outside", "company", "unknown"],
    );
  }
  return Object.freeze(result);
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

  return Object.freeze({
    source_text: stringValue(
      descriptorValue(inspected, "source_text"),
      "input.source_text",
    ),
    received_at: stringValue(
      descriptorValue(inspected, "received_at"),
      "input.received_at",
    ),
    timezone: literalValue(
      descriptorValue(inspected, "timezone"),
      "input.timezone",
      ["Asia/Shanghai"],
    ),
    operation_id: stringValue(
      descriptorValue(inspected, "operation_id"),
      "input.operation_id",
    ),
    source_message_id: stringValue(
      descriptorValue(inspected, "source_message_id"),
      "input.source_message_id",
    ),
    conversation_id: stringValue(
      descriptorValue(inspected, "conversation_id"),
      "input.conversation_id",
    ),
    prior_context: clonePriorContext(
      descriptorValue(inspected, "prior_context"),
    ),
  });
}
