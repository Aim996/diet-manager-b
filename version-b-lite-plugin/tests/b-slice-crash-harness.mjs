import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const childTimeoutMs = 30_000;
const roots = new Map();
const expectedFinalizationSnapshots = Object.freeze({
  command_envelopes: "d1045e31409a2daef86a6a675e9d305d44051a8a87592d168ad61c89267f0a20",
  idempotency_records: "78444d24787f5b7138d1ea5e12e86938df80d1984dd610790d3f0e55b9a211f4",
  daily_progress_snapshots: "52293a8ef0f30ef1e020defad33a11fac4c1d8c05d51f2d14bcb270f9e36d4c3",
  envelope_finalizations: "2ab918c4e3d90ce9d1fdf78ff6cf8ee81b15c4c11019cd7d4e2e4651230d6082",
  mixed_item_results: "cd0f4499faf1eab638f70a89f910d454649dd30ceaa9988d3c5ae294d44095b1",
});

function assert(condition, message) {
  if (!condition) throw new Error(`B_SLICE_CRASH_HARNESS_FAILED:${message}`);
}

function fileIdentity(path, kind) {
  const stat = lstatSync(path);
  assert(!stat.isSymbolicLink(), `identity_link:${kind}`);
  assert(kind === "root" ? stat.isDirectory() : stat.isFile(), `identity_kind:${kind}`);
  return Object.freeze({
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtime_ms: stat.birthtimeMs,
    ctime_ms: stat.ctimeMs,
    size: stat.size,
  });
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.birthtime_ms === right.birthtime_ms && left.ctime_ms === right.ctime_ms &&
    left.size === right.size;
}

function sameRootIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.birthtime_ms === right.birthtime_ms;
}

function ownerBytes(token) {
  return Buffer.from(JSON.stringify({ owner: "B-SLICE-001", token }), "utf8");
}

function newRoot() {
  const root = resolve(tmpdir(), `diet-manager-b-slice-crash-${randomBytes(16).toString("hex")}`);
  assert(dirname(root).toLowerCase() === temporaryParent.toLowerCase(), "root_parent");
  mkdirSync(root, { recursive: false });
  const token = randomBytes(24).toString("hex");
  const bytes = ownerBytes(token);
  const marker = resolve(root, ownerFile);
  writeFileSync(marker, bytes, { encoding: "utf8", flag: "wx" });
  roots.set(root, Object.freeze({
    token,
    owner_bytes: bytes,
    root_identity: fileIdentity(root, "root"),
    owner_identity: fileIdentity(marker, "owner"),
  }));
  return Object.freeze({ root, token });
}

function removeRoot(root) {
  const ownership = roots.get(root);
  assert(ownership !== undefined, "root_unowned");
  assert(dirname(root).toLowerCase() === temporaryParent.toLowerCase(), "cleanup_parent");
  assert(sameRootIdentity(fileIdentity(root, "root"), ownership.root_identity), "cleanup_root_identity");
  const marker = resolve(root, ownerFile);
  assert(sameIdentity(fileIdentity(marker, "owner"), ownership.owner_identity), "cleanup_owner_identity");
  assert(readFileSync(marker).equals(ownership.owner_bytes), "cleanup_owner_bytes");
  rmSync(root, { recursive: true, force: false });
  assert(!existsSync(root), "cleanup_residue");
  roots.delete(root);
}

function cleanupOwnedRoots() {
  for (const root of [...roots.keys()]) {
    try { removeRoot(root); } catch { /* Preserve the primary verification failure. */ }
  }
}

function assertNoSurvivingChild(pid, mode) {
  if (pid === undefined) return;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") return;
    throw error;
  }
  throw new Error(`B_SLICE_CRASH_HARNESS_FAILED:child_survived:${mode}`);
}

function spawnChild(args, mode, env = process.env, timeout = childTimeoutMs) {
  return spawnSync(node, args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout,
    killSignal: "SIGKILL",
  });
}

function runWorker(root, token, mode) {
  const result = spawnChild([worker, mode, token], mode, {
    ...process.env,
    B_SLICE_CRASH_ROOT: root,
  });
  if (result.error?.code === "ETIMEDOUT") {
    assertNoSurvivingChild(result.pid, mode);
    throw new Error(`B_SLICE_CRASH_HARNESS_FAILED:child_timeout:${mode}`);
  }
  assert(result.error === undefined, `child_spawn:${mode}`);
  assert(result.status === crashExit, `child_exit:${mode}:${result.status}`);
  assert(result.signal === null, `child_signal:${mode}:${result.signal}`);
  assert(result.stderr === "", `child_stderr:${mode}`);
  const output = JSON.parse(result.stdout.trim());
  assert(output.mode === mode, `child_mode:${mode}`);
  return output.input;
}

