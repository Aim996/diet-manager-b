import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";

import { createServerPreview } from "../dist/preview/store.js";
import { commitPreparedFact } from "../dist/repository/fact-commit.js";
import { processInventoryEffect } from "../dist/repository/inventory-effects.js";
import { finalizeEnvelope } from "../dist/repository/envelope-finalize.js";
import { computeRepositoryDataRevision } from "../dist/repository/revision.js";
import {
  assertDietDatabaseIdentity,
  openDietDatabase,
} from "../dist/storage/database.js";

const secret = Buffer.from("B-STOR-002 synthetic concurrency test key 0001", "utf8");

function preparedFact(
  database,
  token,
  suffix,
  digestCharacter,
  dataRevision,
  eventSuffix = suffix,
) {
  const effectId = `effect-concurrency-${suffix}`;
  return {
    database,
    secret,
    token,
    inputDigest: digestCharacter.repeat(64),
    subjectScope: "user:synthetic-concurrency",
    commandType: "add_inventory",
    dataRevision,
    traceId: `trace-concurrency-${suffix}`,
    event: {
      eventId: `event-concurrency-${eventSuffix}`,
      operationId: `operation-concurrency-${suffix}`,
      schemaVersion: "domain/v2",
      eventType: "inventory_stock",
      factKind: "inventory",
      sourceMessageId: `message-concurrency-${suffix}`,
      conversationId: "conversation-concurrency",
      receivedAt: "2026-08-12T04:00:00.000Z",
      committedAt: "2026-08-12T04:00:01.000Z",
      occurredAtText: "2026-08-12T12:00:00+08:00",
      mealId: null,
      mealSlot: null,
      payload: {
        contract: "B-STOR-002/concurrency/v1",
        effect_inputs: {
          [effectId]: {
            kind: "inventory_add",
            transaction_id: `transaction-concurrency-${suffix}`,
            reason_code: "initial_stock",
            quantity_microunits: 5_000_000,
            unit: "synthetic-unit",
            product: {
              product_id: `product-concurrency-${suffix}`,
              schema_version: "domain/v2",
              normalized_name: "fixture-concurrency-product",
              product_type: "synthetic_product",
              payload: { synthetic: true },
            },
            batch: {
              batch_id: `batch-concurrency-${suffix}`,
              schema_version: "domain/v2",
              stocked_at: "2026-08-12T04:00:00.000Z",
              explicit_expiration_at: null,
              quantity_unit: "synthetic-unit",
              payload: { synthetic: true },
            },
          },
        },
      },
    },
    items: [],
    effects: [
      {
        outboxId: `outbox-concurrency-${suffix}`,
        effectId,
        effectKind: "inventory_add",
        previousState: null,
        reason: null,
      },
    ],
  };
}

function createAuthority(database, suffix, digestCharacter) {
  const dataRevision = computeRepositoryDataRevision(database);
  return createServerPreview({
    database,
    secret,
    previewId: `preview-concurrency-${suffix}`,
    idempotencyKey: `idem-concurrency-${suffix}`,
    inputDigest: digestCharacter.repeat(64),
    subjectScope: "user:synthetic-concurrency",
    commandType: "add_inventory",
    dataRevision,
    sourceMessageId: `message-concurrency-${suffix}`,
    conversationId: "conversation-concurrency",
    previewMaterial: { action: "add_inventory", synthetic: true, suffix },
    now: "2026-08-12T04:00:00.000Z",
  });
}

function waitAtBarrier(buffer) {
  const barrier = new Int32Array(buffer);
  Atomics.add(barrier, 0, 1);
  Atomics.notify(barrier, 0);
  while (Atomics.load(barrier, 1) === 0) Atomics.wait(barrier, 1, 0, 10_000);
}

