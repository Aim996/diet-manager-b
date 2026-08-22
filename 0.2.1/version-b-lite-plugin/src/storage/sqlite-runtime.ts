import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as typeof import("node:sqlite");

export interface SqliteRuntime {
  database: DatabaseSyncType;
  close(): void;
}

export function openSqliteRuntime(databasePath: string): SqliteRuntime {
  const database = new DatabaseSync(databasePath);
  let closed = false;

  return {
    database,
    close() {
      if (closed) return;
      database.close();
      closed = true;
    },
  };
}
