import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../authority/canonical-json.js";
import {
  dietManagerActions,
  type DietManagerAction,
} from "../contracts.js";
import { authorizeRepositoryPreview } from "../preview/store.js";
import { assertEnvelopeTransition } from "../state/transition-guard.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";

const INPUT_FIELDS = [
  "commandType",
  "dataRevision",
  "database",
  "finalizedAt",
  "frozenAt",
  "inputDigest",
  "payload",
  "receiptId",
  "resultStatus",
  "secret",
  "subjectScope",
  "token",
  "traceId",
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

interface FrozenInput extends Omit<FinalizeEnvelopeInput, "payload" | "secret"> {
  secret: Uint8Array;
  payloadJson: string;
  payload: unknown;
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

    const result = resultFor(
      frozen,
      authority.binding.preview_id,
      authority.idempotency_key,
    );
    frozen.database
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
        frozen.inputDigest,
        frozen.resultStatus,
        frozen.receiptId,
        frozen.finalizedAt,
        frozen.frozenAt,
        frozen.payloadJson,
      );
    injectFault(frozenOptions, "after_finalization_row");

    assertEnvelopeTransition("effects_stable", "finalized");
    frozen.database
      .prepare(
        `UPDATE command_envelopes
         SET state = 'finalized', result_status = ?
         WHERE envelope_id = ? AND state = 'effects_stable'
           AND result_status = 'effects_stable'`,
      )
      .run(frozen.resultStatus, authority.binding.preview_id);
    if (changes(frozen.database) !== 1) return authorityInvalid("envelope_compare_and_set");
    injectFault(frozenOptions, "after_envelope");

    frozen.database
      .prepare(
        `UPDATE idempotency_records
         SET state = 'finalized', terminal_result_json = ?, updated_at = ?
         WHERE idempotency_key = ? AND operation_id = ? AND input_digest = ?
           AND state = 'effects_stable' AND terminal_result_json IS NULL`,
      )
      .run(
        canonicalJson(result),
        frozen.finalizedAt,
        authority.idempotency_key,
        authority.binding.preview_id,
        frozen.inputDigest,
      );
    if (changes(frozen.database) !== 1) {
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
