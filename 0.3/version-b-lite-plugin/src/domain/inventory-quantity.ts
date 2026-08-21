import type { PackageQuantityEvidence } from "./types.js";

const PACKAGE_SCALE = 1_000;
const COMMAND_SCALE = 1_000_000;

export type InventoryQuantityConversionSource = "explicit" | "product_profile" | "unknown";

export interface InventoryQuantity {
  readonly package_unit: string;
  /** One package is 1,000. This field name follows the frozen migration schema. */
  readonly original_package_microunits: number;
  /** ml is stored as microlitres; g is stored as milligrams; count units use thousandths. */
  readonly per_package_base_microunits: number | null;
  readonly base_unit: string | null;
  readonly remaining_base_microunits: number | null;
  readonly conversion_source: InventoryQuantityConversionSource;
}

export interface CreateInventoryQuantityInput {
  readonly package_count: number;
  readonly package_unit: string;
  readonly per_package: Readonly<{ readonly value: number; readonly unit: string }> | null;
  readonly conversion_source?: Exclude<InventoryQuantityConversionSource, "unknown">;
}

export interface ConsumeInventoryQuantityInput {
  /** Existing command convention: one user-facing unit is 1,000,000. */
  readonly requested_microunits: number;
  readonly unit: string;
  readonly available_package_microunits?: number;
}

export interface InventoryQuantityBalance {
  readonly package_unit: string;
  readonly package_milliunits: number;
  readonly whole_packages: number;
  readonly base_unit: string | null;
  readonly remaining_base_microunits: number | null;
  readonly remainder_base_microunits: number | null;
}

export type InventoryQuantityConsumption =
  | Readonly<{
      readonly disposition: "needs_clarification";
      readonly reason_code: "inventory_unit_conversion_unproven";
    }>
  | Readonly<{
      readonly disposition: "applied" | "partially_applied";
      readonly requested_microunits: number;
      readonly deducted_microunits: number;
      readonly shortage_microunits: number;
      readonly deducted_unit: string;
      readonly remaining_package_milliunits: number;
      readonly quantity: Readonly<InventoryQuantity>;
    }>;

export type InventoryQuantityRestoration =
  | Readonly<{
      readonly disposition: "needs_clarification";
      readonly reason_code: "inventory_unit_conversion_unproven";
    }>
  | Readonly<{
      readonly disposition: "applied";
      readonly restored_microunits: number;
      readonly restored_unit: string;
      readonly remaining_package_milliunits: number;
      readonly quantity: Readonly<InventoryQuantity>;
    }>;

function invalid(reason: string): never {
  throw new TypeError(`INVENTORY_QUANTITY_INVALID:${reason}`);
}

function safeText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 64 ||
      /[\u0000-\u001F\u007F]/u.test(value)) return invalid(field);
  return value;
}

function safeInteger(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return invalid(field);
  return Number(value);
}

function scaledInteger(value: unknown, scale: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return invalid(field);
  const scaled = value * scale;
  if (!Number.isSafeInteger(scaled)) return invalid(field);
  return scaled;
}

function exactRecord(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return invalid(field);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\0") !== [...keys].sort().join("\0")) return invalid(field);
  return record;
}

function baseUnit(value: string): Readonly<{ readonly unit: string; readonly storage_per_unit: number }> {
  const aliases: Readonly<Record<string, Readonly<{ unit: string; storage_per_unit: number }>>> = Object.freeze({
    ml: Object.freeze({ unit: "ml", storage_per_unit: 1_000 }),
    mL: Object.freeze({ unit: "ml", storage_per_unit: 1_000 }),
    L: Object.freeze({ unit: "ml", storage_per_unit: 1_000_000 }),
    l: Object.freeze({ unit: "ml", storage_per_unit: 1_000_000 }),
    g: Object.freeze({ unit: "g", storage_per_unit: 1_000 }),
    kg: Object.freeze({ unit: "g", storage_per_unit: 1_000_000 }),
  });
  return aliases[value] ?? Object.freeze({ unit: safeText(value, "base_unit"), storage_per_unit: PACKAGE_SCALE });
}

