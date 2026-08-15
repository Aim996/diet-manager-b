import { createHash } from "node:crypto";

const MAX_DEPTH = 32;
const MAX_NODES = 10_000;
const MAX_STRING_LENGTH = 262_144;
const MAX_UTF8_BYTES = 1_048_576;

function invalid(reason: string): never {
  throw new TypeError(`AUTHORITY_JSON_INVALID:${reason}`);
}

interface CanonicalContext {
  active: WeakSet<object>;
  nodes: number;
}

function visit(value: unknown, depth: number, context: CanonicalContext): string {
  if (depth > MAX_DEPTH) return invalid("depth");
  context.nodes += 1;
  if (context.nodes > MAX_NODES) return invalid("nodes");

  if (value === null) return "null";
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) return invalid("string");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return invalid("number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") return invalid("type");
  if (context.active.has(value)) return invalid("cycle");

  context.active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return invalid("prototype");
      const ownKeys = Reflect.ownKeys(value);
      for (const key of ownKeys) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)) {
          return invalid("array_key");
        }
      }
      const values: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          return invalid("sparse_array");
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          return invalid("descriptor");
        }
        values.push(visit(descriptor.value, depth + 1, context));
      }
      return `[${values.join(",")}]`;
    }

    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return invalid("symbol");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const stringKeys = keys as string[];
    for (const key of stringKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return invalid("descriptor");
      }
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid("prototype");

    return `{${stringKeys
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${visit(descriptors[key].value, depth + 1, context)}`,
      )
      .join(",")}}`;
  } finally {
    context.active.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  const result = visit(value, 0, { active: new WeakSet<object>(), nodes: 0 });
  if (Buffer.byteLength(result, "utf8") > MAX_UTF8_BYTES) return invalid("bytes");
  return result;
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256")
    .update(Buffer.from(canonicalJson(value), "utf8"))
    .digest("hex")
    .toUpperCase();
}
