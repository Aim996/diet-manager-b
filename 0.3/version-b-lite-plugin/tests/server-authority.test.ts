import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  canonicalJson,
  canonicalSha256,
} from "../src/authority/canonical-json.js";
import {
  issuePreviewToken,
  verifyPreviewToken,
  type PreviewBindingV1,
} from "../src/preview/token.js";
import {
  authorizeServerPreview,
  createServerPreview,
  type AuthorizeServerPreviewInput,
  type CreateServerPreviewInput,
} from "../src/preview/store.js";
import {
  assertEffectTransition,
  assertEnvelopeTransition,
  type EffectState,
  type EnvelopeState,
} from "../src/state/transition-guard.js";
import {
  assertCurrentMigrationAuthority,
  assertMigrationTransition,
  type MigrationTransitionPlan,
} from "../src/storage/migration-guard.js";
import { openDietDatabase } from "../src/storage/database.js";

const secret = Buffer.from(
  "B-MERGE-C-001 synthetic test key 0001",
  "utf8",
);
const ownedRoots = new Set<string>();

function newTestRoot(): string {
  const root = join(
    tmpdir(),
    `diet-manager-b-B-MERGE-C-001-${randomUUID().replaceAll("-", "")}`,
  );
  mkdirSync(root, { recursive: false });
  ownedRoots.add(root);
  return root;
}

function removeOwnedRoot(root: string): void {
  if (!ownedRoots.delete(root)) throw new Error(`unregistered test root: ${root}`);
  rmSync(root, { recursive: true, force: false });
  expect(existsSync(root)).toBe(false);
}

function scalar(database: { prepare(sql: string): { get(...args: unknown[]): unknown } }, sql: string): number {
  const row = database.prepare(sql).get() as Record<string, number>;
  return Number(Object.values(row)[0]);
}

function tableCounts(database: {
  prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown };
}): Record<string, number> {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return Object.fromEntries(
    tables.map(({ name }) => [name, scalar(database, `SELECT COUNT(*) FROM "${name}"`)]),
  );
}

function expectDietaryTablesEmpty(counts: Record<string, number>): void {
  const controlTables = new Set([
    "schema_migrations",
    "command_envelopes",
    "idempotency_records",
  ]);
  expect(
    Object.entries(counts)
      .filter(([name]) => !controlTables.has(name))
      .every(([, count]) => count === 0),
  ).toBe(true);
}

function createInput(
  database: CreateServerPreviewInput["database"],
  overrides: Partial<CreateServerPreviewInput> = {},
): CreateServerPreviewInput {
  return {
    database,
    secret,
    previewId: "preview-test-001",
    idempotencyKey: "idem-test-001",
    inputDigest: "B".repeat(64),
    subjectScope: "user:test-subject",
    commandType: "record_meal",
    dataRevision: "issues:0|events:EMPTY",
    sourceMessageId: "message-test-001",
    conversationId: "conversation-test-001",
    previewMaterial: {
      action: "record_meal",
      normalized_item_count: 1,
      issue_revisions: [],
    },
    now: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

function authorizeInput(
  database: AuthorizeServerPreviewInput["database"],
  token: string,
  overrides: Partial<AuthorizeServerPreviewInput> = {},
): AuthorizeServerPreviewInput {
  return {
    database,
    secret,
    token,
    inputDigest: "B".repeat(64),
    subjectScope: "user:test-subject",
    commandType: "record_meal",
    dataRevision: "issues:0|events:EMPTY",
    ...overrides,
  };
}

afterEach(() => {
  for (const root of [...ownedRoots]) removeOwnedRoot(root);
});

function binding(): PreviewBindingV1 {
  return {
    preview_id: "preview-test-001",
    preview_version: 1,
    preview_hash: "A".repeat(64),
    input_digest: "B".repeat(64),
    subject_scope: "user:test-subject",
    command_type: "record_meal",
    data_revision: "issues:0|events:EMPTY",
  };
}

describe("B-MERGE-C-001 canonical authority JSON", () => {
  test("sorts ordinary JSON deterministically and hashes the exact UTF-8 bytes", () => {
    const left = { z: [3, { b: true, a: null }], a: "value" };
    const right = { a: "value", z: [3, { a: null, b: true }] };
    const expected = '{"a":"value","z":[3,{"a":null,"b":true}]}';

    expect(canonicalJson(left)).toBe(expected);
    expect(canonicalJson(right)).toBe(expected);
    expect(canonicalSha256(left)).toBe(
      createHash("sha256").update(Buffer.from(expected, "utf8")).digest("hex").toUpperCase(),
    );
  });

  test("rejects active or non-JSON shapes without executing getters", () => {
    let getterCalls = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "unsafe";
      },
    });
    const sparse = ["first", "second"];
    delete sparse[0];
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => canonicalJson(accessor)).toThrow("AUTHORITY_JSON_INVALID:descriptor");
    expect(getterCalls).toBe(0);
    expect(() => canonicalJson(Object.create({ inherited: true }))).toThrow(
      "AUTHORITY_JSON_INVALID:prototype",
    );
    expect(() => canonicalJson(sparse)).toThrow("AUTHORITY_JSON_INVALID:sparse_array");
    expect(() => canonicalJson(cyclic)).toThrow("AUTHORITY_JSON_INVALID:cycle");
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(
      "AUTHORITY_JSON_INVALID:number",
    );
    expect(() => canonicalJson("x".repeat(262_145))).toThrow(
      "AUTHORITY_JSON_INVALID:string",
    );
  });
});

