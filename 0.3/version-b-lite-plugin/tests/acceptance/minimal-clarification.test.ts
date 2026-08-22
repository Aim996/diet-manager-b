import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCoreRuntime } from "../../src/application/runtime.js";
import { executeAgentCommand } from "../../src/public/execute.js";
import { createPendingCandidate } from "../../src/repository/pending-candidate-repository.js";
import { createPendingCandidateDraft } from "../../src/semantic/pending-candidate.js";
import { openDietDatabase } from "../../src/storage/database.js";

const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as typeof import("node:sqlite");
const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "diet-minimal-clarification-"));
  roots.push(value);
  return value;
}

function runtime(officialDataRoot: string) {
  return createCoreRuntime({
    officialDataRoot,
    now: () => "2026-08-21T04:30:00.000Z",
  });
}

function context(
  id: string,
  conversationId = "minimal-clarification-conversation",
  receivedAt = "2026-08-21T12:30:00+08:00",
) {
  return {
    operation_id: `operation-${id}`,
    source_message_id: `message-${id}`,
    conversation_id: conversationId,
    received_at: receivedAt,
    timezone: "Asia/Shanghai" as const,
  };
}

const self = Object.freeze({
  kind: "self" as const,
  basis: "private_agent_default" as const,
  evidence_span: null,
  explicit_other_spans: Object.freeze([]),
});

function unknownMeal(sourceText = "早上吃了鸡蛋") {
  return {
    schema_version: "diet-manager/agent-command/v2" as const,
    action: "record_meal" as const,
    source_text: sourceText,
    semantic_proposal: {
      kind: "meal" as const,
      subject: self,
      occurrence: "completed" as const,
      meal_slot: "breakfast" as const,
      items: [{ raw_name: "鸡蛋", normalized_hint: "egg", amount: { kind: "unknown" as const } }],
      occurred_at: { kind: "source_text" as const, evidence_span: "早上" },
    },
  };
}

function reply(sourceText: string, action: "record_meal" | "record_water" = "record_meal") {
  return {
    schema_version: "diet-manager/agent-command/v2" as const,
    action,
    source_text: sourceText,
  };
}

function tableCount(officialDataRoot: string, table: string): number {
  const database = new DatabaseSync(join(officialDataRoot, "diet-manager-b.sqlite3"), { readOnly: true });
  try {
    return (database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count;
  } finally {
    database.close();
  }
}

function pendingStates(officialDataRoot: string): readonly Readonly<{
  status: string;
  revision: number;
}>[] {
  const database = new DatabaseSync(join(officialDataRoot, "diet-manager-b.sqlite3"), { readOnly: true });
  try {
    return database.prepare(
      "SELECT status, revision FROM pending_candidates ORDER BY status, candidate_id",
    ).all() as unknown as Array<{ status: string; revision: number }>;
  } finally {
    database.close();
  }
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: false });
});