async function runWorker() {
  const runtime = openDietDatabase({ privateRuntimeRoot: workerData.root });
  try {
    if (workerData.mode === "crash_uncommitted") {
      runtime.database.exec("BEGIN IMMEDIATE");
      runtime.database
        .prepare(
          `INSERT INTO event_records(
            event_id, envelope_id, operation_id, schema_version, event_type, fact_kind,
            source_message_id, conversation_id, received_at, committed_at, occurred_at_text,
            result_status, lifecycle_status, meal_id, meal_slot, payload_json
          ) VALUES (?, ?, ?, 'domain/v2', 'inventory_stock', 'inventory', ?, ?, ?, ?, NULL,
            'uncommitted', 'active', NULL, NULL, '{}')`,
        )
        .run(
          "event-concurrency-crash-uncommitted",
          "preview-concurrency-crash",
          "operation-concurrency-crash",
          "message-concurrency-crash",
          "conversation-concurrency",
          "2026-08-12T04:03:00.000Z",
          "2026-08-12T04:03:01.000Z",
        );
      parentPort.postMessage({ ready: true });
      process.exit(23);
    }
    waitAtBarrier(workerData.barrier);
    if (workerData.mode === "fact") {
      const input = preparedFact(
        runtime.database,
        workerData.token,
        workerData.suffix,
        workerData.digestCharacter,
        workerData.dataRevision,
        workerData.eventSuffix,
      );
      const result = commitPreparedFact(input);
      parentPort.postMessage({ ok: true, result });
      return;
    }
    if (workerData.mode === "effect") {
      const result = processInventoryEffect({
        database: runtime.database,
        outboxId: `outbox-concurrency-${workerData.suffix}`,
        now: "2026-08-12T04:01:00.000Z",
      });
      parentPort.postMessage({ ok: true, result });
      return;
    }
    if (workerData.mode === "finalize_failure") {
      const fact = preparedFact(
        runtime.database,
        workerData.token,
        workerData.suffix,
        workerData.digestCharacter,
        workerData.dataRevision,
        workerData.eventSuffix,
      );
      finalizeEnvelope(
        {
          database: runtime.database,
          secret,
          token: workerData.token,
          inputDigest: workerData.digestCharacter.repeat(64),
          subjectScope: "user:synthetic-concurrency",
          commandType: "add_inventory",
          dataRevision: workerData.dataRevision,
          traceId: `trace-finalize-${workerData.suffix}`,
          resultStatus: "committed",
          receiptId: `receipt-concurrency-${workerData.suffix}`,
          finalizedAt: "2026-08-12T04:02:00.000Z",
          frozenAt: "2026-08-12T04:02:00.000Z",
          payload: {
            contract: "B-STOR-002/concurrency-terminal/v1",
            event_id: fact.event.eventId,
            items: [],
          },
          mixedItems: [],
        },
        { fault: "before_commit" },
      );
      throw new Error("finalizer fault was not injected");
    }
    throw new Error("unknown worker mode");
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    runtime.close();
  }
}

async function crashUncommitted(root) {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { mode: "crash_uncommitted", root },
  });
  let ready = false;
  worker.on("message", (message) => {
    if (message?.ready === true) ready = true;
  });
  const code = await new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", resolve);
  });
  assert(ready, "crash_worker_reached_uncommitted_write");
  assert(code === 23, "crash_worker_exit_code");
}

function scalar(database, sql) {
  const row = database.prepare(sql).get();
  return Number(Object.values(row)[0]);
}

function assert(condition, message) {
  if (!condition) throw new Error(`CONCURRENCY_ASSERTION_FAILED:${message}`);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function race(workerSpecs) {
  const barrierBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const barrier = new Int32Array(barrierBuffer);
  const workers = workerSpecs.map(
    (spec) =>
      new Worker(new URL(import.meta.url), {
        workerData: { ...spec, barrier: barrierBuffer },
      }),
  );
  const messages = workers.map(
    (worker) =>
      new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", (code) => {
          if (code !== 0) reject(new Error(`worker exited ${code}`));
        });
      }),
  );
  const deadline = Date.now() + 10_000;
  while (Atomics.load(barrier, 0) !== workers.length) {
    if (Date.now() > deadline) throw new Error("worker barrier timeout");
    const observed = Atomics.load(barrier, 0);
    Atomics.wait(barrier, 0, observed, 100);
  }
  Atomics.store(barrier, 1, 1);
  Atomics.notify(barrier, 1, workers.length);
  return Promise.all(messages);
}