describe("B-MERGE-C-001 preview capability token", () => {
  test("round-trips one exact canonical seven-field binding", () => {
    const expected = binding();
    const token = issuePreviewToken(expected, secret);

    expect(token.split(".")).toHaveLength(3);
    expect(token.startsWith("dm-b-preview-v1.")).toBe(true);
    expect(verifyPreviewToken(token, secret)).toEqual(expected);
  });

  test("rejects forged, noncanonical, malformed and weak-key inputs", () => {
    const token = issuePreviewToken(binding(), secret);
    const forged = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(() => verifyPreviewToken(forged, secret)).toThrow(
      "PREVIEW_TOKEN_INVALID:signature",
    );

    const noncanonicalPayload = Buffer.from(
      JSON.stringify({
        preview_version: 1,
        preview_id: "preview-test-001",
        preview_hash: "A".repeat(64),
        input_digest: "B".repeat(64),
        subject_scope: "user:test-subject",
        command_type: "record_meal",
        data_revision: "issues:0|events:EMPTY",
      }),
      "utf8",
    ).toString("base64url");
    const signingInput = `dm-b-preview-v1.${noncanonicalPayload}`;
    const signature = createHmac("sha256", secret)
      .update(signingInput, "ascii")
      .digest("base64url");
    expect(() =>
      verifyPreviewToken(`${signingInput}.${signature}`, secret),
    ).toThrow("PREVIEW_TOKEN_INVALID:canonical");

    expect(() => verifyPreviewToken("dm-b-preview-v1.only-two", secret)).toThrow(
      "PREVIEW_TOKEN_INVALID:format",
    );
    expect(() => issuePreviewToken(binding(), Buffer.alloc(31, 1))).toThrow(
      "PREVIEW_TOKEN_INVALID:secret",
    );
  });

  test("rejects dynamic or drifted binding shapes before reading values", () => {
    let getterCalls = 0;
    const dynamic = binding() as unknown as Record<string, unknown>;
    Object.defineProperty(dynamic, "preview_id", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "preview-dynamic";
      },
    });

    expect(() => issuePreviewToken(dynamic as unknown as PreviewBindingV1, secret)).toThrow(
      "PREVIEW_BINDING_INVALID:descriptor",
    );
    expect(getterCalls).toBe(0);
    expect(() =>
      issuePreviewToken({ ...binding(), preview_hash: "A".repeat(63) }, secret),
    ).toThrow("PREVIEW_BINDING_INVALID:preview_hash");
    expect(() =>
      issuePreviewToken(
        { ...binding(), unexpected: true } as PreviewBindingV1,
        secret,
      ),
    ).toThrow("PREVIEW_BINDING_INVALID:shape");
  });
});

