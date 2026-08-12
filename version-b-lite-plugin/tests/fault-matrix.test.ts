import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../src/authority/canonical-json.js";
import { deriveDomainId } from "../src/domain/identity.js";
import {
  createDietDomainService,
  type DietDomainFailureEntry,
  type DietDomainService,
} from "../src/domain/service.js";
import type {
  DomainEnvelopeInput,
  MealItemInput,
  NutritionSourceCandidate,
} from "../src/domain/types.js";
import { openDietDatabase } from "../src/storage/database.js";

const secret = Buffer.from("B-FAULT-001 test secret material 0001", "utf8");
const ownedRoots = new Set<string>();
const diagnosticKeys = ["error_code", "input_digest", "stage", "trace_id"];

interface FaultRow {
  readonly case_id: "CASE-EFFECT-001" | "CASE-EFFECT-002" | "CASE-EFFECT-003";
  readonly fault_id: string;
  readonly fault_point: string;
  readonly failed_state: string;
  readonly observations: {
    readonly outbox: {
      readonly state: string;
      readonly attempt_count: number;
      readonly reason: string | null;
      readonly count: number;
    };
    readonly facts: {
      readonly event_records: number;
      readonly meal_items: number;
      readonly effect_bundle_commits: number;
    };
  };
  readonly same_token_retry: {
    readonly post_retry: {
      readonly outbox_terminal_count: number;
      readonly outbox_attempt_count: number;
      readonly fact_event_records: number;
      readonly fact_meal_items: number;
      readonly terminal_effect_bundle_count: number;
      readonly daily_progress_snapshot_count: number;
      readonly envelope_finalization_count: number;
      readonly success_receipt_count: number;
    };
  };
  readonly diagnostic: {
    readonly stage: DietDomainFailureEntry["stage"];
    readonly error_code: string;
  };
}

const matrix = JSON.parse(readFileSync(
  new URL("../../shared/acceptance-cases/b-fault-matrix.json", import.meta.url),
  "utf8",
)) as { readonly fault_rows: readonly FaultRow[] };
const effectRows = matrix.fault_rows.filter((row) => row.case_id.startsWith("CASE-EFFECT-"));

function newTestRoot(): string {
  const root = join(tmpdir(), `diet-manager-b-fault-${randomUUID().replaceAll("-", "")}`);
  mkdirSync(root, { recursive: false });
  ownedRoots.add(root);
  return root;
}

function removeOwnedRoot(root: string): void {
  if (!ownedRoots.delete(root)) throw new Error(`unregistered test root: ${root}`);
  rmSync(root, { recursive: true, force: false });
  expect(existsSync(root)).toBe(false);
}

afterEach(() => {
  for (const root of [...ownedRoots]) removeOwnedRoot(root);
});

function businessSnapshot(database: DatabaseSync): Record<string, unknown> {
  const tables = database.prepare(
    `SELECT name FROM sqlite_schema
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
     ORDER BY name`,
  ).all() as Array<{ name: string }>;
  return Object.fromEntries(tables.map(({ name }) => [
    name,
    database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ]));
}

function nutritionSource(sourceRef: string, productId: string | null): NutritionSourceCandidate {
  return {
    source_type: productId === null ? "public_fixture" : "product_label",
    source_ref: sourceRef,
    profile_version: 1,
    applicable_product_id: productId,
    basis_kind: "per_item",
    basis_microunits: 1_000_000,
    basis_unit: "piece",
    nutrients: {
      energy_kcal_milli: 100_000,
      protein_mg: 5_000,
      fat_mg: 2_000,
      carbohydrate_mg: 12_000,
      fiber_mg: 1_000,
      water_ml_milli: 50_000,
    },
  };
}

function mealItem(
  name: string,
  deducted: number | null,
  sourceRef: string,
  productId: string | null = null,
): MealItemInput {
  return {
    normalized_name: name,
    item_type: "food",
    amount: {
      unit: "piece",
      observed_microunits: 1_000_000,
      nutrition_adoption_microunits: 1_000_000,
      inventory_deduction_microunits: deducted,
      template_reference_microunits: null,
      evidence: "explicit",
    },
    nutrition_sources: [nutritionSource(sourceRef, productId)],
  };
}

