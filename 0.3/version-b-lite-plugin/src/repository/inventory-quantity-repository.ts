import type { DatabaseSync } from "node:sqlite";

import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
import {
  exactRepositoryInput,
  invalidRepository,
  repositoryInteger,
  repositoryText,
} from "./repository-v2-shared.js";

const PREFIX = "INVENTORY_QUANTITY_REPOSITORY_INVALID";

export interface InventoryQuantityModel {
  readonly batch_id: string;
  readonly package_unit: string;
  readonly original_package_microunits: number;
  readonly per_package_base_microunits: number | null;
  readonly base_unit: string | null;
  readonly remaining_base_microunits: number | null;
  readonly conversion_source: "explicit" | "product_profile" | "unknown";
  readonly revision: number;
}

function fromRow(row: InventoryQuantityModel | undefined): Readonly<InventoryQuantityModel> | undefined {
  return row === undefined ? undefined : Object.freeze({ ...row });
}

export function readInventoryQuantityModel(database: DatabaseSync, batchId: string) {
  assertCurrentMigrationAuthority(database);
  const id = repositoryText(batchId, PREFIX, "batch_id", 128);
  return fromRow(database.prepare("SELECT * FROM inventory_quantity_models WHERE batch_id = ?")
    .get(id) as unknown as InventoryQuantityModel | undefined);
}

export function createInventoryQuantityModel(database: DatabaseSync, value: unknown) {
  assertCurrentMigrationAuthority(database);
  const input = exactRepositoryInput(value, [
    "batch_id", "package_unit", "original_package_microunits",
    "per_package_base_microunits", "base_unit", "remaining_base_microunits",
    "conversion_source",
  ], PREFIX);
  const conversionSource = input.conversion_source;
  if (conversionSource !== "explicit" && conversionSource !== "product_profile" &&
      conversionSource !== "unknown") return invalidRepository(PREFIX, "conversion_source");
  const model = {
    batch_id: repositoryText(input.batch_id, PREFIX, "batch_id", 128),
    package_unit: repositoryText(input.package_unit, PREFIX, "package_unit", 64),
    original_package_microunits: repositoryInteger(
      input.original_package_microunits, PREFIX, "original_package_microunits",
    ),
    per_package_base_microunits: input.per_package_base_microunits === null ? null :
      repositoryInteger(input.per_package_base_microunits, PREFIX, "per_package_base_microunits", 1),
    base_unit: input.base_unit === null ? null : repositoryText(input.base_unit, PREFIX, "base_unit", 64),
    remaining_base_microunits: input.remaining_base_microunits === null ? null :
      repositoryInteger(input.remaining_base_microunits, PREFIX, "remaining_base_microunits"),
    conversion_source: conversionSource,
  };
  if ((model.per_package_base_microunits === null) !== (model.base_unit === null) ||
      (model.per_package_base_microunits === null) !== (model.remaining_base_microunits === null)) {
    return invalidRepository(PREFIX, "base_amount");
  }
  if ((model.per_package_base_microunits === null) !== (model.conversion_source === "unknown")) {
    return invalidRepository(PREFIX, "conversion_source");
  }
  if (model.per_package_base_microunits !== null && model.remaining_base_microunits !== null) {
    const totalNumerator = BigInt(model.original_package_microunits) *
      BigInt(model.per_package_base_microunits);
    if (totalNumerator % 1_000n !== 0n ||
        BigInt(model.remaining_base_microunits) > totalNumerator / 1_000n) {
      return invalidRepository(PREFIX, "base_amount");
    }
  }
  try {
    database.prepare(`INSERT INTO inventory_quantity_models(
      batch_id,package_unit,original_package_microunits,per_package_base_microunits,
      base_unit,remaining_base_microunits,conversion_source,revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).run(
      model.batch_id, model.package_unit, model.original_package_microunits,
      model.per_package_base_microunits, model.base_unit, model.remaining_base_microunits,
      model.conversion_source,
    );
  } catch (error) {
    throw new Error(`${PREFIX}:batch_conflict`, { cause: error });
  }
  return readInventoryQuantityModel(database, model.batch_id)!;
}

export function updateInventoryQuantityRemaining(database: DatabaseSync, value: unknown) {
  assertCurrentMigrationAuthority(database);
  const input = exactRepositoryInput(value, [
    "batch_id", "expected_revision", "remaining_base_microunits",
  ], PREFIX);
  const id = repositoryText(input.batch_id, PREFIX, "batch_id", 128);
  const revision = repositoryInteger(input.expected_revision, PREFIX, "expected_revision", 1);
  const remaining = input.remaining_base_microunits === null ? null :
    repositoryInteger(input.remaining_base_microunits, PREFIX, "remaining_base_microunits");
  const current = readInventoryQuantityModel(database, id);
  if (current === undefined || (current.per_package_base_microunits === null) !== (remaining === null)) {
    return invalidRepository(PREFIX, "remaining_base_microunits");
  }
  if (remaining !== null && current.per_package_base_microunits !== null) {
    const maximum = BigInt(current.original_package_microunits) *
      BigInt(current.per_package_base_microunits) / 1_000n;
    if (BigInt(remaining) > maximum) return invalidRepository(PREFIX, "remaining_base_microunits");
  }
  const result = database.prepare(`UPDATE inventory_quantity_models
    SET remaining_base_microunits = ?, revision = revision + 1
    WHERE batch_id = ? AND revision = ?`).run(remaining, id, revision);
  if (result.changes !== 1) return invalidRepository(PREFIX, "revision_conflict");
  return readInventoryQuantityModel(database, id)!;
}

export function consumeInventoryQuantityRemaining(database: DatabaseSync, value: unknown) {
  assertCurrentMigrationAuthority(database);
  const input = exactRepositoryInput(value, [
    "batch_id", "expected_revision", "expected_remaining_base_microunits",
    "remaining_base_microunits",
  ], PREFIX);
  const id = repositoryText(input.batch_id, PREFIX, "batch_id", 128);
  const revision = repositoryInteger(input.expected_revision, PREFIX, "expected_revision", 1);
  const expected = input.expected_remaining_base_microunits === null ? null :
    repositoryInteger(input.expected_remaining_base_microunits, PREFIX, "expected_remaining_base_microunits");
  const remaining = input.remaining_base_microunits === null ? null :
    repositoryInteger(input.remaining_base_microunits, PREFIX, "remaining_base_microunits");
  if ((expected === null) !== (remaining === null) ||
      expected !== null && remaining !== null && remaining > expected) {
    return invalidRepository(PREFIX, "remaining_base_microunits");
  }
  const result = expected === null
    ? database.prepare(`UPDATE inventory_quantity_models
        SET remaining_base_microunits = NULL, revision = revision + 1
        WHERE batch_id = ? AND revision = ? AND remaining_base_microunits IS NULL`)
      .run(id, revision)
    : database.prepare(`UPDATE inventory_quantity_models
        SET remaining_base_microunits = ?, revision = revision + 1
        WHERE batch_id = ? AND revision = ? AND remaining_base_microunits = ?`)
      .run(remaining, id, revision, expected);
  if (result.changes !== 1) return invalidRepository(PREFIX, "revision_conflict");
  return readInventoryQuantityModel(database, id)!;
}