describe("B-MERGE-C-001 server state transition guards", () => {
  test("accepts only the exact forward envelope and effect edges", () => {
    const envelopeEdges: Array<[EnvelopeState, EnvelopeState]> = [
      ["received", "facts_committed"],
      ["facts_committed", "effects_pending"],
      ["effects_pending", "effects_stable"],
      ["effects_stable", "finalized"],
    ];
    const effectEdges: Array<[EffectState, EffectState]> = [
      ["pending", "processing"],
      ["processing", "succeeded"],
      ["processing", "retryable_failed"],
      ["processing", "permanent_business_skip"],
      ["retryable_failed", "processing"],
    ];

    for (const [previous, next] of envelopeEdges) {
      expect(() => assertEnvelopeTransition(previous, next)).not.toThrow();
    }
    for (const [previous, next] of effectEdges) {
      expect(() => assertEffectTransition(previous, next)).not.toThrow();
    }
  });

  test.each([
    ["envelope", "received", "effects_pending"],
    ["envelope", "effects_stable", "effects_pending"],
    ["envelope", "received", "received"],
    ["envelope", "caller_finalized", "finalized"],
    ["effect", "pending", "succeeded"],
    ["effect", "succeeded", "processing"],
    ["effect", "processing", "processing"],
    ["effect", "caller_succeeded", "succeeded"],
  ])("rejects illegal %s transition %s -> %s", (kind, previous, next) => {
    const action =
      kind === "envelope"
        ? () => assertEnvelopeTransition(previous as EnvelopeState, next as EnvelopeState)
        : () => assertEffectTransition(previous as EffectState, next as EffectState);
    expect(action).toThrow(
      `ILLEGAL_STATE_TRANSITION:${kind}:${previous}:${next}`,
    );
  });
});

describe("B-MERGE-C-001 migration authority guard", () => {
  test("accepts the exact current B migration identity", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({
      privateRuntimeRoot: root,
      now: () => "2026-08-12T00:00:00.000Z",
    });
    try {
      expect(() => assertCurrentMigrationAuthority(runtime.database)).not.toThrow();
      expect(tableCounts(runtime.database).schema_migrations).toBe(2);
      expect(
        Object.entries(tableCounts(runtime.database))
          .filter(([name]) => name !== "schema_migrations")
          .every(([, count]) => count === 0),
      ).toBe(true);
    } finally {
      runtime.close();
    }
    removeOwnedRoot(root);
  });

  test("rejects drifted version, history or schema without business writes", () => {
    for (const drift of ["user_version", "history", "schema"] as const) {
      const root = newTestRoot();
      const runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const before = tableCounts(runtime.database);
        if (drift === "user_version") {
          runtime.database.exec("PRAGMA user_version = 3");
        } else if (drift === "history") {
          runtime.database
            .prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1")
            .run("F".repeat(64));
        } else {
          runtime.database.exec(
            "CREATE TABLE unauthorized_migration (id TEXT PRIMARY KEY) STRICT",
          );
        }
        expect(() => assertCurrentMigrationAuthority(runtime.database)).toThrow(
          `ILLEGAL_MIGRATION:${drift}`,
        );
        const after = tableCounts(runtime.database);
        expect(after.event_records).toBe(before.event_records);
        expect(after.meal_items).toBe(before.meal_items);
        expect(after.inventory_transactions).toBe(before.inventory_transactions);
      } finally {
        runtime.close();
      }
      removeOwnedRoot(root);
    }
  });

  test("accepts only mapping-frozen migration plans", () => {
    const legal: MigrationTransitionPlan[] = [
      {
        scenario: "fresh_install",
        userVersionBefore: 0,
        userVersionAfter: 2,
        backupVerified: false,
        outcome: "commit",
      },
      {
        scenario: "upgrade_success",
        userVersionBefore: 1,
        userVersionAfter: 2,
        backupVerified: true,
        outcome: "commit",
      },
      {
        scenario: "upgrade_failure",
        userVersionBefore: 1,
        userVersionAfter: 1,
        backupVerified: true,
        outcome: "rollback",
      },
      {
        scenario: "recovery",
        userVersionBefore: 2,
        userVersionAfter: 2,
        backupVerified: true,
        outcome: "preserve",
      },
    ];
    for (const plan of legal) {
      expect(() => assertMigrationTransition(plan)).not.toThrow();
    }

    expect(() =>
      assertMigrationTransition({ ...legal[1], backupVerified: false }),
    ).toThrow("ILLEGAL_MIGRATION:backup");
    expect(() =>
      assertMigrationTransition({ ...legal[1], userVersionAfter: 3 }),
    ).toThrow("ILLEGAL_MIGRATION:transition");
    expect(() =>
      assertMigrationTransition({ ...legal[3], outcome: "commit" }),
    ).toThrow("ILLEGAL_MIGRATION:transition");
    expect(() =>
      assertMigrationTransition({
        ...legal[0],
        scenario: "caller_claimed_upgrade" as MigrationTransitionPlan["scenario"],
      }),
    ).toThrow("ILLEGAL_MIGRATION:scenario");
  });
});