function mealEnvelope(
  suffix: string,
  location: "home" | "outside",
  item: MealItemInput,
): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-fault-meal-${suffix}`,
    idempotency_key: `idem-fault-meal-${suffix}`,
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: `message-fault-meal-${suffix}`,
    conversation_id: "conversation-b-fault-001",
    received_at: "2026-08-12T04:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "record_meal",
      operation_id: `operation-fault-meal-${suffix}`,
      occurred_at: "2026-08-12T12:00:00.000Z",
      meal_slot: "lunch",
      location,
      items: [item],
    }],
  };
}

function purchaseEnvelope(suffix: string, name: string, productId: string): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-fault-stock-${suffix}`,
    idempotency_key: `idem-fault-stock-${suffix}`,
    command_type: "add_inventory",
    subject_scope: "user:self",
    source_message_id: `message-fault-stock-${suffix}`,
    conversation_id: "conversation-b-fault-001",
    received_at: "2026-08-12T02:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "add_inventory",
      operation_id: `operation-fault-stock-${suffix}`,
      product: { product_id: productId, normalized_name: name, product_type: "food" },
      batch_id: `batch-fault-stock-${suffix}`,
      amount: {
        unit: "piece",
        observed_microunits: 10_000_000,
        nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null,
        template_reference_microunits: null,
        evidence: "explicit",
      },
      nutrition_sources: [nutritionSource(`label-${productId}-v1`, productId)],
    }],
  };
}

