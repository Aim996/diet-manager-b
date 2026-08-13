import type { DatabaseSync } from "node:sqlite";

import {
  dietManagerActions,
  type DietManagerAction,
} from "../contracts.js";
import { canonicalJson, canonicalSha256 } from "../authority/canonical-json.js";
import {
  parseMealFactPreviewMaterial,
  type MealFactPreviewMaterial,
} from "../authority/meal-fact-identity.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
import {
  freezePreviewBinding,
  issuePreviewToken,
  verifyPreviewToken,
  type PreviewBindingV1,
} from "./token.js";

const CREATE_FIELDS = [
  "commandType",
  "conversationId",
  "dataRevision",
  "database",
  "idempotencyKey",
  "inputDigest",
  "now",
  "previewId",
  "previewMaterial",
  "secret",
  "sourceMessageId",
  "subjectScope",
] as const;

const AUTHORIZE_FIELDS = [
  "commandType",
  "dataRevision",
  "database",
  "inputDigest",
  "secret",
  "subjectScope",
  "token",
] as const;

const REUSE_FIELDS = [
  "commandType",
  "conversationId",
  "database",
  "idempotencyKey",
  "inputDigest",
  "previewId",
  "previewMaterial",
  "secret",
  "sourceMessageId",
  "subjectScope",
] as const;

export interface CreateServerPreviewInput {
  database: DatabaseSync;
  secret: Uint8Array;
  previewId: string;
  idempotencyKey: string;
  inputDigest: string;
  subjectScope: string;
  commandType: DietManagerAction;
  dataRevision: string;
  sourceMessageId: string;
  conversationId: string;
  previewMaterial: unknown;
  now: string;
}

export interface CreatedServerPreview {
  binding: PreviewBindingV1;
  token: string;
  reused: boolean;
}

export interface ReuseServerPreviewInput {
  database: DatabaseSync;
  secret: Uint8Array;
  previewId: string;
  idempotencyKey: string;
  inputDigest: string;
  subjectScope: string;
  commandType: DietManagerAction;
  sourceMessageId: string;
  conversationId: string;
  previewMaterial: unknown;
}

export type PreviewStoreFault = "after_envelope";

export interface AuthorizeServerPreviewInput {
  database: DatabaseSync;
  secret: Uint8Array;
  token: string;
  inputDigest: string;
  subjectScope: string;
  commandType: DietManagerAction;
  dataRevision: string;
}

export interface AuthorizedServerPreview {
  binding: PreviewBindingV1;
  idempotency_key: string;
  envelope_state: "received";
  result_status: "preview_ready";
}

export interface AuthorizedRepositoryPreview {
  binding: PreviewBindingV1;
  idempotency_key: string;
  envelope_state: "received" | "effects_pending" | "effects_stable" | "finalized";
  result_status:
    | "preview_ready"
    | "facts_committed_effects_pending"
    | "effects_stable"
    | "committed"
    | "committed_with_issues";
}

interface FrozenCreateInput {
  database: DatabaseSync;
  secret: Uint8Array;
  previewId: string;
  idempotencyKey: string;
  inputDigest: string;
  subjectScope: string;
  commandType: DietManagerAction;
  dataRevision: string;
  sourceMessageId: string;
  conversationId: string;
  previewHash: string;
  previewMaterialV2?: MealFactPreviewMaterial;
  now: string;
}

interface FrozenAuthorizeInput {
  database: DatabaseSync;
  secret: Uint8Array;
  token: string;
  inputDigest: string;
  subjectScope: string;
  commandType: DietManagerAction;
  dataRevision: string;
}

interface FrozenReuseInput {
  database: DatabaseSync;
  secret: Uint8Array;
  previewId: string;
  idempotencyKey: string;
  inputDigest: string;
  subjectScope: string;
  commandType: DietManagerAction;
  sourceMessageId: string;
  conversationId: string;
  previewHash: string;
}

interface ExistingAuthorityRow {
  envelope_id: string;
  envelope_idempotency_key: string;
  envelope_input_digest: string;
  envelope_state: string;
  result_status: string;
  committed_at: string | null;
  source_message_id: string | null;
  conversation_id: string | null;
  payload_json: string;
  idempotency_key: string;
  operation_id: string;
  idempotency_input_digest: string;
  idempotency_state: string;
  terminal_result_json: string | null;
}

