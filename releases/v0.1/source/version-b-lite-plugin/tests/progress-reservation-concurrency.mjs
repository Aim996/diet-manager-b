import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

import { createDietDomainService } from "../dist/domain/service.js";
import { openDietDatabase } from "../dist/storage/database.js";

const secret = Buffer.from("B-SLICE-001 progress reservation concurrency", "utf8");

function assert(condition, label, detail = undefined) {
  if (!condition) {
    throw new Error(
      `PROGRESS_RESERVATION_CONCURRENCY_FAILED:${label}${
        detail === undefined ? "" : `:${JSON.stringify(detail)}`
      }`,
    );
  }
}

async function withTimeout(promise, label, timeoutMs = 10_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function amount(value) {
  return {
    unit: "piece",
    observed_microunits: value,
    nutrition_adoption_microunits: value,
    inventory_deduction_microunits: null,
    template_reference_microunits: null,
    evidence: "explicit",
  };
}

function nutrition(sourceRef, energy) {
  return {
    source_type: "public_fixture",
    source_ref: sourceRef,
    profile_version: 1,
    applicable_product_id: null,
    basis_kind: "per_item",
    basis_microunits: 1,
    basis_unit: "piece",
    nutrients: {
      energy_kcal_milli: energy,
      protein_mg: 0,
      fat_mg: 0,
      carbohydrate_mg: 0,
      fiber_mg: 0,
      water_ml_milli: 0,
    },
  };
}

function mealOperation(suffix, energy) {
  return {
    kind: "record_meal",
    operation_id: `operation-progress-${suffix}`,
    occurred_at: "2026-08-12T12:00:00.000Z",
    meal_slot: "lunch",
    location: "outside",
    items: [{
      normalized_name: `progress meal ${suffix}`,
      item_type: "food",
      amount: amount(1),
      nutrition_sources: [nutrition(`fixture-progress-${suffix}-v1`, energy)],
    }],
  };
}

function mealEnvelope(suffix, energy) {
  return {
    envelope_id: `envelope-progress-${suffix}`,
    idempotency_key: `idem-progress-${suffix}`,
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: `message-progress-${suffix}`,
    conversation_id: "conversation-progress-concurrency",
    received_at: "2026-08-12T04:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [mealOperation(suffix, energy)],
  };
}

function mixedEffectsStableEnvelope() {
  return {
    envelope_id: "envelope-progress-existing-stable",
    idempotency_key: "idem-progress-existing-stable",
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: "message-progress-existing-stable",
    conversation_id: "conversation-progress-concurrency",
    received_at: "2026-08-12T03:59:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [
      {
        kind: "add_inventory",
        operation_id: "operation-progress-existing-purchase",
        product: {
          product_id: "product-progress-existing",
          normalized_name: "progress existing stock",
          product_type: "food",
        },
        batch_id: "batch-progress-existing",
        amount: {
          unit: "piece",
          observed_microunits: 1,
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          template_reference_microunits: null,
          evidence: "explicit",
        },
        nutrition_sources: [{
          ...nutrition("label-progress-existing-v1", 1),
          source_type: "product_label",
          applicable_product_id: "product-progress-existing",
        }],
      },
      mealOperation("existing-stable", Number.MAX_SAFE_INTEGER),
    ],
  };
}

function waitForProgressRead(barrier) {
  const state = new Int32Array(barrier);
  Atomics.store(state, 0, 1);
  Atomics.notify(state, 0);
  const deadline = Date.now() + 10_000;
  while (Atomics.load(state, 1) === 0) {
    if (Date.now() >= deadline) throw new Error("connection A release barrier timeout");
    Atomics.wait(state, 1, 0, Math.min(100, deadline - Date.now()));
  }
}

