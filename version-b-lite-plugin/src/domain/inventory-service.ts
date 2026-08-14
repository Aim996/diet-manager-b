import { isProxy } from "node:util/types";

import { assertOffsetIsoTimestamp } from "../authority/offset-timestamp.js";
import type {
  ExpirationEvidence,
  OpeningEvidence,
  PackageQuantityEvidence,
  PantryPurchaseEvidence,
  ProductIdentityEvidence,
  ProductSpecificationEvidence,
  StorageLocationEvidence,
} from "./types.js";

const MAX_TEXT_LENGTH = 256;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

export class PantryEvidenceAuthorityError extends Error {
  constructor(readonly reason: string) {
    super(`PANTRY_EVIDENCE_INVALID:${reason}`);
  }
}

function invalid(path: string): never {
  throw new PantryEvidenceAuthorityError(path);
}

function cloneOrdinary(value: unknown, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return invalid(path);
    return value;
  }
  if (typeof value !== "object") return invalid(path);
  if (isProxy(value)) return invalid(`${path}.proxy`);
  if (Array.isArray(value)) return invalid(path);
  if (Object.getPrototypeOf(value) !== Object.prototype) return invalid(`${path}.prototype`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === "symbol")) return invalid(`${path}.symbols`);
  const clone: Record<string, unknown> = {};
  for (const key of keys as readonly string[]) {
    const descriptor = descriptors[key];
    if (
      !descriptor || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined ||
      descriptor.enumerable !== true
    ) return invalid(`${path}.${key}.descriptor`);
    Object.defineProperty(clone, key, {
      value: cloneOrdinary(descriptor.value, `${path}.${key}`),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(clone);
}

function exactRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid(path);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return invalid(path);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_TEXT_LENGTH ||
    CONTROL_CHARACTERS.test(value)
  ) return invalid(path);
  return value;
}

function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return invalid(path);
  return value;
}

function nullablePositiveSafeInteger(value: unknown, path: string): number | null {
  return value === null ? null : positiveSafeInteger(value, path);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) return invalid(path);
  return value as T;
}

function nullableTimestamp(value: unknown, path: string): string | null {
  if (value === null) return null;
  return assertOffsetIsoTimestamp(value, () => invalid(path));
}

function validateSpecification(value: unknown, path: string): Readonly<ProductSpecificationEvidence> | null {
  if (value === null) return null;
  const record = exactRecord(value, ["value", "unit"], path);
  positiveSafeInteger(record.value, `${path}.value`);
  text(record.unit, `${path}.unit`);
  return record as unknown as Readonly<ProductSpecificationEvidence>;
}

function validateProductIdentity(value: unknown, path: string): Readonly<ProductIdentityEvidence> {
  const record = exactRecord(value, [
    "raw_name", "normalized_name", "brand", "variant_or_flavor", "specification", "evidence_kind",
  ], path);
  text(record.raw_name, `${path}.raw_name`);
  text(record.normalized_name, `${path}.normalized_name`);
  nullableText(record.brand, `${path}.brand`);
  nullableText(record.variant_or_flavor, `${path}.variant_or_flavor`);
  validateSpecification(record.specification, `${path}.specification`);
  const kind = enumValue(record.evidence_kind, ["explicit", "inherited_exact", "unknown"], `${path}.evidence_kind`);
  if (kind === "unknown" && (
    record.brand !== null || record.variant_or_flavor !== null || record.specification !== null
  )) return invalid(`${path}.evidence_kind`);
  return record as unknown as Readonly<ProductIdentityEvidence>;
}

function safeProduct(left: number, right: number, path: string): number {
  const product = BigInt(left) * BigInt(right);
  if (product > BigInt(Number.MAX_SAFE_INTEGER)) return invalid(path);
  return Number(product);
}

