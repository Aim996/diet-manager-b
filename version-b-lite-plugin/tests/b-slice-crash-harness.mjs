import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const node = process.execPath;
const worker = resolve("tests/b-slice-crash-worker.mjs");
const temporaryParent = resolve(tmpdir());
const ownerFile = ".b-slice-crash-owner.json";
const databaseFile = "diet-manager-b.sqlite3";
const crashExit = 73;
const roots = new Set();

function assert(condition, message) {
  if (!condition) throw new Error(`B_SLICE_CRASH_HARNESS_FAILED:${message}`);
}

function newRoot() {
  const root = resolve(tmpdir(), `diet-manager-b-slice-crash-${randomBytes(16).toString("hex")}`);
  assert(dirname(root).toLowerCase() === temporaryParent.toLowerCase(), "root_parent");
  mkdirSync(root, { recursive: false });
  const token = randomBytes(24).toString("hex");
  writeFileSync(resolve(root, ownerFile), JSON.stringify({ owner: "B-SLICE-001", token }), "utf8");
  roots.add(root);
  return Object.freeze({ root, token });
}

function removeRoot(root) {
  assert(roots.delete(root), "root_unowned");
  assert(dirname(root).toLowerCase() === temporaryParent.toLowerCase(), "cleanup_parent");
  assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(), "cleanup_root");
  rmSync(root, { recursive: true, force: false });
  assert(!existsSync(root), "cleanup_residue");
}

function runWorker(root, token, mode) {
  const result = spawnSync(node, [worker, mode, token], {
    cwd: process.cwd(),
    env: { ...process.env, B_SLICE_CRASH_ROOT: root },
    encoding: "utf8",
    windowsHide: true,
  });
  assert(result.error === undefined, `child_spawn:${mode}`);
  assert(result.status === crashExit, `child_exit:${mode}:${result.status}`);
  assert(result.signal === null, `child_signal:${mode}:${result.signal}`);
  assert(result.stderr === "", `child_stderr:${mode}`);
  const output = JSON.parse(result.stdout.trim());
  assert(output.mode === mode, `child_mode:${mode}`);
  return output.input;
}

function counts(database) {
  const names = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(({ name }) => name);
  return Object.fromEntries(names.map((name) => [
    name,
    database.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get().count,
  ]));
}

function databaseFor(root) {
  const path = resolve(root, databaseFile);
  assert(existsSync(path), "database_missing");
  return new DatabaseSync(path, { enableForeignKeyConstraints: true, defensive: true });
}

async function runCase(mode, verify) {
  const { root, token } = newRoot();
  try {
    const input = runWorker(root, token, mode);
    const database = databaseFor(root);
    try {
      await verify(database, input);
    } finally {
      database.close();
    }
  } finally {
    removeRoot(root);
  }
}

try {
  await runCase("after_fact_commit", async (database, input) => {
    const before = counts(database);
    assert(before.event_records === 1, "fact_commit_event");
    assert(before.effect_outbox === 2, `fact_commit_outbox:${JSON.stringify(before)}`);
    assert(before.nutrition_snapshots === 0, "fact_commit_no_effect");
    const { createDietDomainService } = await import("../dist/domain/service.js");
    const service = createDietDomainService({
      database,
      secret: Buffer.from("B-SLICE-001 crash harness secret 0001", "utf8"),
      now: () => "2026-08-12T10:00:01.000Z",
    });
    const result = service.execute(input);
    const after = counts(database);
    assert(result.status === "committed", "fact_commit_restart_result");
    assert(after.event_records === before.event_records, "fact_commit_no_new_fact");
    assert(after.effect_outbox === before.effect_outbox, "fact_commit_no_new_outbox");
    assert(after.nutrition_snapshots === 1, "fact_commit_applied_effect");
  });

  await runCase("after_effect_bundle", async (database, input) => {
    const before = counts(database);
    assert(before.event_records === 2, "effect_bundle_facts");
    assert(before.envelope_finalizations === 0, "effect_bundle_not_finalized");
    const { createDietDomainService } = await import("../dist/domain/service.js");
    const service = createDietDomainService({
      database,
      secret: Buffer.from("B-SLICE-001 crash harness secret 0001", "utf8"),
      now: () => "2026-08-12T10:00:01.000Z",
    });
    const result = service.execute(input);
    const after = counts(database);
    assert(result.status === "committed", "effect_bundle_restart_result");
    assert(after.envelope_finalizations === 1, "effect_bundle_finalized");
    const finalizationTables = new Set([
      "daily_progress_snapshots",
      "envelope_finalizations",
      "mixed_item_results",
    ]);
    for (const [table, count] of Object.entries(before)) {
      if (!finalizationTables.has(table)) {
        assert(after[table] === count, `effect_bundle_only_finalize:${table}`);
      }
    }
  });

  await runCase("after_finalize_before_reply", async (database, input) => {
    const before = counts(database);
    assert(before.envelope_finalizations === 1, "finalize_before_reply_finalized");
    const frozen = database.prepare(
      "SELECT payload_json FROM envelope_finalizations WHERE envelope_id = ?",
    ).get(input.envelope.envelope_id).payload_json;
    const { createDietDomainService } = await import("../dist/domain/service.js");
    const service = createDietDomainService({
      database,
      secret: Buffer.from("B-SLICE-001 crash harness secret 0001", "utf8"),
      now: () => "2026-08-12T10:00:01.000Z",
    });
    const result = service.execute(input);
    const after = counts(database);
    assert(JSON.stringify(result) === frozen, "finalize_before_reply_frozen_reply");
    assert(JSON.stringify(after) === JSON.stringify(before), "finalize_before_reply_zero_rows");
  });

  assert(roots.size === 0, "roots_survived");
  process.stdout.write("PASS B-SLICE-001 crash recovery: no surviving child, temporary database, or log residue\n");
} catch (error) {
  for (const root of [...roots]) {
    try { removeRoot(root); } catch { /* Preserve the primary verification failure. */ }
  }
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
