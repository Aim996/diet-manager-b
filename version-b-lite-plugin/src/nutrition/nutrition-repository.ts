import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../authority/canonical-json.js";
import { freezeNutritionData } from "./types.js";
import type { NutritionRecords, NutritionProfileV11, NutritionSnapshotV11 } from "./nutrition-service.js";

interface StoredProfileRow {
  nutrition_profile_id: string;
  schema_version: string;
  subject_type: string;
  subject_id: string;
  profile_version: string;
  source_type: string;
  source_ref: string;
  source_version: string;
  retrieved_at: string;
  coverage_status: string;
  created_at: string;
  supersedes_profile_id: string | null;
  payload_json: string;
}

interface StoredSnapshotRow {
  snapshot_id: string;
  schema_version: string;
  meal_event_id: string;
  intake_item_id: string;
  nutrition_profile_id: string;
  profile_version: string;
  source_type: string;
  source_ref: string;
  coverage_status: string;
  created_at: string;
  payload_json: string;
}

function stableProfilePayload(value: string, retrievedAt: string, createdAt: string): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch { return null; }
  if (
    canonicalJson(parsed) !== value || typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
  ) return null;
  const profile = parsed as Record<string, unknown>;
  if (profile.retrieved_at !== retrievedAt || profile.created_at !== createdAt || retrievedAt !== createdAt) {
    return null;
  }
  const timestamp = new Date(retrievedAt);
  if (!Number.isFinite(timestamp.valueOf()) || timestamp.toISOString() !== retrievedAt) return null;
  return canonicalJson({ ...profile, retrieved_at: null, created_at: null });
}

function invalid(reason: string): never {
  throw new Error(`NUTRITION_REPOSITORY_INVALID:${reason}`);
}

function profileMatches(row: StoredProfileRow, profile: Readonly<NutritionProfileV11>): boolean {
  return row.nutrition_profile_id === profile.nutrition_profile_id && row.schema_version === profile.schema_version &&
    row.subject_type === profile.subject_type && row.subject_id === profile.subject_id &&
    row.profile_version === profile.profile_version && row.source_type === profile.source_type &&
    row.source_ref === profile.source_ref && row.source_version === profile.source_version &&
    row.coverage_status === profile.coverage_status &&
    row.supersedes_profile_id === profile.supersedes_profile_id &&
    stableProfilePayload(row.payload_json, row.retrieved_at, row.created_at) ===
      stableProfilePayload(canonicalJson(profile), profile.retrieved_at, profile.created_at);
}

function snapshotMatches(row: StoredSnapshotRow, snapshot: Readonly<NutritionSnapshotV11>): boolean {
  return row.snapshot_id === snapshot.snapshot_id && row.schema_version === snapshot.schema_version &&
    row.meal_event_id === snapshot.meal_event_id && row.intake_item_id === snapshot.intake_item_id &&
    row.nutrition_profile_id === snapshot.nutrition_profile_id && row.profile_version === snapshot.profile_version &&
    row.source_type === snapshot.source_type && row.source_ref === snapshot.source_ref &&
    row.coverage_status === snapshot.coverage_status && row.created_at === snapshot.created_at &&
    row.payload_json === canonicalJson(snapshot);
}

