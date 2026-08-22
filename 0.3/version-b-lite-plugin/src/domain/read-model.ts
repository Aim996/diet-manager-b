import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../authority/canonical-json.js";
import {
  listMealProjection,
  listInventoryProjection,
  summarizeDailyProgress,
  type InventoryListItem,
  type MealListItem,
} from "../repository/query.js";
import type { DomainQueryOperation } from "./types.js";
import {
  emptyConfiguredGoals,
  GOAL_FIELDS,
  type ConfiguredGoals,
} from "./goal-derivation.js";
import { toNaturalDate } from "./identity.js";
import {
  addProgressMetricStates,
  emptyProgressMetricState,
  progressStateFromNutrients,
  type ProgressMetricStateMap,
  type ProgressNutrientValues,
} from "./progress.js";

export interface InventoryQueryResult {
  readonly kind: "inventory";
  readonly batches: readonly InventoryListItem[];
}

export interface MealQueryResult {
  readonly kind: "meals";
  readonly date: string;
  readonly timezone: "Asia/Shanghai";
  readonly meals: readonly MealListItem[];
}

export interface DailySummaryQueryResult {
  readonly kind: "daily_summary";
  readonly date: string;
  readonly timezone: "Asia/Shanghai";
  readonly coverage_status: "complete" | "partial" | "unknown";
  readonly nutrients: {
    readonly energy_kcal_milli: number | null;
    readonly protein_mg: number | null;
    readonly fat_mg: number | null;
    readonly carbohydrate_mg: number | null;
    readonly fiber_mg: number | null;
    readonly water_ml_milli: number | null;
  };
}

export type DomainQueryResult =
  | InventoryQueryResult
  | MealQueryResult
  | DailySummaryQueryResult;

export interface EffectiveConfiguredGoals {
  readonly goal_version_id: string | null;
  readonly goals: Readonly<ConfiguredGoals>;
}

const PROGRESS_NUTRIENT_FIELDS = Object.freeze([
  "energy_kcal_milli",
  "protein_mg",
  "fat_mg",
  "carbohydrate_mg",
  "fiber_mg",
  "water_ml_milli",
] as const);

function progressAuthorityInvalid(reason: string): never {
  throw new Error(`READ_MODEL_INVALID:progress_${reason}`);
}

function canonicalProgressRecord(value: string, reason: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch {
    return progressAuthorityInvalid(`${reason}_json`);
  }
  if (canonicalJson(parsed) !== value || typeof parsed !== "object" || parsed === null ||
      Array.isArray(parsed)) return progressAuthorityInvalid(`${reason}_canonical`);
  return parsed as Record<string, unknown>;
}

function progressNutrients(value: unknown, reason: string): ProgressNutrientValues {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return progressAuthorityInvalid(reason);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\0") !== [...PROGRESS_NUTRIENT_FIELDS].sort().join("\0")) {
    return progressAuthorityInvalid(reason);
  }
  const result = {} as Record<(typeof PROGRESS_NUTRIENT_FIELDS)[number], number | null>;
  for (const field of PROGRESS_NUTRIENT_FIELDS) {
    const candidate = record[field];
    if (candidate !== null && (!Number.isSafeInteger(candidate) || Number(candidate) < 0)) {
      return progressAuthorityInvalid(reason);
    }
    result[field] = candidate as number | null;
  }
  return Object.freeze(result);
}

interface EffectiveProgressCorrection {
  readonly allowed_ids: ReadonlySet<string>;
  readonly latest_payload: Readonly<Record<string, unknown>> | null;
}

