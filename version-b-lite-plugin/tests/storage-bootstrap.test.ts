import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import {
  DIET_DATABASE_APPLICATION_ID,
  DIET_DATABASE_FILENAME,
  DIET_DATABASE_MAPPING_SHA256,
  DIET_DATABASE_USER_VERSION,
  openDietDatabase,
  type MigrationFault,
} from "../src/storage/database.js";

const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as typeof import("node:sqlite");

const mappingPath = fileURLToPath(
  new URL("../../shared/contracts/storage-mapping.md", import.meta.url),
);
const ownedRoots = new Set<string>();

function newTestRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "diet-manager-b-B-STOR-001-"));
  ownedRoots.add(root);
  return root;
}

function removeOwnedRoot(root: string): void {
  if (!ownedRoots.delete(root)) throw new Error(`unregistered test root: ${root}`);
  rmSync(root, { recursive: true, force: false });
  expect(existsSync(root)).toBe(false);
}

function mappingContract(): Record<string, unknown> {
  const source = readFileSync(mappingPath, "utf8");
  const match = source.match(
    /```json storage-mapping\/v1\n([\s\S]*?)\n```/,
  );
  if (!match) throw new Error("storage mapping machine block missing");
  const bytes = Buffer.from(match[1], "utf8");
  expect(bytes).toHaveLength(44_461);
  expect(createHash("sha256").update(bytes).digest("hex").toUpperCase()).toBe(
    "19A74F1FB131CDCC1799653043EE707F6CC765369F4997811E62815ABED99D2F",
  );
  return JSON.parse(match[1]) as Record<string, unknown>;
}

function scalar(database: DatabaseSyncType, sql: string): number | string {
  const row = database.prepare(sql).get() as Record<string, number | string>;
  return Object.values(row)[0];
}

interface MappingColumn {
  name: string;
  type: string;
  not_null: boolean;
  default: string | null;
}

interface MappingTable {
  name: string;
  columns: MappingColumn[];
  primary_key: string[];
  checks: string[];
  foreign_keys: string[];
}

interface MappingIndex {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  where: string | null;
}

