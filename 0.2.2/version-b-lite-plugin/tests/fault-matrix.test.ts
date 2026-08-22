import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../src/authority/canonical-json.js";
import {
  prepareCorrectionOperation,
  prepareMealOperation,
  preparePurchaseOperation,
  preflightMealOperation,
  applyPurchaseEffect,
} from "../src/domain/effect-bundle.js";
import { deriveDomainId } from "../src/domain/identity.js";
import {
  createDietDomainService,
  type DietDomainFailureEntry,
  type DietDomainService,
} from "../src/domain/service.js";
import type {
  DomainEnvelopeInput,
  MealItemInput,
  NutritionSourceCandidate,
} from "../src/domain/types.js";
import {
  appendPreparedOperationFact,
  sealPreparedEnvelopeFacts,
} from "../src/repository/fact-commit.js";
import { finalizeEnvelope } from "../src/repository/envelope-finalize.js";
import { createContributionProgressReservation } from "../src/repository/progress-reservation.js";
import { computeRepositoryDataRevision } from "../src/repository/revision.js";
import {
  reuseServerPreview,
  type ReuseServerPreviewInput,
} from "../src/preview/store.js";
import {
  DIET_DATABASE_FILENAME,
  openDietDatabase,
  type MigrationFault,
} from "../src/storage/database.js";

const secret = Buffer.from("B-FAULT-001 test secret material 0001", "utf8");
const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as typeof import("node:sqlite");
const ownedRoots = new Set<string>();
const diagnosticKeys = ["error_code", "input_digest", "stage", "trace_id"];
const allForbiddenDiagnosticContent = [
  "source_text",
  "sql",
  "secret",
  "absolute_path",
] as const;
const frozenEffectRowIdentities = [
  ["CASE-EFFECT-001", "effect-001-after-nutrition", "after_nutrition"],
  ["CASE-EFFECT-002", "effect-002-after-inventory-write", "after_inventory_write"],
  ["CASE-EFFECT-002", "effect-002-after-issue-write", "after_issue_write"],
  [
    "CASE-EFFECT-002",
    "effect-002-after-progress-contribution-prepared",
    "after_progress_contribution_prepared",
  ],
  ["CASE-EFFECT-003", "effect-003-after-finalization-row", "after_finalization_row"],
  ["CASE-EFFECT-003", "effect-003-after-envelope", "after_envelope"],
  ["CASE-EFFECT-003", "effect-003-after-idempotency", "after_idempotency"],
  ["CASE-EFFECT-003", "effect-003-before-commit", "before_commit"],
] as const;
const frozenEffectCaseAuthority = {
  "CASE-EFFECT-001": {
    assertion_paths: [
      "/oracle/failure",
      "/oracle/state_after_restart",
      "/oracle/same_key_retry",
      "/forbidden",
    ],
    forbidden: ["fact_commit_rollback", "half_effect_bundle"],
  },
  "CASE-EFFECT-002": {
    assertion_paths: [
      "/effect_bundle/late_failure_full_rollback",
      "/restart/effects_pending",
      "/same_token_retry/missing_effect_only",
      "/forbidden",
    ],
    forbidden: ["partial_effect_bundle"],
  },
  "CASE-EFFECT-003": {
    assertion_paths: [
      "/oracle/failure",
      "/oracle/state_after_restart",
      "/oracle/same_key_retry",
      "/forbidden",
    ],
    forbidden: ["duplicate_effect", "premature_receipt"],
  },
} as const;

interface CountObservation {
  readonly count: number;
  readonly unchanged_from_pre_fault: boolean;
}

interface FaultRow {
  readonly case_id: "CASE-EFFECT-001" | "CASE-EFFECT-002" | "CASE-EFFECT-003";
  readonly fault_id: string;
  readonly operation_kind: "record_meal";
  readonly fault_point: string;
  readonly expected_error_code:
    | "nutrition_effect_write_failed"
    | "effect_bundle_write_failed"
    | "envelope_finalize_write_failed";
  readonly failed_state: string;
  readonly outbox_state: string;
  readonly observations: {
    readonly command_envelope: {
      readonly state: string;
      readonly result_status: string;
    };
    readonly outbox: {
      readonly state: string;
      readonly attempt_count: number;
      readonly reason: string | null;
      readonly count: number;
    };
    readonly facts: {
      readonly event_records: number;
      readonly meal_items: number;
      readonly effect_bundle_commits: number;
      readonly unchanged_from_pre_fault: boolean;
    };
    readonly effect_bundle_checkpoints: CountObservation;
    readonly inventory_transactions: CountObservation;
    readonly nutrition_profiles: CountObservation;
    readonly nutrition_snapshots: CountObservation;
    readonly issues: CountObservation;
    readonly daily_progress_snapshots: CountObservation;
    readonly envelope_finalizations: CountObservation;
    readonly success_receipts: CountObservation;
  };
  readonly restart: {
    readonly sqlite_reopen_state: "same_as_failure";
    readonly only_unfinished_stage_may_change: boolean;
    readonly completed_effects_repeated: boolean;
  };
  readonly same_token_retry: {
    readonly action: "retry_effect_bundle" | "finalize_only";
    readonly business_writes: "only_unfinished_stage" | "finalizer_only";
    readonly completed_effects_repeated: boolean;
    readonly finalizations_added: number;
    readonly frozen_result_bytes_unchanged: boolean;
    readonly post_retry: {
      readonly outbox_terminal_count: number;
      readonly outbox_attempt_count: number;
      readonly fact_event_records: number;
      readonly fact_meal_items: number;
      readonly terminal_effect_bundle_count: number;
      readonly daily_progress_snapshot_count: number;
      readonly envelope_finalization_count: number;
      readonly success_receipt_count: number;
    };
  };
  readonly diagnostic: {
    readonly stage: DietDomainFailureEntry["stage"];
    readonly error_code: string;
    readonly trace_id: "required";
    readonly input_digest: "required";
    readonly forbidden_content: readonly (
      "source_text" | "sql" | "secret" | "absolute_path"
    )[];
  };
  readonly frozen_result: {
    readonly present: boolean;
    readonly payload_bytes_unchanged: boolean;
    readonly returns_old_result_as_new: boolean;
    readonly date_order: readonly string[];
    readonly single_day_alias_present: boolean | null;
  };
  readonly forbidden: readonly string[];
  readonly assertion_paths: readonly string[];
}

type Task6CaseId =
  | "CASE-STORAGE-005"
  | "CASE-STORAGE-006"
  | "CASE-STORAGE-007"
  | "CASE-INVENTORY-006";

const frozenTask6RowIdentities = [
  ["CASE-STORAGE-005", "storage-005-after-schema", "migration_bootstrap", "after_schema"],
  ["CASE-STORAGE-005", "storage-005-before-history", "migration_bootstrap", "before_history"],
  ["CASE-STORAGE-005", "storage-005-before-commit", "migration_bootstrap", "before_commit"],
  [
    "CASE-STORAGE-005",
    "storage-005-unknown-existing-database",
    "migration_bootstrap",
    "unknown_existing_database",
  ],
  [
    "CASE-STORAGE-005",
    "storage-005-drifted-v1-index",
    "migration_bootstrap",
    "drifted_v1_index",
  ],
  [
    "CASE-STORAGE-006",
    "storage-006-after-commit-before-reply",
    "record_multi_date",
    "after_commit_before_reply",
  ],
  ["CASE-STORAGE-007", "storage-007-changed-digest", "record_meal", "changed_digest"],
  ["CASE-STORAGE-007", "storage-007-changed-subject", "record_meal", "changed_subject"],
  ["CASE-STORAGE-007", "storage-007-changed-command", "record_meal", "changed_command"],
  [
    "CASE-INVENTORY-006",
    "inventory-006-preview-data-revision-changed",
    "confirm_inventory_selection",
    "preview_data_revision_changed",
  ],
] as const;

interface Task6FaultRow {
  readonly case_id: Task6CaseId;
  readonly fault_id: string;
  readonly operation_kind: string;
  readonly fault_point: string;
  readonly expected_error_code: string;
  readonly failed_state: string;
  readonly outbox_state: string;
  readonly observations: {
    readonly command_envelope: { readonly state: string; readonly result_status: string };
    readonly outbox: {
      readonly state: string;
      readonly attempt_count: number;
      readonly reason: string | null;
      readonly count: number;
    };
    readonly facts: {
      readonly event_records: number;
      readonly meal_items: number;
      readonly effect_bundle_commits: number;
      readonly unchanged_from_pre_fault: boolean;
    };
    readonly effect_bundle_checkpoints: CountObservation;
    readonly inventory_transactions: CountObservation;
    readonly nutrition_profiles: CountObservation;
    readonly nutrition_snapshots: CountObservation;
    readonly issues: CountObservation;
    readonly daily_progress_snapshots: CountObservation;
    readonly envelope_finalizations: CountObservation;
    readonly success_receipts: CountObservation;
  };
  readonly restart: {
    readonly sqlite_reopen_state: string;
    readonly only_unfinished_stage_may_change: boolean;
    readonly completed_effects_repeated: boolean;
  };
  readonly same_token_retry: {
    readonly action: string;
    readonly business_writes: string;
    readonly completed_effects_repeated: boolean;
    readonly finalizations_added: number;
    readonly frozen_result_bytes_unchanged: boolean;
    readonly post_retry: {
      readonly outbox_terminal_count: number | null;
      readonly outbox_attempt_count: number | null;
      readonly fact_event_records: number;
      readonly fact_meal_items: number;
      readonly terminal_effect_bundle_count: number;
      readonly daily_progress_snapshot_count: number;
      readonly envelope_finalization_count: number;
      readonly success_receipt_count: number;
    };
  };
  readonly diagnostic: {
    readonly stage: string;
    readonly error_code: string;
    readonly trace_id: string;
    readonly input_digest: string;
    readonly forbidden_content: readonly string[];
  };
  readonly frozen_result: {
    readonly present: boolean;
    readonly payload_bytes_unchanged: boolean;
    readonly returns_old_result_as_new: boolean;
    readonly date_order: readonly string[];
    readonly single_day_alias_present: boolean | null;
  };
  readonly forbidden: readonly string[];
  readonly assertion_paths: readonly string[];
}

const matrix: unknown = JSON.parse(readFileSync(
  new URL("../../shared/acceptance-cases/b-fault-matrix.json", import.meta.url),
  "utf8",
));

function matrixInvalid(reason: string): never {
  throw new Error(`B_FAULT_MATRIX_INVALID:${reason}`);
}

function matrixRecord(value: unknown, fields: readonly string[], reason: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return matrixInvalid(reason);
  const keys = Object.keys(value).sort();
  if (keys.join("\u0000") !== [...fields].sort().join("\u0000")) return matrixInvalid(reason);
  return value as Record<string, unknown>;
}

function matrixString(value: unknown, reason: string): string {
  if (typeof value !== "string" || value.length === 0) return matrixInvalid(reason);
  return value;
}

function matrixBoolean(value: unknown, reason: string): boolean {
  if (typeof value !== "boolean") return matrixInvalid(reason);
  return value;
}

function matrixCount(value: unknown, reason: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return matrixInvalid(reason);
  }
  return value;
}

function matrixStrings(value: unknown, reason: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    return matrixInvalid(reason);
  }
  return value;
}

function validateCountObservation(value: unknown, reason: string): void {
  const row = matrixRecord(value, ["count", "unchanged_from_pre_fault"], reason);
  matrixCount(row.count, `${reason}.count`);
  matrixBoolean(row.unchanged_from_pre_fault, `${reason}.unchanged_from_pre_fault`);
}

function validateFrozenEffectAuthority(row: FaultRow): void {
  const stable = row.case_id === "CASE-EFFECT-003";
  const expectedUnchanged = {
    effect_bundle_checkpoints: stable,
    inventory_transactions: stable,
    nutrition_profiles: stable,
    nutrition_snapshots: stable,
    issues: stable,
    daily_progress_snapshots: false,
    envelope_finalizations: false,
    success_receipts: false,
  } as const;
  if (row.observations.facts.unchanged_from_pre_fault !== stable) {
    return matrixInvalid("frozen_authority");
  }
  for (const [name, unchanged] of Object.entries(expectedUnchanged)) {
    if (
      row.observations[name as keyof typeof expectedUnchanged]
        .unchanged_from_pre_fault !== unchanged
    ) return matrixInvalid("frozen_authority");
  }
  if (
    row.restart.sqlite_reopen_state !== "same_as_failure" ||
    row.restart.only_unfinished_stage_may_change !== true ||
    row.restart.completed_effects_repeated !== false ||
    row.same_token_retry.completed_effects_repeated !== false ||
    row.same_token_retry.finalizations_added !== 1 ||
    row.same_token_retry.frozen_result_bytes_unchanged !== true ||
    row.frozen_result.present !== false ||
    row.frozen_result.payload_bytes_unchanged !== true ||
    row.frozen_result.returns_old_result_as_new !== false ||
    row.frozen_result.date_order.length !== 0 ||
    row.frozen_result.single_day_alias_present !== null ||
    canonicalJson(row.diagnostic.forbidden_content) !==
      canonicalJson(allForbiddenDiagnosticContent) ||
    canonicalJson(row.forbidden) !==
      canonicalJson(frozenEffectCaseAuthority[row.case_id].forbidden) ||
    canonicalJson(row.assertion_paths) !==
      canonicalJson(frozenEffectCaseAuthority[row.case_id].assertion_paths)
  ) return matrixInvalid("frozen_authority");
}