function effectiveProgressCorrections(
  database: DatabaseSync,
  targetEventId: string,
  includeEnvelopeId: string,
): EffectiveProgressCorrection {
  const rows = database.prepare(
    `SELECT c.correction_id, c.base_revision, c.payload_json
     FROM correction_events c
     JOIN event_records e ON e.operation_id = c.request_id
       AND e.event_type IN ('diet_correction','nutrition_supplemented')
     JOIN effect_bundle_commits b
       ON b.envelope_id = e.envelope_id AND b.operation_id = e.operation_id
     WHERE c.target_event_id = ?
       AND ((b.effect_state = 'succeeded' AND b.result_status = 'applied') OR
            (b.effect_state = 'permanent_business_skip' AND b.result_status = 'applied_with_issues'))
       AND (e.envelope_id = ? OR EXISTS (
         SELECT 1 FROM envelope_finalizations f WHERE f.envelope_id = e.envelope_id
       ))
     ORDER BY c.base_revision, c.correction_id`,
  ).all(targetEventId, includeEnvelopeId) as Array<{
    correction_id: string;
    base_revision: number;
    payload_json: string;
  }>;
  const allowed = new Set<string>();
  let latest: Readonly<Record<string, unknown>> | null = null;
  let previousRevision = 0;
  for (const row of rows) {
    const payload = canonicalProgressRecord(row.payload_json, "correction");
    if (!Number.isSafeInteger(row.base_revision) || row.base_revision <= previousRevision ||
        payload.authority_kind !== "diet-manager/correction-fact/v1" ||
        payload.correction_id !== row.correction_id || payload.target_event_id !== targetEventId ||
        typeof payload.after_snapshot !== "object" || payload.after_snapshot === null ||
        Array.isArray(payload.after_snapshot)) return progressAuthorityInvalid("correction");
    previousRevision = row.base_revision;
    allowed.add(row.correction_id);
    latest = payload;
  }
  return Object.freeze({ allowed_ids: allowed, latest_payload: latest });
}

function effectiveItemNutrients(
  database: DatabaseSync,
  itemId: string,
  allowedCorrectionIds: ReadonlySet<string>,
): ProgressNutrientValues {
  const rows = database.prepare(
    `SELECT payload_json FROM nutrition_snapshots
     WHERE intake_item_id = ? AND schema_version = 'domain/v2' ORDER BY rowid DESC`,
  ).all(itemId) as Array<{ payload_json: string }>;
  for (const row of rows) {
    const payload = canonicalProgressRecord(row.payload_json, "nutrition_snapshot");
    if (payload.authority_kind !== "diet-manager/nutrition-snapshot/v1") {
      return progressAuthorityInvalid("nutrition_snapshot");
    }
    const correctionId = payload.correction_id;
    if (correctionId !== undefined &&
        (typeof correctionId !== "string" || !allowedCorrectionIds.has(correctionId))) continue;
    return progressNutrients(payload.nutrients, "nutrition_snapshot");
  }
  return progressAuthorityInvalid("nutrition_snapshot_missing");
}

function plainWaterProgress(waterMlMilli: number, source: string): ProgressMetricStateMap {
  if (!Number.isSafeInteger(waterMlMilli) || waterMlMilli < 0) {
    return progressAuthorityInvalid("water");
  }
  return progressStateFromNutrients(Object.freeze({
    energy_kcal_milli: 0,
    protein_mg: 0,
    fat_mg: 0,
    carbohydrate_mg: 0,
    fiber_mg: 0,
    water_ml_milli: waterMlMilli,
  }), source);
}

/**
 * Rebuild the six-metric state from terminal, effective facts and per-item
 * nutrition snapshots. `includeEnvelopeId` is used only by the finalizer so
 * the currently-terminal envelope participates before its finalization row exists.
 */
