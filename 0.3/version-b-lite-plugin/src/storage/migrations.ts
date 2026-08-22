import type { DatabaseSync } from "node:sqlite";

import {
  MIGRATION_V1_ID,
  MIGRATION_V1_INDEX_STATEMENTS,
  MIGRATION_V1_MAPPING_SHA256,
  MIGRATION_V1_TABLE_STATEMENTS,
} from "./migration-v1.js";
import {
  MIGRATION_V2_ID,
  MIGRATION_V2_INDEX_STATEMENTS,
  MIGRATION_V2_MAPPING_SHA256,
  MIGRATION_V2_TABLE_STATEMENTS,
} from "./migration-v2.js";

export type MigrationFault = "after_schema" | "before_history" | "before_commit";

export interface MigrationV1Options {
  now: string;
  fault?: MigrationFault;
}

export type MigrationV2Options = MigrationV1Options;

function injectedFault(fault: MigrationFault): Error {
  return new Error(`STORAGE_MIGRATION_FAILED:${fault}`);
}

export function applyMigrationV1(
  database: DatabaseSync,
  options: MigrationV1Options,
): void {
  database.exec("BEGIN EXCLUSIVE");

  try {
    for (const statement of MIGRATION_V1_TABLE_STATEMENTS) database.exec(statement);
    for (const statement of MIGRATION_V1_INDEX_STATEMENTS) database.exec(statement);

    if (options.fault === "after_schema") throw injectedFault(options.fault);

    database.exec("PRAGMA application_id = 1145913905");
    database.exec("PRAGMA user_version = 1");

    if (options.fault === "before_history") throw injectedFault(options.fault);

    database
      .prepare(
        "INSERT INTO schema_migrations(version, migration_id, applied_at, checksum) VALUES (?, ?, ?, ?)",
      )
      .run(1, MIGRATION_V1_ID, options.now, MIGRATION_V1_MAPPING_SHA256);

    if (options.fault === "before_commit") throw injectedFault(options.fault);

    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The primary migration failure remains authoritative.
    }

    if (error instanceof Error && error.message.startsWith("STORAGE_MIGRATION_FAILED:")) {
      throw error;
    }
    throw new Error("STORAGE_MIGRATION_FAILED:apply", { cause: error });
  }
}

export function applyMigrationV2(
  database: DatabaseSync,
  options: MigrationV2Options,
): void {
  database.exec("BEGIN EXCLUSIVE");

  try {
    for (const statement of MIGRATION_V2_TABLE_STATEMENTS) database.exec(statement);
    for (const statement of MIGRATION_V2_INDEX_STATEMENTS) database.exec(statement);

    if (options.fault === "after_schema") throw injectedFault(options.fault);

    database.exec("PRAGMA user_version = 2");

    if (options.fault === "before_history") throw injectedFault(options.fault);

    database.prepare(
      "INSERT INTO schema_migrations(version, migration_id, applied_at, checksum) VALUES (?, ?, ?, ?)",
    ).run(2, MIGRATION_V2_ID, options.now, MIGRATION_V2_MAPPING_SHA256);

    if (options.fault === "before_commit") throw injectedFault(options.fault);

    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The primary migration failure remains authoritative.
    }
    if (error instanceof Error && error.message.startsWith("STORAGE_MIGRATION_FAILED:")) {
      throw error;
    }
    throw new Error("STORAGE_MIGRATION_FAILED:apply_v2", { cause: error });
  }
}
