import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

import { canonicalJson } from "../authority/canonical-json.js";
import { assertOffsetIsoTimestamp } from "../authority/offset-timestamp.js";
import type {
  ExpirationEvidence,
  InventoryAllocationPlan,
  OpeningEvidence,
  PackageQuantityEvidence,
  PantryPurchaseEvidence,
  ProductIdentityEvidence,
  ProductSpecificationEvidence,
  StorageLocationEvidence,
} from "./types.js";

export type {
  ExpirationEvidence,
  InventoryAllocationPlan,
  OpeningEvidence,
  PackageQuantityEvidence,
  PantryPurchaseEvidence,
  ProductIdentityEvidence,
  StorageLocationEvidence,
} from "./types.js";

export interface PackageQuantityInput {
  readonly outer_count: number | null;
  readonly outer_unit: string | null;
  readonly inner_per_outer: number | null;
  readonly inner_unit: string | null;
  readonly capacity_per_inner: number | null;
  readonly capacity_unit: string | null;
  readonly total_inner: number | null;
  readonly total_capacity: number | null;
}

export interface ProductIdentityCandidate {
  readonly product_id: string;
  readonly identity: Readonly<ProductIdentityEvidence>;
}

export interface ProductIdentityResolutionInput {
  readonly requested: Readonly<ProductIdentityEvidence>;
  readonly candidates: readonly Readonly<ProductIdentityCandidate>[];
}

export type ProductIdentityResolution =
  | Readonly<{ status: "new"; product_id: string }>
  | Readonly<{ status: "reuse_exact"; product_id: string }>
  | Readonly<{ status: "needs_clarification"; candidate_product_ids: readonly string[] }>;

export interface LocationRuleInput {
  readonly explicit_location: string | null;
  readonly configured_home_default: Readonly<{
    readonly value: string;
    readonly rule_version: string;
  }> | null;
}

export interface OpeningRuleInput {
  readonly partial_use_explicit: boolean;
  readonly anchor_at: string;
  readonly rule_version: "diet-manager/opening-evidence-v1";
}

export interface ExpirationRuleInput {
  readonly reliability: "explicit" | "reliable_rule" | "unreliable";
  readonly explicit_at: string | null;
  readonly duration_days: number | null;
  readonly anchor_at: string;
  readonly rule_version: string | null;
}

export interface InventoryAllocationCandidate {
  readonly product_id: string;
  readonly product_identity_fingerprint: string;
  readonly batch_id: string;
  readonly available_microunits: number;
  readonly unit: string;
  readonly effective_expiration_at: string | null;
  readonly stocked_at: string;
  readonly effective_status: "available" | "expired" | "unavailable";
}

export interface InventoryAllocationInput {
  readonly location: "home" | "outside";
  readonly explicit_skip: boolean;
  readonly requested_microunits: number | null;
  readonly unit: string;
  readonly specified_batch_id: string | null;
  readonly candidates: readonly Readonly<InventoryAllocationCandidate>[];
}

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
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return invalid(`${path}.prototype`);
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor || !("value" in lengthDescriptor) || typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0
    ) return invalid(`${path}.length`);
    const length = lengthDescriptor.value as number;
    const keys = Reflect.ownKeys(value);
    const expected = ["length", ...Array.from({ length }, (_, index) => String(index))];
    if (
      keys.some((key) => typeof key === "symbol") || keys.length !== expected.length ||
      expected.some((key) => !Object.hasOwn(descriptors, key))
    ) return invalid(path);
    const clone: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
        return invalid(`${path}.${index}.descriptor`);
      }
      clone.push(cloneOrdinary(descriptor.value, `${path}.${index}`));
    }
    return Object.freeze(clone);
  }
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

