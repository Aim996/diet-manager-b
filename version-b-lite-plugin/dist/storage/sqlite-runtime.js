import { createRequire } from "node:module";
const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite");
export function openSqliteRuntime(databasePath) {
    const database = new DatabaseSync(databasePath);
    let closed = false;
    return {
        database,
        close() {
            if (closed)
                return;
            database.close();
            closed = true;
        },
    };
}
