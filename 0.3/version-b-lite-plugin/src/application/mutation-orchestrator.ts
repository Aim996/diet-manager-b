import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { CoreApplicationRequest } from "../contracts.js";
import { digestDomainEnvelope } from "../domain/identity.js";
import type { DomainEnvelopeInput } from "../domain/types.js";
import type { CoreCorrectionTargetReference } from "../parser/types.js";
import {
  listActiveMealTargetCandidates,
  readEffectiveMealState,
  readEffectiveWaterState,
  resolveCorrectionTarget,
  resolveWaterCorrectionTarget,
  type ResolvedCorrectionTarget,
  type ResolvedWaterCorrectionTarget,
} from "../repository/correction-target.js";
import { readFinalizedCorrectionRevision } from "../repository/revision.js";

const CORRECTION_SETTLE_WAIT = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

export interface MutationReplayIdentity {
  readonly envelope_id: string;
  readonly idempotency_key: string;
}

export type MutationTargetResolution<T> =
  | Readonly<{
      readonly status: "resolved";
      readonly target: T;
      readonly replay: false | Readonly<MutationReplayIdentity>;
    }>
  | Readonly<{ readonly status: "not_found" }>
  | Readonly<{ readonly status: "ambiguous"; readonly question: string }>;

export function assertMutationReplayEnvelope(input: Readonly<{
  database: DatabaseSync;
  replay: Readonly<MutationReplayIdentity>;
  envelope: Readonly<DomainEnvelopeInput>;
  reference: CoreCorrectionTargetReference;
  targetEventId: string;
}>): void {
  if (input.reference.kind === "event_id" && input.reference.event_id !== input.targetEventId) {
    throw new Error("IDEMPOTENCY_CONFLICT:target_event_id");
  }
  const row = input.database.prepare(
    `SELECT idempotency_key, input_digest FROM command_envelopes WHERE envelope_id = ?`,
  ).get(input.replay.envelope_id) as {
    idempotency_key: string;
    input_digest: string;
  } | undefined;
  if (row === undefined || row.idempotency_key !== input.replay.idempotency_key ||
      input.envelope.envelope_id !== input.replay.envelope_id ||
      input.envelope.idempotency_key !== input.replay.idempotency_key) {
    throw new Error("MUTATION_REPLAY_INVALID:envelope_identity");
  }
  if (digestDomainEnvelope(input.envelope) !== row.input_digest) {
    throw new Error("IDEMPOTENCY_CONFLICT:input_digest");
  }
}

function applicationEnvelopeIdentity(
  request: Readonly<CoreApplicationRequest>,
): Readonly<MutationReplayIdentity> {
  const digest = createHash("sha256")
    .update("diet-manager/application-envelope/v1\n", "ascii")
    .update(request.operation_id, "utf8").update("\0", "ascii")
    .update(request.source_message_id, "utf8").update("\0", "ascii")
    .update(request.conversation_id, "utf8").digest("hex").toUpperCase();
  return Object.freeze({
    envelope_id: `envelope-${digest.slice(0, 32).toLowerCase()}`,
    idempotency_key: `core-${digest}`,
  });
}

function resolveAfterPending<T>(resolve: () => T): T {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return resolve();
    } catch (error) {
      if (!(error instanceof Error) ||
          error.message !== "CORRECTION_TARGET_INVALID:pending_correction" || attempt === 99) {
        throw error;
      }
      Atomics.wait(CORRECTION_SETTLE_WAIT, 0, 0, 5);
    }
  }
  throw new Error("CORRECTION_TARGET_INVALID:pending_correction");
}

function shanghaiMinute(value: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new Error("MUTATION_TARGET_INVALID:occurred_at");
  return new Date(epoch + 8 * 60 * 60 * 1_000).toISOString().slice(0, 16).replace("T", " ");
}

function ambiguityQuestion(input: Readonly<{
  database: DatabaseSync;
  authoritySecret: Uint8Array;
  conversationId: string;
  reference: CoreCorrectionTargetReference;
}>): string {
  const itemText = input.reference.kind === "active_meal_item_in_conversation"
    ? input.reference.item_text
    : undefined;
  const set = listActiveMealTargetCandidates({
    database: input.database,
    authoritySecret: input.authoritySecret,
    conversationId: input.conversationId,
    ...(itemText === undefined ? {} : { itemText }),
  });
  const labels = ["A", "B", "C", "D"] as const;
  const summaries = set.candidates.map((candidate, index) => {
    const names = itemText === undefined ? candidate.normalized_names : [itemText];
    return `${labels[index]} ${shanghaiMinute(candidate.occurred_at)} ${names.join("+")}`;
  });
  if (summaries.length < 2) throw new Error("MUTATION_TARGET_INVALID:ambiguity_summary");
  return `找到多条候选饮食记录：${summaries.join("；")}${set.has_more ? "；另有其他候选" : ""}。请说明时间或记录编号。`;
}

