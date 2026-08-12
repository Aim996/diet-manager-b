import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../authority/canonical-json.js";
import {
  dietManagerActions,
  type DietManagerAction,
} from "../contracts.js";
import { authorizeRepositoryPreview } from "../preview/store.js";
import { deriveDomainId } from "../domain/identity.js";
import {
  freezeQuickPrompt,
  rebaseReceiptProgress,
  type QuickPrompt,
  type ReceiptData,
} from "../domain/receipt.js";
import { assertEnvelopeTransition } from "../state/transition-guard.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";

const INPUT_FIELDS = [
  "commandType",
  "dataRevision",
  "database",
  "finalizedAt",
  "frozenAt",
  "inputDigest",
  "mixedItems",
  "payload",
  "receiptId",
  "resultStatus",
  "secret",
  "subjectScope",
  "token",
  "traceId",
] as const;

const MIXED_ITEM_FIELDS = [
  "command_type",
  "error_code",
  "idempotency_key",
  "operation_id",
  "payload",
  "sequence",
  "status",
] as const;

export interface FinalizeEnvelopeInput {
  database: DatabaseSync;
  secret: Uint8Array;
  token: string;
  inputDigest: string;
  subjectScope: string;
  commandType: DietManagerAction;
  dataRevision: string;
  traceId: string;
  resultStatus: "committed" | "committed_with_issues";
  receiptId: string;
  finalizedAt: string;
  frozenAt: string;
  payload: unknown;
  mixedItems: readonly PreparedMixedItemResult[];
}

export interface PreparedMixedItemResult {
  sequence: number;
  operation_id: string;
  idempotency_key: string;
  command_type: DietManagerAction;
  status: "committed" | "committed_with_issues" | "failed";
  error_code: string | null;
  payload: unknown;
}

export type EnvelopeFinalizeFault =
  | "after_finalization_row"
  | "after_envelope"
  | "after_idempotency"
  | "before_commit"
  | "after_commit_before_reply";

export interface EnvelopeFinalizeOptions {
  fault?: EnvelopeFinalizeFault;
}

export interface FinalizedEnvelopeResult {
  envelope_id: string;
  idempotency_key: string;
  input_digest: string;
  envelope_state: "finalized";
  result_status: "committed" | "committed_with_issues";
  receipt_id: string;
  finalized_at: string;
  frozen_at: string;
  payload: unknown;
}

interface FrozenMixedItemResult extends Omit<PreparedMixedItemResult, "payload"> {
  payloadJson: string;
}

interface FrozenInput
  extends Omit<FinalizeEnvelopeInput, "mixedItems" | "payload" | "secret"> {
  secret: Uint8Array;
  payloadJson: string;
  payload: unknown;
  mixedItems: readonly FrozenMixedItemResult[];
}

interface FinalizationRow {
  envelope_id: string;
  idempotency_key: string;
  input_digest: string;
  envelope_state: string;
  result_status: string;
  stage: string;
  receipt_id: string | null;
  error_code: string | null;
  finalized_at: string | null;
  frozen_at: string | null;
  payload_json: string;
  terminal_result_json: string | null;
}

interface MixedItemRow {
  envelope_id: string;
  sequence: number;
  operation_id: string;
  idempotency_key: string;
  command_type: string;
  status: string;
  error_code: string | null;
  payload_json: string;
}

const DAILY_NUTRIENT_FIELDS = [
  "energy_kcal_milli",
  "protein_mg",
  "fat_mg",
  "carbohydrate_mg",
  "fiber_mg",
  "water_ml_milli",
] as const;

interface FrozenDailyProgress {
  readonly date: string;
  readonly timezone: "Asia/Shanghai";
  readonly coverage_status: "complete" | "partial";
  readonly nutrients: Readonly<Record<(typeof DAILY_NUTRIENT_FIELDS)[number], number | null>>;
}

function invalid(reason: string): never {
  throw new TypeError(`ENVELOPE_FINALIZE_REQUEST_INVALID:${reason}`);
}

function authorityInvalid(reason: string): never {
  throw new Error(`ENVELOPE_FINALIZE_AUTHORITY_INVALID:${reason}`);
}