function requestInvalid(reason: string): never {
  throw new TypeError(`PREVIEW_REQUEST_INVALID:${reason}`);
}

function authorityInvalid(reason: string): never {
  throw new Error(`PREVIEW_AUTHORITY_INVALID:${reason}`);
}

function exactDataProperties<T extends readonly string[]>(
  value: unknown,
  fields: T,
): Record<T[number], PropertyDescriptor & { value: unknown }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return requestInvalid("shape");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\u0000") !== [...fields].sort().join("\u0000")
  ) {
    return requestInvalid("shape");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return requestInvalid("descriptor");
    }
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return requestInvalid("prototype");
  return descriptors as Record<T[number], PropertyDescriptor & { value: unknown }>;
}

function visibleAscii(value: unknown, field: string, maxLength = 256): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    !/^[\x20-\x7E]+$/.test(value)
  ) {
    return requestInvalid(field);
  }
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[A-F0-9]{64}$/.test(value)) {
    return requestInvalid("input_digest");
  }
  return value;
}

function command(value: unknown): DietManagerAction {
  if (
    typeof value !== "string" ||
    !dietManagerActions.includes(value as DietManagerAction)
  ) {
    return requestInvalid("command_type");
  }
  return value as DietManagerAction;
}

function database(value: unknown): DatabaseSync {
  if (typeof value !== "object" || value === null) return requestInvalid("database");
  return value as DatabaseSync;
}

function secret(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) return requestInvalid("secret");
  return Uint8Array.from(value);
}

function isoTimestamp(value: unknown): string {
  if (typeof value !== "string") return requestInvalid("now");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    return requestInvalid("now");
  }
  return value;
}

function freezeCreateInput(value: CreateServerPreviewInput): FrozenCreateInput {
  const fields = exactDataProperties(value, CREATE_FIELDS);
  const inputDigest = digest(fields.inputDigest.value);
  const previewMaterial = fields.previewMaterial.value;
  const previewHash = canonicalSha256(previewMaterial);
  let previewMaterialV2: MealFactPreviewMaterial | undefined;
  if (
    typeof previewMaterial === "object" && previewMaterial !== null &&
    !Array.isArray(previewMaterial) &&
    (previewMaterial as Record<string, unknown>).authority_kind ===
      "diet-manager/domain-preview/v2"
  ) {
    previewMaterialV2 = parseMealFactPreviewMaterial(previewMaterial);
    if (previewMaterialV2.input_digest !== inputDigest) {
      return requestInvalid("preview_material_input_digest");
    }
  }
  return Object.freeze({
    database: database(fields.database.value),
    secret: secret(fields.secret.value),
    previewId: visibleAscii(fields.previewId.value, "preview_id", 128),
    idempotencyKey: visibleAscii(fields.idempotencyKey.value, "idempotency_key"),
    inputDigest,
    subjectScope: visibleAscii(fields.subjectScope.value, "subject_scope"),
    commandType: command(fields.commandType.value),
    dataRevision: visibleAscii(fields.dataRevision.value, "data_revision"),
    sourceMessageId: visibleAscii(fields.sourceMessageId.value, "source_message_id"),
    conversationId: visibleAscii(fields.conversationId.value, "conversation_id"),
    previewHash,
    ...(previewMaterialV2 === undefined ? {} : { previewMaterialV2 }),
    now: isoTimestamp(fields.now.value),
  });
}

function freezeAuthorizeInput(value: AuthorizeServerPreviewInput): FrozenAuthorizeInput {
  const fields = exactDataProperties(value, AUTHORIZE_FIELDS);
  return Object.freeze({
    database: database(fields.database.value),
    secret: secret(fields.secret.value),
    token: visibleAscii(fields.token.value, "token", 4096),
    inputDigest: digest(fields.inputDigest.value),
    subjectScope: visibleAscii(fields.subjectScope.value, "subject_scope"),
    commandType: command(fields.commandType.value),
    dataRevision: visibleAscii(fields.dataRevision.value, "data_revision"),
  });
}