function validateEffectRow(value: unknown): FaultRow {
  const row = matrixRecord(value, [
    "assertion_paths",
    "case_id",
    "diagnostic",
    "expected_error_code",
    "failed_state",
    "fault_id",
    "fault_point",
    "forbidden",
    "frozen_result",
    "observations",
    "operation_kind",
    "outbox_state",
    "restart",
    "same_token_retry",
  ], "row_shape");
  if (!["CASE-EFFECT-001", "CASE-EFFECT-002", "CASE-EFFECT-003"].includes(String(row.case_id))) {
    return matrixInvalid("case_id");
  }
  matrixString(row.fault_id, "fault_id");
  matrixString(row.fault_point, "fault_point");
  if (row.operation_kind !== "record_meal") return matrixInvalid("operation_kind");
  if (
    row.expected_error_code !== "nutrition_effect_write_failed" &&
    row.expected_error_code !== "effect_bundle_write_failed" &&
    row.expected_error_code !== "envelope_finalize_write_failed"
  ) return matrixInvalid("expected_error_code");
  matrixString(row.failed_state, "failed_state");
  matrixString(row.outbox_state, "outbox_state");

  const observations = matrixRecord(row.observations, [
    "command_envelope",
    "daily_progress_snapshots",
    "effect_bundle_checkpoints",
    "envelope_finalizations",
    "facts",
    "inventory_transactions",
    "issues",
    "nutrition_profiles",
    "nutrition_snapshots",
    "outbox",
    "success_receipts",
  ], "observations");
  const command = matrixRecord(
    observations.command_envelope,
    ["result_status", "state"],
    "observations.command_envelope",
  );
  if (matrixString(command.state, "observations.command_envelope.state") !== row.failed_state) {
    return matrixInvalid("observations.command_envelope.state");
  }
  matrixString(command.result_status, "observations.command_envelope.result_status");
  const outbox = matrixRecord(
    observations.outbox,
    ["attempt_count", "count", "reason", "state"],
    "observations.outbox",
  );
  if (matrixString(outbox.state, "observations.outbox.state") !== row.outbox_state) {
    return matrixInvalid("observations.outbox.state");
  }
  matrixCount(outbox.attempt_count, "observations.outbox.attempt_count");
  matrixCount(outbox.count, "observations.outbox.count");
  if (outbox.reason !== null) matrixString(outbox.reason, "observations.outbox.reason");
  const facts = matrixRecord(observations.facts, [
    "effect_bundle_commits",
    "event_records",
    "meal_items",
    "unchanged_from_pre_fault",
  ], "observations.facts");
  matrixCount(facts.event_records, "observations.facts.event_records");
  matrixCount(facts.meal_items, "observations.facts.meal_items");
  matrixCount(facts.effect_bundle_commits, "observations.facts.effect_bundle_commits");
  matrixBoolean(facts.unchanged_from_pre_fault, "observations.facts.unchanged_from_pre_fault");
  for (const name of [
    "effect_bundle_checkpoints",
    "inventory_transactions",
    "nutrition_profiles",
    "nutrition_snapshots",
    "issues",
    "daily_progress_snapshots",
    "envelope_finalizations",
    "success_receipts",
  ] as const) validateCountObservation(observations[name], `observations.${name}`);

  const restart = matrixRecord(row.restart, [
    "completed_effects_repeated",
    "only_unfinished_stage_may_change",
    "sqlite_reopen_state",
  ], "restart");
  if (restart.sqlite_reopen_state !== "same_as_failure") return matrixInvalid("restart.sqlite_reopen_state");
  if (!matrixBoolean(restart.only_unfinished_stage_may_change, "restart.only_unfinished_stage_may_change")) {
    return matrixInvalid("restart.only_unfinished_stage_may_change");
  }
  if (matrixBoolean(restart.completed_effects_repeated, "restart.completed_effects_repeated")) {
    return matrixInvalid("restart.completed_effects_repeated");
  }

  const retry = matrixRecord(row.same_token_retry, [
    "action",
    "business_writes",
    "completed_effects_repeated",
    "finalizations_added",
    "frozen_result_bytes_unchanged",
    "post_retry",
  ], "same_token_retry");
  if (retry.action !== "retry_effect_bundle" && retry.action !== "finalize_only") {
    return matrixInvalid("same_token_retry.action");
  }
  if (retry.business_writes !== "only_unfinished_stage" && retry.business_writes !== "finalizer_only") {
    return matrixInvalid("same_token_retry.business_writes");
  }
  if (matrixBoolean(retry.completed_effects_repeated, "same_token_retry.completed_effects_repeated")) {
    return matrixInvalid("same_token_retry.completed_effects_repeated");
  }
  matrixCount(retry.finalizations_added, "same_token_retry.finalizations_added");
  matrixBoolean(retry.frozen_result_bytes_unchanged, "same_token_retry.frozen_result_bytes_unchanged");
  const post = matrixRecord(retry.post_retry, [
    "daily_progress_snapshot_count",
    "envelope_finalization_count",
    "fact_event_records",
    "fact_meal_items",
    "outbox_attempt_count",
    "outbox_terminal_count",
    "success_receipt_count",
    "terminal_effect_bundle_count",
  ], "same_token_retry.post_retry");
  for (const name of Object.keys(post)) {
    matrixCount(post[name], `same_token_retry.post_retry.${name}`);
  }

  const diagnostic = matrixRecord(row.diagnostic, [
    "error_code",
    "forbidden_content",
    "input_digest",
    "stage",
    "trace_id",
  ], "diagnostic");
  if (!["FactCommit", "EffectBundle", "EnvelopeFinalize"].includes(String(diagnostic.stage))) {
    return matrixInvalid("diagnostic.stage");
  }
  matrixString(diagnostic.error_code, "diagnostic.error_code");
  if (diagnostic.trace_id !== "required") return matrixInvalid("diagnostic.trace_id");
  if (diagnostic.input_digest !== "required") return matrixInvalid("diagnostic.input_digest");
  const diagnosticForbidden = matrixStrings(diagnostic.forbidden_content, "diagnostic.forbidden_content");
  if (new Set(diagnosticForbidden).size !== diagnosticForbidden.length) {
    return matrixInvalid("diagnostic.forbidden_content");
  }

  const frozen = matrixRecord(row.frozen_result, [
    "date_order",
    "payload_bytes_unchanged",
    "present",
    "returns_old_result_as_new",
    "single_day_alias_present",
  ], "frozen_result");
  matrixBoolean(frozen.present, "frozen_result.present");
  matrixBoolean(frozen.payload_bytes_unchanged, "frozen_result.payload_bytes_unchanged");
  matrixBoolean(frozen.returns_old_result_as_new, "frozen_result.returns_old_result_as_new");
  matrixStrings(frozen.date_order, "frozen_result.date_order");
  if (frozen.single_day_alias_present !== null && typeof frozen.single_day_alias_present !== "boolean") {
    return matrixInvalid("frozen_result.single_day_alias_present");
  }
  const forbidden = matrixStrings(row.forbidden, "forbidden");
  if (forbidden.length === 0 || new Set(forbidden).size !== forbidden.length) {
    return matrixInvalid("forbidden");
  }
  const assertionPaths = matrixStrings(row.assertion_paths, "assertion_paths");
  if (assertionPaths.length === 0 || assertionPaths.some((path) => !path.startsWith("/"))) {
    return matrixInvalid("assertion_paths");
  }
  return row as unknown as FaultRow;
}

