import { isProxy } from "node:util/types";

import { canonicalJson } from "../authority/canonical-json.js";

export function invalidRepository(prefix: string, reason: string): never {
  throw new Error(`${prefix}:${reason}`);
}

export function exactRepositoryInput(
  value: unknown,
  fields: readonly string[],
  prefix: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return invalidRepository(prefix, "input");
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string") ||
      (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0")) {
    return invalidRepository(prefix, "input");
  }
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true) return invalidRepository(prefix, "input");
    output[field] = descriptor.value;
  }
  return output;
}

export function repositoryText(
  value: unknown,
  prefix: string,
  reason: string,
  max = 512,
): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max ||
      /[\u0000-\u001F\u007F]/u.test(value)) return invalidRepository(prefix, reason);
  return value;
}

export function repositoryTimestamp(
  value: unknown,
  prefix: string,
  reason: string,
): string {
  const text = repositoryText(value, prefix, reason, 64);
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== text) {
    return invalidRepository(prefix, reason);
  }
  return text;
}

export function repositoryInteger(
  value: unknown,
  prefix: string,
  reason: string,
  minimum = 0,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    return invalidRepository(prefix, reason);
  }
  return value as number;
}

export function repositoryJson(value: unknown): string {
  return canonicalJson(value);
}

export function parseRepositoryJson(value: string, prefix: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return invalidRepository(prefix, "stored_json");
  }
  if (canonicalJson(parsed) !== value) return invalidRepository(prefix, "stored_json");
  return deepFreeze(parsed);
}

export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const child of value) deepFreeze(child);
    return Object.freeze(value) as T;
  }
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }
  return value;
}
