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

const PREFIX = "NUTRITION_SEARCH_AUDIT_REPOSITORY_INVALID";

interface AuditRow {
  resolution_id: string;
  query: string;
  source_type: string;
  source_name: string;
  source_ref: string;
  retrieved_at: string;
  match_basis: string;
  confidence_microunits: number;
  license_decision: string;
  cache_decision: string;
  adopted_profile_id: string | null;
  payload_json: string;
}

function fromRow(row: AuditRow) {
  return Object.freeze({
    resolution_id: row.resolution_id,
    query: row.query,
    source_type: row.source_type,
    source_name: row.source_name,
    source_ref: row.source_ref,
    retrieved_at: row.retrieved_at,
    match_basis: row.match_basis,
    confidence_microunits: row.confidence_microunits,
    license_decision: row.license_decision,
    cache_decision: row.cache_decision,
    adopted_profile_id: row.adopted_profile_id,
    payload: parseRepositoryJson(row.payload_json, PREFIX),
  });
}

export function appendNutritionSearchAudit(database: DatabaseSync, value: unknown) {
  assertCurrentMigrationAuthority(database);
  const input = exactRepositoryInput(value, [
    "resolution_id", "query", "source_type", "source_name", "source_ref", "retrieved_at",
    "match_basis", "confidence_microunits", "license_decision", "cache_decision",
    "adopted_profile_id", "payload",
  ], PREFIX);
  const row: AuditRow = {
    resolution_id: repositoryText(input.resolution_id, PREFIX, "resolution_id", 128),
    query: repositoryText(input.query, PREFIX, "query", 512),
    source_type: repositoryText(input.source_type, PREFIX, "source_type", 64),
    source_name: repositoryText(input.source_name, PREFIX, "source_name", 128),
    source_ref: repositoryText(input.source_ref, PREFIX, "source_ref", 512),
    retrieved_at: repositoryTimestamp(input.retrieved_at, PREFIX, "retrieved_at"),
    match_basis: repositoryText(input.match_basis, PREFIX, "match_basis", 128),
    confidence_microunits: repositoryInteger(
      input.confidence_microunits, PREFIX, "confidence_microunits",
    ),
    license_decision: repositoryText(input.license_decision, PREFIX, "license_decision", 128),
    cache_decision: repositoryText(input.cache_decision, PREFIX, "cache_decision", 128),
    adopted_profile_id: input.adopted_profile_id === null ? null :
      repositoryText(input.adopted_profile_id, PREFIX, "adopted_profile_id", 128),
    payload_json: repositoryJson(input.payload),
  };
  if (row.confidence_microunits > 1_000_000) {
    return invalidRepository(PREFIX, "confidence_microunits");
  }
  const existing = database.prepare("SELECT * FROM nutrition_search_audit WHERE resolution_id = ?")
    .get(row.resolution_id) as unknown as AuditRow | undefined;
  if (existing !== undefined) {
    if (JSON.stringify(existing) !== JSON.stringify(row)) {
      return invalidRepository(PREFIX, "resolution_conflict");
    }
    return fromRow(existing);
  }
  database.prepare(`INSERT INTO nutrition_search_audit(
    resolution_id,query,source_type,source_name,source_ref,retrieved_at,match_basis,
    confidence_microunits,license_decision,cache_decision,adopted_profile_id,payload_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    row.resolution_id, row.query, row.source_type, row.source_name, row.source_ref,
    row.retrieved_at, row.match_basis, row.confidence_microunits, row.license_decision,
    row.cache_decision, row.adopted_profile_id, row.payload_json,
  );
  return fromRow(row);
}

export function listNutritionSearchAudit(database: DatabaseSync, query: string) {
  assertCurrentMigrationAuthority(database);
  const normalized = repositoryText(query, PREFIX, "query", 512);
  const rows = database.prepare(`SELECT * FROM nutrition_search_audit
    WHERE query = ? ORDER BY retrieved_at, resolution_id`).all(normalized) as unknown as AuditRow[];
  return Object.freeze(rows.map(fromRow));
}
