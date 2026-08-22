import type { DatabaseSync } from "node:sqlite";

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

const PREFIX = "GOAL_RECOMMENDATION_REPOSITORY_INVALID";

interface GoalRow {
  recommendation_id: string;
  user_id: string;
  profile_version: string;
  goals_json: string;
  status: "pending" | "confirmed" | "rejected" | "superseded";
  basis_json: string;
  created_at: string;
  confirmed_at: string | null;
  invalidated_at: string | null;
  revision: number;
}

function fromRow(row: GoalRow | undefined) {
  if (row === undefined) return undefined;
  return Object.freeze({
    recommendation_id: row.recommendation_id,
    user_id: row.user_id,
    profile_version: row.profile_version,
    goals: parseRepositoryJson(row.goals_json, PREFIX),
    status: row.status,
    basis: parseRepositoryJson(row.basis_json, PREFIX),
    created_at: row.created_at,
    confirmed_at: row.confirmed_at,
    invalidated_at: row.invalidated_at,
    revision: row.revision,
  });
}

export function readGoalRecommendation(database: DatabaseSync, recommendationId: string) {
  assertCurrentMigrationAuthority(database);
  const id = repositoryText(recommendationId, PREFIX, "recommendation_id", 128);
  return fromRow(database.prepare("SELECT * FROM goal_recommendations WHERE recommendation_id = ?")
    .get(id) as unknown as GoalRow | undefined);
}

export function readPendingGoalRecommendation(database: DatabaseSync, userId: string) {
  assertCurrentMigrationAuthority(database);
  const id = repositoryText(userId, PREFIX, "user_id", 128);
  return fromRow(database.prepare(
    "SELECT * FROM goal_recommendations WHERE user_id = ? AND status = 'pending'",
  ).get(id) as unknown as GoalRow | undefined);
}

export function createGoalRecommendation(database: DatabaseSync, value: unknown) {
  assertCurrentMigrationAuthority(database);
  const input = exactRepositoryInput(value, [
    "recommendation_id", "user_id", "profile_version", "goals", "basis", "created_at",
  ], PREFIX);
  const row = {
    recommendation_id: repositoryText(input.recommendation_id, PREFIX, "recommendation_id", 128),
    user_id: repositoryText(input.user_id, PREFIX, "user_id", 128),
    profile_version: repositoryText(input.profile_version, PREFIX, "profile_version", 128),
    goals_json: repositoryJson(input.goals),
    basis_json: repositoryJson(input.basis),
    created_at: repositoryTimestamp(input.created_at, PREFIX, "created_at"),
  };
  const existing = database.prepare("SELECT * FROM goal_recommendations WHERE recommendation_id = ?")
    .get(row.recommendation_id) as unknown as GoalRow | undefined;
  if (existing !== undefined) {
    if (existing.user_id !== row.user_id || existing.profile_version !== row.profile_version ||
        existing.goals_json !== row.goals_json || existing.basis_json !== row.basis_json ||
        existing.created_at !== row.created_at) return invalidRepository(PREFIX, "recommendation_conflict");
    return fromRow(existing)!;
  }
  try {
    database.prepare(`INSERT INTO goal_recommendations(
      recommendation_id,user_id,profile_version,goals_json,status,basis_json,created_at,
      confirmed_at,invalidated_at,revision
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, 1)`).run(
      row.recommendation_id, row.user_id, row.profile_version, row.goals_json,
      row.basis_json, row.created_at,
    );
  } catch (error) {
    throw new Error(`${PREFIX}:pending_conflict`, { cause: error });
  }
  return readGoalRecommendation(database, row.recommendation_id)!;
}

export function transitionGoalRecommendation(database: DatabaseSync, value: unknown) {
  assertCurrentMigrationAuthority(database);
  const input = exactRepositoryInput(value, [
    "recommendation_id", "expected_revision", "status", "changed_at",
  ], PREFIX);
  const id = repositoryText(input.recommendation_id, PREFIX, "recommendation_id", 128);
  const revision = repositoryInteger(input.expected_revision, PREFIX, "expected_revision", 1);
  const status = input.status;
  if (status !== "confirmed" && status !== "rejected" && status !== "superseded") {
    return invalidRepository(PREFIX, "status");
  }
  const changedAt = repositoryTimestamp(input.changed_at, PREFIX, "changed_at");
  const confirmedAt = status === "confirmed" ? changedAt : null;
  const invalidatedAt = status === "confirmed" ? null : changedAt;
  const result = database.prepare(`UPDATE goal_recommendations
    SET status = ?, confirmed_at = ?, invalidated_at = ?, revision = revision + 1
    WHERE recommendation_id = ? AND status = 'pending' AND revision = ?`)
    .run(status, confirmedAt, invalidatedAt, id, revision);
  if (result.changes !== 1) return invalidRepository(PREFIX, "revision_conflict");
  return readGoalRecommendation(database, id)!;
}
