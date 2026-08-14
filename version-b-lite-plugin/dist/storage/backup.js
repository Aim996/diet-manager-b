import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { constants, copyFileSync, existsSync, lstatSync, readFileSync, realpathSync, renameSync, unlinkSync, } from "node:fs";
import { isProxy } from "node:util/types";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { CORE_RUNTIME_SECRET_FILENAME } from "../application/core-runtime.js";
import { assertDietDatabaseIdentity, assertPrivateRuntimeRoot, DIET_DATABASE_FILENAME, openDietDatabase, } from "./database.js";
const requireNode = createRequire(import.meta.url);
const { backup, DatabaseSync } = requireNode("node:sqlite");
function invalid(reason) {
    throw new Error(`DIET_BACKUP_INVALID:${reason}`);
}
function exactInput(value, fields) {
    if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value) ||
        Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0"))
        return invalid("input");
    return value;
}
function ordinaryFile(path, reason) {
    let stat;
    try {
        stat = lstatSync(path, { bigint: true });
    }
    catch {
        return invalid(reason);
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n)
        return invalid(reason);
    return stat;
}
function existingParent(path) {
    const parent = dirname(path);
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync.native(parent) !== resolve(parent)) {
        return invalid("backup_parent");
    }
    return parent;
}
function absolutePath(value, reason) {
    if (typeof value !== "string" || value.length === 0 || !isAbsolute(value) || resolve(value) !== value) {
        return invalid(reason);
    }
    return value;
}
function sha256(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}
function validateBackupDatabase(path) {
    const database = new DatabaseSync(path, {
        readOnly: true,
        timeout: 5_000,
        enableForeignKeyConstraints: true,
        enableDoubleQuotedStringLiterals: false,
        allowExtension: false,
        defensive: true,
    });
    try {
        assertDietDatabaseIdentity(database);
    }
    finally {
        database.close();
    }
}
function removeOwned(path, identity) {
    if (identity === undefined || !existsSync(path))
        return;
    const current = lstatSync(path, { bigint: true });
    if (current.dev === identity.dev && current.ino === identity.ino && current.nlink === 1n && current.isFile()) {
        unlinkSync(path);
    }
}
export async function backupDietDatabase(value) {
    const input = exactInput(value, ["backupPath", "privateRuntimeRoot"]);
    const root = assertPrivateRuntimeRoot(absolutePath(input.privateRuntimeRoot, "runtime_root"));
    const backupPath = absolutePath(input.backupPath, "backup_path");
    const parent = existingParent(backupPath);
    if (backupPath === join(root, DIET_DATABASE_FILENAME) || existsSync(backupPath))
        return invalid("backup_exists");
    const candidate = join(parent, `.${DIET_DATABASE_FILENAME}.backup-${randomUUID()}`);
    let candidateIdentity;
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
        await backup(runtime.database, candidate);
        candidateIdentity = ordinaryFile(candidate, "candidate");
        validateBackupDatabase(candidate);
        renameSync(candidate, backupPath);
        candidateIdentity = undefined;
        const stat = ordinaryFile(backupPath, "backup_file");
        if (stat.size > BigInt(Number.MAX_SAFE_INTEGER))
            return invalid("backup_size");
        return Object.freeze({
            backup_path: backupPath,
            bytes: Number(stat.size),
            sha256: sha256(backupPath),
        });
    }
    finally {
        runtime.close();
        removeOwned(candidate, candidateIdentity);
    }
}
export function restoreDietDatabase(value) {
    const input = exactInput(value, ["backupPath", "expectedSha256", "privateRuntimeRoot"]);
    const root = assertPrivateRuntimeRoot(absolutePath(input.privateRuntimeRoot, "runtime_root"));
    const backupPath = absolutePath(input.backupPath, "backup_path");
    const expected = input.expectedSha256;
    if (typeof expected !== "string" || !/^[A-F0-9]{64}$/u.test(expected))
        return invalid("expected_sha256");
    const backupStat = ordinaryFile(backupPath, "backup_file");
    if (sha256(backupPath) !== expected)
        return invalid("backup_digest");
    validateBackupDatabase(backupPath);
    const secretPath = join(root, CORE_RUNTIME_SECRET_FILENAME);
    const secretStat = ordinaryFile(secretPath, "authority_secret");
    if (secretStat.size !== 32n)
        return invalid("authority_secret");
    const databasePath = join(root, DIET_DATABASE_FILENAME);
    if (existsSync(`${databasePath}-wal`) || existsSync(`${databasePath}-shm`))
        return invalid("runtime_active");
    const previousExists = existsSync(databasePath);
    if (previousExists)
        ordinaryFile(databasePath, "database_file");
    const candidate = join(root, `.${DIET_DATABASE_FILENAME}.restore-${randomUUID()}`);
    const previous = join(root, `.${DIET_DATABASE_FILENAME}.previous-${randomUUID()}`);
    let candidateIdentity;
    let movedPrevious = false;
    let installed = false;
    try {
        copyFileSync(backupPath, candidate, constants.COPYFILE_EXCL);
        candidateIdentity = ordinaryFile(candidate, "restore_candidate");
        validateBackupDatabase(candidate);
        if (previousExists) {
            renameSync(databasePath, previous);
            movedPrevious = true;
        }
        renameSync(candidate, databasePath);
        candidateIdentity = undefined;
        installed = true;
        validateBackupDatabase(databasePath);
        if (movedPrevious)
            unlinkSync(previous);
        const restoredStat = ordinaryFile(databasePath, "database_file");
        return Object.freeze({
            backup_path: backupPath,
            bytes: Number(backupStat.size),
            sha256: expected,
        });
    }
    catch (error) {
        if (installed && existsSync(databasePath))
            unlinkSync(databasePath);
        if (movedPrevious && existsSync(previous))
            renameSync(previous, databasePath);
        throw error;
    }
    finally {
        removeOwned(candidate, candidateIdentity);
    }
}
