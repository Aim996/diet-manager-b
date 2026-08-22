import type { DatabaseSync } from "node:sqlite";

import { dietManagerActions } from "../contracts/actions.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
import {
  exactRepositoryInput,
  invalidRepository,
  parseRepositoryJson,
  repositoryInteger,
  repositoryJson,
  repositoryText,
  repositoryTimestamp,
} from "./repository-v2-shared.js";

const PREFIX = "PENDING_CANDIDATE_REPOSITORY_INVALID";

interface PendingCandidateRow {
  candidate_id: string;
  idempotency_key: string;
  conversation_id: string;
  action: string;
  original_proposal_json: string;
  current_proposal_json: string;
  missing_fields_json: string;
  status: "open" | "consumed" | "cancelled" | "expired";
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  revision: number;
}

export interface PendingCandidate {
  readonly candidate_id: string;
  readonly idempotency_key: string;
  readonly conversation_id: string;
  readonly action: (typeof dietManagerActions)[number];
  readonly original_proposal: unknown;
  readonly current_proposal: unknown;
  readonly missing_fields: readonly string[];
  readonly status: PendingCandidateRow["status"];
  readonly created_at: string;
  readonly expires_at: string;
  readonly consumed_at: string | null;
  readonly revision: number;
}

function missingFields(value: unknown): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 64) {
    return invalidRepository(PREFIX, "missing_fields");
  }
  const result = value.map((field) => repositoryText(field, PREFIX, "missing_fields", 128));
  if (new Set(result).size !== result.length) return invalidRepository(PREFIX, "missing_fields");
  return Object.freeze(result);
}

function fromRow(row: PendingCandidateRow | undefined): Readonly<PendingCandidate> | undefined {
  if (row === undefined) return undefined;
  const missing = parseRepositoryJson(row.missing_fields_json, PREFIX);
  if (!Array.isArray(missing) || missing.some((value) => typeof value !== "string")) {
    return invalidRepository(PREFIX, "stored_json");
  }
  return Object.freeze({
    candidate_id: row.candidate_id,
    idempotency_key: row.idempotency_key,
    conversation_id: row.conversation_id,
    action: row.action as PendingCandidate["action"],
    original_proposal: parseRepositoryJson(row.original_proposal_json, PREFIX),
    current_proposal: parseRepositoryJson(row.current_proposal_json, PREFIX),
    missing_fields: Object.freeze([...missing] as string[]),
    status: row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    consumed_at: row.consumed_at,
    revision: row.revision,
  });
}

export function readPendingCandidate(
  database: DatabaseSync,
  candidateId: string,
): Readonly<PendingCandidate> | undefined {
  assertCurrentMigrationAuthority(database);
  const id = repositoryText(candidateId, PREFIX, "candidate_id", 128);
  return fromRow(database.prepare("SELECT * FROM pending_candidates WHERE candidate_id = ?")
    .get(id) as unknown as PendingCandidateRow | undefined);
}

export function createPendingCandidate(database: DatabaseSync, value: unknown): Readonly<PendingCandidate> {
  assertCurrentMigrationAuthority(database);
  const input = exactRepositoryInput(value, [
    "candidate_id", "idempotency_key", "conversation_id", "action", "original_proposal",
    "current_proposal", "missing_fields", "created_at", "expires_at",
  ], PREFIX);
  const candidateId = repositoryText(input.candidate_id, PREFIX, "candidate_id", 128);
  const idempotencyKey = repositoryText(input.idempotency_key, PREFIX, "idempotency_key", 128);
  const conversationId = repositoryText(input.conversation_id, PREFIX, "conversation_id", 128);
  const action = input.action;
  if (typeof action !== "string" || !dietManagerActions.includes(action as PendingCandidate["action"])) {
    return invalidRepository(PREFIX, "action");
  }
  const originalJson = repositoryJson(input.original_proposal);
  const currentJson = repositoryJson(input.current_proposal);
  const missingJson = repositoryJson(missingFields(input.missing_fields));
  const createdAt = repositoryTimestamp(input.created_at, PREFIX, "created_at");
  const expiresAt = repositoryTimestamp(input.expires_at, PREFIX, "expires_at");
  if (expiresAt <= createdAt) return invalidRepository(PREFIX, "expires_at");

  const existing = database.prepare("SELECT * FROM pending_candidates WHERE idempotency_key = ?")
    .get(idempotencyKey) as unknown as PendingCandidateRow | undefined;
  if (existing !== undefined) {
    if (existing.candidate_id !== candidateId || existing.conversation_id !== conversationId ||
        existing.action !== action || existing.original_proposal_json !== originalJson ||
        existing.current_proposal_json !== currentJson || existing.missing_fields_json !== missingJson ||
        existing.created_at !== createdAt || existing.expires_at !== expiresAt) {
      return invalidRepository(PREFIX, "idempotency_conflict");
    }
    return fromRow(existing)!;
  }
  try {
    database.prepare(`INSERT INTO pending_candidates(
      candidate_id,idempotency_key,conversation_id,action,original_proposal_json,
      current_proposal_json,missing_fields_json,status,created_at,expires_at,consumed_at,revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL, 1)`)
      .run(candidateId, idempotencyKey, conversationId, action, originalJson, currentJson,
        missingJson, createdAt, expiresAt);
  } catch (error) {
    throw new Error(`${PREFIX}:candidate_conflict`, { cause: error });
  }
  return readPendingCandidate(database, candidateId)!;
}

