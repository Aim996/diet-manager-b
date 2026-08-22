import { randomUUID } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import {
  MIGRATION_V1_FOREIGN_KEY_COUNT,
  MIGRATION_V1_ID,
  MIGRATION_V1_INDEX_NAMES,
  MIGRATION_V1_INDEX_STATEMENTS,
  MIGRATION_V1_MAPPING_SHA256,
  MIGRATION_V1_TABLE_NAMES,
  MIGRATION_V1_TABLE_STATEMENTS,
} from "./migration-v1.js";
import {
  MIGRATION_V2_FOREIGN_KEY_COUNT,
  MIGRATION_V2_ID,
  MIGRATION_V2_INDEX_NAMES,
  MIGRATION_V2_INDEX_STATEMENTS,
  MIGRATION_V2_MAPPING_SHA256,
  MIGRATION_V2_TABLE_NAMES,
  MIGRATION_V2_TABLE_STATEMENTS,
} from "./migration-v2.js";
import { applyMigrationV1, applyMigrationV2, type MigrationFault } from "./migrations.js";

export type { MigrationFault } from "./migrations.js";

const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as typeof import("node:sqlite");

export const DIET_DATABASE_FILENAME = "diet-manager-b.sqlite3";
export const DIET_DATABASE_APPLICATION_ID = 1_145_913_905;
export const DIET_DATABASE_USER_VERSION = 2;
export const DIET_DATABASE_MAPPING_SHA256 = MIGRATION_V2_MAPPING_SHA256;
export const DIET_DATABASE_PRE_V2_BACKUP_SUFFIX = ".pre-v2.bak";

export interface OpenDietDatabaseOptions {
  privateRuntimeRoot: string;
  now?: () => string;
  migrationFault?: MigrationFault;
}

export interface DietDatabaseRuntime {
  database: DatabaseSyncType;
  databasePath: string;
  close(): void;
}

function fail(code: string): never {
  throw new Error(code);
}

export function assertPrivateRuntimeRoot(value: string): string {
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value)) {
    return fail("STORAGE_PATH_INVALID:absolute_root");
  }

  const root = resolve(value);
  let stat;
  try {
    stat = lstatSync(root);
  } catch (error) {
    throw new Error("STORAGE_PATH_INVALID:root_missing", { cause: error });
  }
  if (stat.isSymbolicLink()) return fail("STORAGE_PATH_INVALID:root_reparse");
  if (!stat.isDirectory()) return fail("STORAGE_PATH_INVALID:root_directory");

  const physical = realpathSync.native(root);
  if (process.platform === "win32") {
    if (physical.toLowerCase() !== root.toLowerCase()) {
      return fail("STORAGE_PATH_INVALID:root_identity");
    }
  } else if (physical !== root) {
    return fail("STORAGE_PATH_INVALID:root_identity");
  }

  return physical;
}