function quoted(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

afterEach(() => {
  for (const root of [...ownedRoots]) removeOwnedRoot(root);
});

describe("B-STOR-001 database bootstrap", () => {
  test("publishes only the fixed leaf with exact mapping structure and zero business rows", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({
      privateRuntimeRoot: root,
      now: () => "2026-08-12T00:00:00.000Z",
    });

    try {
      expect(runtime.databasePath).toBe(join(resolve(root), DIET_DATABASE_FILENAME));
      expect(basename(runtime.databasePath)).toBe("diet-manager-b.sqlite3");
      expect(dirname(runtime.databasePath)).toBe(resolve(root));
      expect(lstatSync(runtime.databasePath).isFile()).toBe(true);

      expect(scalar(runtime.database, "PRAGMA application_id")).toBe(
        DIET_DATABASE_APPLICATION_ID,
      );
      expect(scalar(runtime.database, "PRAGMA user_version")).toBe(
        DIET_DATABASE_USER_VERSION,
      );
      expect(scalar(runtime.database, "PRAGMA foreign_keys")).toBe(1);
      expect(scalar(runtime.database, "PRAGMA busy_timeout")).toBe(5000);
      expect(scalar(runtime.database, "PRAGMA journal_mode")).toBe("wal");
      expect(scalar(runtime.database, "PRAGMA quick_check")).toBe("ok");
      expect(runtime.database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      const mapping = mappingContract() as {
        tables: MappingTable[];
        indexes: MappingIndex[];
      };
      const tableNames = runtime.database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => String((row as { name: string }).name));
      const indexNames = runtime.database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'index' AND sql IS NOT NULL ORDER BY name",
        )
        .all()
        .map((row) => String((row as { name: string }).name));
      const foreignKeyCount = tableNames.reduce(
        (count, table) =>
          count + runtime.database.prepare(`PRAGMA foreign_key_list('${table}')`).all().length,
        0,
      );

      expect(tableNames).toEqual(mapping.tables.map((table) => table.name).sort());
      expect(indexNames).toEqual(mapping.indexes.map((index) => index.name).sort());
      expect(tableNames).toHaveLength(20);
      expect(indexNames).toHaveLength(18);
      expect(foreignKeyCount).toBe(22);

      for (const table of mapping.tables) {
        const tableInfo = runtime.database
          .prepare(`PRAGMA table_info(${quoted(table.name)})`)
          .all() as Array<{
          cid: number;
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }>;
        expect(tableInfo).toEqual(
          table.columns.map((column, cid) => ({
            cid,
            name: column.name,
            type: column.type,
            notnull: column.not_null ? 1 : 0,
            dflt_value: column.default,
            pk: table.primary_key.indexOf(column.name) + 1,
          })),
        );

        const tableSql = String(
          (
            runtime.database
              .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
              .get(table.name) as { sql: string }
          ).sql,
        );
        for (const check of table.checks) {
          expect(tableSql).toContain(`CHECK (${check})`);
        }

        const expectedForeignKeys = table.foreign_keys
          .map((foreignKey) => {
            const match = foreignKey.match(
              /^([^ ]+) -> ([^(]+)\(([^)]+)\) ON UPDATE (\w+) ON DELETE (\w+)$/,
            );
            if (!match) throw new Error(`invalid mapping foreign key: ${foreignKey}`);
            return {
              from: match[1],
              table: match[2],
              to: match[3],
              on_update: match[4],
              on_delete: match[5],
            };
          })
          .sort((left, right) => left.from.localeCompare(right.from));
        const actualForeignKeys = (
          runtime.database
            .prepare(`PRAGMA foreign_key_list(${quoted(table.name)})`)
            .all() as Array<{
            from: string;
            table: string;
            to: string;
            on_update: string;
            on_delete: string;
          }>
        )
          .map(({ from, table: parent, to, on_update, on_delete }) => ({
            from,
            table: parent,
            to,
            on_update,
            on_delete,
          }))
          .sort((left, right) => left.from.localeCompare(right.from));
        expect(actualForeignKeys).toEqual(expectedForeignKeys);
      }

      for (const index of mapping.indexes) {
        const indexRows = runtime.database
          .prepare(`PRAGMA index_list(${quoted(index.table)})`)
          .all() as Array<{ name: string; unique: number; partial: number }>;
        const actualIndex = indexRows.find((row) => row.name === index.name);
        expect(actualIndex).toMatchObject({
          name: index.name,
          unique: index.unique ? 1 : 0,
          partial: index.where === null ? 0 : 1,
        });
        const actualColumns = runtime.database
          .prepare(`PRAGMA index_info(${quoted(index.name)})`)
          .all()
          .map((row) => String((row as { name: string }).name));
        expect(actualColumns).toEqual(index.columns);
      }

      expect(
        runtime.database
          .prepare(
            "SELECT version, migration_id, applied_at, checksum FROM schema_migrations",
          )
          .all(),
      ).toEqual([
        {
          version: 1,
          migration_id: "diet-manager/b-sqlite-migration/0001",
          applied_at: "2026-08-12T00:00:00.000Z",
          checksum: DIET_DATABASE_MAPPING_SHA256,
        },
      ]);

      for (const tableName of tableNames.filter(
        (name) => name !== "schema_migrations",
      )) {
        expect(scalar(runtime.database, `SELECT COUNT(*) FROM "${tableName}"`)).toBe(0);
      }
    } finally {
      runtime.close();
    }

    const reopened = openDietDatabase({ privateRuntimeRoot: root });
    try {
      expect(
        scalar(reopened.database, "SELECT COUNT(*) FROM schema_migrations"),
      ).toBe(1);
    } finally {
      reopened.close();
    }

    removeOwnedRoot(root);
  });

  test("rejects caller-controlled or reparse paths before opening SQLite", () => {
    expect(() => openDietDatabase({ privateRuntimeRoot: "relative-root" })).toThrow(
      "STORAGE_PATH_INVALID:absolute_root",
    );

    const owner = newTestRoot();
    const external = newTestRoot();
    const rootLink = join(owner, "root-link");
    symlinkSync(external, rootLink, process.platform === "win32" ? "junction" : "dir");
    expect(() => openDietDatabase({ privateRuntimeRoot: rootLink })).toThrow(
      "STORAGE_PATH_INVALID:root_reparse",
    );

    const databaseLink = join(owner, DIET_DATABASE_FILENAME);
    const sentinel = join(external, "sentinel.bin");
    writeFileSync(sentinel, Buffer.from("external-sentinel", "utf8"), { flag: "wx" });
    symlinkSync(external, databaseLink, "junction");
    const before = readFileSync(sentinel);
    expect(() => openDietDatabase({ privateRuntimeRoot: owner })).toThrow(
      "STORAGE_PATH_INVALID:database_reparse",
    );
    expect(readFileSync(sentinel)).toEqual(before);

    rmSync(databaseLink, { force: false });
    linkSync(sentinel, databaseLink);
    expect(() => openDietDatabase({ privateRuntimeRoot: owner })).toThrow(
      "STORAGE_PATH_INVALID:database_link_count",
    );
    expect(readFileSync(sentinel)).toEqual(before);

    rmSync(databaseLink, { force: false });
    rmSync(rootLink, { force: false });
    removeOwnedRoot(owner);
    removeOwnedRoot(external);
  });

  test.each<MigrationFault>([
    "after_schema",
    "before_history",
    "before_commit",
  ])("keeps a failed %s migration unpublished and residue-free", (migrationFault) => {
    const root = newTestRoot();
    expect(() =>
      openDietDatabase({
        privateRuntimeRoot: root,
        now: () => "2026-08-12T00:00:00.000Z",
        migrationFault,
      }),
    ).toThrow(`STORAGE_MIGRATION_FAILED:${migrationFault}`);

    expect(existsSync(join(root, DIET_DATABASE_FILENAME))).toBe(false);
    expect(readdirSync(root)).toEqual([]);

    const retry = openDietDatabase({
      privateRuntimeRoot: root,
      now: () => "2026-08-12T00:00:01.000Z",
    });
    retry.close();
    expect(existsSync(join(root, DIET_DATABASE_FILENAME))).toBe(true);
    removeOwnedRoot(root);
  });

  test("fails closed on an unknown existing database without changing its bytes", () => {
    const root = newTestRoot();
    const databasePath = join(root, DIET_DATABASE_FILENAME);
    const foreign = new DatabaseSync(databasePath);
    foreign.exec("CREATE TABLE legacy_records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    foreign.prepare("INSERT INTO legacy_records(value) VALUES (?)").run("unchanged");
    foreign.close();
    const before = readFileSync(databasePath);

    expect(() => openDietDatabase({ privateRuntimeRoot: root })).toThrow(
      "STORAGE_IDENTITY_INVALID:application_id",
    );
    expect(readFileSync(databasePath)).toEqual(before);

    removeOwnedRoot(root);
  });

  test("rejects a drifted v1 schema without changing the rejected bytes", () => {
    const root = newTestRoot();
    const created = openDietDatabase({ privateRuntimeRoot: root });
    created.close();

    const databasePath = join(root, DIET_DATABASE_FILENAME);
    const drifted = new DatabaseSync(databasePath);
    drifted.exec("DROP INDEX ux_mixed_item_idempotency");
    drifted.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    drifted.close();
    const before = readFileSync(databasePath);

    expect(() => openDietDatabase({ privateRuntimeRoot: root })).toThrow(
      "STORAGE_IDENTITY_INVALID:index:ux_mixed_item_idempotency",
    );
    expect(readFileSync(databasePath)).toEqual(before);

    removeOwnedRoot(root);
  });
});