export function updatePendingCandidate(database: DatabaseSync, value: unknown): Readonly<PendingCandidate> {
  assertCurrentMigrationAuthority(database);
  const input = exactRepositoryInput(value, [
    "candidate_id", "expected_revision", "current_proposal", "missing_fields", "expires_at",
  ], PREFIX);
  const id = repositoryText(input.candidate_id, PREFIX, "candidate_id", 128);
  const revision = repositoryInteger(input.expected_revision, PREFIX, "expected_revision", 1);
  const currentJson = repositoryJson(input.current_proposal);
  const missingJson = repositoryJson(missingFields(input.missing_fields));
  const expiresAt = repositoryTimestamp(input.expires_at, PREFIX, "expires_at");
  const result = database.prepare(`UPDATE pending_candidates
    SET current_proposal_json = ?, missing_fields_json = ?, expires_at = ?, revision = revision + 1
    WHERE candidate_id = ? AND status = 'open' AND revision = ?`)
    .run(currentJson, missingJson, expiresAt, id, revision);
  if (result.changes !== 1) return invalidRepository(PREFIX, "revision_conflict");
  return readPendingCandidate(database, id)!;
}

export function transitionPendingCandidate(
  database: DatabaseSync,
  value: unknown,
): Readonly<PendingCandidate> {
  assertCurrentMigrationAuthority(database);
  const input = exactRepositoryInput(value, [
    "candidate_id", "expected_revision", "status", "transitioned_at",
  ], PREFIX);
  const id = repositoryText(input.candidate_id, PREFIX, "candidate_id", 128);
  const revision = repositoryInteger(input.expected_revision, PREFIX, "expected_revision", 1);
  const status = input.status;
  if (status !== "consumed" && status !== "cancelled" && status !== "expired") {
    return invalidRepository(PREFIX, "status");
  }
  const transitionedAt = repositoryTimestamp(input.transitioned_at, PREFIX, "transitioned_at");
  const result = database.prepare(`UPDATE pending_candidates
    SET status = ?, consumed_at = ?, revision = revision + 1
    WHERE candidate_id = ? AND status = 'open' AND revision = ?`)
    .run(status, status === "consumed" ? transitionedAt : null, id, revision);
  if (result.changes !== 1) return invalidRepository(PREFIX, "revision_conflict");
  return readPendingCandidate(database, id)!;
}

export function consumePendingCandidate(
  database: DatabaseSync,
  value: unknown,
): Readonly<PendingCandidate> {
  assertCurrentMigrationAuthority(database);
  const input = exactRepositoryInput(value, [
    "candidate_id", "expected_revision", "current_proposal", "missing_fields",
    "expires_at", "consumed_at",
  ], PREFIX);
  const id = repositoryText(input.candidate_id, PREFIX, "candidate_id", 128);
  const revision = repositoryInteger(input.expected_revision, PREFIX, "expected_revision", 1);
  const currentJson = repositoryJson(input.current_proposal);
  const fields = missingFields(input.missing_fields);
  if (fields.length !== 0) return invalidRepository(PREFIX, "missing_fields");
  const missingJson = repositoryJson(fields);
  const expiresAt = repositoryTimestamp(input.expires_at, PREFIX, "expires_at");
  const consumedAt = repositoryTimestamp(input.consumed_at, PREFIX, "consumed_at");
  const result = database.prepare(`UPDATE pending_candidates
    SET current_proposal_json = ?, missing_fields_json = ?, expires_at = ?,
        status = 'consumed', consumed_at = ?, revision = revision + 1
    WHERE candidate_id = ? AND status = 'open' AND revision = ?`)
    .run(currentJson, missingJson, expiresAt, consumedAt, id, revision);
  if (result.changes !== 1) return invalidRepository(PREFIX, "revision_conflict");
  return readPendingCandidate(database, id)!;
}

export function listOpenPendingCandidates(
  database: DatabaseSync,
  conversationId: string,
  now: string,
): readonly Readonly<PendingCandidate>[] {
  assertCurrentMigrationAuthority(database);
  const conversation = repositoryText(conversationId, PREFIX, "conversation_id", 128);
  const current = repositoryTimestamp(now, PREFIX, "now");
  database.prepare(`UPDATE pending_candidates
    SET status = 'expired', revision = revision + 1
    WHERE status = 'open' AND expires_at <= ?`).run(current);
  const rows = database.prepare(`SELECT * FROM pending_candidates
    WHERE conversation_id = ? AND status = 'open' ORDER BY created_at, candidate_id`)
    .all(conversation) as unknown as PendingCandidateRow[];
  return Object.freeze(rows.map((row) => fromRow(row)!));
}

export function readLatestPendingCandidateForConversation(
  database: DatabaseSync,
  conversationId: string,
): Readonly<PendingCandidate> | undefined {
  assertCurrentMigrationAuthority(database);
  const conversation = repositoryText(conversationId, PREFIX, "conversation_id", 128);
  const row = database.prepare(`SELECT * FROM pending_candidates
    WHERE conversation_id = ? ORDER BY created_at DESC, candidate_id DESC LIMIT 1`)
    .get(conversation) as unknown as PendingCandidateRow | undefined;
  return fromRow(row);
}