function parseEffectRows(value: unknown): readonly FaultRow[] {
  const root = matrixRecord(value, [
    "case_assertion_paths",
    "case_order",
    "fault_rows",
    "matrix_id",
    "scope_limitations",
  ], "root");
  matrixString(root.matrix_id, "matrix_id");
  const caseOrder = matrixStrings(root.case_order, "case_order");
  const casePaths = matrixRecord(root.case_assertion_paths, caseOrder, "case_assertion_paths");
  for (const caseId of caseOrder) matrixStrings(casePaths[caseId], `case_assertion_paths.${caseId}`);
  for (const [caseId, authority] of Object.entries(frozenEffectCaseAuthority)) {
    if (canonicalJson(casePaths[caseId]) !== canonicalJson(authority.assertion_paths)) {
      return matrixInvalid("frozen_authority");
    }
  }
  if (
    typeof root.scope_limitations !== "object" ||
    root.scope_limitations === null ||
    Array.isArray(root.scope_limitations)
  ) return matrixInvalid("scope_limitations");
  for (const limitation of Object.values(root.scope_limitations)) {
    matrixString(limitation, "scope_limitations");
  }
  if (!Array.isArray(root.fault_rows)) return matrixInvalid("fault_rows");
  const rows = root.fault_rows
    .filter((candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      String((candidate as Record<string, unknown>).case_id).startsWith("CASE-EFFECT-")
    )
    .map(validateEffectRow);
  const identities = rows.map((row) => [
    row.case_id,
    row.fault_id,
    row.fault_point,
  ]);
  if (canonicalJson(identities) !== canonicalJson(frozenEffectRowIdentities)) {
    return matrixInvalid("effect_row_identities");
  }
  for (const row of rows) validateFrozenEffectAuthority(row);
  return Object.freeze(rows);
}

function matrixNullableCount(value: unknown, reason: string): number | null {
  return value === null ? null : matrixCount(value, reason);
}

function validateTask6Row(value: unknown): Task6FaultRow {
  const row = matrixRecord(value, [
    "assertion_paths", "case_id", "diagnostic", "expected_error_code", "failed_state",
    "fault_id", "fault_point", "forbidden", "frozen_result", "observations",
    "operation_kind", "outbox_state", "restart", "same_token_retry",
  ], "task6.row_shape");
  for (const name of [
    "case_id", "fault_id", "operation_kind", "fault_point", "expected_error_code",
    "failed_state", "outbox_state",
  ] as const) matrixString(row[name], `task6.${name}`);

  const observations = matrixRecord(row.observations, [
    "command_envelope", "daily_progress_snapshots", "effect_bundle_checkpoints",
    "envelope_finalizations", "facts", "inventory_transactions", "issues",
    "nutrition_profiles", "nutrition_snapshots", "outbox", "success_receipts",
  ], "task6.observations");
  const command = matrixRecord(
    observations.command_envelope,
    ["result_status", "state"],
    "task6.observations.command_envelope",
  );
  matrixString(command.state, "task6.observations.command_envelope.state");
  matrixString(command.result_status, "task6.observations.command_envelope.result_status");
  const outbox = matrixRecord(
    observations.outbox,
    ["attempt_count", "count", "reason", "state"],
    "task6.observations.outbox",
  );
  matrixString(outbox.state, "task6.observations.outbox.state");
  matrixCount(outbox.attempt_count, "task6.observations.outbox.attempt_count");
  matrixCount(outbox.count, "task6.observations.outbox.count");
  if (outbox.reason !== null) matrixString(outbox.reason, "task6.observations.outbox.reason");
  const facts = matrixRecord(observations.facts, [
    "effect_bundle_commits", "event_records", "meal_items", "unchanged_from_pre_fault",
  ], "task6.observations.facts");
  matrixCount(facts.event_records, "task6.observations.facts.event_records");
  matrixCount(facts.meal_items, "task6.observations.facts.meal_items");
  matrixCount(facts.effect_bundle_commits, "task6.observations.facts.effect_bundle_commits");
  matrixBoolean(facts.unchanged_from_pre_fault, "task6.observations.facts.unchanged_from_pre_fault");
  for (const name of [
    "effect_bundle_checkpoints", "inventory_transactions", "nutrition_profiles",
    "nutrition_snapshots", "issues", "daily_progress_snapshots",
    "envelope_finalizations", "success_receipts",
  ] as const) validateCountObservation(observations[name], `task6.observations.${name}`);

  const restart = matrixRecord(row.restart, [
    "completed_effects_repeated", "only_unfinished_stage_may_change", "sqlite_reopen_state",
  ], "task6.restart");
  matrixString(restart.sqlite_reopen_state, "task6.restart.sqlite_reopen_state");
  matrixBoolean(restart.only_unfinished_stage_may_change, "task6.restart.only_unfinished_stage_may_change");
  matrixBoolean(restart.completed_effects_repeated, "task6.restart.completed_effects_repeated");
  const retry = matrixRecord(row.same_token_retry, [
    "action", "business_writes", "completed_effects_repeated", "finalizations_added",
    "frozen_result_bytes_unchanged", "post_retry",
  ], "task6.same_token_retry");
  matrixString(retry.action, "task6.same_token_retry.action");
  matrixString(retry.business_writes, "task6.same_token_retry.business_writes");
  matrixBoolean(retry.completed_effects_repeated, "task6.same_token_retry.completed_effects_repeated");
  matrixCount(retry.finalizations_added, "task6.same_token_retry.finalizations_added");
  matrixBoolean(retry.frozen_result_bytes_unchanged, "task6.same_token_retry.frozen_result_bytes_unchanged");
  const post = matrixRecord(retry.post_retry, [
    "daily_progress_snapshot_count", "envelope_finalization_count", "fact_event_records",
    "fact_meal_items", "outbox_attempt_count", "outbox_terminal_count",
    "success_receipt_count", "terminal_effect_bundle_count",
  ], "task6.same_token_retry.post_retry");
  for (const name of Object.keys(post)) {
    if (name === "outbox_attempt_count" || name === "outbox_terminal_count") {
      matrixNullableCount(post[name], `task6.same_token_retry.post_retry.${name}`);
    } else {
      matrixCount(post[name], `task6.same_token_retry.post_retry.${name}`);
    }
  }

  const diagnostic = matrixRecord(row.diagnostic, [
    "error_code", "forbidden_content", "input_digest", "stage", "trace_id",
  ], "task6.diagnostic");
  matrixString(diagnostic.error_code, "task6.diagnostic.error_code");
  matrixString(diagnostic.stage, "task6.diagnostic.stage");
  matrixString(diagnostic.trace_id, "task6.diagnostic.trace_id");
  matrixString(diagnostic.input_digest, "task6.diagnostic.input_digest");
  matrixStrings(diagnostic.forbidden_content, "task6.diagnostic.forbidden_content");
  const frozen = matrixRecord(row.frozen_result, [
    "date_order", "payload_bytes_unchanged", "present", "returns_old_result_as_new",
    "single_day_alias_present",
  ], "task6.frozen_result");
  matrixBoolean(frozen.present, "task6.frozen_result.present");
  matrixBoolean(frozen.payload_bytes_unchanged, "task6.frozen_result.payload_bytes_unchanged");
  matrixBoolean(frozen.returns_old_result_as_new, "task6.frozen_result.returns_old_result_as_new");
  matrixStrings(frozen.date_order, "task6.frozen_result.date_order");
  if (frozen.single_day_alias_present !== null && typeof frozen.single_day_alias_present !== "boolean") {
    return matrixInvalid("task6.frozen_result.single_day_alias_present");
  }
  matrixStrings(row.forbidden, "task6.forbidden");
  matrixStrings(row.assertion_paths, "task6.assertion_paths");
  return row as unknown as Task6FaultRow;
}

function expectedTask6Observations(input: {
  commandState: string;
  commandResultStatus: string;
  factEffectBundles: number;
  factsUnchanged: boolean;
  checkpointCount: number;
  checkpointUnchanged: boolean;
  tableUnchanged: boolean;
  finalizationCount?: number;
  receiptCount?: number;
}): Task6FaultRow["observations"] {
  const count = (value = 0, unchanged = input.tableUnchanged) => ({
    count: value,
    unchanged_from_pre_fault: unchanged,
  });
  return {
    command_envelope: {
      state: input.commandState,
      result_status: input.commandResultStatus,
    },
    outbox: {
      state: "not_applicable",
      attempt_count: 0,
      reason: null,
      count: 0,
    },
    facts: {
      event_records: 0,
      meal_items: 0,
      effect_bundle_commits: input.factEffectBundles,
      unchanged_from_pre_fault: input.factsUnchanged,
    },
    effect_bundle_checkpoints: count(
      input.checkpointCount,
      input.checkpointUnchanged,
    ),
    inventory_transactions: count(),
    nutrition_profiles: count(),
    nutrition_snapshots: count(),
    issues: count(),
    daily_progress_snapshots: count(),
    envelope_finalizations: count(input.finalizationCount),
    success_receipts: count(input.receiptCount),
  };
}

function expectedTask6Retry(input: {
  action: string;
  terminalBundleCount?: number;
  finalizationCount?: number;
  receiptCount?: number;
}): Task6FaultRow["same_token_retry"] {
  return {
    action: input.action,
    business_writes: "none",
    completed_effects_repeated: false,
    finalizations_added: 0,
    frozen_result_bytes_unchanged: true,
    post_retry: {
      outbox_terminal_count: null,
      outbox_attempt_count: null,
      fact_event_records: 0,
      fact_meal_items: 0,
      terminal_effect_bundle_count: input.terminalBundleCount ?? 0,
      daily_progress_snapshot_count: 0,
      envelope_finalization_count: input.finalizationCount ?? 0,
      success_receipt_count: input.receiptCount ?? 0,
    },
  };
}

function expectedTask6Frozen(
  present: boolean,
  dateOrder: readonly string[] = [],
  singleDayAlias: boolean | null = null,
): Task6FaultRow["frozen_result"] {
  return {
    present,
    payload_bytes_unchanged: true,
    returns_old_result_as_new: false,
    date_order: dateOrder,
    single_day_alias_present: singleDayAlias,
  };
}

function validateFrozenTask6Authority(row: Task6FaultRow): void {
  let expected: Pick<
    Task6FaultRow,
    | "operation_kind"
    | "expected_error_code"
    | "failed_state"
    | "outbox_state"
    | "observations"
    | "restart"
    | "same_token_retry"
    | "diagnostic"
    | "frozen_result"
    | "forbidden"
  >;
  if (row.case_id === "CASE-STORAGE-005") {
    const rejectedExisting =
      row.fault_point === "unknown_existing_database" ||
      row.fault_point === "drifted_v1_index";
    expected = {
      operation_kind: "migration_bootstrap",
      expected_error_code: rejectedExisting
        ? "storage_identity_invalid"
        : "storage_migration_failed",
      failed_state: "migration_rejected",
      outbox_state: "not_applicable",
      observations: expectedTask6Observations({
        commandState: "not_applicable",
        commandResultStatus: "not_applicable",
        factEffectBundles: 0,
        factsUnchanged: rejectedExisting,
        checkpointCount: 0,
        checkpointUnchanged: false,
        tableUnchanged: rejectedExisting,
      }),
      restart: {
        sqlite_reopen_state: rejectedExisting
          ? "existing_bytes_unchanged"
          : "candidate_absent",
        only_unfinished_stage_may_change: true,
        completed_effects_repeated: false,
      },
      same_token_retry: expectedTask6Retry({
        action: rejectedExisting
          ? "reject_existing_identity"
          : "fresh_candidate_required",
      }),
      diagnostic: {
        stage: rejectedExisting ? "StorageOpen" : "StorageMigration",
        error_code: rejectedExisting
          ? "STORAGE_IDENTITY_INVALID"
          : "STORAGE_MIGRATION_FAILED",
        trace_id: "not_applicable",
        input_digest: "not_applicable",
        forbidden_content: allForbiddenDiagnosticContent,
      },
      frozen_result: expectedTask6Frozen(false),
      forbidden: [
        rejectedExisting
          ? "existing_database_bytes_changed"
          : "candidate_database_published",
      ],
    };
  } else if (row.case_id === "CASE-STORAGE-006") {
    expected = {
      operation_kind: "record_multi_date",
      expected_error_code: "response_lost",
      failed_state: "terminal_frozen",
      outbox_state: "not_applicable",
      observations: expectedTask6Observations({
        commandState: "finalized",
        commandResultStatus: "terminal",
        factEffectBundles: 1,
        factsUnchanged: true,
        checkpointCount: 1,
        checkpointUnchanged: true,
        tableUnchanged: true,
        finalizationCount: 1,
        receiptCount: 1,
      }),
      restart: {
        sqlite_reopen_state: "terminal_payload_frozen",
        only_unfinished_stage_may_change: true,
        completed_effects_repeated: false,
      },
      same_token_retry: expectedTask6Retry({
        action: "return_exact_original_result",
        terminalBundleCount: 1,
        finalizationCount: 1,
        receiptCount: 1,
      }),
      diagnostic: {
        stage: "EnvelopeFinalize",
        error_code: "ENVELOPE_FINALIZE_RESPONSE_LOST",
        trace_id: "required",
        input_digest: "required",
        forbidden_content: allForbiddenDiagnosticContent,
      },
      frozen_result: expectedTask6Frozen(
        true,
        ["2026-08-08", "2026-08-09"],
        false,
      ),
      forbidden: ["retry_recomputed_from_current_totals"],
    };
  } else if (row.case_id === "CASE-STORAGE-007") {
    expected = {
      operation_kind: "record_meal",
      expected_error_code: "idempotency_conflict",
      failed_state: "idempotency_conflict",
      outbox_state: "not_applicable",
      observations: expectedTask6Observations({
        commandState: "finalized",
        commandResultStatus: "terminal",
        factEffectBundles: 0,
        factsUnchanged: true,
        checkpointCount: 0,
        checkpointUnchanged: false,
        tableUnchanged: true,
      }),
      restart: {
        sqlite_reopen_state: "original_terminal_unchanged",
        only_unfinished_stage_may_change: true,
        completed_effects_repeated: false,
      },
      same_token_retry: expectedTask6Retry({ action: "reject_conflict" }),
      diagnostic: {
        stage: "Idempotency",
        error_code: "IDEMPOTENCY_CONFLICT",
        trace_id: "required",
        input_digest: "required",
        forbidden_content: allForbiddenDiagnosticContent,
      },
      frozen_result: expectedTask6Frozen(true),
      forbidden: ["business_write_on_conflict"],
    };
  } else {
    expected = {
      operation_kind: "confirm_inventory_selection",
      expected_error_code: "stale_revision",
      failed_state: "stale_revision_rejected",
      outbox_state: "not_applicable",
      observations: expectedTask6Observations({
        commandState: "not_applicable",
        commandResultStatus: "not_applicable",
        factEffectBundles: 0,
        factsUnchanged: false,
        checkpointCount: 0,
        checkpointUnchanged: false,
        tableUnchanged: false,
      }),
      restart: {
        sqlite_reopen_state: "candidate_change_preserved",
        only_unfinished_stage_may_change: true,
        completed_effects_repeated: false,
      },
      same_token_retry: expectedTask6Retry({ action: "require_fresh_preview" }),
      diagnostic: {
        stage: "PreviewAuthority",
        error_code: "STALE_REVISION",
        trace_id: "required",
        input_digest: "required",
        forbidden_content: allForbiddenDiagnosticContent,
      },
      frozen_result: expectedTask6Frozen(false),
      forbidden: ["stale_selection_accepted"],
    };
  }
  const actual = {
    operation_kind: row.operation_kind,
    expected_error_code: row.expected_error_code,
    failed_state: row.failed_state,
    outbox_state: row.outbox_state,
    observations: row.observations,
    restart: row.restart,
    same_token_retry: row.same_token_retry,
    diagnostic: row.diagnostic,
    frozen_result: row.frozen_result,
    forbidden: row.forbidden,
  };
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    return matrixInvalid("task6.frozen_authority");
  }
}

function parseTask6Rows(value: unknown): readonly Task6FaultRow[] {
  const root = matrixRecord(value, [
    "case_assertion_paths", "case_order", "fault_rows", "matrix_id", "scope_limitations",
  ], "root");
  const caseOrder = matrixStrings(root.case_order, "case_order");
  const task6CaseOrder = caseOrder.filter((caseId) => !caseId.startsWith("CASE-EFFECT-"));
  const casePaths = matrixRecord(root.case_assertion_paths, caseOrder, "case_assertion_paths");
  if (!Array.isArray(root.fault_rows)) return matrixInvalid("fault_rows");
  const task6Cases = new Set(task6CaseOrder);
  const rows = root.fault_rows
    .filter((candidate) =>
      typeof candidate === "object" && candidate !== null &&
      task6Cases.has(String((candidate as Record<string, unknown>).case_id)))
    .map(validateTask6Row);
  const identities = rows.map((row) => [
    row.case_id,
    row.fault_id,
    row.operation_kind,
    row.fault_point,
  ]);
  if (canonicalJson(identities) !== canonicalJson(frozenTask6RowIdentities)) {
    return matrixInvalid("task6.row_identities");
  }
  const observedCaseOrder = [...new Set(rows.map((row) => row.case_id))];
  if (canonicalJson(observedCaseOrder) !== canonicalJson(task6CaseOrder)) {
    return matrixInvalid("task6.case_coverage");
  }
  if (new Set(rows.map((row) => row.fault_id)).size !== rows.length) {
    return matrixInvalid("task6.fault_id_uniqueness");
  }
  for (const row of rows) {
    if (canonicalJson(row.assertion_paths) !== canonicalJson(casePaths[row.case_id])) {
      return matrixInvalid("task6.assertion_paths");
    }
    validateFrozenTask6Authority(row);
  }
  return Object.freeze(rows);
}

function assertExactBusinessSnapshot(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): void {
  const tables = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const table of tables) {
    if (
      !Object.hasOwn(expected, table) ||
      !Object.hasOwn(actual, table) ||
      canonicalJson(expected[table]) !== canonicalJson(actual[table])
    ) throw new Error(`B_FAULT_SNAPSHOT_MISMATCH:${table}`);
  }
}

const effectRows = parseEffectRows(matrix);
const task6Rows = parseTask6Rows(matrix);

function newTestRoot(): string {
  const root = join(tmpdir(), `diet-manager-b-fault-${randomUUID().replaceAll("-", "")}`);
  mkdirSync(root, { recursive: false });
  ownedRoots.add(root);
  return root;
}

function removeOwnedRoot(root: string): void {
  if (!ownedRoots.delete(root)) throw new Error(`unregistered test root: ${root}`);
  rmSync(root, { recursive: true, force: false });
  expect(existsSync(root)).toBe(false);
}

afterEach(() => {
  for (const root of [...ownedRoots]) removeOwnedRoot(root);
});