export function validateAndFreezeProductIdentityEvidence(value: unknown): Readonly<ProductIdentityEvidence> {
  return validateProductIdentity(cloneOrdinary(value, "product_identity"), "product_identity");
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

export function resolvePackageQuantity(input: Readonly<PackageQuantityInput>): Readonly<PackageQuantityEvidence> {
  const cloned = cloneOrdinary(input, "package_quantity_input");
  const record = exactRecord(cloned, [
    "outer_count", "outer_unit", "inner_per_outer", "inner_unit", "capacity_per_inner",
    "capacity_unit", "total_inner", "total_capacity",
  ], "package_quantity_input");
  const outerCount = nullablePositiveSafeInteger(record.outer_count, "package_quantity_input.outer_count");
  const outerUnit = nullableText(record.outer_unit, "package_quantity_input.outer_unit");
  const innerPerOuter = nullablePositiveSafeInteger(record.inner_per_outer, "package_quantity_input.inner_per_outer");
  const innerUnit = nullableText(record.inner_unit, "package_quantity_input.inner_unit");
  const capacityPerInner = nullablePositiveSafeInteger(record.capacity_per_inner, "package_quantity_input.capacity_per_inner");
  const capacityUnit = nullableText(record.capacity_unit, "package_quantity_input.capacity_unit");
  const suppliedTotalInner = nullablePositiveSafeInteger(record.total_inner, "package_quantity_input.total_inner");
  const suppliedTotalCapacity = nullablePositiveSafeInteger(record.total_capacity, "package_quantity_input.total_capacity");
  if ((outerCount === null) !== (outerUnit === null)) return invalid("package_quantity_input.outer");
  if ((innerPerOuter === null) !== (innerUnit === null)) return invalid("package_quantity_input.inner");
  if ((capacityPerInner === null) !== (capacityUnit === null)) return invalid("package_quantity_input.capacity");
  if (outerCount === null) {
    if ([innerPerOuter, capacityPerInner, suppliedTotalInner, suppliedTotalCapacity].some((value) => value !== null)) {
      return invalid("package_quantity_input");
    }
    return Object.freeze({
      outer_count: null,
      outer_unit: null,
      inner_per_outer: null,
      inner_unit: null,
      capacity_per_inner: null,
      capacity_unit: null,
      total_inner: null,
      total_capacity: null,
      formula: null,
    });
  }
  if (innerPerOuter === null) {
    if (capacityPerInner !== null || suppliedTotalInner !== null || suppliedTotalCapacity !== null) {
      return invalid("package_quantity_input");
    }
    return Object.freeze({
      outer_count: outerCount,
      outer_unit: outerUnit,
      inner_per_outer: null,
      inner_unit: null,
      capacity_per_inner: null,
      capacity_unit: null,
      total_inner: null,
      total_capacity: null,
      formula: null,
    });
  }
  const totalInner = safeProduct(outerCount, innerPerOuter, "package_quantity_input.total_inner");
  if (suppliedTotalInner !== null && suppliedTotalInner !== totalInner) {
    return invalid("package_quantity_input.total_inner");
  }
  if (capacityPerInner === null) {
    if (suppliedTotalCapacity !== null) return invalid("package_quantity_input.total_capacity");
    return Object.freeze({
      outer_count: outerCount,
      outer_unit: outerUnit,
      inner_per_outer: innerPerOuter,
      inner_unit: innerUnit,
      capacity_per_inner: null,
      capacity_unit: null,
      total_inner: totalInner,
      total_capacity: null,
      formula: `${outerCount}*${innerPerOuter}=${totalInner}`,
    });
  }
  const totalCapacity = safeProduct(totalInner, capacityPerInner, "package_quantity_input.total_capacity");
  if (suppliedTotalCapacity !== null && suppliedTotalCapacity !== totalCapacity) {
    return invalid("package_quantity_input.total_capacity");
  }
  return Object.freeze({
    outer_count: outerCount,
    outer_unit: outerUnit,
    inner_per_outer: innerPerOuter,
    inner_unit: innerUnit,
    capacity_per_inner: capacityPerInner,
    capacity_unit: capacityUnit,
    total_inner: totalInner,
    total_capacity: totalCapacity,
    formula: `${outerCount}*${innerPerOuter}*${capacityPerInner}=${totalCapacity}`,
  });
}

function validatedIdentity(value: unknown, path: string): Readonly<ProductIdentityEvidence> {
  const cloned = cloneOrdinary(value, path);
  return validateProductIdentity(cloned, path);
}

function identityMaterial(identity: Readonly<ProductIdentityEvidence>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    normalized_name: identity.normalized_name,
    brand: identity.brand,
    variant_or_flavor: identity.variant_or_flavor,
    specification: identity.specification,
  });
}

export function productIdentityFingerprint(input: Readonly<ProductIdentityEvidence>): string {
  const identity = validatedIdentity(input, "product_identity");
  return createHash("sha256").update(canonicalJson(identityMaterial(identity)), "utf8").digest("hex").toUpperCase();
}

function identityScore(
  requested: Readonly<ProductIdentityEvidence>,
  candidate: Readonly<ProductIdentityEvidence>,
): number {
  let score = 0;
  if (candidate.brand === requested.brand) score += 1;
  if (candidate.variant_or_flavor === requested.variant_or_flavor) score += 1;
  if (canonicalJson(candidate.specification) === canonicalJson(requested.specification)) score += 1;
  return score;
}

