import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../src/authority/canonical-json.js";
import {
  prepareCorrectionOperation,
  prepareMealOperation,
  preflightMealOperation,
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
import { appendPreparedOperationFact } from "../src/repository/fact-commit.js";
import { createContributionProgressReservation } from "../src/repository/progress-reservation.js";
import { openDietDatabase } from "../src/storage/database.js";

const secret = Buffer.from("B-FAULT-001 test secret material 0001", "utf8");
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

function businessSnapshot(database: DatabaseSync): Record<string, unknown> {
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

function prepareMealFactBoundary(
  database: DatabaseSync,
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
    preflightMealOperation(database, operation),
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
  database: DatabaseSync,
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
    default:
      return `unclassified:${code}`;
  }
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

function scopedState(database: DatabaseSync, envelopeId: string) {
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