describe("WaterEvent transaction faults", () => {
  it.each([
    ["after_water_event", "after_event"],
    ["after_water_outbox", "after_effects"],
  ] as const)("rolls back all water business rows at %s", (fault, expected) => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T05:00:01.000Z", fault: fault as never });
      const failed = attempt(service, waterEnvelope(fault));
      const preExecute = businessSnapshot(runtime.database);
      expect(failed.run).toThrow(`FACT_COMMIT_FAILED:${expected}`);
      for (const table of ["event_records", "meal_items", "effect_outbox", "effect_bundle_commits", "daily_progress_snapshots", "envelope_finalizations"]) {
        expect(runtime.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
      }
      assertExactBusinessSnapshot(preExecute, businessSnapshot(runtime.database));
    } finally { runtime.close(); removeOwnedRoot(root); }
  });

  it("keeps the water fact but no contribution on effect failure, then retries once", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = waterEnvelope("effect-retry");
      const failed = attempt(createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-12T05:00:01.000Z",
        fault: "after_water_progress_contribution_prepared" as never,
      }), envelope);
      const preExecute = businessSnapshot(runtime.database);
      expect(failed.run).toThrow("WATER_EFFECT_FAILED:after_progress_contribution_prepared");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual({ count: 1 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM daily_progress_snapshots").get()).toEqual({ count: 0 });
      const factOnly = businessSnapshot(runtime.database);
      const recovered = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T05:00:02.000Z" });
      expect(recovered.execute(failed.input).status).toBe("committed");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM daily_progress_snapshots").get()).toEqual({ count: 1 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual({ count: 1 });
      expect((factOnly.event_records as unknown[])).toHaveLength(1);
    } finally { runtime.close(); removeOwnedRoot(root); }
  });

  it("retries finalization without duplicating WaterEvent or hydration contribution", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = waterEnvelope("finalizer-retry");
      const failed = attempt(createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-12T05:00:01.000Z", fault: "after_finalization_row",
      }), envelope);
      const preExecute = businessSnapshot(runtime.database);
      expect(failed.run).toThrow("ENVELOPE_FINALIZE_FAILED:after_finalization_row");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual({ count: 1 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM daily_progress_snapshots").get()).toEqual({ count: 0 });
      const stableEffects = businessSnapshot(runtime.database);
      const recovered = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T05:00:02.000Z" });
      expect(recovered.execute(failed.input).status).toBe("committed");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual({ count: 1 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM daily_progress_snapshots").get()).toEqual({ count: 1 });
      expect((preExecute.event_records as unknown[])).toEqual([]);
      expect((stableEffects.event_records as unknown[])).toHaveLength(1);
    } finally { runtime.close(); removeOwnedRoot(root); }
  });

  it("retries effects-stable water after an unrelated fact changes repository revision", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = waterEnvelope("stable-after-unrelated-fact");
      const failed = attempt(createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T05:00:01.000Z",
        fault: "after_finalization_row",
      }), envelope);
      expect(failed.run).toThrow("ENVELOPE_FINALIZE_FAILED:after_finalization_row");
      const stableRevision = computeRepositoryDataRevision(runtime.database);

      const unrelated = waterEnvelope("unrelated-next-day");
      const unrelatedOccurred = (unrelated.operations[0] as unknown as {
        occurred_time: { resolved_start: string; resolved_end: string };
      }).occurred_time;
      unrelatedOccurred.resolved_start = "2026-08-13T12:00:00.000Z";
      unrelatedOccurred.resolved_end = "2026-08-13T12:01:00.000Z";
      const unrelatedService = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T05:00:02.000Z",
      });
      expect(attempt(unrelatedService, unrelated).run().status).toBe("committed");
      expect(computeRepositoryDataRevision(runtime.database)).not.toBe(stableRevision);

      const recovered = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T05:00:03.000Z",
      });
      expect(recovered.execute(failed.input).status).toBe("committed");
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM event_records WHERE envelope_id = ? AND event_type = 'diet_water'",
      ).get(envelope.envelope_id)).toEqual({ count: 1 });
      expect(runtime.database.prepare(
        `SELECT COUNT(*) AS count FROM effect_outbox
         WHERE envelope_id = ? AND effect_kind = 'daily_progress_contribution' AND state = 'succeeded'`,
      ).get(envelope.envelope_id)).toEqual({ count: 1 });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM daily_progress_snapshots WHERE idempotency_result_id = ?",
      ).get(envelope.idempotency_key)).toEqual({ count: 1 });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });
});

function businessSnapshot(database: DatabaseSyncType): Record<string, unknown> {
  const tables = database.prepare(
    `SELECT name FROM sqlite_schema
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
     ORDER BY name`,
  ).all() as Array<{ name: string }>;
  return Object.fromEntries(tables.map(({ name }) => [
    name,
    database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ]));
}

function nutritionSource(sourceRef: string, productId: string | null): NutritionSourceCandidate {
  return {
    source_type: productId === null ? "public_fixture" : "product_label",
    source_ref: sourceRef,
    profile_version: 1,
    applicable_product_id: productId,
    basis_kind: "per_item",
    basis_microunits: 1_000_000,
    basis_unit: "piece",
    nutrients: {
      energy_kcal_milli: 100_000,
      protein_mg: 5_000,
      fat_mg: 2_000,
      carbohydrate_mg: 12_000,
      fiber_mg: 1_000,
      water_ml_milli: 50_000,
    },
  };
}

function mealItem(
  name: string,
  deducted: number | null,
  sourceRef: string,
  productId: string | null = null,
): MealItemInput {
  return {
    normalized_name: name,
    item_type: "food",
    amount: {
      unit: "piece",
      observed_microunits: 1_000_000,
      nutrition_adoption_microunits: 1_000_000,
      inventory_deduction_microunits: deducted,
      template_reference_microunits: null,
      evidence: "explicit",
    },
    nutrition_sources: [nutritionSource(sourceRef, productId)],
  };
}

function mealEnvelope(
  suffix: string,
  location: "home" | "outside",
  item: MealItemInput,
): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-fault-meal-${suffix}`,
    idempotency_key: `idem-fault-meal-${suffix}`,
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: `message-fault-meal-${suffix}`,
    conversation_id: "conversation-b-fault-001",
    received_at: "2026-08-12T04:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "record_meal",
      operation_id: `operation-fault-meal-${suffix}`,
      occurred_at: "2026-08-12T12:00:00.000Z",
      meal_slot: "lunch",
      location,
      items: [item],
    }],
  };
}

function purchaseEnvelope(suffix: string, name: string, productId: string): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-fault-stock-${suffix}`,
    idempotency_key: `idem-fault-stock-${suffix}`,
    command_type: "add_inventory",
    subject_scope: "user:self",
    source_message_id: `message-fault-stock-${suffix}`,
    conversation_id: "conversation-b-fault-001",
    received_at: "2026-08-12T02:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "add_inventory",
      operation_id: `operation-fault-stock-${suffix}`,
      product: { product_id: productId, normalized_name: name, product_type: "food" },
      batch_id: `batch-fault-stock-${suffix}`,
      amount: {
        unit: "piece",
        observed_microunits: 10_000_000,
        nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null,
        template_reference_microunits: null,
        evidence: "explicit",
      },
      nutrition_sources: [nutritionSource(`label-${productId}-v1`, productId)],
    }],
  };
}

function correctionEnvelope(suffix: string, targetEventId: string): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-fault-correction-${suffix}`,
    idempotency_key: `idem-fault-correction-${suffix}`,
    command_type: "correct_record",
    subject_scope: "user:self",
    source_message_id: [
      `message-fault-correction-${suffix}`,
      "private source text SELECT * FROM secrets b-fault-secret-token C:\\Users\\fault\\private.db",
    ].join(" "),
    conversation_id: "conversation-b-fault-001-correction",
    received_at: "2026-08-12T05:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "correct_record",
      operation_id: `operation-fault-correction-${suffix}`,
      target_event_id: targetEventId,
      base_revision: 1,
      item_order: 0,
      replacement_amount: {
        unit: "piece",
        observed_microunits: 3_000_000,
        nutrition_adoption_microunits: 3_000_000,
        inventory_deduction_microunits: 3_000_000,
        template_reference_microunits: null,
        evidence: "explicit",
      },
    }],
  };
}

function attempt(service: DietDomainService, envelope: DomainEnvelopeInput) {
  const preview = service.preview(envelope);
  const input = {
    envelope,
    token: preview.token,
    input_digest: preview.input_digest,
    data_revision: preview.data_revision,
  } as const;
  return { input, preview, run: () => service.execute(input) };
}

function waterEnvelope(suffix: string): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-water-fault-${suffix}`,
    idempotency_key: `idem-water-fault-${suffix}`,
    command_type: "record_water",
    subject_scope: "user:self",
    source_message_id: `message-water-fault-${suffix}`,
    conversation_id: "conversation-water-fault",
    received_at: "2026-08-12T04:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "record_water", operation_id: `operation-water-fault-${suffix}`,
      occurred_time: {
        raw_text: null, resolved_start: "2026-08-12T12:00:00.000Z", resolved_end: "2026-08-12T12:01:00.000Z",
        precision: "exact", timezone: "Asia/Shanghai", resolution_basis: "explicit",
        resolution_anchor: "2026-08-12T04:00:00.000Z", resolver_version: "diet-manager/time-parser-v1",
      }, source_text: "喝了500ml白水。",
      plain_water_ml_milli: 500_000, amount_evidence: { raw_text: "500ml", quantity: 500, unit: "ml", estimated: false },
    }],
  } as unknown as DomainEnvelopeInput;
}

function prepareMealFactBoundary(
  database: DatabaseSyncType,
  service: DietDomainService,
  envelope: DomainEnvelopeInput,
) {
  const preparedAttempt = attempt(service, envelope);
  const operation = envelope.operations[0];
  if (operation?.kind !== "record_meal") throw new Error("test operation mismatch");
  const committedAt = (database.prepare(
    "SELECT received_at FROM command_envelopes WHERE envelope_id = ?",
  ).get(envelope.envelope_id) as { received_at: string }).received_at;
  const progressReservation = createContributionProgressReservation(
    database,
    preflightMealOperation(database, secret, operation),
  );
  const prepared = prepareMealOperation({
    database,
    secret,
    token: preparedAttempt.preview.token,
    inputDigest: preparedAttempt.preview.input_digest,
    dataRevision: preparedAttempt.preview.data_revision,
    subjectScope: envelope.subject_scope,
    commandType: envelope.command_type,
    idempotencyKey: envelope.idempotency_key,
    sourceMessageId: envelope.source_message_id,
    conversationId: envelope.conversation_id,
    receivedAt: envelope.received_at,
    committedAt,
    sequence: 0,
    operation,
    progressReservation,
  });
  appendPreparedOperationFact(prepared.fact);
  return preparedAttempt;
}

