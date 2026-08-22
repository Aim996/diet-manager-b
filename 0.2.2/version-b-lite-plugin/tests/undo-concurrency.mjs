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

import {
  createCoreRuntime,
  handleCoreRequest,
} from "../dist/application/core-runtime.js";
import { openDietDatabase } from "../dist/storage/database.js";

const CONVERSATION_ID = "conversation-undo-concurrency";
const SEED_PURCHASE_OPERATION_ID = "operation-undo-seed-purchase";
const SEED_MEAL_OPERATION_ID = "operation-undo-seed-meal";

function assert(condition, message) {
  if (!condition) throw new Error(`UNDO_CONCURRENCY_FAILED:${message}`);
}

function request(action, operationId, sourceMessageId, sourceText, receivedAt) {
  return {
    action,
    source_text: sourceText,
    received_at: receivedAt,
    timezone: "Asia/Shanghai",
    operation_id: operationId,
    source_message_id: sourceMessageId,
    conversation_id: CONVERSATION_ID,
    prior_context: [],
  };
}

function purchaseRequest() {
  return request(
    "add_inventory",
    SEED_PURCHASE_OPERATION_ID,
    "message-undo-seed-purchase",
    "买了两箱牛奶，每箱12盒，每盒250ml。",
    "2026-08-11T08:30:00+08:00",
  );
}

function mealRequest() {
  return request(
    "record_meal",
    SEED_MEAL_OPERATION_ID,
    "message-undo-seed-meal",
    "喝了一盒这个牛奶。",
    "2026-08-11T08:30:01+08:00",
  );
}

function undoRequest(operationId, sourceMessageId) {
  return request(
    "undo_record",
    operationId,
    sourceMessageId,
    "撤销刚才那条饮食记录",
    "2026-08-11T08:31:00+08:00",
  );
}

function waitAtBarrier(buffer) {
  const barrier = new Int32Array(buffer);
  Atomics.add(barrier, 0, 1);
  Atomics.notify(barrier, 0);
  while (Atomics.load(barrier, 1) === 0) Atomics.wait(barrier, 1, 0, 10_000);
}

async function runWorker() {
  // worker_threads do not preserve Windows' case-insensitive process.env lookup:
  // the parent's "SYSTEMROOT" is not reachable as "SystemRoot", which the runtime's
  // secret ACL audit reads via spawnSync. Re-expose the mixed-case alias first.
  if (process.env.SystemRoot === undefined) {
    const value = process.env.SYSTEMROOT ?? process.env.WINDIR ?? process.env.windir;
    if (typeof value === "string") process.env.SystemRoot = value;
  }
  const runtime = createCoreRuntime({
    officialDataRoot: workerData.root,
    now: () => "2026-08-11T08:31:01.000Z",
  });
  try {
    // Warm up the runtime session (reads the authority secret) before the shared
    // barrier so the concurrent undo only contends on the database revision, never
    // on the exclusive secret ACL audit, which is not safe to run in parallel.
    const warmup = handleCoreRequest(runtime, {
      action: "query_daily_summary",
      source_text: "查询今日汇总",
      received_at: "2026-08-11T08:31:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: `warmup-${workerData.operationId}`,
      source_message_id: `warmup-${workerData.sourceMessageId}`,
      conversation_id: CONVERSATION_ID,
      prior_context: [],
    });
    assert(warmup.status === "ignored" && warmup.reason_code === "read_only_result",
      `warmup:${JSON.stringify(warmup)}`);
    parentPort.postMessage({ type: "warmed" });
    waitAtBarrier(workerData.barrier);
    const outcome = handleCoreRequest(
      runtime,
      undoRequest(workerData.operationId, workerData.sourceMessageId),
    );
    runtime.close();
    parentPort.postMessage({ type: "done", outcome });
  } catch (error) {
    parentPort.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    runtime.close();
  }
}

function scalar(database, sql, ...parameters) {
  return Number(database.prepare(sql).get(...parameters).count);
}

