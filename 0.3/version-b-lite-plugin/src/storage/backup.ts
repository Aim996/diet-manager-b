import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import type { BigIntStats } from "node:fs";
import { isProxy } from "node:util/types";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import { CORE_RUNTIME_SECRET_FILENAME } from "../application/core-runtime.js";
import {
  assertDietDatabaseIdentity,
  assertPrivateRuntimeRoot,
  DIET_DATABASE_APPLICATION_ID,
  DIET_DATABASE_FILENAME,
  openDietDatabase,
} from "./database.js";

const requireNode = createRequire(import.meta.url);
const { backup, DatabaseSync } = requireNode("node:sqlite") as typeof import("node:sqlite");

export interface DietDatabaseBackupResult {
  readonly backup_path: string;
  readonly bytes: number;
  readonly sha256: string;
}

function invalid(reason: string): never {
  throw new Error(`DIET_BACKUP_INVALID:${reason}`);
}

function exactInput(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")) return invalid("input");
  return value as Record<string, unknown>;
}

function ordinaryFile(path: string, reason: string): BigIntStats {
  let stat;
  try { stat = lstatSync(path, { bigint: true }); } catch { return invalid(reason); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) return invalid(reason);
  return stat;
}

function existingParent(path: string): string {
  const parent = dirname(path);
  const stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync.native(parent) !== resolve(parent)) {
    return invalid("backup_parent");
  }
  return parent;
}

function absolutePath(value: unknown, reason: string): string {
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value) || resolve(value) !== value) {
    return invalid(reason);
  }
  return value;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}

function validateBackupDatabase(path: string): void {
  const database: DatabaseSyncType = new DatabaseSync(path, {
    readOnly: true,
    timeout: 5_000,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    defensive: true,
  });
  try { assertDietDatabaseIdentity(database); } finally { database.close(); }
}

function validateUpgradeableDatabase(path: string): number {
  const database: DatabaseSyncType = new DatabaseSync(path, {
    readOnly: true,
    timeout: 5_000,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    defensive: true,
  });
  try {
    const scalar = (sql: string): number | string => {
      const row = database.prepare(sql).get() as Record<string, number | string>;
      return Object.values(row)[0]!;
    };
    if (scalar("PRAGMA integrity_check") !== "ok" ||
        scalar("PRAGMA application_id") !== DIET_DATABASE_APPLICATION_ID) {
      return invalid("upgrade_identity");
    }
    const version = Number(scalar("PRAGMA user_version"));
    if (version !== 1 && version !== 2) return invalid("upgrade_version");
    if (database.prepare("PRAGMA foreign_key_check").all().length !== 0) {
      return invalid("upgrade_foreign_keys");
    }
    return version;
  } finally {
    database.close();
  }
}

function removeOwned(path: string, identity: BigIntStats | undefined): void {
  if (identity === undefined || !existsSync(path)) return;
  const current = lstatSync(path, { bigint: true });
  if (current.dev === identity.dev && current.ino === identity.ino && current.nlink === 1n && current.isFile()) {
    unlinkSync(path);
  }
}

export async function backupDietDatabase(value: Readonly<{
  privateRuntimeRoot: string;
  backupPath: string;
}>): Promise<Readonly<DietDatabaseBackupResult>> {
  const input = exactInput(value, ["backupPath", "privateRuntimeRoot"]);
  const root = assertPrivateRuntimeRoot(absolutePath(input.privateRuntimeRoot, "runtime_root"));
  const backupPath = absolutePath(input.backupPath, "backup_path");
  const parent = existingParent(backupPath);
  if (backupPath === join(root, DIET_DATABASE_FILENAME) || existsSync(backupPath)) return invalid("backup_exists");
  const candidate = join(parent, `.${DIET_DATABASE_FILENAME}.backup-${randomUUID()}`);
  let candidateIdentity: BigIntStats | undefined;
  const runtime = openDietDatabase({ privateRuntimeRoot: root });
  try {
    await backup(runtime.database, candidate);
    candidateIdentity = ordinaryFile(candidate, "candidate");
    validateBackupDatabase(candidate);
    renameSync(candidate, backupPath);
    candidateIdentity = undefined;
    const stat = ordinaryFile(backupPath, "backup_file");
    if (stat.size > BigInt(Number.MAX_SAFE_INTEGER)) return invalid("backup_size");
    return Object.freeze({
      backup_path: backupPath,
      bytes: Number(stat.size),
      sha256: sha256(backupPath),
    });
  } finally {
    runtime.close();
    removeOwned(candidate, candidateIdentity);
  }
}