function assertOrdinaryDatabaseLeaf(databasePath: string): boolean {
  let stat;
  try {
    stat = lstatSync(databasePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (stat.isSymbolicLink()) return fail("STORAGE_PATH_INVALID:database_reparse");
  if (!stat.isFile()) return fail("STORAGE_PATH_INVALID:database_file");
  if (stat.nlink !== 1) return fail("STORAGE_PATH_INVALID:database_link_count");
  return true;
}

function scalar(database: DatabaseSyncType, sql: string): number | string {
  const row = database.prepare(sql).get() as Record<string, number | string> | undefined;
  if (!row) return fail("STORAGE_IDENTITY_INVALID:scalar");
  return Object.values(row)[0];
}

function expectedSchemaSql(statement: string): string {
  return statement.endsWith(";") ? statement.slice(0, -1) : statement;
}

function assertDietDatabaseIdentityVersion(
  database: DatabaseSyncType,
  expectedVersion: 1 | 2,
): void {
  if (scalar(database, "PRAGMA application_id") !== DIET_DATABASE_APPLICATION_ID) {
    return fail("STORAGE_IDENTITY_INVALID:application_id");
  }
  if (scalar(database, "PRAGMA user_version") !== expectedVersion) {
    return fail("STORAGE_IDENTITY_INVALID:user_version");
  }
  if (String(scalar(database, "PRAGMA journal_mode")).toLowerCase() !== "wal") {
    return fail("STORAGE_IDENTITY_INVALID:journal_mode");
  }
  if (scalar(database, "PRAGMA quick_check") !== "ok") {
    return fail("STORAGE_INTEGRITY_INVALID:quick_check");
  }

  const foreignKeyProblems = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyProblems.length !== 0) return fail("STORAGE_INTEGRITY_INVALID:foreign_keys");

  const schemaRows = database
    .prepare(
      "SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all() as Array<{ type: string; name: string; sql: string }>;
  const actual = new Map(schemaRows.map((row) => [`${row.type}:${row.name}`, row.sql]));

  const tableNames = expectedVersion === 1
    ? MIGRATION_V1_TABLE_NAMES
    : [...MIGRATION_V1_TABLE_NAMES, ...MIGRATION_V2_TABLE_NAMES];
  const tableStatements = expectedVersion === 1
    ? MIGRATION_V1_TABLE_STATEMENTS
    : [...MIGRATION_V1_TABLE_STATEMENTS, ...MIGRATION_V2_TABLE_STATEMENTS];
  const indexNames = expectedVersion === 1
    ? MIGRATION_V1_INDEX_NAMES
    : [...MIGRATION_V1_INDEX_NAMES, ...MIGRATION_V2_INDEX_NAMES];
  const indexStatements = expectedVersion === 1
    ? MIGRATION_V1_INDEX_STATEMENTS
    : [...MIGRATION_V1_INDEX_STATEMENTS, ...MIGRATION_V2_INDEX_STATEMENTS];

  for (let index = 0; index < tableNames.length; index += 1) {
    const name = tableNames[index]!;
    if (actual.get(`table:${name}`) !== expectedSchemaSql(tableStatements[index]!)) {
      return fail(`STORAGE_IDENTITY_INVALID:table:${name}`);
    }
  }
  for (let index = 0; index < indexNames.length; index += 1) {
    const name = indexNames[index]!;
    if (actual.get(`index:${name}`) !== expectedSchemaSql(indexStatements[index]!)) {
      return fail(`STORAGE_IDENTITY_INVALID:index:${name}`);
    }
  }
  if (actual.size !== tableNames.length + indexNames.length) {
    return fail("STORAGE_IDENTITY_INVALID:schema_count");
  }

  let foreignKeyCount = 0;
  for (const table of tableNames) {
    foreignKeyCount += database.prepare(`PRAGMA foreign_key_list("${table}")`).all().length;
  }
  const expectedForeignKeyCount = MIGRATION_V1_FOREIGN_KEY_COUNT +
    (expectedVersion === 2 ? MIGRATION_V2_FOREIGN_KEY_COUNT : 0);
  if (foreignKeyCount !== expectedForeignKeyCount) {
    return fail("STORAGE_IDENTITY_INVALID:foreign_key_count");
  }

  const migrations = database.prepare(
    "SELECT version, migration_id, checksum FROM schema_migrations ORDER BY version",
  ).all() as Array<{ version: number; migration_id: string; checksum: string }>;
  const expectedMigrations = [{
    version: 1,
    migration_id: MIGRATION_V1_ID,
    checksum: MIGRATION_V1_MAPPING_SHA256,
  }, ...(expectedVersion === 2 ? [{
    version: 2,
    migration_id: MIGRATION_V2_ID,
    checksum: MIGRATION_V2_MAPPING_SHA256,
  }] : [])];
  if (JSON.stringify(migrations) !== JSON.stringify(expectedMigrations)) {
    return fail("STORAGE_IDENTITY_INVALID:migration_history");
  }
}

export function assertDietDatabaseV1Identity(database: DatabaseSyncType): void {
  assertDietDatabaseIdentityVersion(database, 1);
}

export function assertDietDatabaseIdentity(database: DatabaseSyncType): void {
  assertDietDatabaseIdentityVersion(database, 2);
}

function configureConnection(database: DatabaseSyncType): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}

function openConnection(databasePath: string, readOnly = false): DatabaseSyncType {
  return new DatabaseSync(databasePath, {
    readOnly,
    timeout: 5_000,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    defensive: true,
  });
}

function cleanupCandidate(candidatePath: string): void {
  for (const path of [candidatePath, `${candidatePath}-wal`, `${candidatePath}-shm`]) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
}

function removeCandidateSidecars(candidatePath: string): void {
  for (const path of [`${candidatePath}-wal`, `${candidatePath}-shm`]) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
}

function createFreshDatabase(
  root: string,
  finalPath: string,
  options: OpenDietDatabaseOptions,
): void {
  const candidatePath = join(root, `.${DIET_DATABASE_FILENAME}.candidate-${randomUUID()}`);
  let database: DatabaseSyncType | undefined;

  try {
    database = openConnection(candidatePath);
    configureConnection(database);
    if (String(scalar(database, "PRAGMA journal_mode = WAL")).toLowerCase() !== "wal") {
      return fail("STORAGE_MIGRATION_FAILED:journal_mode");
    }

    applyMigrationV1(database, {
      now: (options.now ?? (() => new Date().toISOString()))(),
    });
    applyMigrationV2(database, {
      now: (options.now ?? (() => new Date().toISOString()))(),
      fault: options.migrationFault,
    });
    assertDietDatabaseIdentity(database);
    database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    database.close();
    database = undefined;

    removeCandidateSidecars(candidatePath);
    linkSync(candidatePath, finalPath);
    unlinkSync(candidatePath);
  } catch (error) {
    try {
      database?.close();
    } catch {
      // Cleanup below remains best-effort; the primary failure is preserved.
    }
    cleanupCandidate(candidatePath);
    throw error;
  }
}

function validateExistingReadOnly(databasePath: string): 1 | 2 {
  let database: DatabaseSyncType | undefined;
  try {
    database = openConnection(databasePath, true);
    if (scalar(database, "PRAGMA application_id") !== DIET_DATABASE_APPLICATION_ID) {
      return fail("STORAGE_IDENTITY_INVALID:application_id");
    }
    const version = scalar(database, "PRAGMA user_version");
    if (version === 1) {
      assertDietDatabaseV1Identity(database);
      return 1;
    }
    if (version === 2) {
      assertDietDatabaseIdentity(database);
      return 2;
    }
    return fail("STORAGE_IDENTITY_INVALID:user_version");
  } finally {
    database?.close();
  }
}

function validateV1Backup(path: string): void {
  let database: DatabaseSyncType | undefined;
  try {
    database = openConnection(path, true);
    assertDietDatabaseV1Identity(database);
  } finally {
    database?.close();
  }
}

function ensureV1Backup(databasePath: string): void {
  const backupPath = `${databasePath}${DIET_DATABASE_PRE_V2_BACKUP_SUFFIX}`;
  if (existsSync(backupPath)) {
    assertOrdinaryDatabaseLeaf(backupPath);
    validateV1Backup(backupPath);
    if (!readFileSync(backupPath).equals(readFileSync(databasePath))) {
      return fail("STORAGE_MIGRATION_FAILED:backup_conflict");
    }
    return;
  }
  try {
    copyFileSync(databasePath, backupPath, constants.COPYFILE_EXCL);
    assertOrdinaryDatabaseLeaf(backupPath);
    validateV1Backup(backupPath);
  } catch (error) {
    if (existsSync(backupPath)) rmSync(backupPath, { force: true });
    throw new Error("STORAGE_MIGRATION_FAILED:backup", { cause: error });
  }
}

function upgradeExistingV1(
  databasePath: string,
  options: OpenDietDatabaseOptions,
): void {
  let database: DatabaseSyncType | undefined;
  try {
    database = openConnection(databasePath);
    configureConnection(database);
    assertDietDatabaseV1Identity(database);
    database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  } finally {
    database?.close();
  }

  ensureV1Backup(databasePath);
  database = undefined;
  try {
    database = openConnection(databasePath);
    configureConnection(database);
    assertDietDatabaseV1Identity(database);
    applyMigrationV2(database, {
      now: (options.now ?? (() => new Date().toISOString()))(),
      fault: options.migrationFault,
    });
    assertDietDatabaseIdentity(database);
    database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  } finally {
    database?.close();
  }
}

export function openDietDatabase(options: OpenDietDatabaseOptions): DietDatabaseRuntime {
  const root = assertPrivateRuntimeRoot(options.privateRuntimeRoot);
  const databasePath = join(root, DIET_DATABASE_FILENAME);
  const databaseExists = assertOrdinaryDatabaseLeaf(databasePath);

  if (databaseExists) {
    const version = validateExistingReadOnly(databasePath);
    if (version === 1) upgradeExistingV1(databasePath, options);
  } else {
    createFreshDatabase(root, databasePath, options);
  }

  if (!assertOrdinaryDatabaseLeaf(databasePath)) {
    return fail("STORAGE_IDENTITY_INVALID:published_database_missing");
  }
  const database = openConnection(databasePath);
  configureConnection(database);
  try {
    assertDietDatabaseIdentity(database);
  } catch (error) {
    database.close();
    throw error;
  }
  let closed = false;

  return {
    database,
    databasePath,
    close() {
      if (closed) return;
      database.close();
      closed = true;
    },
  };
}
