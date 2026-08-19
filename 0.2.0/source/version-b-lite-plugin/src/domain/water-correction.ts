import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../authority/canonical-json.js";
import type { DietManagerAction } from "../contracts.js";
import { resolveBuiltinNutrientVector } from "../nutrition/builtin.js";
import {
  readEffectiveWaterState,
  type EffectiveWaterSnapshot,
} from "../repository/correction-target.js";
import type { PreparedEnvelopeOperation } from "../repository/fact-commit.js";
import {
  createReplacementProgressReservation,
  reservationsFromEventPayload,
  type ReplacementProgressReservation,
  type ReservedDailyProgress,
} from "../repository/progress-reservation.js";
import { computeRepositoryDataRevision } from "../repository/revision.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
import { assertEffectTransition, type EffectState } from "../state/transition-guard.js";
import {
  readAppliedCorrectionResult,
  type ApplyCorrectionEffectsInput,
  type CorrectionOperationResult,
} from "./effect-bundle.js";
import { deriveDomainId, toNaturalDate } from "./identity.js";
import type { CorrectWaterClassificationOperation, NutritionVector } from "./types.js";

export interface PrepareWaterClassificationInput {
  readonly database: DatabaseSync;
  readonly secret: Uint8Array;
  readonly token: string;
  readonly inputDigest: string;
  readonly dataRevision: string;
  readonly subjectScope: string;
  readonly commandType: DietManagerAction;
  readonly idempotencyKey: string;
  readonly sourceMessageId: string;
  readonly conversationId: string;
  readonly receivedAt: string;
  readonly committedAt: string;
  readonly sequence: number;
  readonly operation: CorrectWaterClassificationOperation;
}

export interface PreparedWaterClassification {
  readonly fact: PreparedEnvelopeOperation;
  readonly correction_id: string;
  readonly operation: CorrectWaterClassificationOperation;
  readonly progress_date: string;
  readonly progress_before: NutritionVector;
  readonly progress_after: NutritionVector;
}

function freezeJson<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) freezeJson(item);
    return Object.freeze(value) as T;
  }
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freezeJson(child);
    return Object.freeze(value);
  }
  return value;
}

function invalid(reason: string): never {
  throw new TypeError(`WATER_CLASSIFICATION_INVALID:${reason}`);
}

function makeWaterReplacementReservation(
  database: DatabaseSync,
  progressDate: string,
  beforeNutrients: NutritionVector,
  afterNutrients: NutritionVector,
): ReplacementProgressReservation {
  const before: ReservedDailyProgress = Object.freeze({
    coverage_status: Object.values(beforeNutrients).every((value) => value !== null)
      ? "complete" as const
      : "partial" as const,
    date: progressDate,
    nutrients: beforeNutrients,
    timezone: "Asia/Shanghai" as const,
  });
  const after: ReservedDailyProgress = Object.freeze({
    coverage_status: Object.values(afterNutrients).every((value) => value !== null)
      ? "complete" as const
      : "partial" as const,
    date: progressDate,
    nutrients: afterNutrients,
    timezone: "Asia/Shanghai" as const,
  });
  try {
    return createReplacementProgressReservation(database, progressDate, before, after);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "PROGRESS_RESERVATION_AUTHORITY_INVALID:daily_progress_delta" ||
        error.message === "PROGRESS_RESERVATION_AUTHORITY_INVALID:daily_progress_missing")
    ) {
      throw new Error("CORRECTION_EFFECT_INVALID:daily_progress");
    }
    throw error;
  }
}

/**
 * 白水分类纠正（“刚才那杯不是白水，是牛奶”）的预备：认证目标白水事件及其纠正链，
 * 校验 base_revision / active / 仍是 plain_water，同步解析替换饮料（牛奶）的营养向量，
 * 组装 12 字段 correction-fact（operation=change_food_type，inventory_compensation_intent
 * 与 nutrition_delta.items 均为空，仅 1 条 daily_progress_replacement）。
 * 不追加第二次 occurrence fact：牛奶营养只写入 after_snapshot，不进每日聚合。
 */