describe("minimal clarification with a persisted pending candidate", () => {
  it("asks only for egg amount and commits after the short answer without restating context", async () => {
    const dataRoot = root();
    let core = runtime(dataRoot);
    try {
      const first = await executeAgentCommand(core, unknownMeal(), context("meal-first"));
      expect(first).toMatchObject({
        committed: false,
        status: "needs_clarification",
        reason_code: "amount_ambiguous",
        question: "鸡蛋吃了多少？",
        pending_candidate: {
          missing_field: "items.0.amount",
          expires_at: "2026-08-21T04:35:00.000Z",
          revision: 1,
        },
      });
      expect(first.question?.match(/？/gu)).toHaveLength(1);
      expect(tableCount(dataRoot, "pending_candidates")).toBe(1);
      expect(tableCount(dataRoot, "event_records")).toBe(0);

      core.close();
      core = runtime(dataRoot);
      const completed = await executeAgentCommand(core, reply("两个"), context("meal-answer"));
      expect(completed).toMatchObject({ committed: true, action: "record_meal" });
      expect(pendingStates(dataRoot)).toEqual([{ status: "consumed", revision: 2 }]);
      const query = await executeAgentCommand(core, {
        schema_version: "diet-manager/agent-command/v2",
        action: "query_meals",
        source_text: "查今天吃了什么",
      }, context("meal-query"));
      expect(query.meal_history?.meals[0]).toMatchObject({
        items: [{ name: "egg", quantity_microunits: 2_000_000 }],
      });
    } finally {
      core.close();
    }
  });

  it("uses a colloquial cup answer only as the missing water capacity", async () => {
    const dataRoot = root();
    const core = runtime(dataRoot);
    try {
      const first = await executeAgentCommand(core, {
        schema_version: "diet-manager/agent-command/v2",
        action: "record_water",
        source_text: "刚才喝了水",
        semantic_proposal: {
          kind: "water",
          subject: self,
          amount: { kind: "unknown" },
          occurred_at: { kind: "source_text", evidence_span: "刚才" },
        },
      }, context("water-first"));
      expect(first).toMatchObject({
        committed: false,
        status: "needs_clarification",
        question: "一共喝了多少毫升？",
      });
      const completed = await executeAgentCommand(
        core,
        reply("一杯大约 300 毫升", "record_water"),
        context("water-answer"),
      );
      expect(completed).toMatchObject({ committed: true, action: "record_water" });
      const query = await executeAgentCommand(core, {
        schema_version: "diet-manager/agent-command/v2",
        action: "query_daily_summary",
        source_text: "查今天进度",
      }, context("water-query"));
      expect(query.daily_progress?.water).toEqual({ count: 1, plain_water_ml_milli: 300_000 });
    } finally {
      core.close();
    }
  });

  it("fills only a seeded missing subject and preserves the known egg amount", async () => {
    const dataRoot = root();
    const opened = openDietDatabase({ privateRuntimeRoot: dataRoot });
    try {
      const draft = createPendingCandidateDraft({
        action: "record_meal",
        source_text: "有人吃了一个鸡蛋",
        proposal: {
          kind: "meal", subject: self, occurrence: "completed", meal_slot: "unknown",
          items: [{ raw_name: "鸡蛋", normalized_hint: "egg", amount: {
            kind: "exact", value: 1, unit: "个", evidence_span: "一个鸡蛋",
          } }],
          occurred_at: { kind: "unspecified", evidence_span: null },
        },
        missing_fields: ["subject"],
        created_at: "2026-08-21T04:29:00.000Z",
        expires_at: "2026-08-21T04:34:00.000Z",
      });
      createPendingCandidate(opened.database, {
        candidate_id: "candidate-subject",
        idempotency_key: "pending:subject",
        conversation_id: "subject-conversation",
        action: "record_meal",
        original_proposal: draft,
        current_proposal: draft,
        missing_fields: draft.missing_fields,
        created_at: draft.created_at,
        expires_at: draft.expires_at,
      });
    } finally {
      opened.close();
    }
    const core = runtime(dataRoot);
    try {
      const outcome = await executeAgentCommand(
        core,
        reply("是我自己吃的"),
        context("subject-answer", "subject-conversation", "2026-08-21T12:30:00+08:00"),
      );
      expect(outcome).toMatchObject({ committed: true, action: "record_meal" });
      expect(outcome.receipt?.items[0]).toMatchObject({ name: "egg", quantity: 1, unit: "个" });
    } finally {
      core.close();
    }
  });

  it("does not merge across conversations, after expiry, or when two candidates are open", async () => {
    const dataRoot = root();
    const core = runtime(dataRoot);
    try {
      await executeAgentCommand(core, unknownMeal(), context("cross-first", "conversation-a"));
      const cross = await executeAgentCommand(
        core,
        reply("两个"),
        context("cross-answer", "conversation-b"),
      );
      expect(cross).toMatchObject({
        committed: false, status: "ignored", reason_code: "pending_candidate_not_found",
      });

      const expired = await executeAgentCommand(
        core,
        reply("两个"),
        context("expired-answer", "conversation-a", "2026-08-21T12:36:00+08:00"),
      );
      expect(expired).toMatchObject({
        committed: false, status: "ignored", reason_code: "pending_candidate_expired",
      });

      await executeAgentCommand(core, unknownMeal("早上吃了鸡蛋"), context("multi-first", "conversation-multi"));
      await executeAgentCommand(core, unknownMeal("早上吃了鸡蛋"), context("multi-second", "conversation-multi"));
      const ambiguous = await executeAgentCommand(
        core,
        reply("两个"),
        context("multi-answer", "conversation-multi"),
      );
      expect(ambiguous).toMatchObject({
        committed: false,
        status: "needs_clarification",
        reason_code: "pending_candidate_ambiguous",
      });
      expect(tableCount(dataRoot, "event_records")).toBe(0);
    } finally {
      core.close();
    }
  });

  it("cancels on a negative answer, refuses consumed reuse, and creates one row on retry", async () => {
    const dataRoot = root();
    const core = runtime(dataRoot);
    try {
      const initialContext = context("retry-first", "retry-conversation");
      await executeAgentCommand(core, unknownMeal(), initialContext);
      await executeAgentCommand(core, unknownMeal(), initialContext);
      expect(tableCount(dataRoot, "pending_candidates")).toBe(1);

      const cancelled = await executeAgentCommand(
        core,
        reply("算了"),
        context("cancel-answer", "retry-conversation"),
      );
      expect(cancelled).toMatchObject({
        committed: false, status: "ignored", reason_code: "pending_candidate_cancelled",
      });
      expect(pendingStates(dataRoot)).toEqual([{ status: "cancelled", revision: 2 }]);
      expect(tableCount(dataRoot, "event_records")).toBe(0);

      await executeAgentCommand(core, unknownMeal(), context("consume-first", "consume-conversation"));
      await executeAgentCommand(core, reply("两个"), context("consume-answer", "consume-conversation"));
      const reused = await executeAgentCommand(
        core,
        reply("三个"),
        context("consume-reuse", "consume-conversation"),
      );
      expect(reused).toMatchObject({
        committed: false, status: "ignored", reason_code: "pending_candidate_consumed",
      });
      expect(tableCount(dataRoot, "event_records")).toBe(1);
      expect(pendingStates(dataRoot)).toEqual([
        { status: "cancelled", revision: 2 },
        { status: "consumed", revision: 2 },
      ]);
    } finally {
      core.close();
    }
  });

  it("allows only one of two concurrent short replies to consume and submit the candidate", async () => {
    const dataRoot = root();
    const core = runtime(dataRoot);
    try {
      await executeAgentCommand(core, unknownMeal(), context("concurrent-first", "concurrent-conversation"));
      const outcomes = await Promise.all([
        executeAgentCommand(core, reply("两个"), context("concurrent-a", "concurrent-conversation")),
        executeAgentCommand(core, reply("三个"), context("concurrent-b", "concurrent-conversation")),
      ]);
      expect(outcomes.filter((outcome) => outcome.committed)).toHaveLength(1);
      expect(outcomes.filter((outcome) =>
        !outcome.committed && outcome.status === "ignored" &&
        outcome.reason_code === "pending_candidate_consumed")).toHaveLength(1);
      expect(tableCount(dataRoot, "event_records")).toBe(1);
      expect(pendingStates(dataRoot)).toEqual([{ status: "consumed", revision: 2 }]);
    } finally {
      core.close();
    }
  });
});