function validatePackageQuantity(value: unknown, path: string): Readonly<PackageQuantityEvidence> {
  const record = exactRecord(value, [
    "outer_count", "outer_unit", "inner_per_outer", "inner_unit", "capacity_per_inner",
    "capacity_unit", "total_inner", "total_capacity", "formula",
  ], path);
  const outerCount = nullablePositiveSafeInteger(record.outer_count, `${path}.outer_count`);
  const outerUnit = nullableText(record.outer_unit, `${path}.outer_unit`);
  const innerPerOuter = nullablePositiveSafeInteger(record.inner_per_outer, `${path}.inner_per_outer`);
  const innerUnit = nullableText(record.inner_unit, `${path}.inner_unit`);
  const capacityPerInner = nullablePositiveSafeInteger(record.capacity_per_inner, `${path}.capacity_per_inner`);
  const capacityUnit = nullableText(record.capacity_unit, `${path}.capacity_unit`);
  const totalInner = nullablePositiveSafeInteger(record.total_inner, `${path}.total_inner`);
  const totalCapacity = nullablePositiveSafeInteger(record.total_capacity, `${path}.total_capacity`);
  const formula = nullableText(record.formula, `${path}.formula`);

  if ((outerCount === null) !== (outerUnit === null)) return invalid(`${path}.outer`);
  if ((innerPerOuter === null) !== (innerUnit === null)) return invalid(`${path}.inner`);
  if ((capacityPerInner === null) !== (capacityUnit === null)) return invalid(`${path}.capacity`);
  if (outerCount === null) {
    if ([innerPerOuter, capacityPerInner, totalInner, totalCapacity, formula].some((item) => item !== null)) {
      return invalid(path);
    }
    return record as unknown as Readonly<PackageQuantityEvidence>;
  }
  if (innerPerOuter === null) {
    if ([capacityPerInner, totalInner, totalCapacity, formula].some((item) => item !== null)) return invalid(path);
    return record as unknown as Readonly<PackageQuantityEvidence>;
  }
  const expectedInner = safeProduct(outerCount, innerPerOuter, `${path}.total_inner`);
  if (totalInner !== expectedInner) return invalid(`${path}.total_inner`);
  if (capacityPerInner === null) {
    if (totalCapacity !== null || formula !== `${outerCount}*${innerPerOuter}=${expectedInner}`) {
      return invalid(`${path}.formula`);
    }
    return record as unknown as Readonly<PackageQuantityEvidence>;
  }
  const expectedCapacity = safeProduct(expectedInner, capacityPerInner, `${path}.total_capacity`);
  if (totalCapacity !== expectedCapacity) return invalid(`${path}.total_capacity`);
  if (formula !== `${outerCount}*${innerPerOuter}*${capacityPerInner}=${expectedCapacity}`) {
    return invalid(`${path}.formula`);
  }
  return record as unknown as Readonly<PackageQuantityEvidence>;
}

function validateLocation(value: unknown, path: string): Readonly<StorageLocationEvidence> {
  const record = exactRecord(value, ["value", "evidence_kind", "rule_version"], path);
  text(record.value, `${path}.value`);
  const kind = enumValue(record.evidence_kind, [
    "explicit", "configured_home_default", "corrected_explicit",
  ], `${path}.evidence_kind`);
  const rule = nullableText(record.rule_version, `${path}.rule_version`);
  if (kind === "configured_home_default" ? rule === null : rule !== null) {
    return invalid(`${path}.rule_version`);
  }
  return record as unknown as Readonly<StorageLocationEvidence>;
}

function validateOpening(value: unknown, path: string): Readonly<OpeningEvidence> | null {
  if (value === null) return null;
  const record = exactRecord(value, ["status", "opened_at", "evidence_kind", "rule_version"], path);
  const status = enumValue(record.status, ["sealed", "opened"], `${path}.status`);
  const openedAt = nullableTimestamp(record.opened_at, `${path}.opened_at`);
  const kind = enumValue(record.evidence_kind, ["explicit", "rule"], `${path}.evidence_kind`);
  const rule = nullableText(record.rule_version, `${path}.rule_version`);
  if ((status === "opened") !== (openedAt !== null)) return invalid(`${path}.opened_at`);
  if (kind === "rule" ? rule === null : rule !== null) return invalid(`${path}.rule_version`);
  return record as unknown as Readonly<OpeningEvidence>;
}

function validateExpiration(value: unknown, path: string): Readonly<ExpirationEvidence> {
  const record = exactRecord(value, ["explicit_at", "effective_at", "basis", "rule_version"], path);
  const explicitAt = nullableTimestamp(record.explicit_at, `${path}.explicit_at`);
  const effectiveAt = nullableTimestamp(record.effective_at, `${path}.effective_at`);
  const basis = enumValue(record.basis, ["explicit", "rule", "unknown"], `${path}.basis`);
  const rule = nullableText(record.rule_version, `${path}.rule_version`);
  if (basis === "unknown") {
    if (explicitAt !== null || effectiveAt !== null || rule !== null) return invalid(path);
  } else if (basis === "explicit") {
    if (explicitAt === null || effectiveAt !== explicitAt || rule !== null) return invalid(path);
  } else if (effectiveAt === null || rule === null) {
    return invalid(path);
  }
  return record as unknown as Readonly<ExpirationEvidence>;
}

export function validateAndFreezePantryPurchaseEvidence(value: unknown): Readonly<PantryPurchaseEvidence> {
  const cloned = cloneOrdinary(value, "pantry_evidence");
  const record = exactRecord(cloned, [
    "schema_version", "product_identity", "package_quantity", "location", "opening", "expiration",
  ], "pantry_evidence");
  enumValue(record.schema_version, ["diet-manager/pantry-evidence/v1"], "pantry_evidence.schema_version");
  validateProductIdentity(record.product_identity, "pantry_evidence.product_identity");
  validatePackageQuantity(record.package_quantity, "pantry_evidence.package_quantity");
  validateLocation(record.location, "pantry_evidence.location");
  validateOpening(record.opening, "pantry_evidence.opening");
  validateExpiration(record.expiration, "pantry_evidence.expiration");
  return record as unknown as Readonly<PantryPurchaseEvidence>;
}
