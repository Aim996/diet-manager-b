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
const expandedCrashMatrix = Object.freeze([
  Object.freeze({ kind: "meal", boundary: "after_finalize_before_reply" }),
  Object.freeze({ kind: "meal", boundary: "after_effect_before_seal" }),
  Object.freeze({ kind: "meal", boundary: "after_fact" }),
  Object.freeze({ kind: "purchase", boundary: "after_finalize_before_reply" }),
  Object.freeze({ kind: "purchase", boundary: "after_effect_before_seal" }),
  Object.freeze({ kind: "purchase", boundary: "after_fact" }),
  Object.freeze({ kind: "correction", boundary: "after_finalize_before_reply" }),
  Object.freeze({ kind: "correction", boundary: "after_effect_before_seal" }),
  Object.freeze({ kind: "correction", boundary: "after_fact" }),
  Object.freeze({ kind: "mixed", boundary: "after_finalize_before_reply" }),
  Object.freeze({ kind: "mixed", boundary: "after_seal_before_finalize" }),
]);
const expandedCrashAuthority = Object.freeze({
  meal_after_finalize_before_reply: "8ce0c6f6dc0e1f66e186ec21ff7f47b201b7fe6d7f43f7638ba46de3604641fe",
  meal_after_effect_before_seal: "7bc3bd0d8cb469ac9d6fa572a09072768fc152ec0e6fec90437c45f8a1870ff5",
  meal_after_fact: "d7f9acadb7c94ca322a13a703e553b221468e775c24dbfabe6b4395aaea0ae96",
  purchase_after_finalize_before_reply: "944d91e6a5ce846bea766e87831f2f60aa44a8b5581a57b206ca5f80dde248bc",
  purchase_after_effect_before_seal: "c6bd4ac3011ceb6be6cc55656e99fa95299197237771991f8993b3d61a2d2080",
  purchase_after_fact: "a115aba9eafbca0997bb8fd972d0428452668e99bfd90d91ec5070439adaf526",
  correction_after_finalize_before_reply: "c1f8c50735c0035a43ddac2068251c05d9a0fbf1e19c0b3f5d4ce1c5903b8254",
  correction_after_effect_before_seal: "f7970fb7a4dd1f713c1d263b816ab21660985fdf2a4b124c3a1515271ace9f20",
  correction_after_fact: "48f1a3590147fac9c1868efe7ac1cdb389598019dabaeed4bb89dee934c54a44",
  mixed_after_finalize_before_reply: "58ad65040cb33af8f1cbc7df87ec486c895b39c65bd9edc06dd7d78807211a61",
  mixed_after_seal_before_finalize: "6aba4ff8cbe89515fc09ff28758b5ad6ea1430ebbcc19152c79608a67fa57899",
});
const expandedTerminalAuthority = Object.freeze({
  meal: Object.freeze({
    snapshot_digest: "8ce0c6f6dc0e1f66e186ec21ff7f47b201b7fe6d7f43f7638ba46de3604641fe",
    frozen_sha256: "d2af84ce7646ffb8c42b9ee59772ce7c005c575888e31d4ff612b1338a35a685",
    frozen_length: 2515,
  }),
  purchase: Object.freeze({
    snapshot_digest: "944d91e6a5ce846bea766e87831f2f60aa44a8b5581a57b206ca5f80dde248bc",
    frozen_sha256: "9ebbaa0d602c170f393fd6b32761718e1c664120193150a39b14b8070213d89f",
    frozen_length: 708,
  }),
  correction: Object.freeze({
    snapshot_digest: "c1f8c50735c0035a43ddac2068251c05d9a0fbf1e19c0b3f5d4ce1c5903b8254",
    frozen_sha256: "309e20bada433b8ba7ddf52e0af86b9b35e2157528bfef7818e12240208a134f",
    frozen_length: 1540,
  }),
  mixed: Object.freeze({
    snapshot_digest: "58ad65040cb33af8f1cbc7df87ec486c895b39c65bd9edc06dd7d78807211a61",
    frozen_sha256: "68de186a58e7e9f1e32cf4905ffba864b5a1d1ace86dc81101dee0c09d4c991e",
    frozen_length: 2873,
  }),
});
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
  assertNoSurvivingChild(result.pid, mode);
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
    ).sort((left, right) => {
      const leftJson = JSON.stringify(left);
      const rightJson = JSON.stringify(right);
      return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
    });
    return [table, Object.freeze(rows)];
  })));
}

function snapshotEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function snapshotDigest(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot), "utf8").digest("hex");
}

