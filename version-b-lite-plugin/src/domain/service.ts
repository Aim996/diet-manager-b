import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../authority/canonical-json.js";
import { createServerPreview, authorizeRepositoryPreview } from "../preview/store.js";
import {
  appendPreparedOperationFact,
  sealPreparedEnvelopeFacts,
  type FactCommitFault,
} from "../repository/fact-commit.js";
import { finalizeEnvelope } from "../repository/envelope-finalize.js";
import { computeRepositoryDataRevision } from "../repository/revision.js";
import {
  applyMealEffects,
  applyPurchaseEffect,
  prepareMealOperation,
  preparePurchaseOperation,
  type MealOperationResult,
} from "./effect-bundle.js";
import { deriveDomainId, digestDomainEnvelope } from "./identity.js";
import { queryDomainReadModel, type DomainQueryResult } from "./read-model.js";
import type {
  AddInventoryOperation,
  DomainEnvelopeInput,
  DomainExecutionResult,
  DomainQueryOperation,
  RecordMealOperation,
} from "./types.js";

export interface DomainPreviewResult {
  readonly envelope_id: string;
  readonly token: string;
  readonly input_digest: string;
  readonly data_revision: string;
  readonly reused: boolean;
}

export interface DomainExecuteInput {
  readonly envelope: DomainEnvelopeInput;
  readonly token: string;
  readonly input_digest: string;
  readonly data_revision: string;
}

export interface DietDomainFailureEntry {
  readonly stage: "FactCommit" | "EffectBundle" | "EnvelopeFinalize";
  readonly error_code: string;
  readonly trace_id: string;
  readonly input_digest: string;
}

export interface CreateDietDomainServiceInput {
  readonly database: DatabaseSync;
  readonly secret: Uint8Array;
  readonly now: () => string;
  readonly fault?:
    | "before_fact_commit"
    | "after_inventory_business_writes"
    | "after_meal_nutrition"
    | "after_meal_first_item";
  readonly failureSink?: (entry: DietDomainFailureEntry) => void;
}

export interface DietDomainService {
  preview(input: DomainEnvelopeInput): DomainPreviewResult;
  execute(input: DomainExecuteInput): DomainExecutionResult;
  query(input: DomainQueryOperation): DomainQueryResult;
}

function invalid(reason: string): never {
  throw new TypeError(`DIET_DOMAIN_REQUEST_INVALID:${reason}`);
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    return invalid(field);
  }
  return value;
}

function emitFailure(
  sink: CreateDietDomainServiceInput["failureSink"],
  entry: DietDomainFailureEntry,
): void {
  if (!sink) return;
  try {
    sink(Object.freeze(entry));
  } catch {
    // Diagnostics are outside the business transaction and cannot replace its error.
  }
}

function writeOperation(
  envelope: DomainEnvelopeInput,
): AddInventoryOperation | RecordMealOperation {
  if (envelope.operations.length !== 1) return invalid("operation_count");
  const operation = envelope.operations[0];
  if (
    (envelope.command_type === "add_inventory" && operation.kind === "add_inventory") ||
    (envelope.command_type === "record_meal" && operation.kind === "record_meal")
  ) return operation;
  return invalid("command_operation");
}

function storedEnvelopeTime(database: DatabaseSync, envelopeId: string): string {
  const row = database
    .prepare("SELECT received_at FROM command_envelopes WHERE envelope_id = ?")
    .get(envelopeId) as { received_at: string } | undefined;
  if (!row) return invalid("envelope_missing");
  return timestamp(row.received_at, "stored_received_at");
}

function frozenExecutionResult(
  envelope: DomainEnvelopeInput,
  inputDigest: string,
  item: ReturnType<typeof preparePurchaseOperation>["result"],
): DomainExecutionResult {
  return Object.freeze({
    envelope_id: envelope.envelope_id,
    input_digest: inputDigest,
    status: "committed" as const,
    items: Object.freeze([item]),
    payload: Object.freeze({
      authority_kind: "diet-manager/domain-execution/v1",
      inventory: Object.freeze({
        batch_id: item.batch_id,
        product_id: item.product_id,
        quantity_microunits: item.inventory_quantity_microunits,
        unit: item.unit,
      }),
    }),
  });
}

function freezeCreator(input: CreateDietDomainServiceInput): {
  database: DatabaseSync;
  secret: Uint8Array;
  now: () => string;
  fault?:
    | "before_fact_commit"
    | "after_inventory_business_writes"
    | "after_meal_nutrition"
    | "after_meal_first_item";
  failureSink?: (entry: DietDomainFailureEntry) => void;
} {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid("service_options");
  }
  if (typeof input.database !== "object" || input.database === null) return invalid("database");
  if (!(input.secret instanceof Uint8Array) || input.secret.byteLength < 16) {
    return invalid("secret");
  }
  if (typeof input.now !== "function") return invalid("clock");
  if (
    input.fault !== undefined &&
    input.fault !== "before_fact_commit" &&
    input.fault !== "after_inventory_business_writes" &&
    input.fault !== "after_meal_nutrition" &&
    input.fault !== "after_meal_first_item"
  ) {
    return invalid("fault");
  }
  if (input.failureSink !== undefined && typeof input.failureSink !== "function") {
    return invalid("failure_sink");
  }
  return {
    database: input.database,
    secret: Uint8Array.from(input.secret),
    now: input.now,
    ...(input.fault === undefined ? {} : { fault: input.fault }),
    ...(input.failureSink === undefined ? {} : { failureSink: input.failureSink }),
  };
}

