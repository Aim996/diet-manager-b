import { MIGRATION_V1_ID, MIGRATION_V1_INDEX_STATEMENTS, MIGRATION_V1_MAPPING_SHA256, MIGRATION_V1_TABLE_STATEMENTS, } from "./migration-v1.js";
function injectedFault(fault) {
    return new Error(`STORAGE_MIGRATION_FAILED:${fault}`);
}
export function applyMigrationV1(database, options) {
    database.exec("BEGIN EXCLUSIVE");
    try {
        for (const statement of MIGRATION_V1_TABLE_STATEMENTS)
            database.exec(statement);
        for (const statement of MIGRATION_V1_INDEX_STATEMENTS)
            database.exec(statement);
        if (options.fault === "after_schema")
            throw injectedFault(options.fault);
        database.exec("PRAGMA application_id = 1145913905");
        database.exec("PRAGMA user_version = 1");
        if (options.fault === "before_history")
            throw injectedFault(options.fault);
        database
            .prepare("INSERT INTO schema_migrations(version, migration_id, applied_at, checksum) VALUES (?, ?, ?, ?)")
            .run(1, MIGRATION_V1_ID, options.now, MIGRATION_V1_MAPPING_SHA256);
        if (options.fault === "before_commit")
            throw injectedFault(options.fault);
        database.exec("COMMIT");
    }
    catch (error) {
        try {
            database.exec("ROLLBACK");
        }
        catch {
            // The primary migration failure remains authoritative.
        }
        if (error instanceof Error && error.message.startsWith("STORAGE_MIGRATION_FAILED:")) {
            throw error;
        }
        throw new Error("STORAGE_MIGRATION_FAILED:apply", { cause: error });
    }
}