function exactDataProperties<T extends readonly string[]>(
  value: unknown,
  fields: T,
): Record<T[number], PropertyDescriptor & { value: unknown }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("shape");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\u0000") !== [...fields].sort().join("\u0000")
  ) {
    return invalid("shape");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return invalid("descriptor");
    }
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid("prototype");
  return descriptors as Record<T[number], PropertyDescriptor & { value: unknown }>;
}

function ascii(value: unknown, field: string, maxLength = 256): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    !/^[\x20-\x7E]+$/.test(value)
  ) {
    return invalid(field);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string") return invalid(field);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    return invalid(field);
  }
  return value;
}

function deepFreezeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeJson(item);
    return Object.freeze(value);
  }
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreezeJson(child);
    return Object.freeze(value);
  }
  return value;
}

function plainRecord(value: unknown, fields: readonly string[], reason: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return authorityInvalid(reason);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
    return authorityInvalid(reason);
  }
  return record;
}

function parseDailyProgress(value: unknown, reason: string): FrozenDailyProgress {
  const progress = plainRecord(
    value,
    ["coverage_status", "date", "nutrients", "timezone"],
    reason,
  );
  if (
    typeof progress.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(progress.date) ||
    progress.timezone !== "Asia/Shanghai" ||
    (progress.coverage_status !== "complete" && progress.coverage_status !== "partial")
  ) return authorityInvalid(reason);
  const nutrients = plainRecord(progress.nutrients, DAILY_NUTRIENT_FIELDS, reason);
  const frozenNutrients = {} as Record<(typeof DAILY_NUTRIENT_FIELDS)[number], number | null>;
  for (const field of DAILY_NUTRIENT_FIELDS) {
    const candidate = nutrients[field];
    if (candidate !== null && (!Number.isSafeInteger(candidate) || (candidate as number) < 0)) {
      return authorityInvalid(reason);
    }
    frozenNutrients[field] = candidate as number | null;
  }
  return Object.freeze({
    date: progress.date,
    timezone: "Asia/Shanghai",
    coverage_status: progress.coverage_status,
    nutrients: Object.freeze(frozenNutrients),
  });
}

function addDailyProgress(
  previous: FrozenDailyProgress | null,
  contribution: FrozenDailyProgress,
): FrozenDailyProgress {
  if (
    previous !== null &&
    (previous.date !== contribution.date || previous.timezone !== contribution.timezone)
  ) return authorityInvalid("daily_progress_date");
  const nutrients = {} as Record<(typeof DAILY_NUTRIENT_FIELDS)[number], number | null>;
  for (const field of DAILY_NUTRIENT_FIELDS) {
    const left = previous === null ? 0 : previous.nutrients[field];
    const right = contribution.nutrients[field];
    if (left === null || right === null) {
      nutrients[field] = null;
      continue;
    }
    const sum = left + right;
    if (!Number.isSafeInteger(sum)) return authorityInvalid("daily_progress_sum");
    nutrients[field] = sum;
  }
  return Object.freeze({
    date: contribution.date,
    timezone: contribution.timezone,
    coverage_status: Object.values(nutrients).every((value) => value !== null)
      ? "complete"
      : "partial",
    nutrients: Object.freeze(nutrients),
  });
}

function nextProgressGeneratedAt(
  database: DatabaseSync,
  date: string,
  timezone: string,
  baseTimestamp: string,
  previousTimestamp: string | null,
): string {
  const base = Date.parse(baseTimestamp);
  if (!Number.isFinite(base)) return authorityInvalid("daily_progress_timestamp");
  const previous = previousTimestamp === null ? null : Date.parse(previousTimestamp);
  if (
    previousTimestamp !== null &&
    (!Number.isFinite(previous) || new Date(previous as number).toISOString() !== previousTimestamp)
  ) return authorityInvalid("daily_progress_timestamp");
  const firstCandidate = previous === null ? base : Math.max(base, previous + 1);
  const occupied = new Set((database.prepare(
    "SELECT generated_at FROM daily_progress_snapshots WHERE date = ? AND timezone = ?",
  ).all(date, timezone) as Array<{ generated_at: string }>).map((row) => row.generated_at));
  for (let offset = 0; offset <= occupied.size; offset += 1) {
    const candidate = new Date(firstCandidate + offset).toISOString();
    if (!occupied.has(candidate)) return candidate;
  }
  return authorityInvalid("daily_progress_timestamp");
}