export function createDietDomainService(
  input: CreateDietDomainServiceInput,
): DietDomainService {
  const options = freezeCreator(input);
  return Object.freeze({
    preview(envelope: DomainEnvelopeInput): DomainPreviewResult {
      writeOperation(envelope);
      const inputDigest = digestDomainEnvelope(envelope);
      const dataRevision = computeRepositoryDataRevision(options.database);
      const now = timestamp(options.now(), "clock");
      const preview = createServerPreview({
        database: options.database,
        secret: options.secret,
        previewId: envelope.envelope_id,
        idempotencyKey: envelope.idempotency_key,
        inputDigest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision,
        sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id,
        previewMaterial: Object.freeze({
          authority_kind: "diet-manager/domain-preview/v1",
          envelope,
        }),
        now,
      });
      return Object.freeze({
        envelope_id: envelope.envelope_id,
        token: preview.token,
        input_digest: inputDigest,
        data_revision: dataRevision,
        reused: preview.reused,
      });
    },

    execute(execution: DomainExecuteInput): DomainExecutionResult {
      const envelope = execution.envelope;
      const operation = writeOperation(envelope);
      const inputDigest = digestDomainEnvelope(envelope);
      if (execution.input_digest !== inputDigest) return invalid("input_digest");
      const authority = authorizeRepositoryPreview({
        database: options.database,
        secret: options.secret,
        token: execution.token,
        inputDigest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision: execution.data_revision,
      });
      if (authority.binding.preview_id !== envelope.envelope_id) {
        return invalid("envelope_id");
      }
      const committedAt = storedEnvelopeTime(options.database, envelope.envelope_id);
      if (operation.kind === "record_meal") {
        const preparedMeal = prepareMealOperation({
          database: options.database,
          secret: options.secret,
          token: execution.token,
          inputDigest,
          dataRevision: execution.data_revision,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          idempotencyKey: envelope.idempotency_key,
          sourceMessageId: envelope.source_message_id,
          conversationId: envelope.conversation_id,
          receivedAt: envelope.received_at,
          committedAt,
          sequence: 0,
          operation,
        });
        if (authority.envelope_state === "finalized") {
          const row = options.database
            .prepare("SELECT payload_json FROM envelope_finalizations WHERE envelope_id = ?")
            .get(envelope.envelope_id) as { payload_json: string } | undefined;
          if (!row) throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_missing");
          const parsed = JSON.parse(row.payload_json) as DomainExecutionResult;
          if (canonicalJson(parsed) !== row.payload_json) {
            throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_payload");
          }
          if (parsed.status !== "committed" && parsed.status !== "committed_with_issues") {
            throw new Error("DIET_DOMAIN_RESULT_INVALID:finalization_status");
          }
          return finalizeEnvelope({
            database: options.database,
            secret: options.secret,
            token: execution.token,
            inputDigest,
            subjectScope: envelope.subject_scope,
            commandType: envelope.command_type,
            dataRevision: execution.data_revision,
            traceId: preparedMeal.fact.traceId,
            resultStatus: parsed.status,
            receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
            finalizedAt: committedAt,
            frozenAt: committedAt,
            payload: parsed,
            mixedItems: Object.freeze([]),
          }).payload as DomainExecutionResult;
        }
        if (authority.envelope_state !== "received") {
          throw new Error(`DIET_DOMAIN_EXECUTION_PENDING:${authority.envelope_state}`);
        }
        if (options.fault === "before_fact_commit") {
          emitFailure(options.failureSink, {
            stage: "FactCommit",
            error_code: "DIET_DOMAIN_EXECUTION_FAILED",
            trace_id: preparedMeal.fact.traceId,
            input_digest: inputDigest,
          });
          throw new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
        }
        appendPreparedOperationFact(preparedMeal.fact, {
          failureSink: (entry) =>
            emitFailure(options.failureSink, {
              stage: "FactCommit",
              error_code: entry.error_code,
              trace_id: entry.trace_id,
              input_digest: entry.input_digest,
            }),
        });
        let mealResult: MealOperationResult;
        try {
          mealResult = applyMealEffects({
            database: options.database,
            envelopeId: envelope.envelope_id,
            operationId: operation.operation_id,
            operationSequence: 0,
            idempotencyKey: envelope.idempotency_key,
            now: committedAt,
            location: operation.location,
            ...(options.fault === "after_meal_nutrition"
              ? { fault: "after_nutrition" as const }
              : options.fault === "after_meal_first_item"
                ? { fault: "after_first_item" as const }
                : {}),
          });
        } catch (error) {
          const code = (error instanceof Error ? error.message : "MEAL_EFFECT_FAILED").split(
            ":",
            1,
          )[0];
          emitFailure(options.failureSink, {
            stage: "EffectBundle",
            error_code: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "MEAL_EFFECT_FAILED",
            trace_id: preparedMeal.fact.traceId,
            input_digest: inputDigest,
          });
          throw error;
        }
        sealPreparedEnvelopeFacts({
          database: options.database,
          secret: options.secret,
          token: execution.token,
          inputDigest,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          dataRevision: execution.data_revision,
          traceId: preparedMeal.fact.traceId,
          expectedOperationIds: Object.freeze([operation.operation_id]),
          sealedAt: committedAt,
        });
        const mealExecution: DomainExecutionResult = Object.freeze({
          envelope_id: envelope.envelope_id,
          input_digest: inputDigest,
          status: mealResult.status,
          items: Object.freeze([mealResult]),
          payload: Object.freeze({
            authority_kind: "diet-manager/domain-execution/v1",
            daily_progress: mealResult.daily_progress,
            daily_progress_by_date: mealResult.daily_progress_by_date,
          }),
        });
        const finalizedMeal = finalizeEnvelope({
          database: options.database,
          secret: options.secret,
          token: execution.token,
          inputDigest,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          dataRevision: execution.data_revision,
          traceId: preparedMeal.fact.traceId,
          resultStatus: mealResult.status,
          receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
          finalizedAt: committedAt,
          frozenAt: committedAt,
          payload: mealExecution,
          mixedItems: Object.freeze([]),
        });
        return finalizedMeal.payload as DomainExecutionResult;
      }
      const prepared = preparePurchaseOperation({
        database: options.database,
        secret: options.secret,
        token: execution.token,
        inputDigest,
        dataRevision: execution.data_revision,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        idempotencyKey: envelope.idempotency_key,
        sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id,
        receivedAt: envelope.received_at,
        committedAt,
        sequence: 0,
        operation,
      });
      const traceId = prepared.fact.traceId;
      const result = frozenExecutionResult(envelope, inputDigest, prepared.result);
      const finalizerInput = {
        database: options.database,
        secret: options.secret,
        token: execution.token,
        inputDigest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision: execution.data_revision,
        traceId,
        resultStatus: "committed" as const,
        receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
        finalizedAt: committedAt,
        frozenAt: committedAt,
        payload: result,
        mixedItems: Object.freeze([]),
      };

      if (authority.envelope_state === "finalized") {
        return finalizeEnvelope(finalizerInput).payload as DomainExecutionResult;
      }
      if (authority.envelope_state === "received") {
        if (options.fault === "before_fact_commit") {
          emitFailure(options.failureSink, {
            stage: "FactCommit",
            error_code: "DIET_DOMAIN_EXECUTION_FAILED",
            trace_id: traceId,
            input_digest: inputDigest,
          });
          throw new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
        }
        appendPreparedOperationFact(prepared.fact, {
          failureSink: (entry) =>
            emitFailure(options.failureSink, {
              stage: "FactCommit",
              error_code: entry.error_code,
              trace_id: entry.trace_id,
              input_digest: entry.input_digest,
            }),
        });
        try {
          applyPurchaseEffect(
            options.database,
            prepared.outbox_id,
            committedAt,
            options.fault === "after_inventory_business_writes"
              ? "after_business_writes"
              : undefined,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "INVENTORY_EFFECT_FAILED";
          const code = message.split(":", 1)[0];
          emitFailure(options.failureSink, {
            stage: "EffectBundle",
            error_code: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "INVENTORY_EFFECT_FAILED",
            trace_id: traceId,
            input_digest: inputDigest,
          });
          throw error;
        }
        sealPreparedEnvelopeFacts({
          database: options.database,
          secret: options.secret,
          token: execution.token,
          inputDigest,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          dataRevision: execution.data_revision,
          traceId,
          expectedOperationIds: Object.freeze([operation.operation_id]),
          sealedAt: committedAt,
        });
      }
      const state = authorizeRepositoryPreview({
        database: options.database,
        secret: options.secret,
        token: execution.token,
        inputDigest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision: execution.data_revision,
      });
      if (state.envelope_state !== "effects_stable") {
        throw new Error(`DIET_DOMAIN_EXECUTION_PENDING:${state.envelope_state}`);
      }
      const finalized = finalizeEnvelope(finalizerInput);
      if (canonicalJson(finalized.payload) !== canonicalJson(result)) {
        throw new Error("DIET_DOMAIN_RESULT_INVALID:finalized_payload");
      }
      return finalized.payload as DomainExecutionResult;
    },

    query(operation: DomainQueryOperation): DomainQueryResult {
      return queryDomainReadModel(options.database, operation);
    },
  });
}
