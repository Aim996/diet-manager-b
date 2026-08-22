export const MIGRATION_V2_ID = "diet-manager/b-sqlite-migration/0002";

export const MIGRATION_V2_TABLE_STATEMENTS = [
  `CREATE TABLE "pending_candidates" (
  "candidate_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "original_proposal_json" TEXT NOT NULL,
  "current_proposal_json" TEXT NOT NULL,
  "missing_fields_json" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "consumed_at" TEXT,
  "revision" INTEGER NOT NULL,
  PRIMARY KEY ("candidate_id"),
  CHECK (json_valid(original_proposal_json)),
  CHECK (json_valid(current_proposal_json)),
  CHECK (json_valid(missing_fields_json) AND json_type(missing_fields_json) = 'array'),
  CHECK (status IN ('open','consumed','cancelled','expired')),
  CHECK (revision >= 1),
  CHECK ((status = 'consumed') = (consumed_at IS NOT NULL))
) STRICT;`,
  `CREATE TABLE "inventory_quantity_models" (
  "batch_id" TEXT NOT NULL,
  "package_unit" TEXT NOT NULL,
  "original_package_microunits" INTEGER NOT NULL,
  "per_package_base_microunits" INTEGER,
  "base_unit" TEXT,
  "remaining_base_microunits" INTEGER,
  "conversion_source" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  PRIMARY KEY ("batch_id"),
  CHECK (original_package_microunits >= 0),
  CHECK (per_package_base_microunits IS NULL OR per_package_base_microunits > 0),
  CHECK (remaining_base_microunits IS NULL OR remaining_base_microunits >= 0),
  CHECK ((per_package_base_microunits IS NULL) = (base_unit IS NULL)),
  CHECK ((per_package_base_microunits IS NULL) = (remaining_base_microunits IS NULL)),
  CHECK (conversion_source IN ('explicit','product_profile','unknown')),
  CHECK (revision >= 1),
  FOREIGN KEY ("batch_id") REFERENCES "inventory_batches"("batch_id") ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;`,
  `CREATE TABLE "nutrition_search_audit" (
  "resolution_id" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_name" TEXT NOT NULL,
  "source_ref" TEXT NOT NULL,
  "retrieved_at" TEXT NOT NULL,
  "match_basis" TEXT NOT NULL,
  "confidence_microunits" INTEGER NOT NULL,
  "license_decision" TEXT NOT NULL,
  "cache_decision" TEXT NOT NULL,
  "adopted_profile_id" TEXT,
  "payload_json" TEXT NOT NULL,
  PRIMARY KEY ("resolution_id"),
  CHECK (length(query) >= 1),
  CHECK (confidence_microunits >= 0 AND confidence_microunits <= 1000000),
  CHECK (json_valid(payload_json)),
  FOREIGN KEY ("adopted_profile_id") REFERENCES "nutrition_profiles"("nutrition_profile_id") ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;`,
  `CREATE TABLE "goal_recommendations" (
  "recommendation_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "profile_version" TEXT NOT NULL,
  "goals_json" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "basis_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "confirmed_at" TEXT,
  "invalidated_at" TEXT,
  "revision" INTEGER NOT NULL,
  PRIMARY KEY ("recommendation_id"),
  CHECK (json_valid(goals_json) AND json_type(goals_json) = 'object'),
  CHECK (json_valid(basis_json) AND json_type(basis_json) = 'object'),
  CHECK (status IN ('pending','confirmed','rejected','superseded')),
  CHECK (revision >= 1),
  CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL)),
  CHECK ((status IN ('rejected','superseded')) = (invalidated_at IS NOT NULL))
) STRICT;`,
] as const;

export const MIGRATION_V2_INDEX_STATEMENTS = [
  `CREATE UNIQUE INDEX "ux_pending_candidate_idempotency" ON "pending_candidates" ("idempotency_key");`,
  `CREATE INDEX "ix_pending_candidate_conversation_status" ON "pending_candidates" ("conversation_id", "status", "created_at");`,
  `CREATE INDEX "ix_inventory_quantity_remaining" ON "inventory_quantity_models" ("base_unit", "remaining_base_microunits");`,
  `CREATE INDEX "ix_nutrition_search_query_time" ON "nutrition_search_audit" ("query", "retrieved_at");`,
  `CREATE UNIQUE INDEX "ux_goal_recommendation_pending_user" ON "goal_recommendations" ("user_id") WHERE status = 'pending';`,
  `CREATE INDEX "ix_goal_recommendation_user_created" ON "goal_recommendations" ("user_id", "created_at");`,
] as const;

export const MIGRATION_V2_TABLE_NAMES = [
  "pending_candidates",
  "inventory_quantity_models",
  "nutrition_search_audit",
  "goal_recommendations",
] as const;

export const MIGRATION_V2_INDEX_NAMES = [
  "ux_pending_candidate_idempotency",
  "ix_pending_candidate_conversation_status",
  "ix_inventory_quantity_remaining",
  "ix_nutrition_search_query_time",
  "ux_goal_recommendation_pending_user",
  "ix_goal_recommendation_user_created",
] as const;

export const MIGRATION_V2_FOREIGN_KEY_COUNT = 2;

export const MIGRATION_V2_MAPPING_SHA256 =
  "29602ADC19262B9160F85526183A58B674F1E6EF0D438C923D465EB65C8650BF";