export function prepareWaterClassificationOperation(
  input: PrepareWaterClassificationInput,
): PreparedWaterClassification {
  const operation = input.operation;
  if (
    operation.kind !== "correct_record" ||
    operation.correction_kind !== "water_classification" ||
    input.commandType !== "correct_record"
  ) return invalid("operation");
  if (
    operation.replacement_kind !== "nutritious_drink" ||
    typeof operation.replacement_name !== "string" ||
    operation.replacement_name.length === 0
  ) return invalid("replacement");
  const current = readEffectiveWaterState(input.database, input.secret, operation.target_event_id);
  if (operation.base_revision !== current.revision) {
    throw new Error("CORRECTION_TARGET_INVALID:stale_revision");
  }
  if (!current.snapshot.active) {
    throw new Error("CORRECTION_TARGET_INVALID:inactive");
  }
  if (current.snapshot.classification !== "plain_water") {
    throw new Error("CORRECTION_TARGET_INVALID:already_classified");
  }
  const plainWaterMlMilli = current.snapshot.plain_water_ml_milli;
  const milkNutrients = resolveBuiltinNutrientVector(operation.replacement_name, plainWaterMlMilli);
  const afterSnapshot = freezeJson({
    active: true,
    classification: "nutritious_drink" as const,
    replacement_name: operation.replacement_name,
    occurred_at: current.snapshot.occurred_at,
    timezone: "Asia/Shanghai" as const,
    plain_water_ml_milli: 0,
    nutrients: milkNutrients,
  }) as EffectiveWaterSnapshot;
  if (canonicalJson(afterSnapshot) === canonicalJson(current.snapshot)) {
    throw new Error("CORRECTION_TARGET_INVALID:no_change");
  }
  const correctionId = deriveDomainId("correction", input.idempotencyKey, input.sequence);
  const eventId = deriveDomainId("event", input.idempotencyKey, input.sequence);
  const date = toNaturalDate(current.snapshot.occurred_at, "Asia/Shanghai");
  const beforeNutrients: NutritionVector = Object.freeze({
    energy_kcal_milli: null,
    protein_mg: null,
    fat_mg: null,
    carbohydrate_mg: null,
    fiber_mg: null,
    water_ml_milli: plainWaterMlMilli,
  });
  const afterNutrients: NutritionVector = Object.freeze({
    energy_kcal_milli: null,
    protein_mg: null,
    fat_mg: null,
    carbohydrate_mg: null,
    fiber_mg: null,
    water_ml_milli: 0,
  });
  const progressReservations: readonly ReplacementProgressReservation[] = Object.freeze([
    makeWaterReplacementReservation(input.database, date, beforeNutrients, afterNutrients),
  ]);
  const payload = freezeJson({
    affected_dates: Object.freeze([date]),
    after_snapshot: afterSnapshot,
    authority_kind: "diet-manager/correction-fact/v1",
    base_revision: current.revision,
    before_snapshot: current.snapshot,
    change_set: Object.freeze([
      Object.freeze({
        after: afterSnapshot.classification,
        before: current.snapshot.classification,
        path: "/classification",
      }),
      Object.freeze({
        after: afterSnapshot.replacement_name,
        before: current.snapshot.replacement_name,
        path: "/replacement_name",
      }),
    ]),
    correction_id: correctionId,
    inventory_compensation_intent: Object.freeze({ items: Object.freeze([]) }),
    nutrition_delta: Object.freeze({
      items: Object.freeze([]),
      progress_reservations: progressReservations,
    }),
    operation: "change_food_type",
    request_id: operation.operation_id,
    target_event_id: operation.target_event_id,
  });
  return Object.freeze({
    correction_id: correctionId,
    operation,
    progress_date: date,
    progress_before: beforeNutrients,
    progress_after: afterNutrients,
    fact: Object.freeze({
      database: input.database,
      secret: Uint8Array.from(input.secret),
      token: input.token,
      inputDigest: input.inputDigest,
      subjectScope: input.subjectScope,
      commandType: input.commandType,
      dataRevision: input.dataRevision,
      traceId: deriveDomainId("trace", input.idempotencyKey, 0),
      sequence: input.sequence,
      operationId: operation.operation_id,
      event: Object.freeze({
        eventId,
        operationId: operation.operation_id,
        schemaVersion: "domain/v2",
        eventType: "diet_correction",
        factKind: "correction",
        sourceMessageId: input.sourceMessageId,
        conversationId: input.conversationId,
        receivedAt: input.receivedAt,
        committedAt: input.committedAt,
        occurredAtText: null,
        mealId: null,
        mealSlot: null,
        payload,
      }),
      items: Object.freeze([]),
      effects: Object.freeze([
        Object.freeze({
          outboxId: deriveDomainId("outbox", input.idempotencyKey, 0),
          effectId: deriveDomainId("effect", input.idempotencyKey, 0),
          effectKind: "daily_progress_replacement",
          previousState: null,
          reason: null,
        }),
      ]),
      progressReservations,
    }),
  });
}

