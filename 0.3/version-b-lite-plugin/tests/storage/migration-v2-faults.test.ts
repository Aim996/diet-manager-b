import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  DIET_DATABASE_FILENAME,
  openDietDatabase,
} from "../../src/storage/database.js";
import { applyMigrationV1 } from "../../src/storage/migrations.js";

const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as typeof import("node:sqlite");
const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "diet-manager-migration-v2-fault-"));
  roots.push(value);
  return value;
}

function scalar(database: DatabaseSyncType, sql: string): number | string {
  const row = database.prepare(sql).get() as Record<string, number | string>;
  return Object.values(row)[0]!;
}

function createV1Database(runtimeRoot: string): string {
  const path = join(runtimeRoot, DIET_DATABASE_FILENAME);
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  applyMigrationV1(database, { now: "2026-08-20T00:00:00.000Z" });
  database.prepare(
    `INSERT INTO products(
      product_id, schema_version, normalized_name, product_type,
      brand, manufacturer, barcode, sku, payload_json
    ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
  ).run("product-before-v2-fault", "diet-manager/product/v1", "legacy milk", "food", "{}");
  database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  database.close();
  return path;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: false });
});

describe("SQLite migration v2 fault rollback", () => {
  it.each(["after_schema", "before_history", "before_commit"] as const)(
    "rolls back an upgrade fault at %s and leaves the v1 database usable",
    (migrationFault) => {
      const runtimeRoot = root();
      const path = createV1Database(runtimeRoot);

      let unexpected: ReturnType<typeof openDietDatabase> | undefined;
      try {
        expect(() => {
          unexpected = openDietDatabase({ privateRuntimeRoot: runtimeRoot, migrationFault });
        }).toThrow(`STORAGE_MIGRATION_FAILED:${migrationFault}`);
      } finally {
        unexpected?.close();
      }

      const legacy = new DatabaseSync(path, { readOnly: true });
      try {
        expect(scalar(legacy, "PRAGMA user_version")).toBe(1);
        expect(scalar(legacy, "SELECT COUNT(*) FROM schema_migrations")).toBe(1);
        expect(legacy.prepare(
          "SELECT name FROM sqlite_schema WHERE name = 'pending_candidates'",
        ).get()).toBeUndefined();
        expect(scalar(legacy, "SELECT COUNT(*) FROM products")).toBe(1);
      } finally {
        legacy.close();
      }
    },
  );
});
