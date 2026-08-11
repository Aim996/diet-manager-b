import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe("diet manager B SQLite runtime", () => {
  test("commits, rolls back, closes, and leaves no test-owned files after cleanup", async () => {
    const testRoot = mkdtempSync(join(tmpdir(), "diet-manager-sqlite-"));
    const databasePath = join(testRoot, "compatibility.sqlite");

    try {
      const runtimeModule = await import("../src/storage/sqlite-runtime");
      const runtime = runtimeModule.openSqliteRuntime(databasePath);

      try {
        runtime.database.exec(`
          PRAGMA journal_mode = WAL;
          CREATE TABLE compatibility_events (
            id INTEGER PRIMARY KEY,
            value TEXT NOT NULL
          ) STRICT;
          BEGIN IMMEDIATE;
          INSERT INTO compatibility_events (value) VALUES ('committed');
          COMMIT;
        `);

        runtime.database.exec(`
          BEGIN IMMEDIATE;
          INSERT INTO compatibility_events (value) VALUES ('rolled-back');
          ROLLBACK;
        `);

        expect(
          runtime.database
            .prepare("SELECT id, value FROM compatibility_events ORDER BY id")
            .all(),
        ).toEqual([{ id: 1, value: "committed" }]);
      } finally {
        runtime.close();
      }

      expect(runtime.database.isOpen).toBe(false);
      expect(existsSync(databasePath)).toBe(true);
      expect(readdirSync(testRoot)).toContain("compatibility.sqlite");
    } finally {
      rmSync(testRoot, { recursive: true, force: false });
    }

    expect(existsSync(testRoot)).toBe(false);
  });
});