function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function resolveProductIdentity(input: Readonly<ProductIdentityResolutionInput>): ProductIdentityResolution {
  const cloned = cloneOrdinary(input, "product_identity_resolution");
  const record = exactRecord(cloned, ["requested", "candidates"], "product_identity_resolution");
  const requested = validateProductIdentity(record.requested, "product_identity_resolution.requested");
  if (!Array.isArray(record.candidates)) return invalid("product_identity_resolution.candidates");
  if (record.candidates.length > 256) return invalid("product_identity_resolution.candidates.length");
  const candidates = record.candidates.map((value, index) => {
    const candidate = exactRecord(value, ["product_id", "identity"], `product_identity_resolution.candidates.${index}`);
    return Object.freeze({
      product_id: text(candidate.product_id, `product_identity_resolution.candidates.${index}.product_id`),
      identity: validateProductIdentity(candidate.identity, `product_identity_resolution.candidates.${index}.identity`),
    });
  });
  const ids = new Set(candidates.map(({ product_id }) => product_id));
  if (ids.size !== candidates.length) return invalid("product_identity_resolution.candidates.product_id");
  const fingerprint = productIdentityFingerprint(requested);
  const exact = candidates
    .filter(({ identity }) => productIdentityFingerprint(identity) === fingerprint)
    .sort((left, right) => ordinal(left.product_id, right.product_id));
  if (exact.length === 1) return Object.freeze({ status: "reuse_exact", product_id: exact[0]!.product_id });
  if (exact.length > 1) {
    return Object.freeze({
      status: "needs_clarification",
      candidate_product_ids: Object.freeze(exact.slice(0, 4).map(({ product_id }) => product_id)),
    });
  }
  const sameName = candidates
    .filter(({ identity }) => identity.normalized_name === requested.normalized_name)
    .sort((left, right) =>
      identityScore(requested, right.identity) - identityScore(requested, left.identity) ||
      ordinal(left.product_id, right.product_id));
  if (sameName.length >= 2) {
    return Object.freeze({
      status: "needs_clarification",
      candidate_product_ids: Object.freeze(sameName.slice(0, 4).map(({ product_id }) => product_id)),
    });
  }
  return Object.freeze({ status: "new", product_id: `product-${fingerprint.slice(0, 32).toLowerCase()}` });
}

export function resolveStorageLocation(input: Readonly<LocationRuleInput>): Readonly<StorageLocationEvidence> {
  const cloned = cloneOrdinary(input, "location_rule");
  const record = exactRecord(cloned, ["explicit_location", "configured_home_default"], "location_rule");
  const explicit = nullableText(record.explicit_location, "location_rule.explicit_location");
  if (explicit !== null) {
    return Object.freeze({ value: explicit, evidence_kind: "explicit", rule_version: null });
  }
  const configured = exactRecord(
    record.configured_home_default,
    ["value", "rule_version"],
    "location_rule.configured_home_default",
  );
  return Object.freeze({
    value: text(configured.value, "location_rule.configured_home_default.value"),
    evidence_kind: "configured_home_default",
    rule_version: text(configured.rule_version, "location_rule.configured_home_default.rule_version"),
  });
}

export function resolveOpening(input: Readonly<OpeningRuleInput>): Readonly<OpeningEvidence> | null {
  const cloned = cloneOrdinary(input, "opening_rule");
  const record = exactRecord(cloned, ["partial_use_explicit", "anchor_at", "rule_version"], "opening_rule");
  if (typeof record.partial_use_explicit !== "boolean") return invalid("opening_rule.partial_use_explicit");
  const anchor = assertOffsetIsoTimestamp(record.anchor_at, () => invalid("opening_rule.anchor_at"));
  enumValue(record.rule_version, ["diet-manager/opening-evidence-v1"], "opening_rule.rule_version");
  if (!record.partial_use_explicit) return null;
  return Object.freeze({
    status: "opened",
    opened_at: anchor,
    evidence_kind: "rule",
    rule_version: "diet-manager/opening-evidence-v1",
  });
}