function cloneQuantity(value: Readonly<InventoryQuantity>): Readonly<InventoryQuantity> {
  const record = exactRecord(value, [
    "package_unit", "original_package_microunits", "per_package_base_microunits",
    "base_unit", "remaining_base_microunits", "conversion_source",
  ], "quantity");
  const packageUnit = safeText(record.package_unit, "package_unit");
  const original = record.original_package_microunits;
  if (!Number.isSafeInteger(original) || Number(original) <= 0) return invalid("original_package_microunits");
  const perPackage = record.per_package_base_microunits;
  const remaining = record.remaining_base_microunits;
  const unit = record.base_unit;
  const source = record.conversion_source;
  if (source !== "explicit" && source !== "product_profile" && source !== "unknown") {
    return invalid("conversion_source");
  }
  if ((perPackage === null) !== (unit === null) || (perPackage === null) !== (remaining === null) ||
      (perPackage === null) !== (source === "unknown")) return invalid("base_amount");
  if (perPackage !== null && (!Number.isSafeInteger(perPackage) || Number(perPackage) <= 0)) {
    return invalid("per_package_base_microunits");
  }
  if (remaining !== null && (!Number.isSafeInteger(remaining) || Number(remaining) < 0)) {
    return invalid("remaining_base_microunits");
  }
  return Object.freeze({
    package_unit: packageUnit,
    original_package_microunits: Number(original),
    per_package_base_microunits: perPackage === null ? null : Number(perPackage),
    base_unit: unit === null ? null : safeText(unit, "base_unit"),
    remaining_base_microunits: remaining === null ? null : Number(remaining),
    conversion_source: source,
  });
}

export function createInventoryQuantity(input: Readonly<CreateInventoryQuantityInput>): Readonly<InventoryQuantity> {
  const packageUnit = safeText(input.package_unit, "package_unit");
  const original = scaledInteger(input.package_count, PACKAGE_SCALE, "package_count");
  if (input.per_package === null) {
    if (input.conversion_source !== undefined) return invalid("conversion_source");
    return Object.freeze({
      package_unit: packageUnit,
      original_package_microunits: original,
      per_package_base_microunits: null,
      base_unit: null,
      remaining_base_microunits: null,
      conversion_source: "unknown" as const,
    });
  }
  const normalized = baseUnit(input.per_package.unit);
  const perPackage = scaledInteger(input.per_package.value, normalized.storage_per_unit, "per_package.value");
  const totalNumerator = BigInt(original) * BigInt(perPackage);
  if (totalNumerator % BigInt(PACKAGE_SCALE) !== 0n) return invalid("total_base_microunits");
  return Object.freeze({
    package_unit: packageUnit,
    original_package_microunits: original,
    per_package_base_microunits: perPackage,
    base_unit: normalized.unit,
    remaining_base_microunits: safeInteger(totalNumerator / BigInt(PACKAGE_SCALE), "total_base_microunits"),
    conversion_source: input.conversion_source ?? "explicit",
  });
}

export function createInventoryQuantityFromPackageEvidence(
  evidence: Readonly<PackageQuantityEvidence>,
): Readonly<InventoryQuantity> | null {
  if (evidence.outer_count === null || evidence.outer_unit === null) return null;
  const hasInner = evidence.inner_per_outer !== null && evidence.inner_unit !== null;
  const packageCount = hasInner
    ? evidence.total_inner ?? evidence.outer_count * evidence.inner_per_outer!
    : evidence.outer_count;
  const packageUnit = hasInner ? evidence.inner_unit! : evidence.outer_unit;
  let perPackage: CreateInventoryQuantityInput["per_package"] = null;
  if (evidence.capacity_per_inner !== null && evidence.capacity_unit !== null) {
    perPackage = Object.freeze({ value: evidence.capacity_per_inner, unit: evidence.capacity_unit });
  }
  return createInventoryQuantity({
    package_count: packageCount,
    package_unit: packageUnit,
    per_package: perPackage,
  });
}

