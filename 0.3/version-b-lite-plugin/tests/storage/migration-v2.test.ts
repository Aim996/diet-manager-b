import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  DIET_DATABASE_APPLICATION_ID,
  DIET_DATABASE_FILENAME,
  DIET_DATABASE_USER_VERSION,
  openDietDatabase,
} from "../../src/storage/database.js";
import { applyMigrationV1 } from "../../src/storage/migrations.js";

const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as typeof import("node:sqlite");
const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "diet-manager-migration-v2-"));
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
  ).run("product-before-v2", "diet-manager/product/v1", "legacy milk", "food", "{}");
  database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  database.close();
  return path;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: false });
});

describe("SQLite migration v2", () => {
  it("creates a fresh database through v1 then v2 with the four new tables", () => {
    const runtime = openDietDatabase({
      privateRuntimeRoot: root(),
      now: () => "2026-08-21T00:00:00.000Z",
    });
    try {
      expect(DIET_DATABASE_USER_VERSION).toBe(2);
      expect(scalar(runtime.database, "PRAGMA user_version")).toBe(2);
      expect(runtime.database.prepare(
        "SELECT version FROM schema_migrations ORDER BY version",
      ).all()).toEqual([{ version: 1 }, { version: 2 }]);
      const tables = runtime.database.prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name IN (
           'pending_candidates', 'inventory_quantity_models',
           'nutrition_search_audit', 'goal_recommendations'
         ) ORDER BY name`,
      ).all();
      expect(tables).toEqual([
        { name: "goal_recommendations" },
        { name: "inventory_quantity_models" },
        { name: "nutrition_search_audit" },
        { name: "pending_candidates" },
      ]);
    } finally {
      runtime.close();
    }
  });

  it("upgrades a valid v1 database without changing its business rows and is repeatable", () => {
    const runtimeRoot = root();
    const path = createV1Database(runtimeRoot);

    const upgraded = openDietDatabase({
      privateRuntimeRoot: runtimeRoot,
      now: () => "2026-08-21T00:00:01.000Z",
    });
    try {
      expect(scalar(upgraded.database, "PRAGMA application_id"))
        .toBe(DIET_DATABASE_APPLICATION_ID);
      expect(scalar(upgraded.database, "PRAGMA user_version")).toBe(2);
      expect(upgraded.database.prepare(
        "SELECT product_id, normalized_name FROM products",
      ).all()).toEqual([{
        product_id: "product-before-v2",
        normalized_name: "legacy milk",
      }]);
    } finally {
      upgraded.close();
    }

    expect(existsSync(`${path}.pre-v2.bak`)).toBe(true);
    const reopened = openDietDatabase({ privateRuntimeRoot: runtimeRoot });
    try {
      expect(scalar(reopened.database, "SELECT COUNT(*) FROM schema_migrations")).toBe(2);
      expect(scalar(reopened.database, "SELECT COUNT(*) FROM products")).toBe(1);
    } finally {
      reopened.close();
    }
  });

});
