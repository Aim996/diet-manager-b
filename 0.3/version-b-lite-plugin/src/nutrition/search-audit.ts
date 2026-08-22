import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson, canonicalSha256 } from "../authority/canonical-json.js";
import {
  findReusableNutritionAuditRecords,
  saveNutritionAuditRecord,
} from "../repository/nutrition-audit-repository.js";
import {
  validateAndFreezeResolvedNutritionEvidence,
  type ResolvedNutritionEvidence,
  type SourceRequest,
  type SourceResolution,
} from "./types.js";

const AUDIT_SCHEMA_VERSION = "diet-manager/nutrition-search-audit/v1";

function invalid(reason: string): never {
  throw new TypeError(`NUTRITION_SEARCH_AUDIT_INVALID:${reason}`);
}

export function recordNutritionWebResolution(
  database: DatabaseSync,
  request: Readonly<SourceRequest>,
  resolution: Readonly<SourceResolution>,
  evidence: Readonly<ResolvedNutritionEvidence>,
  originalQuery: string,
): Readonly<ResolvedNutritionEvidence> | undefined {
  const audit = resolution.audit;
  if (audit === undefined) return invalid("metadata_missing");
  if (originalQuery.length === 0 || originalQuery.length > 512 || /[\u0000-\u001F\u007F]/u.test(originalQuery)) {
    return invalid("original_query");
  }
  const retrieved = new Date(audit.retrieved_at);
  let sourceUrl: URL;
  try { sourceUrl = new URL(audit.source_url); } catch { return invalid("source_url"); }
  if (!Number.isFinite(retrieved.valueOf()) || retrieved.toISOString() !== audit.retrieved_at ||
      sourceUrl.protocol !== "https:" || sourceUrl.username !== "" || sourceUrl.password !== "" ||
      audit.source_url !== evidence.source_ref ||
      !Number.isSafeInteger(audit.confidence_microunits) || audit.confidence_microunits < 0 ||
      audit.confidence_microunits > 1_000_000 ||
      (audit.cache_decision !== "cache_allowed" && audit.cache_decision !== "cache_forbidden")) {
    return invalid("metadata");
  }
  const matchBasis = audit.match_basis.toLowerCase();
  const conflicting = matchBasis.includes("conflict");
  const estimatedMatch = audit.confidence_microunits < 800_000 ||
    /(?:similar|contained|candidate|category|ranked)/u.test(matchBasis);
  const effectiveCacheDecision = conflicting || estimatedMatch
    ? "cache_forbidden" as const
    : audit.cache_decision;
  const payload = {
    schema_version: AUDIT_SCHEMA_VERSION,
    original_query: originalQuery,
    normalized_query: request.normalized_food_name,
    request,
    source_record_id: resolution.source_record_id,
    source_version: resolution.source_version,
    retained_fields_sha256: resolution.retained_fields_sha256,
    evidence,
  };
  saveNutritionAuditRecord(database, {
    resolution_id: `nutrition-search-${canonicalSha256({
      query: request.normalized_food_name,
      source_ref: evidence.source_ref,
      source_record_id: resolution.source_record_id,
      source_version: resolution.source_version,
      retrieved_at: audit.retrieved_at,
      audit_nonce: randomUUID(),
    }).slice(0, 40).toLowerCase()}`,
    query: request.normalized_food_name,
    source_type: evidence.source_type,
    source_name: audit.source_name,
    source_ref: evidence.source_ref,
    retrieved_at: audit.retrieved_at,
    match_basis: audit.match_basis,
    confidence_microunits: audit.confidence_microunits,
    license_decision: audit.license_decision,
    cache_decision: effectiveCacheDecision,
    adopted_profile_id: null,
    payload,
  });
  if (conflicting) return undefined;
  if (!estimatedMatch) return evidence;
  return validateAndFreezeResolvedNutritionEvidence({
    ...evidence,
    source_id: "local.generic_estimate",
    source_type: "generic_estimate",
    field_evidence: [...evidence.field_evidence, {
      evidence_kind: "web_result_classified_as_estimate",
      source_id: evidence.source_id,
      match_basis: audit.match_basis,
      confidence_microunits: audit.confidence_microunits,
    }],
  });
}

export function findReusableNutritionWebEvidence(
  database: DatabaseSync,
  request: Readonly<SourceRequest>,
): Readonly<ResolvedNutritionEvidence> | undefined {
  for (const record of findReusableNutritionAuditRecords(database, request.normalized_food_name)) {
    const payload = record.payload;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) continue;
    const value = payload as Record<string, unknown>;
    if (value.schema_version !== AUDIT_SCHEMA_VERSION ||
        canonicalJson(value.request) !== canonicalJson(request)) continue;
    try {
      const evidence = validateAndFreezeResolvedNutritionEvidence(value.evidence);
      if (evidence.source_ref !== record.source_ref ||
          (evidence.source_type !== "trusted_public_web" &&
           evidence.source_type !== "authoritative_public_database")) continue;
      return evidence;
    } catch {
      continue;
    }
  }
  return undefined;
}