function changed(database: DatabaseSync): number {
  return Number((database.prepare("SELECT changes() AS count").get() as { count: number }).count);
}

function parseCorrectionCanonical(value: string, reason: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return invalid(reason);
  }
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
    canonicalJson(parsed) !== value
  ) return invalid(reason);
  return parsed as Record<string, unknown>;
}

interface WaterOutboxRow {
  readonly effect_id: string;
  readonly effect_kind: string;
  readonly state: string;
}

function claimWaterOutboxes(
  database: DatabaseSync,
  input: ApplyCorrectionEffectsInput,
  outboxes: readonly WaterOutboxRow[],
): void {
  if (
    outboxes.length === 0 || outboxes.some((outbox) =>
      outbox.state !== "pending" && outbox.state !== "retryable_failed")
  ) {
    throw new Error("CORRECTION_EFFECT_INVALID:claim_state");
  }
  for (const outbox of outboxes) {
    assertEffectTransition(outbox.state as EffectState, "processing");
    database.prepare(
      `UPDATE effect_outbox SET state = 'processing', attempt_count = attempt_count + 1,
         reason = NULL, updated_at = ?
       WHERE envelope_id = ? AND operation_id = ? AND effect_id = ? AND state = ?`,
    ).run(
      input.now,
      input.envelopeId,
      input.operationId,
      outbox.effect_id,
      outbox.state,
    );
    if (changed(database) !== 1) throw new Error("CORRECTION_EFFECT_INVALID:claim_cas");
  }
}

function finalizeWaterOutboxes(
  database: DatabaseSync,
  input: ApplyCorrectionEffectsInput,
  outboxes: readonly WaterOutboxRow[],
): void {
  for (const outbox of outboxes) {
    assertEffectTransition("processing", "succeeded");
    database.prepare(
      `UPDATE effect_outbox SET state = 'succeeded', reason = NULL, updated_at = ?
       WHERE envelope_id = ? AND operation_id = ? AND effect_id = ? AND state = 'processing'`,
    ).run(
      input.now,
      input.envelopeId,
      input.operationId,
      outbox.effect_id,
    );
    if (changed(database) !== 1) throw new Error("CORRECTION_EFFECT_INVALID:terminal_cas");
  }
}

/**
 * 应用白水分类纠正的效果（单事务）：仅 1 条 daily_progress_replacement 效果、零库存补偿。
 * 复用 readAppliedCorrectionResult 作为终态回读，避免结果字段漂移。
 */