function freezeMealDailyProgress(
  input: FrozenInput,
  envelopeId: string,
  idempotencyKey: string,
): FrozenInput {
  if (input.commandType !== "record_meal") return input;
  if (typeof input.payload !== "object" || input.payload === null || Array.isArray(input.payload)) return input;
  const execution = input.payload as Record<string, unknown>;
  if (typeof execution.payload !== "object" || execution.payload === null || Array.isArray(execution.payload)) {
    return input;
  }
  const domainPayload = execution.payload as Record<string, unknown>;
  if (domainPayload.authority_kind !== "diet-manager/domain-execution/v1") return input;
  plainRecord(execution, ["envelope_id", "input_digest", "items", "payload", "status"], "daily_progress_execution");
  plainRecord(
    domainPayload,
    ["authority_kind", "daily_progress", "daily_progress_by_date", "quick_prompts", "receipt_data"],
    "daily_progress_payload",
  );
  const contribution = parseDailyProgress(domainPayload.daily_progress, "daily_progress_contribution");
  if (
    !Array.isArray(domainPayload.daily_progress_by_date) ||
    domainPayload.daily_progress_by_date.length !== 1 ||
    canonicalJson(domainPayload.daily_progress_by_date[0]) !== canonicalJson(contribution)
  ) return authorityInvalid("daily_progress_by_date");
  if (!Array.isArray(domainPayload.quick_prompts) || domainPayload.quick_prompts.length > 256) {
    return authorityInvalid("quick_prompts");
  }
  let quickPrompts: readonly QuickPrompt[];
  try {
    quickPrompts = Object.freeze(domainPayload.quick_prompts.map(freezeQuickPrompt));
  } catch {
    return authorityInvalid("quick_prompts");
  }
  const issueRows = input.database.prepare(
    `SELECT i.issue_id, i.issue_code, i.revision, i.detected_at, i.status
     FROM issues i
     JOIN meal_items m ON m.item_id = i.entity_id
     JOIN event_records e ON e.event_id = m.event_id
     WHERE e.envelope_id = ?
     ORDER BY m.item_order, i.issue_id`,
  ).all(envelopeId) as Array<{
    issue_id: string;
    issue_code: string;
    revision: number;
    detected_at: string;
    status: string;
  }>;
  if (
    issueRows.length !== quickPrompts.length ||
    issueRows.some((row, index) => {
      const prompt = quickPrompts[index];
      return row.issue_id !== prompt.issue_id || row.issue_code !== prompt.issue_code ||
        row.revision !== prompt.generated_from_revision || row.detected_at !== prompt.generated_at ||
        row.status !== "open";
    })
  ) return authorityInvalid("quick_prompt_authority");
  if (
    typeof domainPayload.receipt_data !== "object" ||
    domainPayload.receipt_data === null ||
    Array.isArray(domainPayload.receipt_data)
  ) return authorityInvalid("receipt_data");
  const receipt = domainPayload.receipt_data as ReceiptData;
  const receiptProgress = receipt.blocks?.at(-1);
  if (
    receiptProgress?.kind !== "progress" ||
    canonicalJson(receiptProgress.daily_progress) !== canonicalJson(contribution)
  ) return authorityInvalid("receipt_progress");

  const bundles = input.database.prepare(
    `SELECT operation_id, effect_state, result_status, completed_at, payload_json
     FROM effect_bundle_commits WHERE envelope_id = ? ORDER BY operation_id`,
  ).all(envelopeId) as Array<{
    operation_id: string;
    effect_state: string;
    result_status: string;
    completed_at: string | null;
    payload_json: string;
  }>;
  if (bundles.length !== 1) return authorityInvalid("daily_progress_bundle");
  const bundle = bundles[0];
  if (
    !bundle || bundle.completed_at === null ||
    (bundle.effect_state !== "succeeded" && bundle.effect_state !== "permanent_business_skip") ||
    (bundle.result_status !== "applied" && bundle.result_status !== "applied_with_issues")
  ) return authorityInvalid("daily_progress_bundle");
  let bundleValue: unknown;
  try {
    bundleValue = JSON.parse(bundle.payload_json) as unknown;
  } catch {
    return authorityInvalid("daily_progress_bundle");
  }
  if (canonicalJson(bundleValue) !== bundle.payload_json) return authorityInvalid("daily_progress_bundle");
  const bundlePayload = plainRecord(
    bundleValue,
    ["authority_kind", "data_revision", "effects", "operation_sequence"],
    "daily_progress_bundle",
  );
  if (
    bundlePayload.authority_kind !== "diet-manager/effect-bundle/v1" ||
    typeof bundlePayload.data_revision !== "string" ||
    !bundlePayload.data_revision.startsWith("repository-v1:") ||
    bundlePayload.operation_sequence !== 0 ||
    !Array.isArray(bundlePayload.effects)
  ) {
    return authorityInvalid("daily_progress_bundle");
  }
  const outboxes = input.database.prepare(
    `SELECT effect_id, effect_kind, state FROM effect_outbox
     WHERE envelope_id = ? AND operation_id = ? ORDER BY effect_id`,
  ).all(envelopeId, bundle.operation_id) as Array<{
    effect_id: string;
    effect_kind: string;
    state: string;
  }>;
  if (
    bundlePayload.effects.length !== outboxes.length ||
    outboxes.length === 0 ||
    new Set(outboxes.map((outbox) => outbox.effect_id)).size !== outboxes.length
  ) return authorityInvalid("daily_progress_bundle");
  let boundContribution: FrozenDailyProgress | null = null;
  for (let index = 0; index < outboxes.length; index += 1) {
    const outbox = outboxes[index];
    const progressEffect = outbox.effect_kind === "daily_progress_contribution";
    const effect = plainRecord(
      bundlePayload.effects[index],
      progressEffect ? ["contribution", "effect_id", "state"] : ["effect_id", "state"],
      "daily_progress_bundle_effect",
    );
    if (
      effect.effect_id !== outbox.effect_id ||
      effect.state !== outbox.state ||
      (outbox.state !== "succeeded" && outbox.state !== "permanent_business_skip")
    ) return authorityInvalid("daily_progress_bundle");
    if (progressEffect) {
      if (outbox.state !== "succeeded" || boundContribution !== null) {
        return authorityInvalid("daily_progress_bundle");
      }
      boundContribution = parseDailyProgress(effect.contribution, "daily_progress_bundle");
    }
  }
  if (
    boundContribution === null ||
    canonicalJson(boundContribution) !== canonicalJson(contribution)
  ) return authorityInvalid("daily_progress_bundle");

  const previousRow = input.database.prepare(
    `SELECT generated_at, payload_json FROM daily_progress_snapshots
     WHERE date = ? AND timezone = ?
     ORDER BY generated_at DESC, progress_snapshot_id DESC LIMIT 1`,
  ).get(contribution.date, contribution.timezone) as {
    generated_at: string;
    payload_json: string;
  } | undefined;
  let previous: FrozenDailyProgress | null = null;
  if (previousRow) {
    let value: unknown;
    try {
      value = JSON.parse(previousRow.payload_json) as unknown;
    } catch {
      return authorityInvalid("daily_progress_previous");
    }
    if (canonicalJson(value) !== previousRow.payload_json) return authorityInvalid("daily_progress_previous");
    const record = plainRecord(
      value,
      ["authority_kind", "coverage_status", "date", "nutrients", "timezone"],
      "daily_progress_previous",
    );
    if (record.authority_kind !== "diet-manager/daily-progress/v1") {
      return authorityInvalid("daily_progress_previous");
    }
    previous = parseDailyProgress({
      coverage_status: record.coverage_status,
      date: record.date,
      nutrients: record.nutrients,
      timezone: record.timezone,
    }, "daily_progress_previous");
  }
  const cumulative = addDailyProgress(previous, contribution);
  const generatedAt = nextProgressGeneratedAt(
    input.database,
    cumulative.date,
    cumulative.timezone,
    input.finalizedAt,
    previousRow?.generated_at ?? null,
  );
  input.database.prepare(
    `INSERT INTO daily_progress_snapshots(
      progress_snapshot_id, idempotency_result_id, date, timezone,
      goal_version_id, coverage_status, generated_at, payload_json
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    deriveDomainId("progress", idempotencyKey, 0),
    idempotencyKey,
    cumulative.date,
    cumulative.timezone,
    cumulative.coverage_status,
    generatedAt,
    canonicalJson({ authority_kind: "diet-manager/daily-progress/v1", ...cumulative }),
  );
  const finalExecution = {
    ...execution,
    payload: {
      authority_kind: "diet-manager/domain-execution/v1",
      daily_progress: cumulative,
      daily_progress_by_date: [cumulative],
      quick_prompts: quickPrompts,
      receipt_data: rebaseReceiptProgress(receipt, cumulative),
    },
  };
  const payloadJson = canonicalJson(finalExecution);
  return Object.freeze({
    ...input,
    payloadJson,
    payload: deepFreezeJson(JSON.parse(payloadJson) as unknown),
  });
}

function freezeMixedItems(value: unknown): readonly FrozenMixedItemResult[] {
  if (!Array.isArray(value) || value.length > 256) return invalid("mixed_items");
  const items = value.map((candidate, index) => {
    if (!Object.hasOwn(value, index)) return invalid("mixed_items");
    const fields = exactDataProperties(candidate, MIXED_ITEM_FIELDS);
    if (fields.sequence.value !== index) return invalid("mixed_item_sequence");
    if (
      typeof fields.command_type.value !== "string" ||
      !dietManagerActions.includes(fields.command_type.value as DietManagerAction)
    ) {
      return invalid("mixed_item_command_type");
    }
    if (
      fields.status.value !== "committed" &&
      fields.status.value !== "committed_with_issues" &&
      fields.status.value !== "failed"
    ) {
      return invalid("mixed_item_status");
    }
    const errorCode =
      fields.error_code.value === null
        ? null
        : ascii(fields.error_code.value, "mixed_item_error_code", 128);
    if (
      (fields.status.value === "failed" && errorCode === null) ||
      (fields.status.value !== "failed" && errorCode !== null)
    ) {
      return invalid("mixed_item_error_code");
    }
    return Object.freeze({
      sequence: index,
      operation_id: ascii(fields.operation_id.value, "mixed_item_operation_id"),
      idempotency_key: ascii(fields.idempotency_key.value, "mixed_item_idempotency_key"),
      command_type: fields.command_type.value as DietManagerAction,
      status: fields.status.value,
      error_code: errorCode,
      payloadJson: canonicalJson(fields.payload.value),
    });
  });
  if (
    new Set(items.map((item) => item.operation_id)).size !== items.length ||
    new Set(items.map((item) => item.idempotency_key)).size !== items.length
  ) {
    return invalid("mixed_item_identity");
  }
  return Object.freeze(items);
}

function freezeInput(value: FinalizeEnvelopeInput): FrozenInput {
  const fields = exactDataProperties(value, INPUT_FIELDS);
  if (typeof fields.database.value !== "object" || fields.database.value === null) {
    return invalid("database");
  }
  if (!(fields.secret.value instanceof Uint8Array)) return invalid("secret");
  if (
    typeof fields.inputDigest.value !== "string" ||
    !/^[A-F0-9]{64}$/.test(fields.inputDigest.value)
  ) {
    return invalid("input_digest");
  }
  if (
    typeof fields.commandType.value !== "string" ||
    !dietManagerActions.includes(fields.commandType.value as DietManagerAction)
  ) {
    return invalid("command_type");
  }
  if (
    fields.resultStatus.value !== "committed" &&
    fields.resultStatus.value !== "committed_with_issues"
  ) {
    return invalid("result_status");
  }
  const payloadJson = canonicalJson(fields.payload.value);
  const payload = deepFreezeJson(JSON.parse(payloadJson) as unknown);
  return Object.freeze({
    database: fields.database.value as DatabaseSync,
    secret: Uint8Array.from(fields.secret.value),
    token: ascii(fields.token.value, "token", 4096),
    inputDigest: fields.inputDigest.value,
    subjectScope: ascii(fields.subjectScope.value, "subject_scope"),
    commandType: fields.commandType.value as DietManagerAction,
    dataRevision: ascii(fields.dataRevision.value, "data_revision"),
    traceId: ascii(fields.traceId.value, "trace_id"),
    resultStatus: fields.resultStatus.value,
    receiptId: ascii(fields.receiptId.value, "receipt_id"),
    finalizedAt: timestamp(fields.finalizedAt.value, "finalized_at"),
    frozenAt: timestamp(fields.frozenAt.value, "frozen_at"),
    payloadJson,
    payload,
    mixedItems: freezeMixedItems(fields.mixedItems.value),
  });
}

function freezeOptions(
  value: EnvelopeFinalizeOptions | undefined,
): Readonly<EnvelopeFinalizeOptions> {
  if (value === undefined) return Object.freeze({});
  const fields = exactDataProperties(value, ["fault"] as const);
  if (
    ![
      "after_finalization_row",
      "after_envelope",
      "after_idempotency",
      "before_commit",
      "after_commit_before_reply",
    ].includes(String(fields.fault.value))
  ) {
    return invalid("fault");
  }
  return Object.freeze({ fault: fields.fault.value });
}

function injectFault(
  options: Readonly<EnvelopeFinalizeOptions>,
  point: Exclude<EnvelopeFinalizeFault, "after_commit_before_reply">,
): void {
  if (options.fault === point) throw new Error(`ENVELOPE_FINALIZE_FAILED:${point}`);
}

function resultFor(
  input: FrozenInput,
  envelopeId: string,
  idempotencyKey: string,
): FinalizedEnvelopeResult {
  return Object.freeze({
    envelope_id: envelopeId,
    idempotency_key: idempotencyKey,
    input_digest: input.inputDigest,
    envelope_state: "finalized",
    result_status: input.resultStatus,
    receipt_id: input.receiptId,
    finalized_at: input.finalizedAt,
    frozen_at: input.frozenAt,
    payload: input.payload,
  });
}

function readFinalization(
  database: DatabaseSync,
  envelopeId: string,
): FinalizationRow | undefined {
  return database
    .prepare(
      `SELECT f.*, i.terminal_result_json
       FROM envelope_finalizations f
       JOIN idempotency_records i ON i.idempotency_key = f.idempotency_key
       WHERE f.envelope_id = ?`,
    )
    .get(envelopeId) as unknown as FinalizationRow | undefined;
}

function assertMixedOperationAuthority(input: FrozenInput, envelopeId: string): void {
  const events = input.database
    .prepare(
      `SELECT operation_id FROM event_records
       WHERE envelope_id = ?
       ORDER BY committed_at, event_id`,
    )
    .all(envelopeId) as Array<{ operation_id: string }>;
  if (input.mixedItems.length === 0) {
    if (events.length > 1) return authorityInvalid("mixed_item_operations");
    return;
  }
  if (
    events.length !== input.mixedItems.length ||
    events.some(
      (event, index) => event.operation_id !== input.mixedItems[index].operation_id,
    )
  ) {
    return authorityInvalid("mixed_item_operations");
  }
}

function assertMixedReplayRows(input: FrozenInput, envelopeId: string): void {
  const rows = input.database
    .prepare(
      `SELECT * FROM mixed_item_results
       WHERE envelope_id = ?
       ORDER BY sequence`,
    )
    .all(envelopeId) as unknown as MixedItemRow[];
  if (
    rows.length !== input.mixedItems.length ||
    rows.some((row, index) => {
      const expected = input.mixedItems[index];
      return (
        row.envelope_id !== envelopeId ||
        row.sequence !== expected.sequence ||
        row.operation_id !== expected.operation_id ||
        row.idempotency_key !== expected.idempotency_key ||
        row.command_type !== expected.command_type ||
        row.status !== expected.status ||
        row.error_code !== expected.error_code ||
        row.payload_json !== expected.payloadJson
      );
    })
  ) {
    throw new Error("IDEMPOTENCY_CONFLICT:mixed_items");
  }
}

function assertReplay(
  input: FrozenInput,
  envelopeId: string,
  idempotencyKey: string,
): FinalizedEnvelopeResult {
  const row = readFinalization(input.database, envelopeId);
  const expected = resultFor(input, envelopeId, idempotencyKey);
  if (
    !row ||
    row.idempotency_key !== idempotencyKey ||
    row.input_digest !== input.inputDigest ||
    row.envelope_state !== "finalized" ||
    row.result_status !== input.resultStatus ||
    row.stage !== "EnvelopeFinalize" ||
    row.receipt_id !== input.receiptId ||
    row.error_code !== null ||
    row.finalized_at !== input.finalizedAt ||
    row.frozen_at !== input.frozenAt ||
    row.payload_json !== input.payloadJson ||
    row.terminal_result_json !== canonicalJson(expected)
  ) {
    throw new Error("IDEMPOTENCY_CONFLICT:terminal_result");
  }
  assertMixedOperationAuthority(input, envelopeId);
  assertMixedReplayRows(input, envelopeId);
  return expected;
}

function changes(database: DatabaseSync): number {
  return (database.prepare("SELECT changes() AS count").get() as { count: number }).count;
}

export function finalizeEnvelope(
  input: FinalizeEnvelopeInput,
  options?: EnvelopeFinalizeOptions,
): FinalizedEnvelopeResult {
  const frozen = freezeInput(input);
  const frozenOptions = freezeOptions(options);
  let transactionOpen = false;
  let committed = false;
  try {
    frozen.database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    assertCurrentMigrationAuthority(frozen.database);
    const authority = authorizeRepositoryPreview({
      database: frozen.database,
      secret: frozen.secret,
      token: frozen.token,
      inputDigest: frozen.inputDigest,
      subjectScope: frozen.subjectScope,
      commandType: frozen.commandType,
      dataRevision: frozen.dataRevision,
    });
    if (authority.envelope_state === "finalized") {
      const replay = assertReplay(
        frozen,
        authority.binding.preview_id,
        authority.idempotency_key,
      );
      frozen.database.exec("ROLLBACK");
      transactionOpen = false;
      return replay;
    }
    if (authority.envelope_state !== "effects_stable") {
      return authorityInvalid("effects_not_stable");
    }

    const finalizedInput = freezeMealDailyProgress(
      frozen,
      authority.binding.preview_id,
      authority.idempotency_key,
    );
    const result = resultFor(
      finalizedInput,
      authority.binding.preview_id,
      authority.idempotency_key,
    );
    assertMixedOperationAuthority(finalizedInput, authority.binding.preview_id);
    finalizedInput.database
      .prepare(
        `INSERT INTO envelope_finalizations(
          envelope_id, idempotency_key, input_digest, envelope_state,
          result_status, stage, receipt_id, error_code, finalized_at,
          frozen_at, payload_json
        ) VALUES (?, ?, ?, 'finalized', ?, 'EnvelopeFinalize', ?, NULL, ?, ?, ?)`,
      )
      .run(
        authority.binding.preview_id,
        authority.idempotency_key,
        finalizedInput.inputDigest,
        finalizedInput.resultStatus,
        finalizedInput.receiptId,
        finalizedInput.finalizedAt,
        finalizedInput.frozenAt,
        finalizedInput.payloadJson,
      );
    injectFault(frozenOptions, "after_finalization_row");

    const insertMixedItem = finalizedInput.database.prepare(
      `INSERT INTO mixed_item_results(
        envelope_id, sequence, operation_id, idempotency_key,
        command_type, status, error_code, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of finalizedInput.mixedItems) {
      insertMixedItem.run(
        authority.binding.preview_id,
        item.sequence,
        item.operation_id,
        item.idempotency_key,
        item.command_type,
        item.status,
        item.error_code,
        item.payloadJson,
      );
    }

    assertEnvelopeTransition("effects_stable", "finalized");
    finalizedInput.database
      .prepare(
        `UPDATE command_envelopes
         SET state = 'finalized', result_status = ?
         WHERE envelope_id = ? AND state = 'effects_stable'
           AND result_status = 'effects_stable'`,
      )
      .run(finalizedInput.resultStatus, authority.binding.preview_id);
    if (changes(finalizedInput.database) !== 1) return authorityInvalid("envelope_compare_and_set");
    injectFault(frozenOptions, "after_envelope");

    finalizedInput.database
      .prepare(
        `UPDATE idempotency_records
         SET state = 'finalized', terminal_result_json = ?, updated_at = ?
         WHERE idempotency_key = ? AND operation_id = ? AND input_digest = ?
           AND state = 'effects_stable' AND terminal_result_json IS NULL`,
      )
      .run(
        canonicalJson(result),
        finalizedInput.finalizedAt,
        authority.idempotency_key,
        authority.binding.preview_id,
        finalizedInput.inputDigest,
      );
    if (changes(finalizedInput.database) !== 1) {
      return authorityInvalid("idempotency_compare_and_set");
    }
    injectFault(frozenOptions, "after_idempotency");
    injectFault(frozenOptions, "before_commit");
    frozen.database.exec("COMMIT");
    transactionOpen = false;
    committed = true;
    if (frozenOptions.fault === "after_commit_before_reply") {
      throw new Error("ENVELOPE_FINALIZE_RESPONSE_LOST:after_commit_before_reply");
    }
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        frozen.database.exec("ROLLBACK");
      } catch {
        // Preserve the primary finalizer failure.
      }
    }
    if (committed) throw error;
    throw error;
  }
}