function progressBarrierDatabase(database, barrier) {
  let reached = false;
  return new Proxy(database, {
    get(target, property) {
      if (property !== "prepare") {
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (sql) => {
        const statement = target.prepare(sql);
        if (
          reached ||
          !sql.includes("SELECT generated_at, payload_json FROM daily_progress_snapshots")
        ) return statement;
        return new Proxy(statement, {
          get(statementTarget, statementProperty) {
            if (statementProperty !== "get") {
              const value = Reflect.get(statementTarget, statementProperty, statementTarget);
              return typeof value === "function" ? value.bind(statementTarget) : value;
            }
            return (...args) => {
              const row = statementTarget.get(...args);
              reached = true;
              waitForProgressRead(barrier);
              return row;
            };
          },
        });
      };
    },
  });
}

async function runConnectionA() {
  const runtime = openDietDatabase({ privateRuntimeRoot: workerData.root });
  try {
    const service = createDietDomainService({
      database: progressBarrierDatabase(runtime.database, workerData.barrier),
      secret,
      now: () => "2026-08-12T04:00:01.000Z",
    });
    const result = service.execute(workerData.execution);
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    runtime.close();
  }
}

function count(database, table, envelopeId) {
  if (table === "meal_items") {
    return Number(database.prepare(
      `SELECT COUNT(*) AS count FROM meal_items WHERE event_id IN (
         SELECT event_id FROM event_records WHERE envelope_id = ?
       )`,
    ).get(envelopeId).count);
  }
  return Number(database.prepare(
    `SELECT COUNT(*) AS count FROM ${table} WHERE envelope_id = ?`,
  ).get(envelopeId).count);
}

async function main() {
  const root = join(
    tmpdir(),
    `diet-manager-progress-reservation-${randomUUID().replaceAll("-", "")}`,
  );
  mkdirSync(root, { recursive: false });
  const runtime = openDietDatabase({ privateRuntimeRoot: root });
  let worker;
  let workerExited;
  try {
    const stableEnvelope = mixedEffectsStableEnvelope();
    const stableService = createDietDomainService({
      database: runtime.database,
      secret,
      now: () => "2026-08-12T03:59:01.000Z",
      fault: "after_mixed_seal",
    });
    const stablePreview = stableService.preview(stableEnvelope);
    const stableExecution = {
      envelope: stableEnvelope,
      token: stablePreview.token,
      input_digest: stablePreview.input_digest,
      data_revision: stablePreview.data_revision,
    };
    let stableFault = "";
    try {
      stableService.execute(stableExecution);
    } catch (error) {
      stableFault = error instanceof Error ? error.message : String(error);
    }
    assert(
      stableFault === "DIET_DOMAIN_EXECUTION_FAILED:after_mixed_seal",
      "existing_envelope_reached_effects_stable",
      { stableFault },
    );

    const envelopeA = mealEnvelope("connection-a", 1);
    const serviceA = createDietDomainService({
      database: runtime.database,
      secret,
      now: () => "2026-08-12T04:00:01.000Z",
    });
    const previewA = serviceA.preview(envelopeA);
    const executionA = {
      envelope: envelopeA,
      token: previewA.token,
      input_digest: previewA.input_digest,
      data_revision: previewA.data_revision,
    };

    const barrierBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const barrier = new Int32Array(barrierBuffer);
    worker = new Worker(new URL(import.meta.url), {
      workerData: { root, barrier: barrierBuffer, execution: executionA },
    });
    workerExited = new Promise((resolve, reject) => {
      worker.once("error", reject);
      worker.once("exit", (code) => code === 0
        ? resolve()
        : reject(new Error(`connection A exited ${code}`)));
    });
    void workerExited.catch(() => undefined);
    const message = new Promise((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    });

    const barrierDeadline = Date.now() + 10_000;
    while (Atomics.load(barrier, 0) === 0) {
      if (Date.now() >= barrierDeadline) throw new Error("connection A progress barrier timeout");
      Atomics.wait(barrier, 0, 0, Math.min(100, barrierDeadline - Date.now()));
    }
    const finalizingService = createDietDomainService({
      database: runtime.database,
      secret,
      now: () => "2026-08-12T03:59:02.000Z",
    });
    const stableResult = finalizingService.execute(stableExecution);
    assert(stableResult.status === "committed", "connection_b_finalized");
    Atomics.store(barrier, 1, 1);
    Atomics.notify(barrier, 1);

    const outcomeA = await withTimeout(message, "connection A result timeout");
    await withTimeout(workerExited, "connection A exit timeout");
    worker = undefined;
    workerExited = undefined;
    const envelopeId = envelopeA.envelope_id;
    const evidence = {
      worker_error: outcomeA.ok ? null : outcomeA.error,
      event_records: count(runtime.database, "event_records", envelopeId),
      meal_items: count(runtime.database, "meal_items", envelopeId),
      effect_outbox: count(runtime.database, "effect_outbox", envelopeId),
      effect_bundle_commits: count(runtime.database, "effect_bundle_commits", envelopeId),
      envelope_finalizations: count(runtime.database, "envelope_finalizations", envelopeId),
      envelope_state: runtime.database.prepare(
        "SELECT state FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelopeId)?.state,
    };

    assert(
      evidence.event_records === 0 &&
        evidence.meal_items === 0 &&
        evidence.effect_outbox === 0 &&
        evidence.effect_bundle_commits === 0 &&
        evidence.envelope_finalizations === 0 &&
        evidence.envelope_state === "received",
      "connection_a_left_no_unfinalizable_fact",
      evidence,
    );
    console.log(JSON.stringify({ status: "ok", evidence }));
  } finally {
    let cleanupError;
    if (worker) {
      try {
        await withTimeout(worker.terminate(), "connection A terminate timeout", 5_000);
        if (workerExited) await withTimeout(
          workerExited.catch(() => undefined),
          "connection A terminated exit timeout",
          5_000,
        );
      } catch (error) {
        cleanupError = error;
      }
    }
    try {
      runtime.close();
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      if (existsSync(root)) rmSync(root, { recursive: true, force: false });
      assert(!existsSync(root), "owned_root_removed");
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) throw cleanupError;
  }
}

if (isMainThread) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
} else {
  await runConnectionA();
}