export function readEffectiveDailyProgressState(
  database: DatabaseSync,
  date: string,
  includeEnvelopeId?: string,
): Readonly<ProgressMetricStateMap> {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return progressAuthorityInvalid("date");
  const currentEnvelope = includeEnvelopeId ?? "";
  if (includeEnvelopeId !== undefined &&
      (includeEnvelopeId.length === 0 || includeEnvelopeId.length > 256)) {
    return progressAuthorityInvalid("envelope");
  }
  const rows = database.prepare(
    `SELECT e.event_id, e.event_type, e.occurred_at_text, e.payload_json
     FROM event_records e
     JOIN effect_bundle_commits b
       ON b.envelope_id = e.envelope_id AND b.operation_id = e.operation_id
     WHERE e.event_type IN ('diet_meal','diet_water') AND e.lifecycle_status = 'active'
       AND ((b.effect_state = 'succeeded' AND b.result_status = 'applied') OR
            (b.effect_state = 'permanent_business_skip' AND b.result_status = 'applied_with_issues'))
       AND (e.envelope_id = ? OR EXISTS (
         SELECT 1 FROM envelope_finalizations f WHERE f.envelope_id = e.envelope_id
       ))
     ORDER BY e.event_id`,
  ).all(currentEnvelope) as Array<{
    event_id: string;
    event_type: "diet_meal" | "diet_water";
    occurred_at_text: string | null;
    payload_json: string;
  }>;
  let state = emptyProgressMetricState();
  for (const row of rows) {
    const corrections = effectiveProgressCorrections(database, row.event_id, currentEnvelope);
    const latest = corrections.latest_payload;
    if (row.event_type === "diet_meal") {
      let active = true;
      let occurredAt = row.occurred_at_text;
      let itemIds: readonly string[];
      if (latest === null) {
        itemIds = Object.freeze((database.prepare(
          "SELECT item_id FROM meal_items WHERE event_id = ? ORDER BY item_order",
        ).all(row.event_id) as Array<{ item_id: string }>).map(({ item_id }) => item_id));
      } else {
        const snapshot = latest.after_snapshot as Record<string, unknown>;
        if (typeof snapshot.active !== "boolean" || typeof snapshot.occurred_at !== "string" ||
            snapshot.timezone !== "Asia/Shanghai" || !Array.isArray(snapshot.items)) {
          return progressAuthorityInvalid("meal_snapshot");
        }
        active = snapshot.active;
        occurredAt = snapshot.occurred_at;
        itemIds = Object.freeze(snapshot.items.map((candidate) => {
          if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate) ||
              typeof (candidate as Record<string, unknown>).item_id !== "string") {
            return progressAuthorityInvalid("meal_item");
          }
          return (candidate as Record<string, unknown>).item_id as string;
        }));
      }
      if (!active) continue;
      if (occurredAt === null || !Number.isFinite(Date.parse(occurredAt)) ||
          itemIds.length === 0 || itemIds.length > 256) {
        return progressAuthorityInvalid("meal_snapshot");
      }
      if (toNaturalDate(new Date(occurredAt).toISOString(), "Asia/Shanghai") !== date) continue;
      for (const itemId of itemIds) {
        state = addProgressMetricStates(state, progressStateFromNutrients(
          effectiveItemNutrients(database, itemId, corrections.allowed_ids),
          `item:${itemId}`,
        ));
      }
      continue;
    }

    const eventPayload = canonicalProgressRecord(row.payload_json, "water_event");
    if (eventPayload.authority_kind !== "diet-manager/water-fact/v1" ||
        !Number.isSafeInteger(eventPayload.plain_water_ml_milli) ||
        Number(eventPayload.plain_water_ml_milli) <= 0) return progressAuthorityInvalid("water_event");
    let active = true;
    let occurredAt = row.occurred_at_text;
    let classification: "plain_water" | "nutritious_drink" = "plain_water";
    let waterMlMilli = Number(eventPayload.plain_water_ml_milli);
    let nutritiousNutrients: ProgressNutrientValues | null = null;
    if (latest !== null) {
      const snapshot = latest.after_snapshot as Record<string, unknown>;
      if (typeof snapshot.active !== "boolean" || typeof snapshot.occurred_at !== "string" ||
          (snapshot.classification !== "plain_water" && snapshot.classification !== "nutritious_drink") ||
          !Number.isSafeInteger(snapshot.plain_water_ml_milli)) {
        return progressAuthorityInvalid("water_snapshot");
      }
      active = snapshot.active;
      occurredAt = snapshot.occurred_at;
      classification = snapshot.classification;
      waterMlMilli = Number(snapshot.plain_water_ml_milli);
      if (classification === "nutritious_drink") {
        nutritiousNutrients = progressNutrients(snapshot.nutrients, "water_snapshot");
      }
    }
    if (!active || occurredAt === null || !Number.isFinite(Date.parse(occurredAt)) ||
        toNaturalDate(new Date(occurredAt).toISOString(), "Asia/Shanghai") !== date) continue;
    state = addProgressMetricStates(state, classification === "plain_water"
      ? plainWaterProgress(waterMlMilli, `water:${row.event_id}`)
      : progressStateFromNutrients(
          nutritiousNutrients ?? progressAuthorityInvalid("water_snapshot"),
          `water:${row.event_id}`,
        ));
  }
  return Object.freeze(state);
}

