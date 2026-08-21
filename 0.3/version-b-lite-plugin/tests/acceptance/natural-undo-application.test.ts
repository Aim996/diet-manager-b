import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleCoreRequest } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { openDietDatabase } from "../../src/storage/database.js";

const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "diet-manager-natural-undo-"));
  ownedRoots.add(root);
  return root;
}

function removeRoot(root: string): void {
  if (!ownedRoots.delete(root)) throw new Error(`unregistered test root: ${root}`);
  rmSync(root, { recursive: true, force: false });
}

afterEach(() => {
  for (const root of [...ownedRoots]) removeRoot(root);
});

function mealRequest(
  operationId: string,
  conversationId: string,
  receivedAt: string,
  sourceText = "吃了一个鸡蛋。",
) {
  return {
    action: "record_meal" as const,
    source_text: sourceText,
    received_at: receivedAt,
    timezone: "Asia/Shanghai" as const,
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: conversationId,
    prior_context: [],
  };
}

function undoRequest(operationId: string, conversationId: string, sourceText: string) {
  return {
    action: "undo_record" as const,
    source_text: sourceText,
    received_at: "2026-08-20T14:10:00+08:00",
    timezone: "Asia/Shanghai" as const,
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: conversationId,
    prior_context: [],
  };
}

function correctionCount(root: string): number {
  const databaseRuntime = openDietDatabase({ privateRuntimeRoot: root });
  try {
    return (databaseRuntime.database.prepare(
      "SELECT COUNT(*) AS count FROM correction_events",
    ).get() as { count: number }).count;
  } finally {
    databaseRuntime.close();
  }
}

describe("natural undo application safety", () => {
  it("voids the sole active meal in the current conversation and ignores another conversation", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-20T06:10:00.000Z",
    });
    try {
      const current = handleCoreRequest(
        runtime,
        mealRequest("operation-natural-undo-current", "conversation-current", "2026-08-20T14:00:00+08:00"),
      );
      expect(current).toMatchObject({ committed: true });
      const other = handleCoreRequest(
        runtime,
        mealRequest("operation-natural-undo-other", "conversation-other", "2026-08-20T14:01:00+08:00"),
      );
      expect(other).toMatchObject({ committed: true });

      const undo = handleCoreRequest(
        runtime,
        undoRequest("operation-natural-undo-commit", "conversation-current", "刚才鸡蛋那条先取消。"),
      );

      expect(undo).toMatchObject({
        action: "undo_record",
        status: "committed",
        committed: true,
        correction: {
          operation: "void_event",
          target_event_id: (current as { record_id: string }).record_id,
          current_active: false,
        },
      });
      expect(correctionCount(root)).toBe(1);
    } finally {
      runtime.close();
    }
  });

  it("asks for clarification and writes no correction when two active meals share the conversation", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-20T06:10:00.000Z",
    });
    try {
      expect(handleCoreRequest(
        runtime,
        mealRequest("operation-natural-undo-first", "conversation-ambiguous", "2026-08-20T14:00:00+08:00"),
      )).toMatchObject({ committed: true });
      expect(handleCoreRequest(
        runtime,
        mealRequest("operation-natural-undo-second", "conversation-ambiguous", "2026-08-20T14:01:00+08:00"),
      )).toMatchObject({ committed: true });

      const undo = handleCoreRequest(
        runtime,
        undoRequest("operation-natural-undo-ambiguous", "conversation-ambiguous", "前面鸡蛋那次算错了，帮我去掉。"),
      );

      expect(undo).toMatchObject({
        action: "undo_record",
        status: "needs_clarification",
        committed: false,
        operation_id: "operation-natural-undo-ambiguous",
        reason_code: "target_ambiguous",
      });
      expect(undo.question).toContain("2026-08-20 14:00");
      expect(undo.question).toContain("2026-08-20 14:01");
      expect(undo.question).toContain("鸡蛋");
      expect(correctionCount(root)).toBe(0);
    } finally {
      runtime.close();
    }
  });

  it("voids a naturally phrased bare-classifier meal", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-20T08:10:00.000Z",
    });
    try {
      const meal = handleCoreRequest(
        runtime,
        mealRequest(
          "operation-natural-undo-unknown-meal",
          "conversation-unknown-meal",
          "2026-08-20T15:55:00+08:00",
          "刚下班路上啃了个苹果。",
        ),
      );
      expect(meal).toMatchObject({ committed: true });

      const undo = handleCoreRequest(
        runtime,
        undoRequest(
          "operation-natural-undo-unknown-commit",
          "conversation-unknown-meal",
          "下班路上那个苹果不记了。",
        ),
      );

      expect(undo).toMatchObject({
        action: "undo_record",
        status: "committed",
        committed: true,
        correction: {
          operation: "void_event",
          target_event_id: (meal as { record_id: string }).record_id,
          current_active: false,
        },
      });
      expect(correctionCount(root)).toBe(1);
    } finally {
      runtime.close();
    }
  });
});