function databaseTables(database) {
  return database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(({ name }) => name);
}

function counts(database) {
  const names = databaseTables(database);
  return Object.fromEntries(names.map((name) => [
    name,
    database.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get().count,
  ]));
}

function canonicalValue(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Object.freeze({ type: "blob", hex: Buffer.from(value).toString("hex") });
  }
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "bigint") return Object.freeze({ type: "bigint", value: value.toString() });
  if (typeof value === "boolean") return value;
  throw new Error(`B_SLICE_CRASH_HARNESS_FAILED:snapshot_value:${typeof value}`);
}

function tableSnapshot(database) {
  return Object.freeze(Object.fromEntries(databaseTables(database).map((table) => {
    const columns = database.prepare(`PRAGMA table_info("${table}")`).all()
      .map(({ name }) => name);
    const rows = database.prepare(`SELECT * FROM "${table}"`).all().map((row) =>
      Object.freeze(columns.map((column) => Object.freeze([column, canonicalValue(row[column])]))),
    ).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return [table, Object.freeze(rows)];
  })));
}

function snapshotEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function snapshotDigest(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot), "utf8").digest("hex");
}

function assertSnapshotUnchanged(before, after, tables, label) {
  for (const table of tables) {
    assert(snapshotEquals(before[table], after[table]), `${label}:${table}`);
  }
}

function databaseFor(root) {
  const path = resolve(root, databaseFile);
  assert(existsSync(path), "database_missing");
  return new DatabaseSync(path, { enableForeignKeyConstraints: true, defensive: true });
}

function expectFailure(action, code) {
  try {
    action();
  } catch (error) {
    assert(error instanceof Error && error.message.includes(code), `selftest_failure:${code}`);
    return;
  }
  throw new Error(`B_SLICE_CRASH_HARNESS_FAILED:selftest_missing_failure:${code}`);
}

function verifyHangTimeout() {
  const result = spawnChild(["-e", "setInterval(() => {}, 1000)"], "selftest_hang", process.env, 200);
  assert(result.error?.code === "ETIMEDOUT", "selftest_hang_timeout");
  assertNoSurvivingChild(result.pid, "selftest_hang");
}

function verifyReplacementRootRefused() {
  const { root, token } = newRoot();
  const original = `${root}-original`;
  try {
    renameSync(root, original);
    mkdirSync(root, { recursive: false });
    writeFileSync(resolve(root, ownerFile), ownerBytes(token), { encoding: "utf8", flag: "wx" });
    const sentinel = resolve(root, "replacement-sentinel.txt");
    writeFileSync(sentinel, "must survive", { encoding: "utf8", flag: "wx" });
    expectFailure(() => removeRoot(root), "cleanup_root_identity");
    assert(existsSync(sentinel), "selftest_replacement_sentinel_deleted");
    rmSync(root, { recursive: true, force: false });
    renameSync(original, root);
    removeRoot(root);
  } finally {
    if (existsSync(original) && !existsSync(root)) renameSync(original, root);
    if (roots.has(root)) {
      try { removeRoot(root); } catch { /* The self-test has already asserted fail-closed behavior. */ }
    }
  }
}

function verifySnapshotMutationCaught() {
  const { root, token } = newRoot();
  try {
    runWorker(root, token, "after_fact_commit");
    const database = databaseFor(root);
    try {
      const before = tableSnapshot(database);
      database.prepare("UPDATE command_envelopes SET result_status = 'tampered' WHERE envelope_id = ?")
        .run("envelope-crash-fact-commit-001");
      const after = tableSnapshot(database);
      expectFailure(
        () => assertSnapshotUnchanged(before, after, ["command_envelopes"], "selftest_snapshot_mutation"),
        "selftest_snapshot_mutation:command_envelopes",
      );
    } finally {
      database.close();
    }
  } finally {
    removeRoot(root);
  }
}

function verifyEmergencyCleanupAfterVerifierFailure() {
  const { root, token } = newRoot();
  let database;
  try {
    runWorker(root, token, "after_fact_commit");
    database = databaseFor(root);
    throw new Error("B_SLICE_CRASH_HARNESS_FAILED:selftest_verifier_failure");
  } catch (error) {
    assert(error instanceof Error && error.message.includes("selftest_verifier_failure"),
      "selftest_verifier_failure_missing");
  } finally {
    database?.close();
    cleanupOwnedRoots();
  }
  assert(!existsSync(root) && roots.size === 0, "selftest_emergency_cleanup_residue");
}