function freezeReuseInput(value: ReuseServerPreviewInput): FrozenReuseInput {
  const fields = exactDataProperties(value, REUSE_FIELDS);
  return Object.freeze({
    database: database(fields.database.value),
    secret: secret(fields.secret.value),
    previewId: visibleAscii(fields.previewId.value, "preview_id", 128),
    idempotencyKey: visibleAscii(fields.idempotencyKey.value, "idempotency_key"),
    inputDigest: digest(fields.inputDigest.value),
    subjectScope: visibleAscii(fields.subjectScope.value, "subject_scope"),
    commandType: command(fields.commandType.value),
    sourceMessageId: visibleAscii(fields.sourceMessageId.value, "source_message_id"),
    conversationId: visibleAscii(fields.conversationId.value, "conversation_id"),
    previewHash: canonicalSha256(fields.previewMaterial.value),
  });
}

function authorityPayload(
  binding: PreviewBindingV1,
  material?: MealFactPreviewMaterial,
): string {
  return material === undefined
    ? canonicalJson({
        authority_kind: "diet-manager/server-preview/v1",
        binding,
      })
    : canonicalJson({
        authority_kind: "diet-manager/server-preview/v2",
        binding,
        input_digest: material.input_digest,
        meal_fact_identities: material.meal_fact_identities,
      });
}

function storedBinding(payloadJson: string): PreviewBindingV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson) as unknown;
  } catch {
    return authorityInvalid("binding");
  }
  if (canonicalJson(parsed) !== payloadJson) return authorityInvalid("binding");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return authorityInvalid("binding");
  }
  const candidate = parsed as {
    authority_kind?: unknown;
    binding?: unknown;
    input_digest?: unknown;
    meal_fact_identities?: unknown;
  };
  const keys = Object.keys(candidate).sort().join("\u0000");
  const v1 = candidate.authority_kind === "diet-manager/server-preview/v1" &&
    keys === "authority_kind\u0000binding";
  const v2 = candidate.authority_kind === "diet-manager/server-preview/v2" &&
    keys === "authority_kind\u0000binding\u0000input_digest\u0000meal_fact_identities";
  if (!v1 && !v2) {
    return authorityInvalid("binding");
  }
  try {
    const binding = freezePreviewBinding(candidate.binding);
    if (v2) {
      const material = parseMealFactPreviewMaterial({
        authority_kind: "diet-manager/domain-preview/v2",
        input_digest: candidate.input_digest,
        meal_fact_identities: candidate.meal_fact_identities,
      });
      if (
        binding.input_digest !== material.input_digest ||
        binding.preview_hash !== canonicalSha256(material)
      ) return authorityInvalid("binding");
    }
    return binding;
  } catch {
    return authorityInvalid("binding");
  }
}

function findAuthorityByIdempotencyKey(
  database: DatabaseSync,
  idempotencyKey: string,
): ExistingAuthorityRow | undefined {
  return database
    .prepare(
      `SELECT
        e.envelope_id,
        e.idempotency_key AS envelope_idempotency_key,
        e.input_digest AS envelope_input_digest,
        e.state AS envelope_state,
        e.result_status,
        e.committed_at,
        e.source_message_id,
        e.conversation_id,
        e.payload_json,
        i.idempotency_key,
        i.operation_id,
        i.input_digest AS idempotency_input_digest,
        i.state AS idempotency_state,
        i.terminal_result_json
      FROM idempotency_records i
      LEFT JOIN command_envelopes e ON e.envelope_id = i.operation_id
      WHERE i.idempotency_key = ?`,
    )
    .get(idempotencyKey) as ExistingAuthorityRow | undefined;
}

function findAuthorityByPreviewId(
  database: DatabaseSync,
  previewId: string,
): ExistingAuthorityRow | undefined {
  return database
    .prepare(
      `SELECT
        e.envelope_id,
        e.idempotency_key AS envelope_idempotency_key,
        e.input_digest AS envelope_input_digest,
        e.state AS envelope_state,
        e.result_status,
        e.committed_at,
        e.source_message_id,
        e.conversation_id,
        e.payload_json,
        i.idempotency_key,
        i.operation_id,
        i.input_digest AS idempotency_input_digest,
        i.state AS idempotency_state,
        i.terminal_result_json
      FROM command_envelopes e
      LEFT JOIN idempotency_records i ON i.operation_id = e.envelope_id
      WHERE e.envelope_id = ?`,
    )
    .get(previewId) as ExistingAuthorityRow | undefined;
}