function expandedAuthoritySnapshot(database) {
  const snapshot = tableSnapshot(database);
  return Object.freeze(Object.fromEntries(
    Object.entries(snapshot).filter(([table]) => table !== "schema_migrations"),
  ));
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

function verifyCanonicalSnapshotOrdering() {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE canonical_order(value TEXT NOT NULL)");
    database.prepare("INSERT INTO canonical_order(value) VALUES (?), (?)").run("z", "ä");
    const ordered = tableSnapshot(database).canonical_order;
    assert(
      JSON.stringify(ordered) === JSON.stringify([
        [["value", "z"]],
        [["value", "ä"]],
      ]),
      `selftest_canonical_order:${JSON.stringify(ordered)}`,
    );
  } finally {
    database.close();
  }
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

function envelopeIdentitySnapshot(database, envelopeId) {
  return Object.freeze({
    events: database.prepare(
      `SELECT event_id, operation_id FROM event_records
       WHERE envelope_id = ? ORDER BY event_id`,
    ).all(envelopeId),
    items: database.prepare(
      `SELECT m.item_id, m.event_id FROM meal_items m
       JOIN event_records e ON e.event_id = m.event_id
       WHERE e.envelope_id = ? ORDER BY m.item_id`,
    ).all(envelopeId),
    corrections: database.prepare(
      `SELECT c.correction_id, c.request_id FROM correction_events c
       JOIN event_records e ON e.operation_id = c.request_id
       WHERE e.envelope_id = ? ORDER BY c.correction_id`,
    ).all(envelopeId),
    outboxes: database.prepare(
      `SELECT outbox_id, effect_id, operation_id FROM effect_outbox
       WHERE envelope_id = ? ORDER BY outbox_id`,
    ).all(envelopeId),
  });
}

function assertCrashBoundary(database, input, kind, boundary) {
  const envelopeId = input.envelope.envelope_id;
  const envelope = database.prepare(
    "SELECT state, result_status FROM command_envelopes WHERE envelope_id = ?",
  ).get(envelopeId);
  const expectedState = boundary === "after_fact" ||
      boundary === "after_effect_before_seal"
    ? Object.freeze({ state: "received", result_status: "preview_ready" })
    : boundary === "after_seal_before_finalize"
      ? Object.freeze({ state: "effects_stable", result_status: "effects_stable" })
      : Object.freeze({ state: "finalized", result_status: "committed" });
  assert(
    JSON.stringify(envelope) === JSON.stringify(expectedState),
    `crash_boundary_envelope:${kind}:${boundary}:${JSON.stringify(envelope)}`,
  );
  const eventCount = database.prepare(
    "SELECT COUNT(*) AS count FROM event_records WHERE envelope_id = ?",
  ).get(envelopeId).count;
  assert(eventCount === (kind === "mixed" ? 2 : 1), `crash_boundary_events:${kind}:${boundary}`);
  const finalizationCount = database.prepare(
    "SELECT COUNT(*) AS count FROM envelope_finalizations WHERE envelope_id = ?",
  ).get(envelopeId).count;
  assert(
    finalizationCount === (boundary === "after_finalize_before_reply" ? 1 : 0),
    `crash_boundary_finalization:${kind}:${boundary}`,
  );
  const outboxes = database.prepare(
    `SELECT state, attempt_count FROM effect_outbox
     WHERE envelope_id = ? ORDER BY effect_id`,
  ).all(envelopeId);
  const expectedOutboxCount = Object.freeze({
    meal: 2,
    purchase: 1,
    correction: 2,
    mixed: 5,
  })[kind];
  assert(outboxes.length === expectedOutboxCount, `crash_boundary_outbox_count:${kind}:${boundary}`);
  const factsOnly = boundary === "after_fact";
  assert(
    outboxes.every((row) => row.state === (factsOnly ? "pending" : "succeeded")),
    `crash_boundary_outbox_state:${kind}:${boundary}`,
  );
  const expectedAttemptCount = factsOnly ? 0 : 1;
  assert(
    outboxes.every((row) => row.attempt_count === expectedAttemptCount),
    `crash_boundary_outbox_attempt:${kind}:${boundary}:${JSON.stringify(outboxes)}`,
  );
  const checkpoints = database.prepare(
    `SELECT effect_state, result_status, completed_at FROM effect_bundle_commits
     WHERE envelope_id = ? ORDER BY operation_id`,
  ).all(envelopeId);
  assert(checkpoints.length === (kind === "mixed" ? 2 : 1),
    `crash_boundary_checkpoint_count:${kind}:${boundary}`);
  assert(
    checkpoints.every((row) => factsOnly
      ? row.effect_state === "pending" &&
        row.result_status === "facts_committed_effects_pending" &&
        row.completed_at === null
      : row.effect_state === "succeeded" &&
        row.result_status === "applied" &&
        typeof row.completed_at === "string"),
    `crash_boundary_checkpoint_state:${kind}:${boundary}`,
  );
  if (kind === "meal") {
    const nutritionCount = database.prepare(
      `SELECT COUNT(*) AS count FROM nutrition_snapshots n
       JOIN event_records e ON e.event_id = n.meal_event_id
       WHERE e.envelope_id = ?`,
    ).get(envelopeId).count;
    assert(nutritionCount === (factsOnly ? 0 : 1),
      `crash_boundary_meal_effect:${boundary}`);
  }
  if (kind === "purchase" || kind === "correction") {
    const transactionCount = database.prepare(
      `SELECT COUNT(*) AS count FROM inventory_transactions t
       JOIN event_records e ON e.event_id = t.event_id
       WHERE e.envelope_id = ?`,
    ).get(envelopeId).count;
    assert(transactionCount === (factsOnly ? 0 : 1),
      `crash_boundary_inventory_effect:${kind}:${boundary}`);
  }
}

function assertExpandedAuthority(database, input, kind, boundary) {
  assertCrashBoundary(database, input, kind, boundary);
  const mode = `${kind}_${boundary}`;
  const expected = expandedCrashAuthority[mode];
  assert(typeof expected === "string", `expanded_authority_missing:${mode}`);
  const actual = snapshotDigest(expandedAuthoritySnapshot(database));
  assert(actual === expected, `expanded_authority:${mode}:${actual}`);
}

async function verifyExpandedAuthorityMutation(mode, kind, boundary, mutate, code) {
  const { root, token } = newRoot();
  let database;
  try {
    const input = runWorker(root, token, mode);
    database = databaseFor(root);
    mutate(database, input);
    expectFailure(
      () => assertExpandedAuthority(database, input, kind, boundary),
      code,
    );
  } finally {
    database?.close();
    removeRoot(root);
  }
}

async function verifyExpandedFactAuthorityMutationCaught() {
  await verifyExpandedAuthorityMutation(
    "meal_after_fact",
    "meal",
    "after_fact",
    (database, input) => {
      const changed = database.prepare(
        "UPDATE command_envelopes SET committed_at = ? WHERE envelope_id = ?",
      ).run("2026-08-12T10:00:00.000Z", input.envelope.envelope_id).changes;
      assert(changed === 1, "selftest_expanded_fact_setup");
    },
    "expanded_authority:meal_after_fact",
  );
}

async function verifyExpandedEffectAuthorityMutationCaught() {
  await verifyExpandedAuthorityMutation(
    "meal_after_effect_before_seal",
    "meal",
    "after_effect_before_seal",
    (database, input) => {
      const changed = database.prepare(
        `UPDATE nutrition_snapshots SET payload_json = '{}'
         WHERE meal_event_id IN (
           SELECT event_id FROM event_records WHERE envelope_id = ?
         )`,
      ).run(input.envelope.envelope_id).changes;
      assert(changed === 1, "selftest_expanded_effect_setup");
    },
    "expanded_authority:meal_after_effect_before_seal",
  );
}

async function verifyExpandedFinalizeAuthorityMutationCaught() {
  await verifyExpandedAuthorityMutation(
    "meal_after_finalize_before_reply",
    "meal",
    "after_finalize_before_reply",
    (database, input) => {
      const changed = database.prepare(
        "DELETE FROM daily_progress_snapshots WHERE idempotency_result_id = ?",
      ).run(input.envelope.idempotency_key).changes;
      assert(changed === 1, "selftest_expanded_finalize_setup");
    },
    "expanded_authority:meal_after_finalize_before_reply",
  );
}

async function runExpandedRecoveryCase(spec, expectedTerminal) {
  const mode = `${spec.kind}_${spec.boundary}`;
  const { root, token } = newRoot();
  let database;
  try {
    const input = runWorker(root, token, mode);
    database = databaseFor(root);
    assertExpandedAuthority(database, input, spec.kind, spec.boundary);
    const crashSnapshot = tableSnapshot(database);
    const crashIdentities = envelopeIdentitySnapshot(database, input.envelope.envelope_id);
    database.close();
    database = databaseFor(root);
    const reopenedSnapshot = tableSnapshot(database);
    assert(snapshotEquals(reopenedSnapshot, crashSnapshot), `reopen_snapshot:${mode}`);

    const { createDietDomainService } = await import("../dist/domain/service.js");
    const service = createDietDomainService({
      database,
      secret: Buffer.from("B-SLICE-001 crash harness secret 0001", "utf8"),
      now: () => "2026-08-12T10:00:01.000Z",
    });
    const result = service.execute(input);
    assert(result.status === "committed", `recovery_result:${mode}`);
    const recoveredSnapshot = tableSnapshot(database);
    const terminalAuthorityDigest = snapshotDigest(expandedAuthoritySnapshot(database));
    const terminalAuthority = expandedTerminalAuthority[spec.kind];
    assert(terminalAuthority !== undefined, `terminal_authority_missing:${spec.kind}`);
    assert(
      terminalAuthorityDigest === terminalAuthority.snapshot_digest,
      `terminal_authority:${mode}:${terminalAuthorityDigest}`,
    );
    const recoveredIdentities = envelopeIdentitySnapshot(database, input.envelope.envelope_id);
    assert(
      snapshotEquals(crashIdentities, recoveredIdentities),
      `recovery_repeated_identity:${mode}`,
    );
    if (
      spec.boundary === "after_effect_before_seal" ||
      spec.boundary === "after_seal_before_finalize"
    ) {
      const recoveryTables = new Set([
        "command_envelopes",
        "daily_progress_snapshots",
        "effect_bundle_commits",
        "envelope_finalizations",
        "event_records",
        "idempotency_records",
        "mixed_item_results",
      ]);
      if (spec.boundary === "after_seal_before_finalize") {
        recoveryTables.delete("effect_bundle_commits");
        recoveryTables.delete("event_records");
      }
      assertSnapshotUnchanged(
        crashSnapshot,
        recoveredSnapshot,
        databaseTables(database).filter((table) => !recoveryTables.has(table)),
        `recovery_repeated_effect:${mode}`,
      );
    }
    if (spec.boundary === "after_finalize_before_reply") {
      assert(snapshotEquals(recoveredSnapshot, crashSnapshot), `recovery_finalized_write:${mode}`);
    }
    const finalization = database.prepare(
      "SELECT payload_json FROM envelope_finalizations WHERE envelope_id = ?",
    ).get(input.envelope.envelope_id);
    assert(finalization !== undefined, `recovery_finalization_missing:${mode}`);
    const frozenBytes = Buffer.from(finalization.payload_json, "utf8");
    const frozenDigest = createHash("sha256").update(frozenBytes).digest("hex");
    assert(frozenBytes.byteLength === terminalAuthority.frozen_length,
      `terminal_frozen_length:${mode}:${frozenBytes.byteLength}`);
    assert(frozenDigest === terminalAuthority.frozen_sha256,
      `terminal_frozen_digest:${mode}:${frozenDigest}`);
    assert(
      frozenBytes.equals(Buffer.from(JSON.stringify(result), "utf8")),
      `recovery_frozen_payload:${mode}`,
    );
    if (expectedTerminal !== undefined) {
      assertSnapshotUnchanged(
        expectedTerminal.snapshot,
        recoveredSnapshot,
        databaseTables(database).filter((table) => table !== "schema_migrations"),
        `recovery_exact:${mode}`,
      );
      assert(frozenBytes.equals(expectedTerminal.frozen_bytes), `recovery_exact_payload:${mode}`);
    }
    const replay = service.execute(input);
    const replaySnapshot = tableSnapshot(database);
    assert(JSON.stringify(replay) === frozenBytes.toString("utf8"), `replay_frozen_payload:${mode}`);
    assert(snapshotEquals(replaySnapshot, recoveredSnapshot), `replay_zero_writes:${mode}`);
    return Object.freeze({
      snapshot: recoveredSnapshot,
      frozen_bytes: Buffer.from(frozenBytes),
    });
  } finally {
    database?.close();
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
  if (process.env.B_SLICE_CRASH_SELFTEST === "expanded-fact-mutation") {
    await verifyExpandedFactAuthorityMutationCaught();
    process.stdout.write("PASS B-SLICE-001 expanded Fact authority mutation self-test\n");
    process.exit(0);
  }
  if (process.env.B_SLICE_CRASH_SELFTEST === "expanded-effect-mutation") {
    await verifyExpandedEffectAuthorityMutationCaught();
    process.stdout.write("PASS B-SLICE-001 expanded Effect authority mutation self-test\n");
    process.exit(0);
  }
  if (process.env.B_SLICE_CRASH_SELFTEST === "expanded-finalize-mutation") {
    await verifyExpandedFinalizeAuthorityMutationCaught();
    process.stdout.write("PASS B-SLICE-001 expanded Finalize authority mutation self-test\n");
    process.exit(0);
  }
  if (process.env.B_SLICE_CRASH_SELFTEST === "canonical-order") {
    verifyCanonicalSnapshotOrdering();
    process.stdout.write("PASS B-SLICE-001 canonical snapshot ordering self-test\n");
    process.exit(0);
  }
  if (process.env.B_SLICE_CRASH_SELFTEST !== undefined) {
    throw new Error("B_SLICE_CRASH_HARNESS_FAILED:selftest_unknown");
  }
  const terminalByKind = new Map();
  for (const spec of expandedCrashMatrix) {
    const expectedTerminal = terminalByKind.get(spec.kind);
    const terminal = await runExpandedRecoveryCase(spec, expectedTerminal);
    if (spec.boundary === "after_finalize_before_reply") {
      terminalByKind.set(spec.kind, terminal);
    } else {
      assert(expectedTerminal !== undefined, `terminal_reference_missing:${spec.kind}`);
    }
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