function packageMilliunits(quantity: Readonly<InventoryQuantity>, fallbackCommandMicrounits?: number): number {
  if (quantity.remaining_base_microunits === null || quantity.per_package_base_microunits === null) {
    if (fallbackCommandMicrounits === undefined) return quantity.original_package_microunits;
    if (!Number.isSafeInteger(fallbackCommandMicrounits) || fallbackCommandMicrounits < 0 ||
        fallbackCommandMicrounits % (COMMAND_SCALE / PACKAGE_SCALE) !== 0) {
      return invalid("available_package_microunits");
    }
    return fallbackCommandMicrounits / (COMMAND_SCALE / PACKAGE_SCALE);
  }
  return safeInteger(
    BigInt(quantity.remaining_base_microunits) * BigInt(PACKAGE_SCALE) /
      BigInt(quantity.per_package_base_microunits),
    "package_milliunits",
  );
}

export function inventoryQuantityBalance(value: Readonly<InventoryQuantity>): Readonly<InventoryQuantityBalance> {
  const quantity = cloneQuantity(value);
  const packages = packageMilliunits(quantity);
  const whole = Math.floor(packages / PACKAGE_SCALE);
  return Object.freeze({
    package_unit: quantity.package_unit,
    package_milliunits: packages,
    whole_packages: whole,
    base_unit: quantity.base_unit,
    remaining_base_microunits: quantity.remaining_base_microunits,
    remainder_base_microunits: quantity.remaining_base_microunits === null ||
        quantity.per_package_base_microunits === null
      ? null
      : quantity.remaining_base_microunits - whole * quantity.per_package_base_microunits,
  });
}

export function availableInventoryMicrounits(
  value: Readonly<InventoryQuantity>,
  requestedUnit: string,
  availablePackageMicrounits?: number,
): number | null {
  const quantity = cloneQuantity(value);
  const unit = safeText(requestedUnit, "requested_unit");
  if (unit === quantity.package_unit) {
    return packageMilliunits(quantity, availablePackageMicrounits) * (COMMAND_SCALE / PACKAGE_SCALE);
  }
  if (quantity.base_unit === null || quantity.remaining_base_microunits === null) return null;
  const requestedBase = baseUnit(unit);
  if (requestedBase.unit !== quantity.base_unit) return null;
  const numerator = BigInt(quantity.remaining_base_microunits) * BigInt(COMMAND_SCALE);
  if (numerator % BigInt(requestedBase.storage_per_unit) !== 0n) return null;
  return safeInteger(numerator / BigInt(requestedBase.storage_per_unit), "available_microunits");
}

export function consumeInventoryQuantity(
  value: Readonly<InventoryQuantity>,
  input: Readonly<ConsumeInventoryQuantityInput>,
): InventoryQuantityConsumption {
  const quantity = cloneQuantity(value);
  const requested = input.requested_microunits;
  if (!Number.isSafeInteger(requested) || requested <= 0) return invalid("requested_microunits");
  const unit = safeText(input.unit, "requested_unit");
  const available = availableInventoryMicrounits(quantity, unit, input.available_package_microunits);
  if (available === null) return Object.freeze({
    disposition: "needs_clarification" as const,
    reason_code: "inventory_unit_conversion_unproven" as const,
  });
  const deducted = Math.min(requested, available);
  const shortage = requested - deducted;
  let remainingBase = quantity.remaining_base_microunits;
  let remainingPackages: number;
  if (unit === quantity.package_unit) {
    if (deducted % (COMMAND_SCALE / PACKAGE_SCALE) !== 0) return invalid("package_resolution");
    const deductedPackages = deducted / (COMMAND_SCALE / PACKAGE_SCALE);
    remainingPackages = packageMilliunits(quantity, input.available_package_microunits) - deductedPackages;
    if (quantity.per_package_base_microunits !== null && remainingBase !== null) {
      const numerator = BigInt(deducted) * BigInt(quantity.per_package_base_microunits);
      if (numerator % BigInt(COMMAND_SCALE) !== 0n) return invalid("base_resolution");
      remainingBase -= safeInteger(numerator / BigInt(COMMAND_SCALE), "deducted_base_microunits");
    }
  } else {
    if (quantity.base_unit === null || remainingBase === null) return invalid("base_amount");
    const requestedBase = baseUnit(unit);
    const numerator = BigInt(deducted) * BigInt(requestedBase.storage_per_unit);
    if (numerator % BigInt(COMMAND_SCALE) !== 0n) return invalid("base_resolution");
    remainingBase -= safeInteger(numerator / BigInt(COMMAND_SCALE), "deducted_base_microunits");
    remainingPackages = safeInteger(
      BigInt(remainingBase) * BigInt(PACKAGE_SCALE) / BigInt(quantity.per_package_base_microunits!),
      "remaining_package_milliunits",
    );
  }
  if (remainingBase !== null && remainingBase < 0 || remainingPackages < 0) return invalid("negative_balance");
  const next = Object.freeze({ ...quantity, remaining_base_microunits: remainingBase });
  return Object.freeze({
    disposition: shortage === 0 ? "applied" as const : "partially_applied" as const,
    requested_microunits: requested,
    deducted_microunits: deducted,
    shortage_microunits: shortage,
    deducted_unit: unit,
    remaining_package_milliunits: remainingPackages,
    quantity: next,
  });
}