export function readEffectiveConfiguredGoals(
  database: DatabaseSync,
  userId: string,
  effectiveAt: string,
): EffectiveConfiguredGoals {
  if (!Number.isFinite(Date.parse(effectiveAt))) {
    throw new Error("READ_MODEL_INVALID:goal_effective_at");
  }
  const row = database.prepare(
    `SELECT goal_version_id, payload_json FROM goal_versions
     WHERE user_id = ? AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to > ?)
     ORDER BY effective_from DESC LIMIT 1`,
  ).get(userId, effectiveAt, effectiveAt) as {
    goal_version_id: string;
    payload_json: string;
  } | undefined;
  if (row === undefined) {
    return Object.freeze({ goal_version_id: null, goals: emptyConfiguredGoals() });
  }
  let payload: unknown;
  try { payload = JSON.parse(row.payload_json) as unknown; } catch {
    throw new Error("READ_MODEL_INVALID:goal_payload");
  }
  if (canonicalJson(payload) !== row.payload_json || typeof payload !== "object" ||
      payload === null || Array.isArray(payload)) {
    throw new Error("READ_MODEL_INVALID:goal_payload");
  }
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).sort().join("\0") !== "authority_kind\0goals" ||
      record.authority_kind !== "diet-manager/goal-version/v1" ||
      typeof record.goals !== "object" || record.goals === null || Array.isArray(record.goals)) {
    throw new Error("READ_MODEL_INVALID:goal_payload");
  }
  const values = record.goals as Record<string, unknown>;
  if (Object.keys(values).sort().join("\0") !== [...GOAL_FIELDS].sort().join("\0")) {
    throw new Error("READ_MODEL_INVALID:goal_values");
  }
  const goals: Record<(typeof GOAL_FIELDS)[number], number | null> = {
    ...emptyConfiguredGoals(),
  };
  for (const field of GOAL_FIELDS) {
    const value = values[field];
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
      throw new Error("READ_MODEL_INVALID:goal_values");
    }
    goals[field] = value as number | null;
  }
  return Object.freeze({
    goal_version_id: row.goal_version_id,
    goals: Object.freeze(goals),
  });
}

export function queryDomainReadModel(
  database: DatabaseSync,
  authoritySecret: Uint8Array,
  operation: DomainQueryOperation,
): DomainQueryResult {
  if (operation.kind === "query_inventory") {
    return Object.freeze({
      kind: "inventory" as const,
      batches: listInventoryProjection({ authoritySecret, database }),
    });
  }
  if (operation.kind === "query_meals") {
    return Object.freeze({
      kind: "meals" as const,
      date: operation.date,
      timezone: operation.timezone,
      meals: listMealProjection({
        authoritySecret,
        database,
        date: operation.date,
        timezone: operation.timezone,
      }),
    });
  }
  const summary = summarizeDailyProgress({
    authoritySecret,
    database,
    date: operation.date,
    timezone: operation.timezone,
  });
  return Object.freeze({
    kind: "daily_summary" as const,
    date: operation.date,
    timezone: operation.timezone,
    coverage_status: summary.coverage_status,
    nutrients: summary.nutrients,
  });
}