async function verifyAllowedTableMutationCaught() {
  const { root, token } = newRoot();
  let database;
  try {
    const input = runWorker(root, token, "after_effect_bundle");
    database = databaseFor(root);
    const before = tableSnapshot(database);
    database.prepare("UPDATE command_envelopes SET source_message_id = 'tampered' WHERE envelope_id = ?")
      .run("envelope-crash-mixed-001");
    const { createDietDomainService } = await import("../dist/domain/service.js");
    const service = createDietDomainService({
      database,
      secret: Buffer.from("B-SLICE-001 crash harness secret 0001", "utf8"),
      now: () => "2026-08-12T10:00:01.000Z",
    });
    service.execute(input);
    expectFailure(
      () => assertExpectedFinalization(database, input, before, tableSnapshot(database)),
      "finalizer_snapshot_exact:command_envelopes",
    );
  } finally {
    database?.close();
    removeRoot(root);
  }
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

function assertExpectedFinalization(database, input, before, after) {
  const finalizerTables = new Set([
    "command_envelopes",
    "daily_progress_snapshots",
    "envelope_finalizations",
    "idempotency_records",
    "mixed_item_results",
  ]);
  assertSnapshotUnchanged(
    before,
    after,
    databaseTables(database).filter((table) => !finalizerTables.has(table)),
    "finalizer_touched_nonfinalizer_table",
  );
  for (const [table, expected] of Object.entries(expectedFinalizationSnapshots)) {
    assert(snapshotDigest(after[table]) === expected, `finalizer_snapshot_exact:${table}`);
  }
  assert(before.daily_progress_snapshots.length === 0, "finalizer_progress_before");
  assert(before.envelope_finalizations.length === 0, "finalizer_envelope_before");
  assert(before.mixed_item_results.length === 0, "finalizer_mixed_before");
  const finalization = database.prepare(
    `SELECT envelope_id, idempotency_key, input_digest, envelope_state, result_status,
            stage, receipt_id, error_code, finalized_at, frozen_at, payload_json
       FROM envelope_finalizations WHERE envelope_id = ?`,
  ).get("envelope-crash-mixed-001");
  assert(finalization !== undefined, "finalizer_row_missing");
  assert(finalization.idempotency_key === "idem-crash-mixed-001", "finalizer_idempotency");
  assert(finalization.input_digest === input.input_digest, "finalizer_digest");
  assert(finalization.envelope_state === "finalized", "finalizer_state");
  assert(finalization.result_status === "committed", "finalizer_status");
  assert(finalization.stage === "EnvelopeFinalize", "finalizer_stage");
  assert(finalization.error_code === null, "finalizer_error");
  assert(finalization.finalized_at === "2026-08-12T10:00:00.002Z", "finalizer_time");
  assert(finalization.frozen_at === "2026-08-12T10:00:00.002Z", "finalizer_frozen_time");
  const finalPayload = JSON.parse(finalization.payload_json);
  assert(finalPayload.envelope_id === "envelope-crash-mixed-001", "finalizer_payload_envelope");
  assert(finalPayload.status === "committed", "finalizer_payload_status");
  assert(finalPayload.items.length === 2, "finalizer_payload_items");

  const envelope = database.prepare(
    `SELECT state, result_status, committed_at FROM command_envelopes WHERE envelope_id = ?`,
  ).get("envelope-crash-mixed-001");
  assert(JSON.stringify(envelope) === JSON.stringify({
    state: "finalized", result_status: "committed", committed_at: "2026-08-12T10:00:00.002Z",
  }), "finalizer_envelope_authority");
  const idempotency = database.prepare(
    `SELECT state, terminal_result_json FROM idempotency_records WHERE idempotency_key = ?`,
  ).get("idem-crash-mixed-001");
  const terminal = JSON.parse(idempotency.terminal_result_json);
  assert(idempotency.state === "finalized" && terminal.envelope_id === "envelope-crash-mixed-001" &&
    terminal.result_status === "committed" && terminal.payload.status === "committed",
  "finalizer_idempotency_authority");

  const progress = database.prepare(
    `SELECT idempotency_result_id, date, timezone, goal_version_id, coverage_status,
            generated_at, payload_json FROM daily_progress_snapshots`,
  ).all();
  assert(progress.length === 1, "finalizer_progress_count");
  assert(progress[0].idempotency_result_id === "idem-crash-mixed-001", "finalizer_progress_idempotency");
  assert(progress[0].date === "2026-08-12" && progress[0].timezone === "Asia/Shanghai",
    "finalizer_progress_scope");
  assert(progress[0].goal_version_id === null && progress[0].coverage_status === "partial",
    "finalizer_progress_status");
  assert(progress[0].generated_at === "2026-08-12T10:00:00.002Z", "finalizer_progress_time");
  assert(JSON.parse(progress[0].payload_json).authority_kind === "diet-manager/daily-progress/v1",
    "finalizer_progress_authority");

  const mixed = database.prepare(
    `SELECT sequence, operation_id, idempotency_key, command_type, status, error_code,
            payload_json FROM mixed_item_results ORDER BY sequence`,
  ).all();
  assert(mixed.length === 2, "finalizer_mixed_count");
  assert(JSON.stringify(mixed.map(({ sequence, operation_id, command_type, status, error_code }) =>
    ({ sequence, operation_id, command_type, status, error_code }))) === JSON.stringify([
    {
      sequence: 0, operation_id: "operation-crash-purchase-001",
      command_type: "add_inventory",
      status: "committed", error_code: null,
    },
    {
      sequence: 1, operation_id: "operation-crash-meal-001",
      command_type: "record_meal",
      status: "committed", error_code: null,
    },
  ]), "finalizer_mixed_rows");
  assert(mixed.every((row) => /^idempotency-[a-f0-9]{32}$/.test(row.idempotency_key)),
    "finalizer_mixed_idempotency");
  assert(mixed.every((row) => JSON.parse(row.payload_json).status === "committed"),
    "finalizer_mixed_payload");
}

try {
  if (process.env.B_SLICE_CRASH_SELFTEST === "hang") {
    verifyHangTimeout();
    process.stdout.write("PASS B-SLICE-001 crash harness hang-timeout self-test\n");
    process.exit(0);
  }
  if (process.env.B_SLICE_CRASH_SELFTEST === "root-replace") {
    verifyReplacementRootRefused();
    process.stdout.write("PASS B-SLICE-001 crash harness root-replacement self-test\n");
    process.exit(0);
  }
  if (process.env.B_SLICE_CRASH_SELFTEST === "snapshot-mutation") {
    verifySnapshotMutationCaught();
    process.stdout.write("PASS B-SLICE-001 crash harness snapshot-mutation self-test\n");
    process.exit(0);
  }
  if (process.env.B_SLICE_CRASH_SELFTEST === "emergency-cleanup") {
    verifyEmergencyCleanupAfterVerifierFailure();
    process.stdout.write("PASS B-SLICE-001 crash harness emergency-cleanup self-test\n");
    process.exit(0);
  }
  if (process.env.B_SLICE_CRASH_SELFTEST === "allowed-mutation") {
    await verifyAllowedTableMutationCaught();
    process.stdout.write("PASS B-SLICE-001 crash harness allowed-table mutation self-test\n");
    process.exit(0);
  }
  if (process.env.B_SLICE_CRASH_SELFTEST !== undefined) {
    throw new Error("B_SLICE_CRASH_HARNESS_FAILED:selftest_unknown");
  }
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
    const beforeSnapshot = tableSnapshot(database);
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
    const afterSnapshot = tableSnapshot(database);
    assert(result.status === "committed", "effect_bundle_restart_result");
    assert(after.envelope_finalizations === 1, "effect_bundle_finalized");
    assertExpectedFinalization(database, input, beforeSnapshot, afterSnapshot);
  });

  await runCase("after_finalize_before_reply", async (database, input) => {
    const before = counts(database);
    const beforeSnapshot = tableSnapshot(database);
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
    const afterSnapshot = tableSnapshot(database);
    assert(JSON.stringify(result) === frozen, "finalize_before_reply_frozen_reply");
    assert(JSON.stringify(after) === JSON.stringify(before), "finalize_before_reply_zero_rows");
    assert(snapshotEquals(afterSnapshot, beforeSnapshot), "finalize_before_reply_snapshot");
  });

  assert(roots.size === 0, "roots_survived");
  process.stdout.write("PASS B-SLICE-001 crash recovery: no surviving child, temporary database, or log residue\n");
} catch (error) {
  cleanupOwnedRoots();
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