async function main() {
  const root = join(
    tmpdir(),
    `diet-manager-b-B-STOR-002-concurrency-${randomUUID().replaceAll("-", "")}`,
  );
  mkdirSync(root, { recursive: false });
  let runtime;
  try {
    runtime = openDietDatabase({
      privateRuntimeRoot: root,
      now: () => "2026-08-12T04:00:00.000Z",
    });
    const exactAuthority = createAuthority(runtime.database, "exact", "E");
    runtime.close();
    runtime = undefined;

    const exact = await race([
      {
        mode: "fact",
        root,
        token: exactAuthority.token,
        suffix: "exact",
        digestCharacter: "E",
        dataRevision: exactAuthority.binding.data_revision,
        eventSuffix: "exact",
      },
      {
        mode: "fact",
        root,
        token: exactAuthority.token,
        suffix: "exact",
        digestCharacter: "E",
        dataRevision: exactAuthority.binding.data_revision,
        eventSuffix: "exact",
      },
    ]);
    assert(exact.every((result) => result.ok), "same_identity_workers_succeed");
    assert(sameJson(exact[0].result, exact[1].result), "same_identity_result_equal");

    runtime = openDietDatabase({ privateRuntimeRoot: root });
    const conflictAuthority = createAuthority(runtime.database, "conflict", "F");
    runtime.close();
    runtime = undefined;

    const conflict = await race([
      {
        mode: "fact",
        root,
        token: conflictAuthority.token,
        suffix: "conflict",
        digestCharacter: "F",
        dataRevision: conflictAuthority.binding.data_revision,
        eventSuffix: "winner-a",
      },
      {
        mode: "fact",
        root,
        token: conflictAuthority.token,
        suffix: "conflict",
        digestCharacter: "F",
        dataRevision: conflictAuthority.binding.data_revision,
        eventSuffix: "winner-b",
      },
    ]);
    assert(conflict.filter((result) => result.ok).length === 1, "one_conflict_winner");
    assert(
      conflict.filter((result) => !result.ok).length === 1 &&
        conflict.find((result) => !result.ok).error === "IDEMPOTENCY_CONFLICT:fact_identity",
      "one_stable_conflict",
    );

    runtime = openDietDatabase({ privateRuntimeRoot: root });
    const effectAuthority = createAuthority(runtime.database, "effect", "A");
    commitPreparedFact(
      preparedFact(
        runtime.database,
        effectAuthority.token,
        "effect",
        "A",
        effectAuthority.binding.data_revision,
        "effect",
      ),
    );
    runtime.close();
    runtime = undefined;

    const effects = await race([
      { mode: "effect", root, suffix: "effect" },
      { mode: "effect", root, suffix: "effect" },
    ]);
    assert(effects.every((result) => result.ok), "effect_workers_succeed");
    assert(sameJson(effects[0].result, effects[1].result), "effect_result_equal");

    runtime = openDietDatabase({ privateRuntimeRoot: root });
    const finalAuthority = createAuthority(runtime.database, "final", "B");
    commitPreparedFact(
      preparedFact(
        runtime.database,
        finalAuthority.token,
        "final",
        "B",
        finalAuthority.binding.data_revision,
        "final",
      ),
    );
    processInventoryEffect({
      database: runtime.database,
      outboxId: "outbox-concurrency-final",
      now: "2026-08-12T04:01:30.000Z",
    });
    const otherAuthority = createAuthority(runtime.database, "other", "C");
    createAuthority(runtime.database, "crash", "D");
    runtime.close();
    runtime = undefined;

    const finalizerRace = await race([
      {
        mode: "finalize_failure",
        root,
        token: finalAuthority.token,
        suffix: "final",
        digestCharacter: "B",
        dataRevision: finalAuthority.binding.data_revision,
        eventSuffix: "final",
      },
      {
        mode: "fact",
        root,
        token: otherAuthority.token,
        suffix: "other",
        digestCharacter: "C",
        dataRevision: otherAuthority.binding.data_revision,
        eventSuffix: "other",
      },
    ]);
    assert(
      finalizerRace.some(
        (result) =>
          !result.ok && result.error === "ENVELOPE_FINALIZE_FAILED:before_commit",
      ),
      "finalizer_failure_observed",
    );
    assert(finalizerRace.some((result) => result.ok), "concurrent_other_fact_succeeds");

    await crashUncommitted(root);

    runtime = openDietDatabase({ privateRuntimeRoot: root });
    assert(
      scalar(runtime.database, "SELECT COUNT(*) FROM event_records") === 5,
      "one_event_per_authority",
    );
    assert(
      scalar(
        runtime.database,
        "SELECT COUNT(*) FROM event_records WHERE envelope_id = 'preview-concurrency-exact'",
      ) === 1,
      "exact_fact_once",
    );
    assert(
      scalar(
        runtime.database,
        "SELECT COUNT(*) FROM event_records WHERE envelope_id = 'preview-concurrency-conflict'",
      ) === 1,
      "conflict_fact_once",
    );
    assert(
      scalar(
        runtime.database,
        "SELECT COUNT(*) FROM inventory_transactions WHERE idempotency_key = 'effect-concurrency-effect'",
      ) === 1,
      "effect_once",
    );
    assert(
      scalar(
        runtime.database,
        "SELECT COUNT(*) FROM envelope_finalizations WHERE envelope_id = 'preview-concurrency-final'",
      ) === 0,
      "failed_finalizer_zero_rows",
    );
    assert(
      runtime.database
        .prepare(
          "SELECT state FROM command_envelopes WHERE envelope_id = 'preview-concurrency-final'",
        )
        .get().state === "effects_stable",
      "failed_finalizer_preserves_stable_effect",
    );
    assert(
      scalar(
        runtime.database,
        "SELECT COUNT(*) FROM event_records WHERE event_id = 'event-concurrency-crash-uncommitted'",
      ) === 0,
      "crashed_transaction_invisible",
    );
    assert(
      runtime.database
        .prepare(
          "SELECT state FROM command_envelopes WHERE envelope_id = 'preview-concurrency-crash'",
        )
        .get().state === "received",
      "crashed_transaction_preserves_preview",
    );
    assertDietDatabaseIdentity(runtime.database);
    assert(runtime.database.prepare("PRAGMA foreign_key_check").all().length === 0, "foreign_keys");
    console.log(
      "B_STOR_002_CONCURRENCY|PASS|same_identity=2|conflict=1+1|effect=2|finalizer_failure=1|other_fact=1|crash_uncommitted=0_visible|business_rows=exactly_once",
    );
  } finally {
    runtime?.close();
    if (existsSync(root)) rmSync(root, { recursive: true, force: false });
    if (existsSync(root)) throw new Error("concurrency fixture residual");
  }
}

if (isMainThread) {
  await main();
} else {
  await runWorker();
}