export async function backupDietDatabaseForUpgrade(value: Readonly<{
  privateRuntimeRoot: string;
  backupPath: string;
}>): Promise<Readonly<DietDatabaseBackupResult & { source_user_version: number }>> {
  const input = exactInput(value, ["backupPath", "privateRuntimeRoot"]);
  const root = assertPrivateRuntimeRoot(absolutePath(input.privateRuntimeRoot, "runtime_root"));
  const backupPath = absolutePath(input.backupPath, "backup_path");
  const parent = existingParent(backupPath);
  const databasePath = join(root, DIET_DATABASE_FILENAME);
  const sourceVersion = validateUpgradeableDatabase(databasePath);
  if (existsSync(backupPath)) return invalid("backup_exists");
  const candidate = join(parent, `.${DIET_DATABASE_FILENAME}.upgrade-backup-${randomUUID()}`);
  let candidateIdentity: BigIntStats | undefined;
  const database: DatabaseSyncType = new DatabaseSync(databasePath, {
    readOnly: true,
    timeout: 5_000,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    defensive: true,
  });
  try {
    await backup(database, candidate);
    candidateIdentity = ordinaryFile(candidate, "candidate");
    if (validateUpgradeableDatabase(candidate) !== sourceVersion) return invalid("upgrade_version");
    renameSync(candidate, backupPath);
    candidateIdentity = undefined;
    const stat = ordinaryFile(backupPath, "backup_file");
    if (stat.size > BigInt(Number.MAX_SAFE_INTEGER)) return invalid("backup_size");
    return Object.freeze({
      backup_path: backupPath,
      bytes: Number(stat.size),
      sha256: sha256(backupPath),
      source_user_version: sourceVersion,
    });
  } finally {
    database.close();
    removeOwned(candidate, candidateIdentity);
  }
}

function restoreDatabase(
  value: Readonly<{ privateRuntimeRoot: string; backupPath: string; expectedSha256: string }>,
  validateDatabase: (path: string) => unknown,
): Readonly<DietDatabaseBackupResult> {
  const input = exactInput(value, ["backupPath", "expectedSha256", "privateRuntimeRoot"]);
  const root = assertPrivateRuntimeRoot(absolutePath(input.privateRuntimeRoot, "runtime_root"));
  const backupPath = absolutePath(input.backupPath, "backup_path");
  const expected = input.expectedSha256;
  if (typeof expected !== "string" || !/^[A-F0-9]{64}$/u.test(expected)) return invalid("expected_sha256");
  const backupStat = ordinaryFile(backupPath, "backup_file");
  if (sha256(backupPath) !== expected) return invalid("backup_digest");
  validateDatabase(backupPath);

  const secretPath = join(root, CORE_RUNTIME_SECRET_FILENAME);
  const secretStat = ordinaryFile(secretPath, "authority_secret");
  if (secretStat.size !== 32n) return invalid("authority_secret");
  const databasePath = join(root, DIET_DATABASE_FILENAME);
  if (existsSync(`${databasePath}-wal`) || existsSync(`${databasePath}-shm`)) return invalid("runtime_active");
  const previousExists = existsSync(databasePath);
  if (previousExists) ordinaryFile(databasePath, "database_file");

  const candidate = join(root, `.${DIET_DATABASE_FILENAME}.restore-${randomUUID()}`);
  const previous = join(root, `.${DIET_DATABASE_FILENAME}.previous-${randomUUID()}`);
  let candidateIdentity: BigIntStats | undefined;
  let movedPrevious = false;
  let installed = false;
  try {
    copyFileSync(backupPath, candidate, constants.COPYFILE_EXCL);
    candidateIdentity = ordinaryFile(candidate, "restore_candidate");
    validateDatabase(candidate);
    if (previousExists) {
      renameSync(databasePath, previous);
      movedPrevious = true;
    }
    renameSync(candidate, databasePath);
    candidateIdentity = undefined;
    installed = true;
    validateDatabase(databasePath);
    if (movedPrevious) unlinkSync(previous);
    return Object.freeze({
      backup_path: backupPath,
      bytes: Number(backupStat.size),
      sha256: expected,
    });
  } catch (error) {
    if (installed && existsSync(databasePath)) unlinkSync(databasePath);
    if (movedPrevious && existsSync(previous)) renameSync(previous, databasePath);
    throw error;
  } finally {
    removeOwned(candidate, candidateIdentity);
  }
}

export function restoreDietDatabase(value: Readonly<{
  privateRuntimeRoot: string;
  backupPath: string;
  expectedSha256: string;
}>): Readonly<DietDatabaseBackupResult> {
  return restoreDatabase(value, validateBackupDatabase);
}

export function restoreDietDatabaseForUpgrade(value: Readonly<{
  privateRuntimeRoot: string;
  backupPath: string;
  expectedSha256: string;
}>): Readonly<DietDatabaseBackupResult> {
  return restoreDatabase(value, validateUpgradeableDatabase);
}