function assertPreviewReadyRow(row: ExistingAuthorityRow | undefined): ExistingAuthorityRow {
  if (!row || !row.envelope_id || !row.idempotency_key) return authorityInvalid("missing");
  if (
    row.envelope_id !== row.operation_id ||
    row.envelope_idempotency_key !== row.idempotency_key ||
    row.envelope_input_digest !== row.idempotency_input_digest
  ) {
    return authorityInvalid("identity");
  }
  if (
    row.envelope_state !== "received" ||
    row.result_status !== "preview_ready" ||
    row.committed_at !== null ||
    row.idempotency_state !== "preview_ready" ||
    row.terminal_result_json !== null
  ) {
    return authorityInvalid("state");
  }
  return row;
}

function assertPreviewIdentityConflicts(
  row: ExistingAuthorityRow,
  binding: PreviewBindingV1,
  inputDigest: string,
  subjectScope: string,
  commandType: DietManagerAction,
): void {
  if (row.idempotency_input_digest !== inputDigest) {
    throw new Error("IDEMPOTENCY_CONFLICT:input_digest");
  }
  if (binding.subject_scope !== subjectScope) {
    throw new Error("IDEMPOTENCY_CONFLICT:subject_scope");
  }
  if (binding.command_type !== commandType) {
    throw new Error("IDEMPOTENCY_CONFLICT:command_type");
  }
}

function isTerminalAuthorityCandidate(row: ExistingAuthorityRow): boolean {
  return (
    row.envelope_state === "finalized" &&
    row.idempotency_state === "finalized" &&
    typeof row.terminal_result_json === "string" &&
    row.terminal_result_json.length > 0
  );
}

function bindingEquals(left: PreviewBindingV1, right: PreviewBindingV1): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function assertRepositoryAuthorityRow(
  row: ExistingAuthorityRow | undefined,
  expectedBinding?: PreviewBindingV1,
): {
  binding: PreviewBindingV1;
  idempotency_key: string;
  envelope_state: AuthorizedRepositoryPreview["envelope_state"];
  result_status: AuthorizedRepositoryPreview["result_status"];
} {
  if (!row || !row.envelope_id || !row.idempotency_key) {
    return authorityInvalid("missing");
  }
  if (
    row.envelope_id !== row.operation_id ||
    row.envelope_idempotency_key !== row.idempotency_key ||
    row.envelope_input_digest !== row.idempotency_input_digest
  ) {
    return authorityInvalid("identity");
  }

  const previewReady =
    row.envelope_state === "received" &&
    row.result_status === "preview_ready" &&
    row.committed_at === null &&
    row.idempotency_state === "preview_ready" &&
    row.terminal_result_json === null;
  const factsCommitted =
    row.envelope_state === "effects_pending" &&
    row.result_status === "facts_committed_effects_pending" &&
    typeof row.committed_at === "string" &&
    row.committed_at.length > 0 &&
    row.idempotency_state === "effects_pending" &&
    row.terminal_result_json === null;
  const effectsStable =
    row.envelope_state === "effects_stable" &&
    row.result_status === "effects_stable" &&
    typeof row.committed_at === "string" &&
    row.committed_at.length > 0 &&
    row.idempotency_state === "effects_stable" &&
    row.terminal_result_json === null;
  const finalized =
    row.envelope_state === "finalized" &&
    (row.result_status === "committed" ||
      row.result_status === "committed_with_issues") &&
    typeof row.committed_at === "string" &&
    row.committed_at.length > 0 &&
    row.idempotency_state === "finalized" &&
    typeof row.terminal_result_json === "string" &&
    row.terminal_result_json.length > 0;
  if (!previewReady && !factsCommitted && !effectsStable && !finalized) {
    return authorityInvalid("state");
  }

  const binding = storedBinding(row.payload_json);
  if (
    binding.preview_id !== row.envelope_id ||
    binding.input_digest !== row.envelope_input_digest ||
    (expectedBinding !== undefined && !bindingEquals(binding, expectedBinding))
  ) {
    return authorityInvalid("binding");
  }
  return {
    binding,
    idempotency_key: row.idempotency_key,
    envelope_state: previewReady
      ? "received"
      : finalized
        ? "finalized"
        : effectsStable
          ? "effects_stable"
          : "effects_pending",
    result_status: previewReady
      ? "preview_ready"
      : finalized
        ? (row.result_status as "committed" | "committed_with_issues")
        : effectsStable
          ? "effects_stable"
          : "facts_committed_effects_pending",
  };
}