describe("B-MERGE-C-001 SQLite server preview authority", () => {
  test("persists only control metadata and authorizes the exact preview after restart", () => {
    const root = newTestRoot();
    const firstRuntime = openDietDatabase({ privateRuntimeRoot: root });
    const firstInput = createInput(firstRuntime.database);
    let created: ReturnType<typeof createServerPreview>;
    try {
      created = createServerPreview(firstInput);
      expect(created.reused).toBe(false);
      expect(created.binding).toEqual({
        ...binding(),
        preview_hash: canonicalSha256(firstInput.previewMaterial),
      });
      expect(verifyPreviewToken(created.token, secret)).toEqual(created.binding);
      expect(tableCounts(firstRuntime.database)).toMatchObject({
        command_envelopes: 1,
        idempotency_records: 1,
        event_records: 0,
        meal_items: 0,
        inventory_transactions: 0,
      });
      expectDietaryTablesEmpty(tableCounts(firstRuntime.database));
      const stored = firstRuntime.database
        .prepare(
          "SELECT state, result_status, committed_at, payload_json FROM command_envelopes WHERE envelope_id = ?",
        )
        .get(created.binding.preview_id) as {
        state: string;
        result_status: string;
        committed_at: string | null;
        payload_json: string;
      };
      expect(stored).toMatchObject({
        state: "received",
        result_status: "preview_ready",
        committed_at: null,
      });
      expect(stored.payload_json).not.toContain(created.token);
      expect(stored.payload_json).not.toContain(secret.toString("utf8"));
      expect(stored.payload_json).not.toContain("source_text");
    } finally {
      firstRuntime.close();
    }

    const reopened = openDietDatabase({ privateRuntimeRoot: root });
    try {
      expect(authorizeServerPreview(authorizeInput(reopened.database, created.token))).toEqual({
        binding: created.binding,
        idempotency_key: "idem-test-001",
        envelope_state: "received",
        result_status: "preview_ready",
      });
      expectDietaryTablesEmpty(tableCounts(reopened.database));
    } finally {
      reopened.close();
    }
    removeOwnedRoot(root);
  });

  test("returns the exact original preview on an exact retry with zero row delta", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const first = createServerPreview(createInput(runtime.database));
      const before = tableCounts(runtime.database);
      const retry = createServerPreview(
        createInput(runtime.database, {
          previewId: "preview-must-not-replace-original",
          sourceMessageId: "message-retry-002",
          now: "2026-08-12T00:00:05.000Z",
        }),
      );
      expect(retry).toEqual({ ...first, reused: true });
      expect(tableCounts(runtime.database)).toEqual(before);
      expectDietaryTablesEmpty(tableCounts(runtime.database));
    } finally {
      runtime.close();
    }
    removeOwnedRoot(root);
  });

  test("rolls back the first control row when the second control write fails", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const before = tableCounts(runtime.database);
      expect(() =>
        createServerPreview(createInput(runtime.database), "after_envelope"),
      ).toThrow("PREVIEW_STORE_FAILED:after_envelope");
      expect(tableCounts(runtime.database)).toEqual(before);
      expect(tableCounts(runtime.database)).toMatchObject({
        command_envelopes: 0,
        idempotency_records: 0,
      });
      expectDietaryTablesEmpty(tableCounts(runtime.database));

      expect(createServerPreview(createInput(runtime.database)).reused).toBe(false);
      expect(tableCounts(runtime.database)).toMatchObject({
        command_envelopes: 1,
        idempotency_records: 1,
      });
    } finally {
      runtime.close();
    }
    removeOwnedRoot(root);
  });

  test("refuses preview control writes after an unregistered schema change", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      runtime.database.exec(
        "CREATE TABLE unauthorized_migration (id TEXT PRIMARY KEY) STRICT",
      );
      const before = tableCounts(runtime.database);
      expect(() => createServerPreview(createInput(runtime.database))).toThrow(
        "ILLEGAL_MIGRATION:schema",
      );
      expect(tableCounts(runtime.database)).toEqual(before);
      expect(tableCounts(runtime.database)).toMatchObject({
        command_envelopes: 0,
        idempotency_records: 0,
      });
      expectDietaryTablesEmpty(tableCounts(runtime.database));
    } finally {
      runtime.close();
    }
    removeOwnedRoot(root);
  });

  test.each([
    ["input_digest", { inputDigest: "C".repeat(64) }],
    ["subject_scope", { subjectScope: "user:other-subject" }],
    ["command_type", { commandType: "add_inventory" as const }],
  ])("rejects same-key changed %s with zero mutation", (field, override) => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      createServerPreview(createInput(runtime.database));
      const beforeCounts = tableCounts(runtime.database);
      const beforeRows = runtime.database
        .prepare(
          "SELECT envelope_id, idempotency_key, input_digest, state, result_status, payload_json FROM command_envelopes ORDER BY envelope_id",
        )
        .all();
      expect(() =>
        createServerPreview(createInput(runtime.database, override)),
      ).toThrow(`IDEMPOTENCY_CONFLICT:${field}`);
      expect(tableCounts(runtime.database)).toEqual(beforeCounts);
      expect(
        runtime.database
          .prepare(
            "SELECT envelope_id, idempotency_key, input_digest, state, result_status, payload_json FROM command_envelopes ORDER BY envelope_id",
          )
          .all(),
      ).toEqual(beforeRows);
      expectDietaryTablesEmpty(tableCounts(runtime.database));
    } finally {
      runtime.close();
    }
    removeOwnedRoot(root);
  });

  test("rejects changed preview material or revision instead of replacing authority", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      createServerPreview(createInput(runtime.database));
      const before = tableCounts(runtime.database);
      expect(() =>
        createServerPreview(
          createInput(runtime.database, {
            previewMaterial: {
              action: "record_meal",
              normalized_item_count: 2,
              issue_revisions: [],
            },
          }),
        ),
      ).toThrow("PREVIEW_CONFLICT:preview_hash");
      expect(() =>
        createServerPreview(
          createInput(runtime.database, {
            dataRevision: "issues:1|events:EMPTY",
          }),
        ),
      ).toThrow("PREVIEW_STALE:data_revision");
      expect(tableCounts(runtime.database)).toEqual(before);
      expectDietaryTablesEmpty(tableCounts(runtime.database));
    } finally {
      runtime.close();
    }
    removeOwnedRoot(root);
  });

  test("rejects forged, stale and caller-state authorization without mutation", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const created = createServerPreview(createInput(runtime.database));
      const before = tableCounts(runtime.database);
      const forged = `${created.token.slice(0, -1)}${created.token.endsWith("A") ? "B" : "A"}`;
      expect(() => authorizeServerPreview(authorizeInput(runtime.database, forged))).toThrow(
        "PREVIEW_TOKEN_INVALID:signature",
      );
      expect(() =>
        authorizeServerPreview(
          authorizeInput(runtime.database, created.token, {
            dataRevision: "issues:1|events:EMPTY",
          }),
        ),
      ).toThrow("PREVIEW_STALE:data_revision");
      expect(() =>
        authorizeServerPreview(
          authorizeInput(runtime.database, created.token, {
            subjectScope: "user:other-subject",
          }),
        ),
      ).toThrow("PREVIEW_BINDING_MISMATCH:subject_scope");

      let callerStateGetterCalls = 0;
      const withCallerState = authorizeInput(runtime.database, created.token) as unknown as Record<
        string,
        unknown
      >;
      Object.defineProperty(withCallerState, "callerState", {
        enumerable: true,
        get() {
          callerStateGetterCalls += 1;
          return "finalized";
        },
      });
      expect(() =>
        authorizeServerPreview(withCallerState as unknown as AuthorizeServerPreviewInput),
      ).toThrow("PREVIEW_REQUEST_INVALID:shape");
      expect(callerStateGetterCalls).toBe(0);
      expect(tableCounts(runtime.database)).toEqual(before);
      expectDietaryTablesEmpty(tableCounts(runtime.database));
    } finally {
      runtime.close();
    }
    removeOwnedRoot(root);
  });

  test("rejects stored binding or server state tampering with zero additional writes", () => {
    for (const tamper of ["binding", "state"] as const) {
      const root = newTestRoot();
      const runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const created = createServerPreview(createInput(runtime.database));
        if (tamper === "binding") {
          const payload = canonicalJson({
            authority_kind: "diet-manager/server-preview/v1",
            binding: { ...created.binding, preview_hash: "D".repeat(64) },
          });
          runtime.database
            .prepare("UPDATE command_envelopes SET payload_json = ? WHERE envelope_id = ?")
            .run(payload, created.binding.preview_id);
        } else {
          runtime.database
            .prepare("UPDATE command_envelopes SET state = 'effects_pending' WHERE envelope_id = ?")
            .run(created.binding.preview_id);
        }
        const afterTamper = tableCounts(runtime.database);
        expect(() =>
          authorizeServerPreview(authorizeInput(runtime.database, created.token)),
        ).toThrow(`PREVIEW_AUTHORITY_INVALID:${tamper}`);
        expect(tableCounts(runtime.database)).toEqual(afterTamper);
        expectDietaryTablesEmpty(tableCounts(runtime.database));
      } finally {
        runtime.close();
      }
      removeOwnedRoot(root);
    }
  });
});
