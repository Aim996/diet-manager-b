import { createHash } from "node:crypto";

import { canonicalSha256 } from "../authority/canonical-json.js";
import type { DomainEnvelopeInput } from "./types.js";

function invalid(reason: string): never {
  throw new TypeError(`DOMAIN_IDENTITY_INVALID:${reason}`);
}

export function deriveDomainId(
  kind: string,
  idempotencyKey: string,
  sequence: number,
): string {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(kind)) return invalid("kind");
  if (
    idempotencyKey.length === 0 ||
    idempotencyKey.length > 256 ||
    !/^[\x20-\x7E]+$/.test(idempotencyKey)
  ) {
    return invalid("idempotency_key");
  }
  if (!Number.isSafeInteger(sequence) || sequence < 0) return invalid("sequence");
  const digest = createHash("sha256")
    .update(`${kind}\u0000${idempotencyKey}\u0000${sequence}`, "utf8")
    .digest("hex");
  return `${kind}-${digest.slice(0, 32)}`;
}

export function digestDomainEnvelope(input: DomainEnvelopeInput): string {
  return canonicalSha256(input);
}

export function toNaturalDate(
  timestamp: string,
  timezone: "Asia/Shanghai",
): string {
  if (timezone !== "Asia/Shanghai") return invalid("timezone");
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== timestamp) {
    return invalid("timestamp");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}