function insertProfile(database: DatabaseSync, profile: Readonly<NutritionProfileV11>): void {
  const existing = database.prepare("SELECT * FROM nutrition_profiles WHERE nutrition_profile_id = ?")
    .get(profile.nutrition_profile_id) as unknown as StoredProfileRow | undefined;
  if (existing !== undefined) {
    if (!profileMatches(existing, profile)) invalid("profile_conflict");
    return;
  }
  database.prepare(`INSERT INTO nutrition_profiles(
    nutrition_profile_id,schema_version,subject_type,subject_id,profile_version,source_type,source_ref,
    source_version,retrieved_at,coverage_status,created_at,supersedes_profile_id,payload_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(profile.nutrition_profile_id, profile.schema_version, profile.subject_type, profile.subject_id,
      profile.profile_version, profile.source_type, profile.source_ref, profile.source_version,
      profile.retrieved_at, profile.coverage_status, profile.created_at, profile.supersedes_profile_id,
      canonicalJson(profile));
}

function insertSnapshot(database: DatabaseSync, snapshot: Readonly<NutritionSnapshotV11>): void {
  const existing = database.prepare("SELECT * FROM nutrition_snapshots WHERE snapshot_id = ?")
    .get(snapshot.snapshot_id) as unknown as StoredSnapshotRow | undefined;
  if (existing !== undefined) {
    if (!snapshotMatches(existing, snapshot)) invalid("snapshot_conflict");
    return;
  }
  database.prepare(`INSERT INTO nutrition_snapshots(
    snapshot_id,schema_version,meal_event_id,intake_item_id,nutrition_profile_id,profile_version,
    source_type,source_ref,coverage_status,created_at,payload_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(snapshot.snapshot_id, snapshot.schema_version, snapshot.meal_event_id, snapshot.intake_item_id,
      snapshot.nutrition_profile_id, snapshot.profile_version, snapshot.source_type, snapshot.source_ref,
      snapshot.coverage_status, snapshot.created_at, canonicalJson(snapshot));
}

export function persistNutritionRecords(
  database: DatabaseSync,
  records: readonly Readonly<NutritionRecords>[],
): void {
  database.exec("SAVEPOINT nutrition_records");
  try {
    for (const record of records) {
      insertProfile(database, record.profile);
      insertSnapshot(database, record.snapshot);
    }
    database.exec("RELEASE SAVEPOINT nutrition_records");
  } catch (error) {
    try {
      database.exec("ROLLBACK TO SAVEPOINT nutrition_records");
      database.exec("RELEASE SAVEPOINT nutrition_records");
    } catch { /* preserve the business/authority error */ }
    throw error;
  }
}

export function assertNutritionRecordsPersisted(
  database: DatabaseSync,
  records: readonly Readonly<NutritionRecords>[],
): void {
  for (const record of records) {
    const profile = database.prepare("SELECT * FROM nutrition_profiles WHERE nutrition_profile_id = ?")
      .get(record.profile.nutrition_profile_id) as unknown as StoredProfileRow | undefined;
    const snapshot = database.prepare("SELECT * FROM nutrition_snapshots WHERE snapshot_id = ?")
      .get(record.snapshot.snapshot_id) as unknown as StoredSnapshotRow | undefined;
    if (profile === undefined || !profileMatches(profile, record.profile)) invalid("profile_readback");
    if (snapshot === undefined || !snapshotMatches(snapshot, record.snapshot)) invalid("snapshot_readback");
  }
}

export function readNutritionRecordsForMeal(
  database: DatabaseSync,
  mealEventId: string,
): readonly Readonly<{ profile: NutritionProfileV11; snapshot: NutritionSnapshotV11 }>[] {
  const rows = database.prepare(`SELECT s.payload_json AS snapshot_json, p.payload_json AS profile_json
    FROM nutrition_snapshots s JOIN nutrition_profiles p ON p.nutrition_profile_id = s.nutrition_profile_id
    WHERE s.meal_event_id = ? ORDER BY s.intake_item_id, s.snapshot_id`).all(mealEventId) as unknown as Array<{
      snapshot_json: string;
      profile_json: string;
    }>;
  return Object.freeze(rows.map((row) => {
    let snapshot: unknown;
    let profile: unknown;
    try {
      snapshot = JSON.parse(row.snapshot_json);
      profile = JSON.parse(row.profile_json);
    } catch { return invalid("read_json"); }
    if (canonicalJson(snapshot) !== row.snapshot_json || canonicalJson(profile) !== row.profile_json) {
      return invalid("read_canonical");
    }
    return freezeNutritionData({ profile, snapshot }) as Readonly<{
      profile: NutritionProfileV11;
      snapshot: NutritionSnapshotV11;
    }>;
  }));
}