function prepareCorrectionFactBoundary(
  database: DatabaseSyncType,
  service: DietDomainService,
  envelope: DomainEnvelopeInput,
) {
  const preparedAttempt = attempt(service, envelope);
  const operation = envelope.operations[0];
  if (
    operation?.kind !== "correct_record" &&
    operation?.kind !== "undo_record"
  ) throw new Error("test correction operation mismatch");
  const committedAt = (database.prepare(
    "SELECT received_at FROM command_envelopes WHERE envelope_id = ?",
  ).get(envelope.envelope_id) as { received_at: string }).received_at;
  const prepared = prepareCorrectionOperation({
    database,
    secret,
    token: preparedAttempt.preview.token,
    inputDigest: preparedAttempt.preview.input_digest,
    dataRevision: preparedAttempt.preview.data_revision,
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
  appendPreparedOperationFact(prepared.fact);
  return preparedAttempt;
}

function preparePurchaseEffectBoundary(
  database: DatabaseSyncType,
  service: DietDomainService,
  envelope: DomainEnvelopeInput,
) {
  const preparedAttempt = attempt(service, envelope);
  const operation = envelope.operations[0];
  if (operation?.kind !== "add_inventory") throw new Error("test purchase operation mismatch");
  const committedAt = (database.prepare(
    "SELECT received_at FROM command_envelopes WHERE envelope_id = ?",
  ).get(envelope.envelope_id) as { received_at: string }).received_at;
  const prepared = preparePurchaseOperation({
    database,
    secret,
    token: preparedAttempt.preview.token,
    inputDigest: preparedAttempt.preview.input_digest,
    dataRevision: preparedAttempt.preview.data_revision,
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
  appendPreparedOperationFact(prepared.fact);
  applyPurchaseEffect(database, prepared.outbox_id, committedAt);
  sealPreparedEnvelopeFacts({
    database,
    secret,
    token: preparedAttempt.preview.token,
    inputDigest: preparedAttempt.preview.input_digest,
    dataRevision: preparedAttempt.preview.data_revision,
    subjectScope: envelope.subject_scope,
    commandType: envelope.command_type,
    traceId: prepared.fact.traceId,
    expectedOperationIds: [operation.operation_id],
    sealedAt: committedAt,
  });
  return { committedAt, operation, prepared, preparedAttempt };
}

function createTerminalMealAuthority(suffix: string) {
  const root = newTestRoot();
  const runtime = openDietDatabase({ privateRuntimeRoot: root });
  const service = createDietDomainService({
    database: runtime.database,
    secret,
    now: () => "2026-08-12T05:00:00.000Z",
  });
  const envelope = mealEnvelope(
    suffix,
    "outside",
    mealItem(`terminal authority ${suffix}`, null, `public-terminal-${suffix}`),
  );
  const originalAttempt = attempt(service, envelope);
  originalAttempt.run();
  const terminalBytes = (runtime.database.prepare(
    "SELECT terminal_result_json FROM idempotency_records WHERE idempotency_key = ?",
  ).get(envelope.idempotency_key) as { terminal_result_json: string }).terminal_result_json;
  const reuseInput: ReuseServerPreviewInput = {
    database: runtime.database,
    secret,
    previewId: envelope.envelope_id,
    idempotencyKey: envelope.idempotency_key,
    inputDigest: originalAttempt.preview.input_digest,
    subjectScope: envelope.subject_scope,
    commandType: envelope.command_type,
    sourceMessageId: envelope.source_message_id,
    conversationId: envelope.conversation_id,
    previewMaterial: {
      authority_kind: "diet-manager/domain-preview/v1",
      envelope,
    },
  };
  return { envelope, reuseInput, root, runtime, terminalBytes };
}

function expectedFailureFromFactBaseline(
  baseline: Record<string, unknown>,
  row: FaultRow,
  envelopeId: string,
): Record<string, unknown> {
  const expected = structuredClone(baseline) as Record<string, Array<Record<string, unknown>>>;
  const envelopes = expected.command_envelopes ?? [];
  const envelope = envelopes.find((candidate) => candidate.envelope_id === envelopeId);
  if (!envelope) throw new Error("B_FAULT_BASELINE_INVALID:command_envelope");
  envelope.state = row.observations.command_envelope.state;
  envelope.result_status = row.observations.command_envelope.result_status;
  const outboxes = (expected.effect_outbox ?? [])
    .filter((candidate) => candidate.envelope_id === envelopeId);
  if (outboxes.length !== row.observations.outbox.count) {
    throw new Error("B_FAULT_BASELINE_INVALID:outbox_count");
  }
  const markerTime = outboxes[0]?.updated_at;
  for (const outbox of outboxes) {
    outbox.state = row.observations.outbox.state;
    outbox.attempt_count = row.observations.outbox.attempt_count;
    outbox.reason = row.observations.outbox.reason;
  }
  envelope.committed_at = markerTime;
  const idempotency = (expected.idempotency_records ?? [])
    .find((candidate) => candidate.operation_id === envelopeId);
  if (!idempotency) throw new Error("B_FAULT_BASELINE_INVALID:idempotency");
  idempotency.state = row.failed_state;
  idempotency.updated_at = markerTime;
  return expected;
}

function expectedRecoveryFromCleanFactRun(
  clean: Record<string, unknown>,
  row: FaultRow,
  envelopeId: string,
): Record<string, unknown> {
  const expected = structuredClone(clean) as Record<string, Array<Record<string, unknown>>>;
  const outboxes = (expected.effect_outbox ?? [])
    .filter((candidate) => candidate.envelope_id === envelopeId);
  for (const outbox of outboxes) {
    outbox.attempt_count = row.same_token_retry.post_retry.outbox_attempt_count;
  }
  return expected;
}

function errorPublicCode(error: unknown): string {
  const code = (error instanceof Error ? error.message : String(error)).split(":", 1)[0];
  switch (code) {
    case "NUTRITION_EFFECT_WRITE_FAILED":
      return "nutrition_effect_write_failed";
    case "MEAL_EFFECT_FAILED":
      return "effect_bundle_write_failed";
    case "ENVELOPE_FINALIZE_FAILED":
      return "envelope_finalize_write_failed";
    case "STORAGE_MIGRATION_FAILED":
      return "storage_migration_failed";
    case "STORAGE_IDENTITY_INVALID":
      return "storage_identity_invalid";
    case "ENVELOPE_FINALIZE_RESPONSE_LOST":
      return "response_lost";
    case "IDEMPOTENCY_CONFLICT":
      return "idempotency_conflict";
    case "PREVIEW_STALE":
      return "stale_revision";
    default:
      return `unclassified:${code}`;
  }
}

function task6CaseRows(caseId: Task6CaseId): readonly Task6FaultRow[] {
  const rows = task6Rows.filter((row) => row.case_id === caseId);
  if (rows.length === 0) throw new Error(`B_FAULT_MATRIX_INVALID:missing_${caseId}`);
  return rows;
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}

function readUserVersion(path: string): number {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  } finally {
    database.close();
  }
}

function scopedWriteCounts(database: DatabaseSyncType, envelopeId: string) {
  const count = (sql: string) =>
    (database.prepare(sql).get(envelopeId) as { count: number }).count;
  return {
    event_records: count("SELECT COUNT(*) AS count FROM event_records WHERE envelope_id = ?"),
    meal_items: count(
      "SELECT COUNT(*) AS count FROM meal_items m JOIN event_records e ON e.event_id = m.event_id WHERE e.envelope_id = ?",
    ),
    outbox: count("SELECT COUNT(*) AS count FROM effect_outbox WHERE envelope_id = ?"),
    effect_bundle_commits: count(
      "SELECT COUNT(*) AS count FROM effect_bundle_commits WHERE envelope_id = ?",
    ),
  };
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("B_FAULT_EXPECTED_FAILURE_MISSING");
}

function expectDiagnostic(
  entry: DietDomainFailureEntry,
  expected: FaultRow["diagnostic"],
  inputDigest: string,
): void {
  expect(Object.keys(entry).sort()).toEqual(diagnosticKeys);
  expect(entry).toEqual({
    stage: expected.stage,
    error_code: expected.error_code,
    trace_id: expect.stringMatching(/^trace-[a-f0-9]{32}$/),
    input_digest: inputDigest,
  });
  const encoded = JSON.stringify(entry).toLowerCase();
  const forbiddenValue = {
    source_text: "private source text",
    sql: "select * from secrets",
    secret: "b-fault-secret-token",
    absolute_path: "c:\\\\users\\\\fault\\\\private.db",
  } as const;
  for (const category of expected.forbidden_content) {
    expect(encoded).not.toContain(forbiddenValue[category]);
  }
}

function scopedState(database: DatabaseSyncType, envelopeId: string) {
  const count = (sql: string, ...parameters: unknown[]) =>
    (database.prepare(sql).get(...parameters) as { count: number }).count;
  return {
    envelope: database.prepare(
      "SELECT state, result_status FROM command_envelopes WHERE envelope_id = ?",
    ).get(envelopeId),
    outbox: database.prepare(
      `SELECT state, attempt_count, reason FROM effect_outbox
       WHERE envelope_id = ? ORDER BY effect_id`,
    ).all(envelopeId),
    event_records: count("SELECT COUNT(*) AS count FROM event_records WHERE envelope_id = ?", envelopeId),
    meal_items: count(
      `SELECT COUNT(*) AS count FROM meal_items m
       JOIN event_records e ON e.event_id = m.event_id WHERE e.envelope_id = ?`,
      envelopeId,
    ),
    effect_bundle_commits: count(
      "SELECT COUNT(*) AS count FROM effect_bundle_commits WHERE envelope_id = ? AND completed_at IS NOT NULL",
      envelopeId,
    ),
    effect_bundle_checkpoints: count(
      "SELECT COUNT(*) AS count FROM effect_bundle_commits WHERE envelope_id = ? AND completed_at IS NOT NULL",
      envelopeId,
    ),
    inventory_transactions: count(
      `SELECT COUNT(*) AS count FROM inventory_transactions t
       JOIN event_records e ON e.event_id = t.event_id WHERE e.envelope_id = ?`,
      envelopeId,
    ),
    nutrition_profiles: count(
      `SELECT COUNT(DISTINCT n.nutrition_profile_id) AS count FROM nutrition_snapshots n
       JOIN event_records e ON e.event_id = n.meal_event_id WHERE e.envelope_id = ?`,
      envelopeId,
    ),
    nutrition_snapshots: count(
      `SELECT COUNT(*) AS count FROM nutrition_snapshots n
       JOIN event_records e ON e.event_id = n.meal_event_id WHERE e.envelope_id = ?`,
      envelopeId,
    ),
    issues: count(
      `SELECT COUNT(*) AS count FROM issues i JOIN meal_items m ON m.item_id = i.entity_id
       JOIN event_records e ON e.event_id = m.event_id WHERE e.envelope_id = ?`,
      envelopeId,
    ),
    daily_progress_snapshots: count(
      "SELECT COUNT(*) AS count FROM daily_progress_snapshots WHERE idempotency_result_id = ?",
      (database.prepare(
        "SELECT idempotency_key FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelopeId) as { idempotency_key: string }).idempotency_key,
    ),
    finalizations: count(
      "SELECT COUNT(*) AS count FROM envelope_finalizations WHERE envelope_id = ?",
      envelopeId,
    ),
    success_receipts: count(
      `SELECT COUNT(*) AS count FROM idempotency_records
       WHERE operation_id = ? AND state = 'finalized' AND terminal_result_json IS NOT NULL`,
      envelopeId,
    ),
  };
}

function effectFixture(row: FaultRow): {
  readonly envelope: DomainEnvelopeInput;
  readonly serviceFault: string;
  readonly seeds: readonly DomainEnvelopeInput[];
} {
  const leak = "private source text SELECT * FROM secrets b-fault-secret-token C:\\Users\\fault\\private.db";
  if (row.case_id === "CASE-EFFECT-001") {
    return {
      serviceFault: "after_meal_nutrition",
      seeds: [],
      envelope: mealEnvelope(
        row.fault_point,
        "outside",
        mealItem(leak, null, leak),
      ),
    };
  }
  if (row.fault_point === "after_inventory_write") {
    const name = `matrix exact home item ${leak}`;
    const productId = "product-matrix-exact-home-item";
    return {
      serviceFault: "after_meal_first_item",
      seeds: [purchaseEnvelope(row.fault_point, name, productId)],
      envelope: mealEnvelope(
        row.fault_point,
        "home",
        mealItem(name, 1_000_000, `label-${productId}-v1`, productId),
      ),
    };
  }
  const name = `matrix home ${row.fault_point} ${leak}`;
  const productId = `product-matrix-${row.fault_point}`;
  const ambiguous = row.fault_point === "after_issue_write";
  return {
    serviceFault: row.fault_point === "after_issue_write"
      ? "after_meal_issue_write"
      : "after_meal_progress_contribution_prepared",
    seeds: ambiguous
      ? [
          purchaseEnvelope(`${row.fault_point}-a`, name, `${productId}-a`),
          purchaseEnvelope(`${row.fault_point}-b`, name, `${productId}-b`),
        ]
      : [purchaseEnvelope(row.fault_point, name, productId)],
    envelope: mealEnvelope(
      row.fault_point,
      "home",
      mealItem(
        name,
        1_000_000,
        ambiguous ? leak : `label-${productId}-v1`,
        ambiguous ? null : productId,
      ),
    ),
  };
}

function seedCorrectionTarget(service: DietDomainService, suffix: string): string {
  const name = `fault eggs ${suffix}`;
  const productId = `product-fault-eggs-${suffix}`;
  attempt(service, purchaseEnvelope(`eggs-${suffix}`, name, productId)).run();
  const target = mealEnvelope(
    `target-${suffix}`,
    "home",
    mealItem(name, 2_000_000, `label-${productId}-v1`, productId),
  );
  attempt(service, target).run();
  return deriveDomainId("event", target.idempotency_key, 0);
}

describe("B-FAULT-001 frozen EffectBundle matrix", () => {
  const mutatedMatrix = (): {
    fault_rows: Array<Record<string, unknown>>;
  } => structuredClone(matrix) as {
    fault_rows: Array<Record<string, unknown>>;
  };

  it.each(frozenEffectRowIdentities.map((identity, index) => [identity[1], index] as const))(
    "rejects deletion of frozen %s row",
    (_faultId, index) => {
      const mutated = mutatedMatrix();
      mutated.fault_rows.splice(index, 1);
      expect(() => parseEffectRows(mutated)).toThrow(
        "B_FAULT_MATRIX_INVALID:effect_row_identities",
      );
    },
  );

  it.each([
    ["fault_id", (row: Record<string, unknown>) => {
      row.fault_id = "effect-002-unique-but-unfrozen";
    }],
    ["fault_point", (row: Record<string, unknown>) => {
      row.fault_point = "after_unique_but_unfrozen";
    }],
    ["case_mapping", (row: Record<string, unknown>) => {
      row.case_id = "CASE-EFFECT-001";
    }],
  ])("rejects an exact %s identity mutation", (_name, mutate) => {
    const mutated = mutatedMatrix();
    mutate(mutated.fault_rows[2]!);
    expect(() => parseEffectRows(mutated)).toThrow(
      "B_FAULT_MATRIX_INVALID:effect_row_identities",
    );
  });

  it.each([
    ["facts unchanged", (row: Record<string, unknown>) => {
      const observations = row.observations as Record<string, Record<string, unknown>>;
      observations.facts!.unchanged_from_pre_fault =
        !observations.facts!.unchanged_from_pre_fault;
    }],
    ["table unchanged", (row: Record<string, unknown>) => {
      const observations = row.observations as Record<string, Record<string, unknown>>;
      observations.inventory_transactions!.unchanged_from_pre_fault =
        !observations.inventory_transactions!.unchanged_from_pre_fault;
    }],
    ["frozen payload bytes", (row: Record<string, unknown>) => {
      const frozen = row.frozen_result as Record<string, unknown>;
      frozen.payload_bytes_unchanged = !frozen.payload_bytes_unchanged;
    }],
    ["single-day alias", (row: Record<string, unknown>) => {
      const frozen = row.frozen_result as Record<string, unknown>;
      frozen.single_day_alias_present = true;
    }],
  ])("rejects a frozen %s authority flip", (_name, mutate) => {
    const mutated = mutatedMatrix();
    mutate(mutated.fault_rows[1]!);
    expect(() => parseEffectRows(mutated)).toThrow(
      "B_FAULT_MATRIX_INVALID:frozen_authority",
    );
  });

  it("rejects a mutation of a previously unconsumed operation_kind", () => {
    const mutated = mutatedMatrix();
    mutated.fault_rows[0]!.operation_kind = "add_inventory";
    expect(() => parseEffectRows(mutated)).toThrow(
      "B_FAULT_MATRIX_INVALID:operation_kind",
    );
  });

  it("rejects an unexpected all-business-table delta from the Fact baseline", () => {
    expect(() => assertExactBusinessSnapshot(
      { effect_outbox: [{ state: "retryable_failed" }], issues: [] },
      {
        effect_outbox: [{ state: "retryable_failed" }],
        issues: [{ issue_id: "unexpected-half-write" }],
      },
    )).toThrow("B_FAULT_SNAPSHOT_MISMATCH:issues");
  });

  it("binds each Effect row to its matrix-owned assertion paths", () => {
    const root = matrix as {
      case_assertion_paths: Record<string, readonly string[]>;
    };
    expect(new Set(effectRows.map((row) => row.fault_id)).size).toBe(effectRows.length);
    for (const row of effectRows) {
      expect(row.assertion_paths).toEqual(root.case_assertion_paths[row.case_id]);
    }
  });

  for (const row of effectRows.filter((candidate) => candidate.case_id !== "CASE-EFFECT-003")) {
    it(`${row.fault_id} rolls back the whole EffectBundle, survives reopen, and retries once`, () => {
      const root = newTestRoot();
      const baselineRoot = newTestRoot();
      let runtime = openDietDatabase({ privateRuntimeRoot: root });
      const baselineRuntime = openDietDatabase({ privateRuntimeRoot: baselineRoot });
      try {
        const fixture = effectFixture(row);
        const base = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T04:00:01.000Z",
        });
        const baseline = createDietDomainService({
          database: baselineRuntime.database,
          secret,
          now: () => "2026-08-12T04:00:01.000Z",
        });
        for (const seed of fixture.seeds) attempt(base, seed).run();
        for (const seed of fixture.seeds) attempt(baseline, seed).run();
        const baselineAttempt = prepareMealFactBoundary(
          baselineRuntime.database,
          baseline,
          fixture.envelope,
        );
        const factBaseline = businessSnapshot(baselineRuntime.database);
        const failures: DietDomainFailureEntry[] = [];
        const faulting = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T04:00:01.000Z",
          fault: fixture.serviceFault as never,
          failureSink: (entry) => {
            failures.push(entry);
            if (row.case_id === "CASE-EFFECT-001") {
              throw new Error("diagnostic sink must not win");
            }
          },
        });
        const failedAttempt = attempt(faulting, fixture.envelope);
        const primaryError = captureError(failedAttempt.run);
        expect(errorPublicCode(primaryError)).toBe(row.expected_error_code);
        expect(failures).toHaveLength(1);
        expectDiagnostic(failures[0]!, row.diagnostic, failedAttempt.preview.input_digest);

        const failed = scopedState(runtime.database, fixture.envelope.envelope_id);
        expect(failed.envelope).toEqual(row.observations.command_envelope);
        expect(failed.outbox).toEqual(Array.from(
          { length: row.observations.outbox.count },
          () => ({
            state: row.observations.outbox.state,
            attempt_count: row.observations.outbox.attempt_count,
            reason: row.observations.outbox.reason,
          }),
        ));
        expect(failed).toMatchObject({
          event_records: row.observations.facts.event_records,
          meal_items: row.observations.facts.meal_items,
          effect_bundle_commits: row.observations.facts.effect_bundle_commits,
          effect_bundle_checkpoints: row.observations.effect_bundle_checkpoints.count,
          inventory_transactions: row.observations.inventory_transactions.count,
          nutrition_profiles: row.observations.nutrition_profiles.count,
          nutrition_snapshots: row.observations.nutrition_snapshots.count,
          issues: row.observations.issues.count,
          daily_progress_snapshots: row.observations.daily_progress_snapshots.count,
          finalizations: row.observations.envelope_finalizations.count,
          success_receipts: row.observations.success_receipts.count,
        });
        const failedSnapshot = businessSnapshot(runtime.database);
        assertExactBusinessSnapshot(
          expectedFailureFromFactBaseline(
            factBaseline,
            row,
            fixture.envelope.envelope_id,
          ),
          failedSnapshot,
        );
        const failureBytes = canonicalJson(failedSnapshot);
        expect(row.frozen_result.present).toBe(false);
        expect(row.frozen_result.date_order).toEqual([]);
        expect(row.frozen_result.returns_old_result_as_new).toBe(false);
        const forbiddenEvidence: Record<string, boolean> = {
          fact_commit_rollback:
            failed.event_records === row.observations.facts.event_records &&
            failed.meal_items === row.observations.facts.meal_items,
          half_effect_bundle: canonicalJson(failedSnapshot) === canonicalJson(
            expectedFailureFromFactBaseline(factBaseline, row, fixture.envelope.envelope_id),
          ),
          partial_effect_bundle: canonicalJson(failedSnapshot) === canonicalJson(
            expectedFailureFromFactBaseline(factBaseline, row, fixture.envelope.envelope_id),
          ),
        };
        for (const forbidden of row.forbidden) expect(forbiddenEvidence[forbidden]).toBe(true);

        runtime.close();
        runtime = openDietDatabase({ privateRuntimeRoot: root });
        if (row.restart.sqlite_reopen_state === "same_as_failure") {
          expect(canonicalJson(businessSnapshot(runtime.database))).toBe(failureBytes);
        }
        const recovery = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T04:00:02.000Z",
        });
        const recovered = recovery.execute(failedAttempt.input);
        expect(row.same_token_retry.action).toBe("retry_effect_bundle");
        expect(row.same_token_retry.business_writes).toBe("only_unfinished_stage");
        const cleanResult = baseline.execute(baselineAttempt.input);
        const recoveredSnapshot = businessSnapshot(runtime.database);
        assertExactBusinessSnapshot(
          expectedRecoveryFromCleanFactRun(
            businessSnapshot(baselineRuntime.database),
            row,
            fixture.envelope.envelope_id,
          ),
          recoveredSnapshot,
        );
        expect(canonicalJson(recovered)).toBe(canonicalJson(cleanResult));
        const expected = row.same_token_retry.post_retry;
        const green = scopedState(runtime.database, fixture.envelope.envelope_id);
        expect(green).toMatchObject({
          event_records: expected.fact_event_records,
          meal_items: expected.fact_meal_items,
          effect_bundle_commits: expected.terminal_effect_bundle_count,
          finalizations: expected.envelope_finalization_count,
          success_receipts: expected.success_receipt_count,
        });
        expect(green.outbox).toHaveLength(expected.outbox_terminal_count);
        expect(green.outbox.every((value) =>
          (value as { state: string }).state === "succeeded" ||
          (value as { state: string }).state === "permanent_business_skip"
        )).toBe(true);
        expect(green.outbox.every((value) =>
          (value as { attempt_count: number }).attempt_count === expected.outbox_attempt_count
        )).toBe(true);
        expect(green.daily_progress_snapshots).toBe(expected.daily_progress_snapshot_count);
        expect(green.finalizations).toBe(row.same_token_retry.finalizations_added);
        const frozenResult = canonicalJson(recovered);
        const terminalBytes = canonicalJson(businessSnapshot(runtime.database));
        const replay = canonicalJson(recovery.execute(failedAttempt.input));
        if (row.same_token_retry.frozen_result_bytes_unchanged) {
          expect(replay).toBe(frozenResult);
        }
        expect(canonicalJson(businessSnapshot(runtime.database))).toBe(terminalBytes);
      } finally {
        runtime.close();
        baselineRuntime.close();
        removeOwnedRoot(root);
        removeOwnedRoot(baselineRoot);
      }
    });
  }
});