function shanghaiCalendarAdd(anchor: string, durationDays: number, path: string): string {
  const epoch = Date.parse(anchor);
  const local = new Date(epoch + 8 * 60 * 60 * 1_000);
  const calculated = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + durationDays,
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  );
  if (!Number.isFinite(calculated)) return invalid(path);
  const result = new Date(calculated);
  const year = result.getUTCFullYear();
  if (year < 1_000 || year > 9_999) return invalid(path);
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${pad(year, 4)}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}` +
    `T${pad(result.getUTCHours())}:${pad(result.getUTCMinutes())}:${pad(result.getUTCSeconds())}` +
    `.${pad(result.getUTCMilliseconds(), 3)}+08:00`;
}

export function resolveExpiration(input: Readonly<ExpirationRuleInput>): Readonly<ExpirationEvidence> {
  const cloned = cloneOrdinary(input, "expiration_rule");
  const record = exactRecord(cloned, [
    "reliability", "explicit_at", "duration_days", "anchor_at", "rule_version",
  ], "expiration_rule");
  const reliability = enumValue(
    record.reliability,
    ["explicit", "reliable_rule", "unreliable"],
    "expiration_rule.reliability",
  );
  const explicitAt = nullableTimestamp(record.explicit_at, "expiration_rule.explicit_at");
  const duration = record.duration_days === null
    ? null
    : positiveSafeInteger(record.duration_days, "expiration_rule.duration_days");
  const anchor = assertOffsetIsoTimestamp(record.anchor_at, () => invalid("expiration_rule.anchor_at"));
  const rule = nullableText(record.rule_version, "expiration_rule.rule_version");
  if (reliability === "unreliable") {
    if (explicitAt !== null || duration !== null || rule !== null) return invalid("expiration_rule");
    return Object.freeze({ explicit_at: null, effective_at: null, basis: "unknown", rule_version: null });
  }
  if (reliability === "explicit") {
    if (explicitAt === null || duration !== null || rule !== null) return invalid("expiration_rule");
    return Object.freeze({ explicit_at: explicitAt, effective_at: explicitAt, basis: "explicit", rule_version: null });
  }
  if (explicitAt !== null || duration === null || rule === null) return invalid("expiration_rule");
  return Object.freeze({
    explicit_at: null,
    effective_at: shanghaiCalendarAdd(anchor, duration, "expiration_rule.effective_at"),
    basis: "rule",
    rule_version: rule,
  });
}

function emptyAllocationPlan(
  status: Exclude<InventoryAllocationPlan["status"], "matched">,
  requestedMicrounits: number | null,
  unit: string,
  candidateCount: number,
  issueCode: InventoryAllocationPlan["issue_code"],
  readRequired: boolean,
): Readonly<InventoryAllocationPlan> {
  return Object.freeze({
    status,
    requested_microunits: requestedMicrounits,
    unit,
    allocations: Object.freeze([]),
    candidate_count: candidateCount,
    issue_code: issueCode,
    read_required: readRequired,
  });
}

function nonnegativeSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid(path);
  return value;
}

function timestampEpoch(value: unknown, path: string): { readonly value: string; readonly epoch: number } {
  const timestamp = assertOffsetIsoTimestamp(value, () => invalid(path));
  const epoch = Date.parse(timestamp);
  if (!Number.isFinite(epoch)) return invalid(path);
  return Object.freeze({ value: timestamp, epoch });
}

export function resolveInventoryAllocation(
  input: Readonly<InventoryAllocationInput>,
): Readonly<InventoryAllocationPlan> {
  if (typeof input !== "object" || input === null || isProxy(input)) return invalid("inventory_allocation");
  const unit = text(input.unit, "inventory_allocation.unit");
  if (input.location !== "home" && input.location !== "outside") return invalid("inventory_allocation.location");
  if (typeof input.explicit_skip !== "boolean") return invalid("inventory_allocation.explicit_skip");
  const requested = input.requested_microunits === null
    ? null
    : positiveSafeInteger(input.requested_microunits, "inventory_allocation.requested_microunits");
  if (input.location === "outside") {
    return emptyAllocationPlan("skipped_outside", requested, unit, 0, null, false);
  }
  if (input.explicit_skip) {
    return emptyAllocationPlan("skipped_by_user", requested, unit, 0, null, false);
  }
  if (requested === null) {
    return emptyAllocationPlan("skipped_amount_unknown", null, unit, 0, "inventory_amount_unknown", false);
  }

  const specifiedBatch = nullableText(input.specified_batch_id, "inventory_allocation.specified_batch_id");
  if (isProxy(input.candidates) || !Array.isArray(input.candidates)) return invalid("inventory_allocation.candidates");
  if (input.candidates.length > 256) return invalid("inventory_allocation.candidates.length");
  const candidates = input.candidates.map((value, index) => {
    const cloned = cloneOrdinary(value, `inventory_allocation.candidates.${index}`);
    const record = exactRecord(cloned, [
      "product_id", "product_identity_fingerprint", "batch_id", "available_microunits", "unit",
      "effective_expiration_at", "stocked_at", "effective_status",
    ], `inventory_allocation.candidates.${index}`);
    const fingerprint = text(
      record.product_identity_fingerprint,
      `inventory_allocation.candidates.${index}.product_identity_fingerprint`,
    );
    if (!/^[A-F0-9]{64}$/.test(fingerprint)) {
      return invalid(`inventory_allocation.candidates.${index}.product_identity_fingerprint`);
    }
    const expiration = record.effective_expiration_at === null
      ? null
      : timestampEpoch(record.effective_expiration_at, `inventory_allocation.candidates.${index}.effective_expiration_at`);
    return Object.freeze({
      product_id: text(record.product_id, `inventory_allocation.candidates.${index}.product_id`),
      product_identity_fingerprint: fingerprint,
      batch_id: text(record.batch_id, `inventory_allocation.candidates.${index}.batch_id`),
      available_microunits: nonnegativeSafeInteger(
        record.available_microunits,
        `inventory_allocation.candidates.${index}.available_microunits`,
      ),
      unit: text(record.unit, `inventory_allocation.candidates.${index}.unit`),
      effective_expiration_at: expiration?.value ?? null,
      effective_expiration_epoch: expiration?.epoch ?? null,
      stocked_at: timestampEpoch(record.stocked_at, `inventory_allocation.candidates.${index}.stocked_at`),
      effective_status: enumValue(
        record.effective_status,
        ["available", "expired", "unavailable"],
        `inventory_allocation.candidates.${index}.effective_status`,
      ),
    });
  });
  const batchIds = new Set(candidates.map(({ batch_id }) => batch_id));
  if (batchIds.size !== candidates.length) return invalid("inventory_allocation.candidates.batch_id");
  const eligible = candidates.filter(({ effective_status, available_microunits }) =>
    effective_status === "available" && available_microunits > 0);
  const identities = new Set(eligible.map(({ product_identity_fingerprint }) => product_identity_fingerprint));
  if (identities.size > 1) {
    return emptyAllocationPlan(
      "skipped_ambiguous", requested, unit, eligible.length, "inventory_multiple_candidates", true,
    );
  }
  const compatible = eligible.filter((candidate) => candidate.unit === unit);
  if (eligible.length > 0 && compatible.length === 0) {
    return emptyAllocationPlan(
      "skipped_unit_incompatible", requested, unit, eligible.length, "inventory_unit_conversion_unproven", true,
    );
  }
  const ordered = [...compatible].sort((left, right) => {
    const leftSpecified = left.batch_id === specifiedBatch;
    const rightSpecified = right.batch_id === specifiedBatch;
    if (leftSpecified !== rightSpecified) return leftSpecified ? -1 : 1;
    if (left.effective_expiration_epoch === null && right.effective_expiration_epoch !== null) return 1;
    if (left.effective_expiration_epoch !== null && right.effective_expiration_epoch === null) return -1;
    if (
      left.effective_expiration_epoch !== null && right.effective_expiration_epoch !== null &&
      left.effective_expiration_epoch !== right.effective_expiration_epoch
    ) return left.effective_expiration_epoch - right.effective_expiration_epoch;
    if (left.stocked_at.epoch !== right.stocked_at.epoch) return left.stocked_at.epoch - right.stocked_at.epoch;
    return ordinal(left.batch_id, right.batch_id);
  });
  const availableTotal = ordered.reduce((sum, candidate) => sum + BigInt(candidate.available_microunits), 0n);
  if (availableTotal < BigInt(requested)) {
    return emptyAllocationPlan(
      "skipped_insufficient", requested, unit, compatible.length, "inventory_insufficient", true,
    );
  }
  let remaining = requested;
  const allocations = [];
  for (const candidate of ordered) {
    if (remaining === 0) break;
    const deducted = Math.min(remaining, candidate.available_microunits);
    remaining -= deducted;
    allocations.push(Object.freeze({
      product_id: candidate.product_id,
      batch_id: candidate.batch_id,
      before_microunits: candidate.available_microunits,
      deducted_microunits: deducted,
      after_microunits: candidate.available_microunits - deducted,
      unit,
      selection_basis: candidate.batch_id === specifiedBatch
        ? "explicit_batch" as const
        : candidate.effective_expiration_at === null
          ? "fifo" as const
          : "fefo" as const,
    }));
  }
  if (remaining !== 0) return invalid("inventory_allocation.remaining");
  return Object.freeze({
    status: "matched",
    requested_microunits: requested,
    unit,
    allocations: Object.freeze(allocations),
    candidate_count: compatible.length,
    issue_code: null,
    read_required: true,
  });
}