export function reuseServerPreview(
  input: ReuseServerPreviewInput,
): CreatedServerPreview | undefined {
  const frozen = freezeReuseInput(input);
  assertCurrentMigrationAuthority(frozen.database);
  const existing = findAuthorityByIdempotencyKey(frozen.database, frozen.idempotencyKey);
  if (!existing) return undefined;
  if (isTerminalAuthorityCandidate(existing)) {
    const terminal = assertRepositoryAuthorityRow(existing);
    if (terminal.envelope_state !== "finalized") return authorityInvalid("state");
    assertPreviewIdentityConflicts(
      existing,
      terminal.binding,
      frozen.inputDigest,
      frozen.subjectScope,
      frozen.commandType,
    );
  }
  const row = assertPreviewReadyRow(existing);
  const binding = storedBinding(row.payload_json);
  if (row.envelope_id !== frozen.previewId) throw new Error("IDEMPOTENCY_CONFLICT:preview_id");
  if (row.idempotency_input_digest !== frozen.inputDigest) {
    throw new Error("IDEMPOTENCY_CONFLICT:input_digest");
  }
  if (row.source_message_id !== frozen.sourceMessageId) {
    throw new Error("IDEMPOTENCY_CONFLICT:source_message_id");
  }
  if (row.conversation_id !== frozen.conversationId) {
    throw new Error("IDEMPOTENCY_CONFLICT:conversation_id");
  }
  if (binding.input_digest !== frozen.inputDigest) return authorityInvalid("binding");
  if (binding.subject_scope !== frozen.subjectScope) {
    throw new Error("IDEMPOTENCY_CONFLICT:subject_scope");
  }
  if (binding.command_type !== frozen.commandType) {
    throw new Error("IDEMPOTENCY_CONFLICT:command_type");
  }
  if (binding.preview_hash !== frozen.previewHash) {
    throw new Error("PREVIEW_CONFLICT:preview_hash");
  }
  return Object.freeze({
    binding,
    token: issuePreviewToken(binding, frozen.secret),
    reused: true,
  });
}

export function createServerPreview(
  input: CreateServerPreviewInput,
  fault?: PreviewStoreFault,
): CreatedServerPreview {
  if (fault !== undefined && fault !== "after_envelope") {
    return requestInvalid("fault");
  }
  const frozen = freezeCreateInput(input);
  const candidateBinding = freezePreviewBinding({
    preview_id: frozen.previewId,
    preview_version: 1,
    preview_hash: frozen.previewHash,
    input_digest: frozen.inputDigest,
    subject_scope: frozen.subjectScope,
    command_type: frozen.commandType,
    data_revision: frozen.dataRevision,
  });
  const candidateToken = issuePreviewToken(candidateBinding, frozen.secret);
  let transactionOpen = false;

  try {
    frozen.database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    assertCurrentMigrationAuthority(frozen.database);

    const existing = findAuthorityByIdempotencyKey(
      frozen.database,
      frozen.idempotencyKey,
    );
    if (existing) {
      if (isTerminalAuthorityCandidate(existing)) {
        const terminal = assertRepositoryAuthorityRow(existing);
        if (terminal.envelope_state !== "finalized") return authorityInvalid("state");
        assertPreviewIdentityConflicts(
          existing,
          terminal.binding,
          frozen.inputDigest,
          frozen.subjectScope,
          frozen.commandType,
        );
      }
      const row = assertPreviewReadyRow(existing);
      const originalBinding = storedBinding(row.payload_json);
      if (row.idempotency_input_digest !== frozen.inputDigest) {
        throw new Error("IDEMPOTENCY_CONFLICT:input_digest");
      }
      if (originalBinding.subject_scope !== frozen.subjectScope) {
        throw new Error("IDEMPOTENCY_CONFLICT:subject_scope");
      }
      if (originalBinding.command_type !== frozen.commandType) {
        throw new Error("IDEMPOTENCY_CONFLICT:command_type");
      }
      if (originalBinding.preview_hash !== frozen.previewHash) {
        throw new Error("PREVIEW_CONFLICT:preview_hash");
      }
      if (originalBinding.data_revision !== frozen.dataRevision) {
        throw new Error("PREVIEW_STALE:data_revision");
      }
      if (originalBinding.input_digest !== frozen.inputDigest) {
        return authorityInvalid("binding");
      }
      frozen.database.exec("ROLLBACK");
      transactionOpen = false;
      return Object.freeze({
        binding: originalBinding,
        token: issuePreviewToken(originalBinding, frozen.secret),
        reused: true,
      });
    }

    frozen.database
      .prepare(
        `INSERT INTO command_envelopes(
          envelope_id, idempotency_key, input_digest, source_message_id,
          conversation_id, state, result_status, received_at, committed_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, 'received', 'preview_ready', ?, NULL, ?)`,
      )
      .run(
        candidateBinding.preview_id,
        frozen.idempotencyKey,
        frozen.inputDigest,
        frozen.sourceMessageId,
        frozen.conversationId,
        frozen.now,
        authorityPayload(candidateBinding, frozen.previewMaterialV2),
      );
    if (fault === "after_envelope") {
      throw new Error("PREVIEW_STORE_FAILED:after_envelope");
    }
    frozen.database
      .prepare(
        `INSERT INTO idempotency_records(
          idempotency_key, operation_id, input_digest, state,
          terminal_result_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'preview_ready', NULL, ?, ?)`,
      )
      .run(
        frozen.idempotencyKey,
        candidateBinding.preview_id,
        frozen.inputDigest,
        frozen.now,
        frozen.now,
      );

    frozen.database.exec("COMMIT");
    transactionOpen = false;
    return Object.freeze({
      binding: candidateBinding,
      token: candidateToken,
      reused: false,
    });
  } catch (error) {
    if (transactionOpen) {
      try {
        frozen.database.exec("ROLLBACK");
      } catch {
        // The original authority failure remains primary.
      }
    }
    throw error;
  }
}