describe("B-FAULT-001 storage and stale-preview matrix aggregation", () => {
  const mutatedMatrix = (): {
    fault_rows: Array<Record<string, unknown>>;
  } => structuredClone(matrix) as {
    fault_rows: Array<Record<string, unknown>>;
  };

  it("executes every frozen non-Effect case in matrix order", () => {
    const root = matrix as { case_order: readonly string[] };
    expect([
      ...new Set([...effectRows, ...task6Rows].map((row) => row.case_id)),
    ]).toEqual(root.case_order);
  });

  it.each(frozenTask6RowIdentities)(
    "rejects deletion of frozen Task 6 row %s/%s",
    (_caseId, faultId) => {
      const mutated = mutatedMatrix();
      mutated.fault_rows = mutated.fault_rows.filter((row) => row.fault_id !== faultId);
      expect(() => parseTask6Rows(mutated)).toThrow(
        "B_FAULT_MATRIX_INVALID:task6.row_identities",
      );
    },
  );

  it.each([
    ["fault id", (rows: Array<Record<string, unknown>>) => {
      rows.find((row) => row.fault_id === "storage-005-before-history")!.fault_id =
        "storage-005-before-history-drifted";
    }],
    ["row order", (rows: Array<Record<string, unknown>>) => {
      const left = rows.findIndex((row) => row.fault_id === "storage-005-after-schema");
      const right = rows.findIndex((row) => row.fault_id === "storage-005-before-history");
      [rows[left], rows[right]] = [rows[right]!, rows[left]!];
    }],
    ["operation kind", (rows: Array<Record<string, unknown>>) => {
      rows.find((row) => row.fault_id === "storage-007-changed-digest")!.operation_kind =
        "add_inventory";
    }],
    ["fault point", (rows: Array<Record<string, unknown>>) => {
      rows.find((row) => row.fault_id === "storage-007-changed-command")!.fault_point =
        "changed_command_drifted";
    }],
  ] as const)("rejects frozen Task 6 %s mutation", (_name, mutate) => {
    const mutated = mutatedMatrix();
    mutate(mutated.fault_rows);
    expect(() => parseTask6Rows(mutated)).toThrow(
      "B_FAULT_MATRIX_INVALID:task6.row_identities",
    );
  });

  it.each([
    ["state", (row: Record<string, unknown>) => {
      (row.observations as Record<string, Record<string, unknown>>)
        .command_envelope!.state = "received";
    }],
    ["restart", (row: Record<string, unknown>) => {
      (row.restart as Record<string, unknown>).sqlite_reopen_state = "candidate_absent";
    }],
    ["write scope", (row: Record<string, unknown>) => {
      (row.same_token_retry as Record<string, unknown>).business_writes = "finalizer_only";
    }],
    ["table observation", (row: Record<string, unknown>) => {
      (row.observations as Record<string, Record<string, unknown>>)
        .inventory_transactions!.unchanged_from_pre_fault = false;
    }],
    ["frozen result", (row: Record<string, unknown>) => {
      (row.frozen_result as Record<string, unknown>).present = false;
    }],
    ["forbidden outcome", (row: Record<string, unknown>) => {
      row.forbidden = ["candidate_database_published"];
    }],
    ["diagnostic", (row: Record<string, unknown>) => {
      (row.diagnostic as Record<string, unknown>).stage = "FactCommit";
    }],
  ] as const)("rejects same-type frozen %s mutation", (_name, mutate) => {
    const mutated = mutatedMatrix();
    const row = mutated.fault_rows.find(
      (candidate) => candidate.fault_id === "storage-006-after-commit-before-reply",
    )!;
    mutate(row);
    expect(() => parseTask6Rows(mutated)).toThrow(
      "B_FAULT_MATRIX_INVALID:task6.frozen_authority",
    );
  });

  it("rejects deletion, observation-shape drift, and detached assertion authority", () => {
    const deleted = mutatedMatrix();
    deleted.fault_rows = deleted.fault_rows.filter(
      (row) => row.case_id !== "CASE-INVENTORY-006",
    );
    expect(() => parseTask6Rows(deleted)).toThrow(
      "B_FAULT_MATRIX_INVALID:task6.row_identities",
    );

    const observationDrift = mutatedMatrix();
    const observationRow = observationDrift.fault_rows.find(
      (row) => row.case_id === "CASE-STORAGE-006",
    )!;
    delete (observationRow.observations as {
      facts: Record<string, unknown>;
    }).facts.unchanged_from_pre_fault;
    expect(() => parseTask6Rows(observationDrift)).toThrow(
      "B_FAULT_MATRIX_INVALID:task6.observations.facts",
    );

    const detached = mutatedMatrix();
    detached.fault_rows.find((row) => row.case_id === "CASE-STORAGE-007")!
      .assertion_paths = ["/detached/oracle"];
    expect(() => parseTask6Rows(detached)).toThrow(
      "B_FAULT_MATRIX_INVALID:task6.assertion_paths",
    );
  });

  it("CASE-STORAGE-005 keeps failed candidates unpublished and rejected files byte-exact", () => {
    for (const row of task6CaseRows("CASE-STORAGE-005")) {
      const root = newTestRoot();
      const databasePath = join(root, DIET_DATABASE_FILENAME);
      if (["after_schema", "before_history", "before_commit"].includes(row.fault_point)) {
        const error = captureError(() => openDietDatabase({
          privateRuntimeRoot: root,
          now: () => "2026-08-12T00:00:00.000Z",
          migrationFault: row.fault_point as MigrationFault,
        }));
        expect(errorPublicCode(error)).toBe(row.expected_error_code);
        expect(existsSync(databasePath)).toBe(false);
        expect(readdirSync(root)).toEqual([]);
      } else {
        if (row.fault_point === "unknown_existing_database") {
          const foreign = new DatabaseSync(databasePath);
          foreign.exec("PRAGMA user_version = 17");
          foreign.exec("CREATE TABLE foreign_records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
          foreign.prepare("INSERT INTO foreign_records(value) VALUES (?)").run("byte sentinel");
          foreign.close();
        } else if (row.fault_point === "drifted_v1_index") {
          const created = openDietDatabase({ privateRuntimeRoot: root });
          created.close();
          const drifted = new DatabaseSync(databasePath);
          drifted.exec("DROP INDEX ux_mixed_item_idempotency");
          drifted.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
          drifted.close();
        } else {
          throw new Error(`B_FAULT_MATRIX_INVALID:storage_fault_point:${row.fault_point}`);
        }
        const beforeBytes = readFileSync(databasePath);
        const beforeSha = fileSha256(databasePath);
        const beforeVersion = readUserVersion(databasePath);
        const error = captureError(() => openDietDatabase({ privateRuntimeRoot: root }));
        expect(errorPublicCode(error)).toBe(row.expected_error_code);
        expect(readFileSync(databasePath)).toEqual(beforeBytes);
        expect(fileSha256(databasePath)).toBe(beforeSha);
        expect(readUserVersion(databasePath)).toBe(beforeVersion);
      }
      removeOwnedRoot(root);
    }
  });

  it("CASE-STORAGE-006 replays terminal bytes after response loss and an unrelated fact", () => {
    const [row] = task6CaseRows("CASE-STORAGE-006");
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T04:00:00.000Z",
      });
      const envelope = purchaseEnvelope(
        "terminal-multi-date",
        "terminal replay product",
        "product-terminal-replay",
      );
      const prepared = preparePurchaseEffectBoundary(runtime.database, service, envelope);
      const payload = Object.freeze({
        authority_kind: "diet-manager/storage-replay-evidence/v1",
        daily_progress_by_date: row!.frozen_result.date_order.map((date) => ({ date })),
      });
      const finalizeInput = {
        database: runtime.database,
        secret,
        token: prepared.preparedAttempt.preview.token,
        inputDigest: prepared.preparedAttempt.preview.input_digest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision: prepared.preparedAttempt.preview.data_revision,
        traceId: prepared.prepared.fact.traceId,
        resultStatus: "committed" as const,
        receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
        finalizedAt: prepared.committedAt,
        frozenAt: prepared.committedAt,
        payload,
        mixedItems: Object.freeze([]),
      };
      const lost = captureError(() => finalizeEnvelope(
        finalizeInput,
        { fault: "after_commit_before_reply" },
      ));
      expect(errorPublicCode(lost)).toBe(row!.expected_error_code);
      const terminalBytes = (runtime.database.prepare(
        "SELECT terminal_result_json FROM idempotency_records WHERE idempotency_key = ?",
      ).get(envelope.idempotency_key) as { terminal_result_json: string }).terminal_result_json;
      expect(typeof terminalBytes).toBe("string");

      attempt(service, purchaseEnvelope(
        "later-unrelated",
        "later unrelated product",
        "product-later-unrelated",
      )).run();
      const beforeRetry = businessSnapshot(runtime.database);
      const replay = finalizeEnvelope(finalizeInput);
      const afterRetry = businessSnapshot(runtime.database);
      expect(canonicalJson(replay)).toBe(terminalBytes);
      expect(afterRetry).toEqual(beforeRetry);
      expect((replay.payload as { daily_progress_by_date: Array<{ date: string }> })
        .daily_progress_by_date.map(({ date }) => date)).toEqual(row!.frozen_result.date_order);
      expect(Object.hasOwn(replay.payload as object, "daily_progress")).toBe(
        row!.frozen_result.single_day_alias_present,
      );
      expect(scopedWriteCounts(runtime.database, envelope.envelope_id)).toMatchObject({
        effect_bundle_commits: row!.same_token_retry.post_retry.terminal_effect_bundle_count,
      });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM envelope_finalizations WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({
        count: row!.same_token_retry.post_retry.envelope_finalization_count,
      });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM idempotency_records WHERE operation_id = ? AND state = 'finalized' AND terminal_result_json IS NOT NULL",
      ).get(envelope.envelope_id)).toEqual({
        count: row!.same_token_retry.post_retry.success_receipt_count,
      });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("CASE-STORAGE-007 rejects each changed terminal identity without leaking or writing", () => {
    const rows = task6CaseRows("CASE-STORAGE-007");
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T05:00:00.000Z",
      });
      const original = mealEnvelope(
        "terminal-conflict",
        "outside",
        mealItem(
          "terminal conflict meal",
          null,
          "public-terminal-conflict-meal",
        ),
      );
      expect(rows.every((row) => row.operation_kind === original.command_type)).toBe(true);
      const originalAttempt = attempt(service, original);
      originalAttempt.run();
      const terminalBytes = (runtime.database.prepare(
        "SELECT terminal_result_json FROM idempotency_records WHERE idempotency_key = ?",
      ).get(original.idempotency_key) as { terminal_result_json: string }).terminal_result_json;
      const before = businessSnapshot(runtime.database);
      const originalPreviewMaterial = {
        authority_kind: "diet-manager/domain-preview/v1",
        envelope: original,
      };

      for (const row of rows) {
        const override: {
          inputDigest?: string;
          subjectScope?: string;
          commandType?: "record_meal" | "add_inventory";
        } = {};
        let expectedDetail: string;
        if (row.fault_point === "changed_digest") {
          override.inputDigest = "F".repeat(64);
          expectedDetail = "input_digest";
        } else if (row.fault_point === "changed_subject") {
          override.subjectScope = "user:changed-subject";
          expectedDetail = "subject_scope";
        } else if (row.fault_point === "changed_command") {
          override.commandType = row.operation_kind === "record_meal"
            ? "add_inventory"
            : "record_meal";
          expectedDetail = "command_type";
        } else {
          throw new Error(`B_FAULT_MATRIX_INVALID:terminal_fault_point:${row.fault_point}`);
        }
        const changed = {
          database: runtime.database,
          secret,
          previewId: original.envelope_id,
          idempotencyKey: original.idempotency_key,
          inputDigest: originalAttempt.preview.input_digest,
          subjectScope: original.subject_scope,
          commandType: original.command_type,
          sourceMessageId: original.source_message_id,
          conversationId: original.conversation_id,
          previewMaterial: originalPreviewMaterial,
          ...override,
        };
        const first = captureError(() => reuseServerPreview(changed));
        const second = captureError(() => reuseServerPreview(changed));
        expect(errorPublicCode(first)).toBe(row.expected_error_code);
        expect(first).toEqual(new Error(`IDEMPOTENCY_CONFLICT:${expectedDetail}`));
        expect(String(second)).toBe(String(first));
        expect(String(first)).not.toContain(terminalBytes);
        assertExactBusinessSnapshot(before, businessSnapshot(runtime.database));
      }
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it.each(([
    ["invalid committed status", "state", (database: DatabaseSyncType, envelopeId: string) => {
      database.prepare(
        "UPDATE command_envelopes SET result_status = 'preview_ready' WHERE envelope_id = ?",
      ).run(envelopeId);
    }],
    ["missing committed timestamp", "state", (database: DatabaseSyncType, envelopeId: string) => {
      database.prepare(
        "UPDATE command_envelopes SET committed_at = NULL WHERE envelope_id = ?",
      ).run(envelopeId);
    }],
    ["repository identity mismatch", "identity", (
      database: DatabaseSyncType,
      envelopeId: string,
    ) => {
      database.prepare(
        "UPDATE command_envelopes SET input_digest = ? WHERE envelope_id = ?",
      ).run("E".repeat(64), envelopeId);
    }],
    ["invalid stored binding", "binding", (database: DatabaseSyncType, envelopeId: string) => {
      database.prepare(
        "UPDATE command_envelopes SET payload_json = '{}' WHERE envelope_id = ?",
      ).run(envelopeId);
    }],
    ["mismatched stored binding", "binding", (
      database: DatabaseSyncType,
      envelopeId: string,
    ) => {
      const stored = database.prepare(
        "SELECT payload_json FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelopeId) as { payload_json: string };
      const payload = JSON.parse(stored.payload_json) as {
        authority_kind: string;
        binding: Record<string, unknown>;
      };
      payload.binding.preview_id = "preview-mismatched-terminal-authority";
      database.prepare(
        "UPDATE command_envelopes SET payload_json = ? WHERE envelope_id = ?",
      ).run(canonicalJson(payload), envelopeId);
    }],
  ] as const).flatMap(([malformation, expectedDetail, corrupt]) =>
    (["digest", "subject", "command"] as const).map((conflict) =>
      [malformation, conflict, expectedDetail, corrupt] as const,
    ),
  ))(
    "fails closed on finalized-looking %s before changed %s",
    (malformation, conflict, expectedDetail, corrupt) => {
      const fixture = createTerminalMealAuthority(
        `malformed-${malformation.replaceAll(" ", "-")}-${conflict}`,
      );
      try {
        corrupt(fixture.runtime.database, fixture.envelope.envelope_id);
        const before = businessSnapshot(fixture.runtime.database);
        const changed: ReuseServerPreviewInput = {
          ...fixture.reuseInput,
          ...(conflict === "digest" ? { inputDigest: "F".repeat(64) } : {}),
          ...(conflict === "subject" ? { subjectScope: "user:changed-subject" } : {}),
          ...(conflict === "command" ? { commandType: "add_inventory" as const } : {}),
        };
        for (let repetition = 0; repetition < 2; repetition += 1) {
          const error = captureError(() => reuseServerPreview(changed));
          expect(error).toEqual(new Error(`PREVIEW_AUTHORITY_INVALID:${expectedDetail}`));
          expect(String(error)).not.toContain(fixture.terminalBytes);
        }
        assertExactBusinessSnapshot(before, businessSnapshot(fixture.runtime.database));
      } finally {
        fixture.runtime.close();
        removeOwnedRoot(fixture.root);
      }
    },
  );

  it("preserves nonterminal preview-state precedence over changed identity conflicts", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T05:30:00.000Z",
      });
      const envelope = purchaseEnvelope(
        "nonterminal-precedence",
        "nonterminal precedence product",
        "product-nonterminal-precedence",
      );
      const preview = service.preview(envelope);
      runtime.database.prepare(
        `UPDATE command_envelopes
         SET state = 'effects_pending', result_status = 'facts_committed_effects_pending',
             committed_at = received_at
         WHERE envelope_id = ?`,
      ).run(envelope.envelope_id);
      runtime.database.prepare(
        "UPDATE idempotency_records SET state = 'effects_pending' WHERE idempotency_key = ?",
      ).run(envelope.idempotency_key);

      expect(() => reuseServerPreview({
        database: runtime.database,
        secret,
        previewId: envelope.envelope_id,
        idempotencyKey: envelope.idempotency_key,
        inputDigest: "F".repeat(64),
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id,
        previewMaterial: {
          authority_kind: "diet-manager/domain-preview/v1",
          envelope,
        },
      })).toThrow("PREVIEW_AUTHORITY_INVALID:state");
      expect(preview.reused).toBe(false);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("CASE-INVENTORY-006 rejects the one-to-two-candidate stale preview with zero writes", () => {
    const [row] = task6CaseRows("CASE-INVENTORY-006");
    const root = newTestRoot();
    let runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      let service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T06:00:00.000Z",
      });
      const name = "candidate revision oats";
      attempt(service, purchaseEnvelope("candidate-a", name, "product-candidate-a")).run();
      const envelope = mealEnvelope(
        "candidate-stale-preview",
        "home",
        mealItem(name, 1_000_000, "public-candidate-stale"),
      );
      const preview = service.preview(envelope);
      attempt(service, purchaseEnvelope("candidate-b", name, "product-candidate-b")).run();
      expect(computeRepositoryDataRevision(runtime.database)).not.toBe(preview.data_revision);
      const before = businessSnapshot(runtime.database);
      runtime.close();
      runtime = openDietDatabase({ privateRuntimeRoot: root });
      service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T06:00:01.000Z",
      });
      const error = captureError(() => service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      }));
      expect(errorPublicCode(error)).toBe(row!.expected_error_code);
      expect(scopedWriteCounts(runtime.database, envelope.envelope_id)).toEqual({
        event_records: row!.observations.facts.event_records,
        meal_items: row!.observations.facts.meal_items,
        outbox: row!.observations.outbox.count,
        effect_bundle_commits: row!.observations.facts.effect_bundle_commits,
      });
      assertExactBusinessSnapshot(before, businessSnapshot(runtime.database));
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });
});