function correctionEnvelope(suffix: string, targetEventId: string): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-fault-correction-${suffix}`,
    idempotency_key: `idem-fault-correction-${suffix}`,
    command_type: "correct_record",
    subject_scope: "user:self",
    source_message_id: [
      `message-fault-correction-${suffix}`,
      "private source text SELECT * FROM secrets b-fault-secret-token C:\\Users\\fault\\private.db",
    ].join(" "),
    conversation_id: "conversation-b-fault-001-correction",
    received_at: "2026-08-12T05:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "correct_record",
      operation_id: `operation-fault-correction-${suffix}`,
      target_event_id: targetEventId,
      base_revision: 1,
      item_order: 0,
      replacement_amount: {
        unit: "piece",
        observed_microunits: 3_000_000,
        nutrition_adoption_microunits: 3_000_000,
        inventory_deduction_microunits: 3_000_000,
        template_reference_microunits: null,
        evidence: "explicit",
      },
    }],
  };
}

function attempt(service: DietDomainService, envelope: DomainEnvelopeInput) {
  const preview = service.preview(envelope);
  const input = {
    envelope,
    token: preview.token,
    input_digest: preview.input_digest,
    data_revision: preview.data_revision,
  } as const;
  return { input, preview, run: () => service.execute(input) };
}

function expectDiagnostic(
  entry: DietDomainFailureEntry,
  expected: FaultRow["diagnostic"],
  inputDigest: string,
): void {
  expect(Object.keys(entry).sort()).toEqual(diagnosticKeys);
  expect(entry).toEqual({
    stage: expected.stage,
    error_code: expected.error_code,
    trace_id: expect.stringMatching(/^trace-[a-f0-9]{32}$/),
    input_digest: inputDigest,
  });
  const encoded = JSON.stringify(entry).toLowerCase();
  for (const forbidden of [
    "private source text",
    "select * from secrets",
    "b-fault-secret-token",
    "c:\\\\users\\\\fault\\\\private.db",
  ]) expect(encoded).not.toContain(forbidden);
}

function scopedState(database: DatabaseSync, envelopeId: string) {
  const count = (sql: string, ...parameters: unknown[]) =>
    (database.prepare(sql).get(...parameters) as { count: number }).count;
  return {
    envelope: database.prepare(
      "SELECT state, result_status FROM command_envelopes WHERE envelope_id = ?",
    ).get(envelopeId),
    outbox: database.prepare(
      `SELECT state, attempt_count, reason FROM effect_outbox
       WHERE envelope_id = ? ORDER BY effect_id`,
    ).all(envelopeId),
    event_records: count("SELECT COUNT(*) AS count FROM event_records WHERE envelope_id = ?", envelopeId),
    meal_items: count(
      `SELECT COUNT(*) AS count FROM meal_items m
       JOIN event_records e ON e.event_id = m.event_id WHERE e.envelope_id = ?`,
      envelopeId,
    ),
    effect_bundle_commits: count(
      "SELECT COUNT(*) AS count FROM effect_bundle_commits WHERE envelope_id = ? AND completed_at IS NOT NULL",
      envelopeId,
    ),
    inventory_transactions: count(
      `SELECT COUNT(*) AS count FROM inventory_transactions t
       JOIN event_records e ON e.event_id = t.event_id WHERE e.envelope_id = ?`,
      envelopeId,
    ),
    nutrition_profiles: count(
      `SELECT COUNT(DISTINCT n.nutrition_profile_id) AS count FROM nutrition_snapshots n
       JOIN event_records e ON e.event_id = n.meal_event_id WHERE e.envelope_id = ?`,
      envelopeId,
    ),
    nutrition_snapshots: count(
      `SELECT COUNT(*) AS count FROM nutrition_snapshots n
       JOIN event_records e ON e.event_id = n.meal_event_id WHERE e.envelope_id = ?`,
      envelopeId,
    ),
    issues: count(
      `SELECT COUNT(*) AS count FROM issues i JOIN meal_items m ON m.item_id = i.entity_id
       JOIN event_records e ON e.event_id = m.event_id WHERE e.envelope_id = ?`,
      envelopeId,
    ),
    finalizations: count(
      "SELECT COUNT(*) AS count FROM envelope_finalizations WHERE envelope_id = ?",
      envelopeId,
    ),
    success_receipts: count(
      `SELECT COUNT(*) AS count FROM idempotency_records
       WHERE operation_id = ? AND state = 'finalized' AND terminal_result_json IS NOT NULL`,
      envelopeId,
    ),
  };
}

function effectFixture(row: FaultRow): {
  readonly envelope: DomainEnvelopeInput;
  readonly serviceFault: string;
  readonly seeds: readonly DomainEnvelopeInput[];
} {
  const leak = "private source text SELECT * FROM secrets b-fault-secret-token C:\\Users\\fault\\private.db";
  if (row.case_id === "CASE-EFFECT-001") {
    return {
      serviceFault: "after_meal_nutrition",
      seeds: [],
      envelope: mealEnvelope(
        row.fault_point,
        "outside",
        mealItem(leak, null, leak),
      ),
    };
  }
  if (row.fault_point === "after_inventory_write") {
    const name = `matrix exact home item ${leak}`;
    const productId = "product-matrix-exact-home-item";
    return {
      serviceFault: "after_meal_first_item",
      seeds: [purchaseEnvelope(row.fault_point, name, productId)],
      envelope: mealEnvelope(
        row.fault_point,
        "home",
        mealItem(name, 1_000_000, `label-${productId}-v1`, productId),
      ),
    };
  }
  const name = `matrix home ${row.fault_point} ${leak}`;
  const productId = `product-matrix-${row.fault_point}`;
  const ambiguous = row.fault_point === "after_issue_write";
  return {
    serviceFault: row.fault_point === "after_issue_write"
      ? "after_meal_issue_write"
      : "after_meal_progress_contribution_prepared",
    seeds: ambiguous
      ? [
          purchaseEnvelope(`${row.fault_point}-a`, name, `${productId}-a`),
          purchaseEnvelope(`${row.fault_point}-b`, name, `${productId}-b`),
        ]
      : [purchaseEnvelope(row.fault_point, name, productId)],
    envelope: mealEnvelope(
      row.fault_point,
      "home",
      mealItem(
        name,
        1_000_000,
        ambiguous ? leak : `label-${productId}-v1`,
        ambiguous ? null : productId,
      ),
    ),
  };
}

function seedCorrectionTarget(service: DietDomainService, suffix: string): string {
  const name = `fault eggs ${suffix}`;
  const productId = `product-fault-eggs-${suffix}`;
  attempt(service, purchaseEnvelope(`eggs-${suffix}`, name, productId)).run();
  const target = mealEnvelope(
    `target-${suffix}`,
    "home",
    mealItem(name, 2_000_000, `label-${productId}-v1`, productId),
  );
  attempt(service, target).run();
  return deriveDomainId("event", target.idempotency_key, 0);
}

describe("B-FAULT-001 frozen EffectBundle matrix", () => {
  it("binds every frozen CASE-EFFECT fault row to a real execution", () => {
    expect(effectRows.map((row) => row.fault_id)).toEqual([
      "effect-001-after-nutrition",
      "effect-002-after-inventory-write",
      "effect-002-after-issue-write",
      "effect-002-after-progress-contribution-prepared",
      "effect-003-after-finalization-row",
      "effect-003-after-envelope",
      "effect-003-after-idempotency",
      "effect-003-before-commit",
    ]);
  });

  for (const row of effectRows.filter((candidate) => candidate.case_id !== "CASE-EFFECT-003")) {
    it(`${row.fault_id} rolls back the whole EffectBundle, survives reopen, and retries once`, () => {
      const root = newTestRoot();
      let runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const fixture = effectFixture(row);
        const base = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T04:00:01.000Z",
        });
        for (const seed of fixture.seeds) attempt(base, seed).run();
        const before = businessSnapshot(runtime.database);
        const failures: DietDomainFailureEntry[] = [];
        const faulting = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T04:00:01.000Z",
          fault: fixture.serviceFault as never,
          failureSink: (entry) => {
            failures.push(entry);
            if (row.case_id === "CASE-EFFECT-001") {
              throw new Error("diagnostic sink must not win");
            }
          },
        });
        const failedAttempt = attempt(faulting, fixture.envelope);
        expect(failedAttempt.run).toThrow(new RegExp(
          row.diagnostic.error_code === "NUTRITION_EFFECT_WRITE_FAILED"
            ? "^NUTRITION_EFFECT_WRITE_FAILED:"
            : "^MEAL_EFFECT_FAILED:",
        ));
        expect(failures).toHaveLength(1);
        expectDiagnostic(failures[0]!, row.diagnostic, failedAttempt.preview.input_digest);

        const failed = scopedState(runtime.database, fixture.envelope.envelope_id);
        expect(failed.envelope).toEqual({
          state: row.failed_state,
          result_status: "facts_committed_effects_pending",
        });
        expect(failed.outbox).toEqual(Array.from(
          { length: row.observations.outbox.count },
          () => ({
            state: row.observations.outbox.state,
            attempt_count: row.observations.outbox.attempt_count,
            reason: row.observations.outbox.reason,
          }),
        ));
        expect(failed).toMatchObject({
          event_records: row.observations.facts.event_records,
          meal_items: row.observations.facts.meal_items,
          effect_bundle_commits: row.observations.facts.effect_bundle_commits,
          inventory_transactions: 0,
          nutrition_profiles: 0,
          nutrition_snapshots: 0,
          issues: 0,
          finalizations: 0,
          success_receipts: 0,
        });
        const failureBytes = canonicalJson(businessSnapshot(runtime.database));
        expect(failureBytes).not.toBe(canonicalJson(before));

        runtime.close();
        runtime = openDietDatabase({ privateRuntimeRoot: root });
        expect(canonicalJson(businessSnapshot(runtime.database))).toBe(failureBytes);
        const recovery = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T04:00:02.000Z",
        });
        const recovered = recovery.execute(failedAttempt.input);
        const expected = row.same_token_retry.post_retry;
        const green = scopedState(runtime.database, fixture.envelope.envelope_id);
        expect(green).toMatchObject({
          event_records: expected.fact_event_records,
          meal_items: expected.fact_meal_items,
          effect_bundle_commits: expected.terminal_effect_bundle_count,
          finalizations: expected.envelope_finalization_count,
          success_receipts: expected.success_receipt_count,
        });
        expect(green.outbox).toHaveLength(expected.outbox_terminal_count);
        expect(green.outbox.every((value) =>
          (value as { state: string }).state === "succeeded" ||
          (value as { state: string }).state === "permanent_business_skip"
        )).toBe(true);
        expect(green.outbox.every((value) =>
          (value as { attempt_count: number }).attempt_count === expected.outbox_attempt_count
        )).toBe(true);
        expect(runtime.database.prepare(
          "SELECT COUNT(*) AS count FROM daily_progress_snapshots WHERE idempotency_result_id = ?",
        ).get(fixture.envelope.idempotency_key)).toEqual({
          count: expected.daily_progress_snapshot_count,
        });
        const frozenResult = canonicalJson(recovered);
        const terminalBytes = canonicalJson(businessSnapshot(runtime.database));
        expect(canonicalJson(recovery.execute(failedAttempt.input))).toBe(frozenResult);
        expect(canonicalJson(businessSnapshot(runtime.database))).toBe(terminalBytes);
      } finally {
        runtime.close();
        removeOwnedRoot(root);
      }
    });
  }
});

describe("B-FAULT-001 EnvelopeFinalize matrix", () => {
  for (const row of effectRows.filter((candidate) => candidate.case_id === "CASE-EFFECT-003")) {
    it(`${row.fault_id} rolls back the real meal finalizer and resumes finalizer-only`, () => {
      const root = newTestRoot();
      let runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const failures: DietDomainFailureEntry[] = [];
        const name = [
          `matrix finalizer home ${row.fault_point}`,
          "private source text SELECT * FROM secrets b-fault-secret-token C:\\Users\\fault\\private.db",
        ].join(" ");
        const productId = `product-matrix-finalizer-${row.fault_point}`;
        const base = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T03:00:01.000Z",
        });
        attempt(base, purchaseEnvelope(row.fault_point, name, productId)).run();
        const envelope = mealEnvelope(
          row.fault_point,
          "home",
          mealItem(
            name,
            1_000_000,
            `label-${productId}-v1`,
            productId,
          ),
        );
        const faulting = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T04:00:01.000Z",
          fault: row.fault_point as never,
          failureSink: (entry) => {
            failures.push(entry);
            if (row.fault_point === "after_finalization_row") {
              throw new Error("diagnostic sink must not win");
            }
          },
        });
        const failedAttempt = attempt(faulting, envelope);
        expect(failedAttempt.run).toThrow(`ENVELOPE_FINALIZE_FAILED:${row.fault_point}`);
        expect(failures).toHaveLength(1);
        expectDiagnostic(failures[0]!, row.diagnostic, failedAttempt.preview.input_digest);
        const failed = scopedState(runtime.database, envelope.envelope_id);
        expect(failed.envelope).toEqual({ state: "effects_stable", result_status: "effects_stable" });
        expect(failed.outbox).toEqual(Array.from(
          { length: row.observations.outbox.count },
          () => ({ state: "succeeded", attempt_count: 1, reason: null }),
        ));
        expect(failed).toMatchObject({
          event_records: 1,
          meal_items: 1,
          effect_bundle_commits: 1,
          inventory_transactions: 1,
          nutrition_profiles: 1,
          nutrition_snapshots: 1,
          issues: 0,
          finalizations: 0,
          success_receipts: 0,
        });
        expect(runtime.database.prepare(
          "SELECT COUNT(*) AS count FROM daily_progress_snapshots WHERE idempotency_result_id = ?",
        ).get(envelope.idempotency_key)).toEqual({ count: 0 });
        const stableSnapshot = businessSnapshot(runtime.database);
        const stableBytes = canonicalJson(stableSnapshot);

        runtime.close();
        runtime = openDietDatabase({ privateRuntimeRoot: root });
        expect(canonicalJson(businessSnapshot(runtime.database))).toBe(stableBytes);
        const recovery = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T04:00:02.000Z",
        });
        const recovered = recovery.execute(failedAttempt.input);
        const after = businessSnapshot(runtime.database);
        const finalizerTables = new Set([
          "command_envelopes",
          "daily_progress_snapshots",
          "envelope_finalizations",
          "idempotency_records",
        ]);
        for (const [table, rows] of Object.entries(stableSnapshot)) {
          if (!finalizerTables.has(table)) expect(after[table]).toEqual(rows);
        }
        const expected = row.same_token_retry.post_retry;
        const green = scopedState(runtime.database, envelope.envelope_id);
        expect(green).toMatchObject({
          effect_bundle_commits: expected.terminal_effect_bundle_count,
          finalizations: expected.envelope_finalization_count,
          success_receipts: expected.success_receipt_count,
        });
        expect(green.outbox.every((value) =>
          (value as { attempt_count: number }).attempt_count === expected.outbox_attempt_count
        )).toBe(true);
        const finalBytes = canonicalJson(businessSnapshot(runtime.database));
        expect(canonicalJson(recovery.execute(failedAttempt.input))).toBe(canonicalJson(recovered));
        expect(canonicalJson(businessSnapshot(runtime.database))).toBe(finalBytes);
      } finally {
        runtime.close();
        removeOwnedRoot(root);
      }
    });
  }
});

describe("B-FAULT-001 correction late rollback and finalizer diagnostics", () => {
  for (const fault of [
    "after_correction_claim",
    "after_correction_compensation",
    "after_correction_nutrition_progress",
  ] as const) {
    it(`${fault} leaves no partial correction EffectBundle write`, () => {
      const root = newTestRoot();
      const runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const base = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T05:00:01.000Z",
        });
        const targetEventId = seedCorrectionTarget(base, fault);
        const beforeProjection = canonicalJson(runtime.database.prepare(
          "SELECT * FROM inventory_batch_projections ORDER BY batch_id",
        ).all());
        const beforeProgress = canonicalJson(runtime.database.prepare(
          "SELECT * FROM daily_progress_snapshots ORDER BY rowid",
        ).all());
        const beforeNutrition = canonicalJson(runtime.database.prepare(
          "SELECT * FROM nutrition_snapshots ORDER BY rowid",
        ).all());
        const failures: DietDomainFailureEntry[] = [];
        const faulting = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T05:00:02.000Z",
          fault,
          failureSink: (entry) => failures.push(entry),
        });
        const envelope = correctionEnvelope(fault, targetEventId);
        const failedAttempt = attempt(faulting, envelope);
        expect(failedAttempt.run).toThrow(/^CORRECTION_EFFECT_FAILED:/);
        expect(canonicalJson(runtime.database.prepare(
          "SELECT * FROM inventory_batch_projections ORDER BY batch_id",
        ).all())).toBe(beforeProjection);
        expect(canonicalJson(runtime.database.prepare(
          "SELECT * FROM daily_progress_snapshots ORDER BY rowid",
        ).all())).toBe(beforeProgress);
        expect(canonicalJson(runtime.database.prepare(
          "SELECT * FROM nutrition_snapshots ORDER BY rowid",
        ).all())).toBe(beforeNutrition);
        const correctionEventId = (runtime.database.prepare(
          "SELECT event_id FROM event_records WHERE envelope_id = ?",
        ).get(envelope.envelope_id) as { event_id: string }).event_id;
        expect(runtime.database.prepare(
          "SELECT COUNT(*) AS count FROM inventory_transactions WHERE event_id = ?",
        ).get(correctionEventId)).toEqual({ count: 0 });
        expect(failures).toHaveLength(1);
        expectDiagnostic(failures[0]!, {
          stage: "EffectBundle",
          error_code: "CORRECTION_EFFECT_FAILED",
        }, failedAttempt.preview.input_digest);
      } finally {
        runtime.close();
        removeOwnedRoot(root);
      }
    });
  }

  it("logs a real correction finalizer fault and retries without repeating compensation", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const base = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T05:00:01.000Z",
      });
      const targetEventId = seedCorrectionTarget(base, "finalizer");
      const failures: DietDomainFailureEntry[] = [];
      const faulting = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T05:00:02.000Z",
        fault: "after_idempotency" as never,
        failureSink: (entry) => failures.push(entry),
      });
      const envelope = correctionEnvelope("finalizer", targetEventId);
      const failedAttempt = attempt(faulting, envelope);
      expect(failedAttempt.run).toThrow("ENVELOPE_FINALIZE_FAILED:after_idempotency");
      expect(failures).toHaveLength(1);
      expectDiagnostic(failures[0]!, {
        stage: "EnvelopeFinalize",
        error_code: "ENVELOPE_FINALIZE_FAILED",
      }, failedAttempt.preview.input_digest);
      expect(runtime.database.prepare(
        "SELECT state, result_status FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({ state: "effects_stable", result_status: "effects_stable" });
      const correctionEventId = (runtime.database.prepare(
        "SELECT event_id FROM event_records WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { event_id: string }).event_id;
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE event_id = ?",
      ).get(correctionEventId)).toEqual({ count: 1 });
      const compensationBefore = canonicalJson(runtime.database.prepare(
        "SELECT * FROM inventory_transactions WHERE event_id = ? ORDER BY transaction_id",
      ).all(correctionEventId));

      const recovery = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T05:00:03.000Z",
      });
      expect(recovery.execute(failedAttempt.input).status).toBe("committed");
      expect(canonicalJson(runtime.database.prepare(
        "SELECT * FROM inventory_transactions WHERE event_id = ? ORDER BY transaction_id",
      ).all(correctionEventId))).toBe(compensationBefore);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });
});