export function authorizeServerPreview(
  input: AuthorizeServerPreviewInput,
): AuthorizedServerPreview {
  const frozen = freezeAuthorizeInput(input);
  assertCurrentMigrationAuthority(frozen.database);
  const tokenBinding = verifyPreviewToken(frozen.token, frozen.secret);
  if (tokenBinding.input_digest !== frozen.inputDigest) {
    throw new Error("PREVIEW_BINDING_MISMATCH:input_digest");
  }
  if (tokenBinding.subject_scope !== frozen.subjectScope) {
    throw new Error("PREVIEW_BINDING_MISMATCH:subject_scope");
  }
  if (tokenBinding.command_type !== frozen.commandType) {
    throw new Error("PREVIEW_BINDING_MISMATCH:command_type");
  }
  if (tokenBinding.data_revision !== frozen.dataRevision) {
    throw new Error("PREVIEW_STALE:data_revision");
  }

  const row = assertPreviewReadyRow(
    findAuthorityByPreviewId(frozen.database, tokenBinding.preview_id),
  );
  const authoritativeBinding = storedBinding(row.payload_json);
  if (!bindingEquals(authoritativeBinding, tokenBinding)) {
    return authorityInvalid("binding");
  }
  if (row.envelope_input_digest !== tokenBinding.input_digest) {
    return authorityInvalid("identity");
  }

  return Object.freeze({
    binding: authoritativeBinding,
    idempotency_key: row.idempotency_key,
    envelope_state: "received",
    result_status: "preview_ready",
  });
}

export function authorizeRepositoryPreview(
  input: AuthorizeServerPreviewInput,
): AuthorizedRepositoryPreview {
  const frozen = freezeAuthorizeInput(input);
  assertCurrentMigrationAuthority(frozen.database);
  const tokenBinding = verifyPreviewToken(frozen.token, frozen.secret);
  if (tokenBinding.input_digest !== frozen.inputDigest) {
    throw new Error("PREVIEW_BINDING_MISMATCH:input_digest");
  }
  if (tokenBinding.subject_scope !== frozen.subjectScope) {
    throw new Error("PREVIEW_BINDING_MISMATCH:subject_scope");
  }
  if (tokenBinding.command_type !== frozen.commandType) {
    throw new Error("PREVIEW_BINDING_MISMATCH:command_type");
  }
  if (tokenBinding.data_revision !== frozen.dataRevision) {
    throw new Error("PREVIEW_STALE:data_revision");
  }

  const row = findAuthorityByPreviewId(frozen.database, tokenBinding.preview_id);
  const authority = assertRepositoryAuthorityRow(row, tokenBinding);

  return Object.freeze({
    binding: authority.binding,
    idempotency_key: authority.idempotency_key,
    envelope_state: authority.envelope_state,
    result_status: authority.result_status,
  });
}