describe("B-FAULT-001 EnvelopeFinalize matrix", () => {
  for (const row of effectRows.filter((candidate) => candidate.case_id === "CASE-EFFECT-003")) {
    it(`${row.fault_id} rolls back the real meal finalizer and resumes finalizer-only`, () => {
      const root = newTestRoot();
      let runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const failures: DietDomainFailureEntry[] = [];
        const name = [
          `matrix finalizer home ${row.fault_point}`,
          "private source text SELECT * FROM secrets b-fault-secret-token C:\\Users\\fault\\private.db",
        ].join(" ");
        const productId = `product-matrix-finalizer-${row.fault_point}`;
        const base = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T03:00:01.000Z",
        });
        attempt(base, purchaseEnvelope(row.fault_point, name, productId)).run();
        const envelope = mealEnvelope(
          row.fault_point,
          "home",
          mealItem(
            name,
            1_000_000,
            `label-${productId}-v1`,
            productId,
          ),
        );
        const faulting = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T04:00:01.000Z",
          fault: row.fault_point as never,
          failureSink: (entry) => {
            failures.push(entry);
            if (row.fault_point === "after_finalization_row") {
              throw new Error("diagnostic sink must not win");
            }
          },
        });
        const failedAttempt = attempt(faulting, envelope);
        const primaryError = captureError(failedAttempt.run);
        expect(errorPublicCode(primaryError)).toBe(row.expected_error_code);
        expect(failures).toHaveLength(1);
        expectDiagnostic(failures[0]!, row.diagnostic, failedAttempt.preview.input_digest);
        const failed = scopedState(runtime.database, envelope.envelope_id);
        expect(failed.envelope).toEqual(row.observations.command_envelope);
        expect(failed.outbox).toEqual(Array.from(
          { length: row.observations.outbox.count },
          () => ({
            state: row.observations.outbox.state,
            attempt_count: row.observations.outbox.attempt_count,
            reason: row.observations.outbox.reason,
          }),
        ));
        expect(failed).toMatchObject({
          event_records: row.observations.facts.event_records,
          meal_items: row.observations.facts.meal_items,
          effect_bundle_commits: row.observations.facts.effect_bundle_commits,
          effect_bundle_checkpoints: row.observations.effect_bundle_checkpoints.count,
          inventory_transactions: row.observations.inventory_transactions.count,
          nutrition_profiles: row.observations.nutrition_profiles.count,
          nutrition_snapshots: row.observations.nutrition_snapshots.count,
          issues: row.observations.issues.count,
          daily_progress_snapshots: row.observations.daily_progress_snapshots.count,
          finalizations: row.observations.envelope_finalizations.count,
          success_receipts: row.observations.success_receipts.count,
        });
        expect(row.frozen_result.present).toBe(false);
        expect(row.frozen_result.date_order).toEqual([]);
        const stableSnapshot = businessSnapshot(runtime.database);
        const stableBytes = canonicalJson(stableSnapshot);

        runtime.close();
        runtime = openDietDatabase({ privateRuntimeRoot: root });
        if (row.restart.sqlite_reopen_state === "same_as_failure") {
          expect(canonicalJson(businessSnapshot(runtime.database))).toBe(stableBytes);
        }
        const recovery = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T04:00:02.000Z",
        });
        const recovered = recovery.execute(failedAttempt.input);
        expect(row.same_token_retry.action).toBe("finalize_only");
        expect(row.same_token_retry.business_writes).toBe("finalizer_only");
        const after = businessSnapshot(runtime.database);
        const finalizerTables = new Set([
          "command_envelopes",
          "daily_progress_snapshots",
          "envelope_finalizations",
          "idempotency_records",
        ]);
        for (const [table, rows] of Object.entries(stableSnapshot)) {
          if (!finalizerTables.has(table)) expect(after[table]).toEqual(rows);
        }
        const forbiddenEvidence: Record<string, boolean> = {
          duplicate_effect: [...Object.keys(stableSnapshot)]
            .filter((table) => !finalizerTables.has(table))
            .every((table) => canonicalJson(after[table]) === canonicalJson(stableSnapshot[table])),
          premature_receipt:
            failed.finalizations === row.observations.envelope_finalizations.count &&
            failed.success_receipts === row.observations.success_receipts.count,
        };
        for (const forbidden of row.forbidden) expect(forbiddenEvidence[forbidden]).toBe(true);
        const expected = row.same_token_retry.post_retry;
        const green = scopedState(runtime.database, envelope.envelope_id);
        expect(green).toMatchObject({
          event_records: expected.fact_event_records,
          meal_items: expected.fact_meal_items,
          effect_bundle_commits: expected.terminal_effect_bundle_count,
          daily_progress_snapshots: expected.daily_progress_snapshot_count,
          finalizations: expected.envelope_finalization_count,
          success_receipts: expected.success_receipt_count,
        });
        expect(green.outbox).toHaveLength(expected.outbox_terminal_count);
        expect(green.outbox.every((value) =>
          (value as { attempt_count: number }).attempt_count === expected.outbox_attempt_count
        )).toBe(true);
        expect(green.finalizations).toBe(row.same_token_retry.finalizations_added);
        const finalBytes = canonicalJson(businessSnapshot(runtime.database));
        const replay = canonicalJson(recovery.execute(failedAttempt.input));
        if (row.same_token_retry.frozen_result_bytes_unchanged) {
          expect(replay).toBe(canonicalJson(recovered));
        }
        expect(canonicalJson(businessSnapshot(runtime.database))).toBe(finalBytes);
      } finally {
        runtime.close();
        removeOwnedRoot(root);
      }
    });
  }
});

