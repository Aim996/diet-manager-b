import { randomUUID } from "node:crypto";
import { existsSync, linkSync, lstatSync, realpathSync, rmSync, unlinkSync, } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { MIGRATION_V1_FOREIGN_KEY_COUNT, MIGRATION_V1_ID, MIGRATION_V1_INDEX_NAMES, MIGRATION_V1_INDEX_STATEMENTS, MIGRATION_V1_MAPPING_SHA256, MIGRATION_V1_TABLE_NAMES, MIGRATION_V1_TABLE_STATEMENTS, } from "./migration-v1.js";
import { applyMigrationV1 } from "./migrations.js";
const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite");
export const DIET_DATABASE_FILENAME = "diet-manager-b.sqlite3";
export const DIET_DATABASE_APPLICATION_ID = 1_145_913_905;
export const DIET_DATABASE_USER_VERSION = 1;
export const DIET_DATABASE_MAPPING_SHA256 = MIGRATION_V1_MAPPING_SHA256;
function fail(code) {
    throw new Error(code);
}
function assertPrivateRuntimeRoot(value) {
    if (typeof value !== "string" || value.length === 0 || !isAbsolute(value)) {
        return fail("STORAGE_PATH_INVALID:absolute_root");
    }
    const root = resolve(value);
    let stat;
    try {
        stat = lstatSync(root);
    }
    catch (error) {
        throw new Error("STORAGE_PATH_INVALID:root_missing", { cause: error });
    }
    if (stat.isSymbolicLink())
        return fail("STORAGE_PATH_INVALID:root_reparse");
    if (!stat.isDirectory())
        return fail("STORAGE_PATH_INVALID:root_directory");
    const physical = realpathSync.native(root);
    if (process.platform === "win32") {
        if (physical.toLowerCase() !== root.toLowerCase()) {
            return fail("STORAGE_PATH_INVALID:root_identity");
        }
    }
    else if (physical !== root) {
        return fail("STORAGE_PATH_INVALID:root_identity");
    }
    return root;
}
function assertOrdinaryDatabaseLeaf(databasePath) {
    let stat;
    try {
        stat = lstatSync(databasePath);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return false;
        throw error;
    }
    if (stat.isSymbolicLink())
        return fail("STORAGE_PATH_INVALID:database_reparse");
    if (!stat.isFile())
        return fail("STORAGE_PATH_INVALID:database_file");
    if (stat.nlink !== 1)
        return fail("STORAGE_PATH_INVALID:database_link_count");
    return true;
}
function scalar(database, sql) {
    const row = database.prepare(sql).get();
    if (!row)
        return fail("STORAGE_IDENTITY_INVALID:scalar");
    return Object.values(row)[0];
}
function expectedSchemaSql(statement) {
    return statement.endsWith(";") ? statement.slice(0, -1) : statement;
}
export function assertDietDatabaseIdentity(database) {
    if (scalar(database, "PRAGMA application_id") !== DIET_DATABASE_APPLICATION_ID) {
        return fail("STORAGE_IDENTITY_INVALID:application_id");
    }
    if (scalar(database, "PRAGMA user_version") !== DIET_DATABASE_USER_VERSION) {
        return fail("STORAGE_IDENTITY_INVALID:user_version");
    }
    if (String(scalar(database, "PRAGMA journal_mode")).toLowerCase() !== "wal") {
        return fail("STORAGE_IDENTITY_INVALID:journal_mode");
    }
    if (scalar(database, "PRAGMA quick_check") !== "ok") {
        return fail("STORAGE_INTEGRITY_INVALID:quick_check");
    }
    const foreignKeyProblems = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyProblems.length !== 0)
        return fail("STORAGE_INTEGRITY_INVALID:foreign_keys");
    const schemaRows = database
        .prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
        .all();
    const actual = new Map(schemaRows.map((row) => [`${row.type}:${row.name}`, row.sql]));
    for (let index = 0; index < MIGRATION_V1_TABLE_NAMES.length; index += 1) {
        const name = MIGRATION_V1_TABLE_NAMES[index];
        if (actual.get(`table:${name}`) !== expectedSchemaSql(MIGRATION_V1_TABLE_STATEMENTS[index])) {
            return fail(`STORAGE_IDENTITY_INVALID:table:${name}`);
        }
    }
    for (let index = 0; index < MIGRATION_V1_INDEX_NAMES.length; index += 1) {
        const name = MIGRATION_V1_INDEX_NAMES[index];
        if (actual.get(`index:${name}`) !== expectedSchemaSql(MIGRATION_V1_INDEX_STATEMENTS[index])) {
            return fail(`STORAGE_IDENTITY_INVALID:index:${name}`);
        }
    }
    if (actual.size !== MIGRATION_V1_TABLE_NAMES.length + MIGRATION_V1_INDEX_NAMES.length) {
        return fail("STORAGE_IDENTITY_INVALID:schema_count");
    }
    let foreignKeyCount = 0;
    for (const table of MIGRATION_V1_TABLE_NAMES) {
        foreignKeyCount += database.prepare(`PRAGMA foreign_key_list("${table}")`).all().length;
    }
    if (foreignKeyCount !== MIGRATION_V1_FOREIGN_KEY_COUNT) {
        return fail("STORAGE_IDENTITY_INVALID:foreign_key_count");
    }
    const migration = database
        .prepare("SELECT version, migration_id, checksum FROM schema_migrations WHERE version = 1")
        .get();
    if (!migration ||
        migration.version !== 1 ||
        migration.migration_id !== MIGRATION_V1_ID ||
        migration.checksum !== MIGRATION_V1_MAPPING_SHA256) {
        return fail("STORAGE_IDENTITY_INVALID:migration_history");
    }
}
function configureConnection(database) {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");
}
function openConnection(databasePath, readOnly = false) {
    return new DatabaseSync(databasePath, {
        readOnly,
        timeout: 5_000,
        enableForeignKeyConstraints: true,
        enableDoubleQuotedStringLiterals: false,
        allowExtension: false,
        defensive: true,
    });
}
function cleanupCandidate(candidatePath) {
    for (const path of [candidatePath, `${candidatePath}-wal`, `${candidatePath}-shm`]) {
        if (existsSync(path))
            rmSync(path, { force: true });
    }
}
function removeCandidateSidecars(candidatePath) {
    for (const path of [`${candidatePath}-wal`, `${candidatePath}-shm`]) {
        if (existsSync(path))
            rmSync(path, { force: true });
    }
}
function createFreshDatabase(root, finalPath, options) {
    const candidatePath = join(root, `.${DIET_DATABASE_FILENAME}.candidate-${randomUUID()}`);
    let database;
    try {
        database = openConnection(candidatePath);
        configureConnection(database);
        if (String(scalar(database, "PRAGMA journal_mode = WAL")).toLowerCase() !== "wal") {
            return fail("STORAGE_MIGRATION_FAILED:journal_mode");
        }
        applyMigrationV1(database, {
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
    }
    catch (error) {
        try {
            database?.close();
        }
        catch {
            // Cleanup below remains best-effort; the primary failure is preserved.
        }
        cleanupCandidate(candidatePath);
        throw error;
    }
}
function validateExistingReadOnly(databasePath) {
    let database;
    try {
        database = openConnection(databasePath, true);
        assertDietDatabaseIdentity(database);
    }
    finally {
        database?.close();
    }
}
export function openDietDatabase(options) {
    const root = assertPrivateRuntimeRoot(options.privateRuntimeRoot);
    const databasePath = join(root, DIET_DATABASE_FILENAME);
    const databaseExists = assertOrdinaryDatabaseLeaf(databasePath);
    if (databaseExists) {
        validateExistingReadOnly(databasePath);
    }
    else {
        createFreshDatabase(root, databasePath, options);
    }
    if (!assertOrdinaryDatabaseLeaf(databasePath)) {
        return fail("STORAGE_IDENTITY_INVALID:published_database_missing");
    }
    const database = openConnection(databasePath);
    configureConnection(database);
    try {
        assertDietDatabaseIdentity(database);
    }
    catch (error) {
        database.close();
        throw error;
    }
    let closed = false;
    return {
        database,
        databasePath,
        close() {
            if (closed)
                return;
            database.close();
            closed = true;
        },
    };
}