export function applyWaterClassificationEffects(
  input: ApplyCorrectionEffectsInput,
): CorrectionOperationResult {
  let transactionOpen = false;
  try {
    input.database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    assertCurrentMigrationAuthority(input.database);
    const checkpoint = input.database.prepare(
      `SELECT operation_id, effect_state, result_status, completed_at, payload_json
       FROM effect_bundle_commits
       WHERE envelope_id = ? AND operation_id = ?`,
    ).get(input.envelopeId, input.operationId) as {
      operation_id: string;
      effect_state: string;
      result_status: string;
      completed_at: string | null;
      payload_json: string;
    } | undefined;
    if (
      checkpoint?.operation_id === input.operationId &&
      checkpoint.completed_at !== null &&
      ((checkpoint.effect_state === "succeeded" && checkpoint.result_status === "applied") ||
        (checkpoint.effect_state === "permanent_business_skip" &&
          checkpoint.result_status === "applied_with_issues"))
    ) {
      const replay = readAppliedCorrectionResult(input);
      input.database.exec("ROLLBACK");
      transactionOpen = false;
      return replay;
    }
    if (
      !checkpoint || checkpoint.operation_id !== input.operationId ||
      checkpoint.effect_state !== "pending" ||
      checkpoint.result_status !== "facts_committed_effects_pending" ||
      checkpoint.completed_at !== null
    ) {
      throw new Error("CORRECTION_EFFECT_INVALID:checkpoint");
    }
    const checkpointPayload = parseCorrectionCanonical(checkpoint.payload_json, "checkpoint");
    const outboxes = input.database.prepare(
      `SELECT effect_id, effect_kind, state FROM effect_outbox
       WHERE envelope_id = ? AND operation_id = ? ORDER BY effect_id`,
    ).all(input.envelopeId, input.operationId) as unknown as WaterOutboxRow[];
    const expectedEffectId = deriveDomainId("effect", input.idempotencyKey, 0);
    if (
      Object.keys(checkpointPayload).sort().join("\u0000") !==
        ["authority_kind", "data_revision", "effects", "operation_sequence"].sort().join("\u0000") ||
      checkpointPayload.authority_kind !== "diet-manager/effect-bundle-checkpoint/v1" ||
      checkpointPayload.operation_sequence !== input.operationSequence ||
      typeof checkpointPayload.data_revision !== "string" ||
      !checkpointPayload.data_revision.startsWith("repository-v1:") ||
      checkpointPayload.data_revision !== computeRepositoryDataRevision(input.database) ||
      !Array.isArray(checkpointPayload.effects) ||
      checkpointPayload.effects.length !== 1 ||
      outboxes.length !== 1 ||
      outboxes[0]!.effect_id !== expectedEffectId ||
      outboxes[0]!.effect_kind !== "daily_progress_replacement" ||
      (outboxes[0]!.state !== "pending" && outboxes[0]!.state !== "retryable_failed") ||
      (checkpointPayload.effects[0] as Record<string, unknown>).effect_id !== expectedEffectId ||
      (checkpointPayload.effects[0] as Record<string, unknown>).state !== "pending"
    ) {
      if (checkpointPayload.data_revision !== computeRepositoryDataRevision(input.database)) {
        throw new Error("PREVIEW_STALE:data_revision");
      }
      throw new Error("CORRECTION_EFFECT_INVALID:checkpoint_payload");
    }
    const correctionFact = input.database.prepare(
      "SELECT payload_json FROM correction_events WHERE request_id = ?",
    ).get(input.operationId) as { payload_json: string } | undefined;
    if (!correctionFact) throw new Error("CORRECTION_EFFECT_INVALID:fact");
    const factPayload = parseCorrectionCanonical(correctionFact.payload_json, "fact");
    const reservations = reservationsFromEventPayload(
      factPayload,
      "diet_correction",
    ) as readonly ReplacementProgressReservation[];
    if (reservations.length !== 1) throw new Error("CORRECTION_EFFECT_INVALID:reservation");
    const reservation = reservations[0]!;

    claimWaterOutboxes(input.database, input, outboxes);
    finalizeWaterOutboxes(input.database, input, outboxes);
    input.database.prepare(
      `UPDATE effect_bundle_commits SET effect_state = 'succeeded', result_status = 'applied',
         completed_at = ?, payload_json = ?
       WHERE envelope_id = ? AND operation_id = ? AND effect_state = 'pending'`,
    ).run(
      input.now,
      canonicalJson({
        authority_kind: "diet-manager/effect-bundle/v1",
        data_revision: computeRepositoryDataRevision(input.database),
        effects: Object.freeze([
          Object.freeze({
            delta: Object.freeze({ after: reservation.after, before: reservation.before }),
            effect_id: expectedEffectId,
            replacement: Object.freeze({
              date: reservation.date,
              timezone: reservation.timezone,
              coverage_status: reservation.reserved_progress.coverage_status,
              nutrients: reservation.reserved_progress.nutrients,
            }),
            state: "succeeded",
          }),
        ]),
        operation_sequence: input.operationSequence,
      }),
      input.envelopeId,
      input.operationId,
    );
    if (changed(input.database) !== 1) throw new Error("CORRECTION_EFFECT_INVALID:bundle_cas");
    input.database.exec("COMMIT");
    transactionOpen = false;
    return readAppliedCorrectionResult(input);
  } catch (error) {
    if (transactionOpen) {
      try { input.database.exec("ROLLBACK"); } catch { /* preserve primary */ }
    }
    throw error;
  }
}

/** 白水分类纠正的终态回读：与通用纠正结果同构，直接复用共享回读。 */
export function readAppliedWaterClassificationResult(
  input: Omit<ApplyCorrectionEffectsInput, "now">,
): CorrectionOperationResult {
  return readAppliedCorrectionResult(input);
}