describe("B-FAULT-001 correction late rollback and finalizer diagnostics", () => {
  for (const fault of [
    "after_correction_claim",
    "after_correction_compensation",
    "after_correction_nutrition_progress",
  ] as const) {
    it(`${fault} leaves no partial correction EffectBundle write`, () => {
      const root = newTestRoot();
      const runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const base = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T05:00:01.000Z",
        });
        const targetEventId = seedCorrectionTarget(base, fault);
        const envelope = correctionEnvelope(fault, targetEventId);
        const preparedAttempt = prepareCorrectionFactBoundary(
          runtime.database,
          base,
          envelope,
        );
        const factBaseline = businessSnapshot(runtime.database);
        const baselineOutbox = runtime.database.prepare(
          `SELECT state, attempt_count, reason FROM effect_outbox
           WHERE envelope_id = ? ORDER BY effect_id`,
        ).all(envelope.envelope_id);
        const baselineCheckpoint = runtime.database.prepare(
          `SELECT effect_state, result_status, completed_at, payload_json
           FROM effect_bundle_commits WHERE envelope_id = ?`,
        ).get(envelope.envelope_id);
        const baselineIssues = canonicalJson(
          (factBaseline.issues ?? []) as unknown,
        );
        const failures: DietDomainFailureEntry[] = [];
        const faulting = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T05:00:02.000Z",
          fault,
          failureSink: (entry) => failures.push(entry),
        });
        const failedAttempt = attempt(faulting, envelope);
        const primaryError = captureError(failedAttempt.run);
        const internalFault = fault === "after_correction_claim"
          ? "after_claim"
          : fault === "after_correction_compensation"
            ? "after_compensation"
            : "after_nutrition_progress";
        expect(primaryError).toEqual(new Error(`CORRECTION_EFFECT_FAILED:${internalFault}`));
        assertExactBusinessSnapshot(factBaseline, businessSnapshot(runtime.database));
        expect(runtime.database.prepare(
          `SELECT state, attempt_count, reason FROM effect_outbox
           WHERE envelope_id = ? ORDER BY effect_id`,
        ).all(envelope.envelope_id)).toEqual(baselineOutbox);
        expect(baselineOutbox).toEqual(Array.from(
          { length: baselineOutbox.length },
          () => ({ state: "pending", attempt_count: 0, reason: null }),
        ));
        expect(runtime.database.prepare(
          `SELECT effect_state, result_status, completed_at, payload_json
           FROM effect_bundle_commits WHERE envelope_id = ?`,
        ).get(envelope.envelope_id)).toEqual(baselineCheckpoint);
        expect(baselineCheckpoint).toMatchObject({
          effect_state: "pending",
          result_status: "facts_committed_effects_pending",
          completed_at: null,
        });
        expect(canonicalJson(runtime.database.prepare(
          "SELECT * FROM issues ORDER BY rowid",
        ).all())).toBe(baselineIssues);
        expect(failedAttempt.input).toEqual(preparedAttempt.input);
        expect(failures).toHaveLength(1);
        expectDiagnostic(failures[0]!, {
          stage: "EffectBundle",
          error_code: "CORRECTION_EFFECT_FAILED",
          trace_id: "required",
          input_digest: "required",
          forbidden_content: allForbiddenDiagnosticContent,
        }, failedAttempt.preview.input_digest);
      } finally {
        runtime.close();
        removeOwnedRoot(root);
      }
    });
  }

  it("logs a real correction finalizer fault and retries without repeating compensation", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const base = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T05:00:01.000Z",
      });
      const targetEventId = seedCorrectionTarget(base, "finalizer");
      const failures: DietDomainFailureEntry[] = [];
      const faulting = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T05:00:02.000Z",
        fault: "after_idempotency" as never,
        failureSink: (entry) => failures.push(entry),
      });
      const envelope = correctionEnvelope("finalizer", targetEventId);
      const failedAttempt = attempt(faulting, envelope);
      expect(failedAttempt.run).toThrow("ENVELOPE_FINALIZE_FAILED:after_idempotency");
      expect(failures).toHaveLength(1);
      expectDiagnostic(failures[0]!, {
        stage: "EnvelopeFinalize",
        error_code: "ENVELOPE_FINALIZE_FAILED",
        trace_id: "required",
        input_digest: "required",
        forbidden_content: allForbiddenDiagnosticContent,
      }, failedAttempt.preview.input_digest);
      expect(runtime.database.prepare(
        "SELECT state, result_status FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({ state: "effects_stable", result_status: "effects_stable" });
      const correctionEventId = (runtime.database.prepare(
        "SELECT event_id FROM event_records WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { event_id: string }).event_id;
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE event_id = ?",
      ).get(correctionEventId)).toEqual({ count: 1 });
      const stableSnapshot = businessSnapshot(runtime.database);
      const stableOutbox = canonicalJson(runtime.database.prepare(
        `SELECT state, attempt_count, reason FROM effect_outbox
         WHERE envelope_id = ? ORDER BY effect_id`,
      ).all(envelope.envelope_id));
      const stableCheckpoint = canonicalJson(runtime.database.prepare(
        "SELECT * FROM effect_bundle_commits WHERE envelope_id = ?",
      ).get(envelope.envelope_id));
      const stableIssues = canonicalJson(runtime.database.prepare(
        "SELECT * FROM issues ORDER BY rowid",
      ).all());

      const recovery = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T05:00:03.000Z",
      });
      expect(recovery.execute(failedAttempt.input).status).toBe("committed");
      const recoveredSnapshot = businessSnapshot(runtime.database);
      const finalizerTables = new Set([
        "command_envelopes",
        "daily_progress_snapshots",
        "envelope_finalizations",
        "idempotency_records",
      ]);
      for (const [table, rows] of Object.entries(stableSnapshot)) {
        if (!finalizerTables.has(table)) expect(recoveredSnapshot[table]).toEqual(rows);
      }
      expect(canonicalJson(runtime.database.prepare(
        `SELECT state, attempt_count, reason FROM effect_outbox
         WHERE envelope_id = ? ORDER BY effect_id`,
      ).all(envelope.envelope_id))).toBe(stableOutbox);
      expect(canonicalJson(runtime.database.prepare(
        "SELECT * FROM effect_bundle_commits WHERE envelope_id = ?",
      ).get(envelope.envelope_id))).toBe(stableCheckpoint);
      expect(canonicalJson(runtime.database.prepare(
        "SELECT * FROM issues ORDER BY rowid",
      ).all())).toBe(stableIssues);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });
});

// Task 6 Step 1: undo (void) fault matrix. The public undo path crosses six fault
// boundaries — before_fact_commit, after_event, after_effects,
// after_inventory_business_writes, before_finalize, after_commit_before_reply. The
// three effect boundaries (after_event/after_effects/after_inventory_business_writes)
// and the finalizer boundary (before_finalize) already leave no partial write and no
// repeated compensation, verified by "B-FAULT-001 correction late rollback and finalizer
// diagnostics" above on the shared correction seam. These two tests cover the remaining
// fact-commit and reply-lost boundaries and assert the terminal two-snapshot invariant:
// fully unchanged, or exactly one complete void plus one compensation. Never a void
// without compensation, a duplicate compensation, a modified original payload, negative
// inventory or an orphaned row.
describe("B-FAULT undo void terminal-snapshot reliability", () => {
  function undoEnvelope(suffix: string, targetEventId: string): DomainEnvelopeInput {
    return {
      envelope_id: `envelope-fault-undo-${suffix}`,
      idempotency_key: `idem-fault-undo-${suffix}`,
      command_type: "undo_record",
      subject_scope: "user:self",
      source_message_id: `message-fault-undo-${suffix}`,
      conversation_id: "conversation-b-fault-001-undo",
      received_at: "2026-08-12T05:00:00.000Z",
      timezone: "Asia/Shanghai",
      operations: [{
        kind: "undo_record",
        operation_id: `operation-fault-undo-${suffix}`,
        target_event_id: targetEventId,
        base_revision: 1,
      }],
    };
  }

  function originalTargetPayload(database: DatabaseSyncType, targetEventId: string): string {
    return (database.prepare(
      "SELECT payload_json FROM event_records WHERE event_id = ?",
    ).get(targetEventId) as { payload_json: string }).payload_json;
  }

  function voidEventRows(database: DatabaseSyncType, targetEventId: string) {
    return database.prepare(
      "SELECT operation, base_revision FROM correction_events WHERE target_event_id = ? ORDER BY base_revision",
    ).all(targetEventId);
  }

  function compensationRows(database: DatabaseSyncType) {
    return database.prepare(
      `SELECT direction, json_extract(payload_json, '$.quantity_delta_microunits') AS delta
       FROM inventory_transactions WHERE reason_code = 'correction_compensation'`,
    ).all() as Array<{ direction: string; delta: number | string }>;
  }

  function assertExactlyOneVoidPlusCompensation(
    database: DatabaseSyncType,
    targetEventId: string,
    originalPayload: string,
  ): void {
    expect(voidEventRows(database, targetEventId)).toEqual([
      { operation: "void_event", base_revision: 1 },
    ]);
    const compensation = compensationRows(database);
    expect(compensation.length).toBe(1);
    expect(compensation[0].direction).toBe("in");
    expect(Number(compensation[0].delta) > 0).toBe(true);
    expect(originalTargetPayload(database, targetEventId)).toBe(originalPayload);
    expect(database.prepare(
      `SELECT COUNT(*) AS count FROM inventory_batch_projections
       WHERE json_extract(payload_json, '$.quantity_microunits') < 0`,
    ).get()).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  }

  it("before_fact_commit leaves the target fully unchanged, then recovers to one void plus compensation", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const base = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-12T05:00:01.000Z",
      });
      const targetEventId = seedCorrectionTarget(base, "undo-before-fact-commit");
      const originalPayload = originalTargetPayload(runtime.database, targetEventId);
      const envelope = undoEnvelope("before-fact-commit", targetEventId);

      const failures: DietDomainFailureEntry[] = [];
      const faulting = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-12T05:00:02.000Z",
        fault: "before_fact_commit",
        failureSink: (entry) => failures.push(entry),
      });
      const failedAttempt = attempt(faulting, envelope);
      expect(captureError(failedAttempt.run))
        .toEqual(new Error("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit"));
      expect(failures).toHaveLength(1);

      // Allowed snapshot A: fully unchanged — no void event, no compensation, payload intact.
      expect(voidEventRows(runtime.database, targetEventId)).toEqual([]);
      expect(compensationRows(runtime.database)).toEqual([]);
      expect(originalTargetPayload(runtime.database, targetEventId)).toBe(originalPayload);

      const recovery = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-12T05:00:03.000Z",
      });
      expect(recovery.execute(failedAttempt.input).status).toBe("committed");
      assertExactlyOneVoidPlusCompensation(runtime.database, targetEventId, originalPayload);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("after_commit_before_reply commits the void once and replays without duplicating compensation", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const base = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-12T05:00:01.000Z",
      });
      const targetEventId = seedCorrectionTarget(base, "undo-after-commit-before-reply");
      const originalPayload = originalTargetPayload(runtime.database, targetEventId);
      const envelope = undoEnvelope("after-commit-before-reply", targetEventId);

      const failures: DietDomainFailureEntry[] = [];
      const faulting = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-12T05:00:02.000Z",
        fault: "after_mixed_finalize_commit",
        failureSink: (entry) => failures.push(entry),
      });
      const failedAttempt = attempt(faulting, envelope);
      expect(captureError(failedAttempt.run))
        .toEqual(new Error("ENVELOPE_FINALIZE_RESPONSE_LOST:after_commit_before_reply"));
      expect(failures).toHaveLength(1);

      // The void and its compensation are already durable; only the reply was lost.
      assertExactlyOneVoidPlusCompensation(runtime.database, targetEventId, originalPayload);

      const recovery = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-12T05:00:03.000Z",
      });
      expect(recovery.execute(failedAttempt.input).status).toBe("committed");
      // A second replay of the same token must not duplicate the compensation.
      expect(recovery.execute(failedAttempt.input).status).toBe("committed");
      assertExactlyOneVoidPlusCompensation(runtime.database, targetEventId, originalPayload);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });
});