export function restoreInventoryQuantity(
  value: Readonly<InventoryQuantity>,
  input: Readonly<{
    readonly restored_microunits: number;
    readonly unit: string;
    readonly available_package_microunits?: number;
  }>,
): InventoryQuantityRestoration {
  const quantity = cloneQuantity(value);
  const restored = input.restored_microunits;
  if (!Number.isSafeInteger(restored) || restored <= 0) return invalid("restored_microunits");
  const unit = safeText(input.unit, "restored_unit");
  let remainingBase = quantity.remaining_base_microunits;
  let remainingPackages: number;
  if (unit === quantity.package_unit) {
    if (restored % (COMMAND_SCALE / PACKAGE_SCALE) !== 0) return invalid("package_resolution");
    const restoredPackages = restored / (COMMAND_SCALE / PACKAGE_SCALE);
    remainingPackages = packageMilliunits(quantity, input.available_package_microunits) + restoredPackages;
    if (remainingPackages > quantity.original_package_microunits) return invalid("restoration_exceeds_original");
    if (quantity.per_package_base_microunits !== null && remainingBase !== null) {
      const numerator = BigInt(restored) * BigInt(quantity.per_package_base_microunits);
      if (numerator % BigInt(COMMAND_SCALE) !== 0n) return invalid("base_resolution");
      remainingBase += safeInteger(numerator / BigInt(COMMAND_SCALE), "restored_base_microunits");
    }
  } else {
    if (quantity.base_unit === null || remainingBase === null || quantity.per_package_base_microunits === null) {
      return Object.freeze({
        disposition: "needs_clarification" as const,
        reason_code: "inventory_unit_conversion_unproven" as const,
      });
    }
    const restoredBase = baseUnit(unit);
    if (restoredBase.unit !== quantity.base_unit) return Object.freeze({
      disposition: "needs_clarification" as const,
      reason_code: "inventory_unit_conversion_unproven" as const,
    });
    const numerator = BigInt(restored) * BigInt(restoredBase.storage_per_unit);
    if (numerator % BigInt(COMMAND_SCALE) !== 0n) return invalid("base_resolution");
    remainingBase += safeInteger(numerator / BigInt(COMMAND_SCALE), "restored_base_microunits");
    remainingPackages = safeInteger(
      BigInt(remainingBase) * BigInt(PACKAGE_SCALE) / BigInt(quantity.per_package_base_microunits),
      "remaining_package_milliunits",
    );
  }
  const maximumBase = quantity.per_package_base_microunits === null ? null : safeInteger(
    BigInt(quantity.original_package_microunits) * BigInt(quantity.per_package_base_microunits) /
      BigInt(PACKAGE_SCALE),
    "maximum_base_microunits",
  );
  if (maximumBase !== null && remainingBase !== null && remainingBase > maximumBase) {
    return invalid("restoration_exceeds_original");
  }
  return Object.freeze({
    disposition: "applied" as const,
    restored_microunits: restored,
    restored_unit: unit,
    remaining_package_milliunits: remainingPackages,
    quantity: Object.freeze({ ...quantity, remaining_base_microunits: remainingBase }),
  });
}