function replayRevision(input: Readonly<{
  database: DatabaseSync;
  request: Readonly<CoreApplicationRequest>;
  allowedOperations: readonly string[];
}>) {
  const identity = applicationEnvelopeIdentity(input.request);
  const revision = readFinalizedCorrectionRevision({
    database: input.database,
    envelopeId: identity.envelope_id,
    operationId: input.request.operation_id,
    sourceMessageId: input.request.source_message_id,
    conversationId: input.request.conversation_id,
    receivedAt: input.request.received_at,
    allowedOperations: input.allowedOperations,
  });
  if (revision === undefined) return undefined;
  return Object.freeze({ identity, revision });
}

export function resolveMealMutationTarget(input: Readonly<{
  database: DatabaseSync;
  authoritySecret: Uint8Array;
  request: Readonly<CoreApplicationRequest>;
  reference: CoreCorrectionTargetReference;
  allowedOperations: readonly ("change_amount" | "change_time" | "void_event" | "restore_event")[];
}>): MutationTargetResolution<ResolvedCorrectionTarget> {
  const replay = replayRevision(input);
  if (replay !== undefined) {
    const state = readEffectiveMealState(
      input.database,
      input.authoritySecret,
      replay.revision.target_event_id,
    );
    return Object.freeze({
      status: "resolved" as const,
      replay: replay.identity,
      target: Object.freeze({
        target_event_id: replay.revision.target_event_id,
        base_revision: replay.revision.base_revision,
        active: state.snapshot.active,
        event_kind: "diet_meal" as const,
      }),
    });
  }
  try {
    const target = resolveAfterPending(() => resolveCorrectionTarget({
      database: input.database,
      authoritySecret: input.authoritySecret,
      conversationId: input.request.conversation_id,
      reference: input.reference,
    }));
    return Object.freeze({ status: "resolved" as const, target, replay: false });
  } catch (error) {
    if (error instanceof Error && error.message === "CORRECTION_TARGET_NOT_FOUND") {
      return Object.freeze({ status: "not_found" as const });
    }
    if (error instanceof Error && error.message === "CORRECTION_TARGET_AMBIGUOUS") {
      return Object.freeze({
        status: "ambiguous" as const,
        question: ambiguityQuestion({
          database: input.database,
          authoritySecret: input.authoritySecret,
          conversationId: input.request.conversation_id,
          reference: input.reference,
        }),
      });
    }
    throw error;
  }
}

export function resolveWaterMutationTarget(input: Readonly<{
  database: DatabaseSync;
  authoritySecret: Uint8Array;
  request: Readonly<CoreApplicationRequest>;
  reference: CoreCorrectionTargetReference;
}>): MutationTargetResolution<ResolvedWaterCorrectionTarget> {
  const replay = replayRevision({ ...input, allowedOperations: ["change_food_type"] });
  if (replay !== undefined) {
    const state = readEffectiveWaterState(
      input.database,
      input.authoritySecret,
      replay.revision.target_event_id,
    );
    return Object.freeze({
      status: "resolved" as const,
      replay: replay.identity,
      target: Object.freeze({
        target_event_id: replay.revision.target_event_id,
        base_revision: replay.revision.base_revision,
        active: state.snapshot.active,
        event_kind: "diet_water" as const,
      }),
    });
  }
  try {
    const target = resolveAfterPending(() => resolveWaterCorrectionTarget({
      database: input.database,
      authoritySecret: input.authoritySecret,
      conversationId: input.request.conversation_id,
      reference: input.reference,
    }));
    return Object.freeze({ status: "resolved" as const, target, replay: false });
  } catch (error) {
    if (error instanceof Error && error.message === "CORRECTION_TARGET_NOT_FOUND") {
      return Object.freeze({ status: "not_found" as const });
    }
    if (error instanceof Error && error.message === "CORRECTION_TARGET_AMBIGUOUS") {
      return Object.freeze({ status: "ambiguous" as const, question: "找到多条候选饮水记录，请说明时间或记录编号。" });
    }
    throw error;
  }
}