// Launch one worker and wait until it has warmed up (read the authority secret)
// and reached the shared barrier. Launching sequentially serializes the exclusive
// secret ACL audit across workers; only the undo itself races.
async function launchWarmedWorker(root, spec, barrierBuffer) {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { ...spec, root, barrier: barrierBuffer },
  });
  const warmed = new Promise((resolve, reject) => {
    worker.once("message", (message) => {
      if (message?.type === "warmed") resolve();
      else reject(new Error(`unexpected warmup message:${JSON.stringify(message)}`));
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exited ${code} before warmup`));
    });
  });
  await warmed;
  return worker;
}

function workerDone(worker) {
  return new Promise((resolve, reject) => {
    worker.once("message", (message) => {
      if (message?.type === "done") resolve(message.outcome);
      else if (message?.type === "error") reject(new Error(message.error));
      else reject(new Error(`unexpected done message:${JSON.stringify(message)}`));
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
    });
  });
}

async function main() {
  const root = join(
    tmpdir(),
    `diet-manager-undo-concurrency-${randomUUID().replaceAll("-", "")}`,
  );
  mkdirSync(root, { recursive: false });
  let runtime;
  try {
    runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-11T08:30:01.000Z",
    });
    const purchase = handleCoreRequest(runtime, purchaseRequest());
    assert(purchase.committed === true, `seed_purchase:${JSON.stringify(purchase)}`);
    const meal = handleCoreRequest(runtime, mealRequest());
    assert(meal.committed === true, `seed_meal:${JSON.stringify(meal)}`);
    runtime.close();
    runtime = undefined;

    const inspect = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const outCount = scalar(
        inspect.database,
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'",
      );
      assert(outCount === 1, `seed_deduction:${outCount}`);
    } finally {
      inspect.close();
    }

    const barrierBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const specs = [
      { operationId: "operation-undo-race-a", sourceMessageId: "message-undo-race-a" },
      { operationId: "operation-undo-race-b", sourceMessageId: "message-undo-race-b" },
    ];
    const workers = [];
    for (const spec of specs) {
      workers.push(await launchWarmedWorker(root, spec, barrierBuffer));
    }
    const barrier = new Int32Array(barrierBuffer);
    assert(Atomics.load(barrier, 0) === workers.length,
      `barrier_count:${Atomics.load(barrier, 0)}`);
    Atomics.store(barrier, 1, 1);
    Atomics.notify(barrier, 1, workers.length);

    const outcomes = await Promise.all(workers.map(workerDone));
    const committed = outcomes.filter(
      (outcome) => outcome.committed === true &&
        (outcome.status === "committed" || outcome.status === "committed_with_issues"),
    );
    const ignored = outcomes.filter(
      (outcome) => outcome.status === "ignored" && outcome.reason_code === "already_voided",
    );
    assert(committed.length === 1, `exactly_one_committed:${JSON.stringify(outcomes)}`);
    assert(ignored.length === 1, `exactly_one_ignored:${JSON.stringify(outcomes)}`);
    const correction = committed[0].correction;
    assert(correction !== undefined, `correction_view:${JSON.stringify(committed[0])}`);
    assert(correction.operation === "void_event", `void_event:${JSON.stringify(correction)}`);
    assert(correction.current_active === false, `inactive:${JSON.stringify(correction)}`);

    const verify = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const targetEventId = verify.database.prepare(
        "SELECT event_id FROM event_records WHERE operation_id = ?",
      ).get(SEED_MEAL_OPERATION_ID).event_id;
      assert(correction.target_event_id === targetEventId,
        `target_event_id:${correction.target_event_id}:${targetEventId}`);
      const correctionRows = verify.database.prepare(
        "SELECT operation, base_revision FROM correction_events ORDER BY base_revision",
      ).all();
      assert(
        JSON.stringify(correctionRows) ===
          JSON.stringify([{ operation: "void_event", base_revision: 1 }]),
        `one_void:${JSON.stringify(correctionRows)}`,
      );
      const compensation = verify.database.prepare(
        `SELECT direction, json_extract(payload_json, '$.quantity_delta_microunits') AS delta
         FROM inventory_transactions WHERE reason_code = 'correction_compensation'`,
      ).all();
      assert(compensation.length === 1, `one_compensation:${JSON.stringify(compensation)}`);
      assert(compensation[0].direction === "in", `compensation_direction:${JSON.stringify(compensation)}`);
      assert(Number(compensation[0].delta) > 0, `compensation_positive:${JSON.stringify(compensation)}`);
      assert(
        scalar(verify.database,
          "SELECT COUNT(*) AS count FROM event_records WHERE event_id = ? AND event_type = 'diet_meal'",
          targetEventId) === 1,
        "meal_retained",
      );
      const negative = scalar(
        verify.database,
        `SELECT COUNT(*) AS count FROM inventory_batch_projections
         WHERE json_extract(payload_json, '$.quantity_microunits') < 0`,
      );
      assert(negative === 0, `negative_inventory:${negative}`);
      assert(
        verify.database.prepare("PRAGMA foreign_key_check").all().length === 0,
        "foreign_keys",
      );
    } finally {
      verify.close();
    }
    process.stdout.write(
      "UNDO_CONCURRENCY|PASS|committed=1|ignored=1|void=1|compensation=1|target_retained=1|negative=0\n",
    );
  } finally {
    runtime?.close();
    if (existsSync(root)) rmSync(root, { recursive: true, force: false });
    if (existsSync(root)) throw new Error("UNDO_CONCURRENCY_FAILED:residual_root");
  }
}

if (isMainThread) {
  await main();
} else {
  await runWorker();
}
