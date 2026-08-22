import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleCoreRequest } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import type { CoreApplicationRequest, DietManagerAction } from "../../src/contracts.js";
import { openDietDatabase } from "../../src/storage/database.js";

const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), `diet-manager-undo-restore-v2-${randomUUID()}-`));
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

function request(
  action: DietManagerAction,
  sourceText: string,
  operationId: string,
  receivedAt: string,
  conversationId = "conversation-undo-v2",
): CoreApplicationRequest {
  return {
    action,
    source_text: sourceText,
    received_at: receivedAt,
    timezone: "Asia/Shanghai",
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: conversationId,
    prior_context: [],
  };
}

function correctionCount(root: string): number {
  const stored = openDietDatabase({ privateRuntimeRoot: root });
  try {
    return (stored.database.prepare(
      "SELECT COUNT(*) AS count FROM correction_events",
    ).get() as { count: number }).count;
  } finally {
    stored.close();
  }
}

describe("Task 10 natural undo and explicit restore", () => {
  it("selects the unique described food even when another active food exists", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-22T06:10:01.000Z",
    });
    try {
      const egg = handleCoreRequest(runtime, request(
        "record_meal", "吃了一个鸡蛋。", "operation-undo-egg", "2026-08-22T14:00:00+08:00",
      ));
      const apple = handleCoreRequest(runtime, request(
        "record_meal", "刚下班路上啃了个苹果。", "operation-undo-apple", "2026-08-22T14:05:00+08:00",
      ));
      expect(egg).toMatchObject({ committed: true });
      expect(apple).toMatchObject({ committed: true });

      const undo = handleCoreRequest(runtime, request(
        "undo_record",
        "下班路上那个苹果不记了。",
        "operation-undo-apple-only",
        "2026-08-22T14:10:00+08:00",
      ));
      expect(undo, JSON.stringify(undo)).toMatchObject({
        status: "committed",
        committed: true,
        correction: {
          operation: "void_event",
          target_event_id: apple.record_id,
          current_active: false,
        },
      });

      const meals = handleCoreRequest(runtime, request(
        "query_meals", "查询今天饮食", "operation-undo-unique-query", "2026-08-22T14:11:00+08:00",
        "conversation-fresh-query",
      ));
      expect(meals.meal_history?.meals).toHaveLength(1);
      expect(meals.meal_history?.meals[0]?.audit_ref.original_event_id).toBe(egg.record_id);
    } finally {
      runtime.close();
    }
  });

  it("writes nothing and returns bounded candidate summaries when the described food is ambiguous", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-22T06:10:01.000Z",
    });
    try {
      expect(handleCoreRequest(runtime, request(
        "record_meal", "吃了一个苹果。", "operation-undo-apple-a", "2026-08-22T14:00:00+08:00",
      ))).toMatchObject({ committed: true });
      expect(handleCoreRequest(runtime, request(
        "record_meal", "吃了一个苹果。", "operation-undo-apple-b", "2026-08-22T14:05:00+08:00",
      ))).toMatchObject({ committed: true });

      const before = correctionCount(root);
      const undo = handleCoreRequest(runtime, request(
        "undo_record",
        "下班路上那个苹果不记了。",
        "operation-undo-apple-ambiguous",
        "2026-08-22T14:10:00+08:00",
      ));
      expect(undo).toMatchObject({
        status: "needs_clarification",
        committed: false,
        reason_code: "target_ambiguous",
      });
      expect(undo.question).toContain("14:00");
      expect(undo.question).toContain("14:05");
      expect(correctionCount(root)).toBe(before);
    } finally {
      runtime.close();
    }
  });

  it("returns an exact not-found result for a natural undo with no matching record", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-22T06:10:01.000Z",
    });
    try {
      const undo = handleCoreRequest(runtime, request(
        "undo_record",
        "下班路上那个苹果不记了。",
        "operation-undo-not-found",
        "2026-08-22T14:10:00+08:00",
      ));
      expect(undo).toEqual({
        action: "undo_record",
        status: "ignored",
        committed: false,
        operation_id: "operation-undo-not-found",
        reason_code: "target_not_found",
      });
      expect(correctionCount(root)).toBe(0);
    } finally {
      runtime.close();
    }
  });

  it("restores only an explicitly voided record and replays the same restore idempotently", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-22T06:10:01.000Z",
    });
    try {
      const meal = handleCoreRequest(runtime, request(
        "record_meal", "吃了一个鸡蛋。", "operation-restore-v2-meal", "2026-08-22T14:00:00+08:00",
      ));
      expect(meal).toMatchObject({ committed: true });

      const undo = handleCoreRequest(runtime, request(
        "undo_record",
        `撤销 记录 ${meal.record_id}`,
        "operation-restore-v2-undo",
        "2026-08-22T14:05:00+08:00",
      ));
      expect(undo).toMatchObject({ status: "committed", correction: { current_active: false } });

      const restoreRequest = request(
        "restore_record",
        `恢复 记录 ${meal.record_id}`,
        "operation-restore-v2-commit",
        "2026-08-22T14:06:00+08:00",
      );
      const restored = handleCoreRequest(runtime, restoreRequest);
      expect(restored).toMatchObject({
        status: "committed",
        correction: { operation: "restore_event", target_event_id: meal.record_id, current_active: true },
      });
      expect(handleCoreRequest(runtime, restoreRequest)).toEqual(restored);
      expect(correctionCount(root)).toBe(2);

      expect(handleCoreRequest(runtime, {
        ...restoreRequest,
        source_text: "恢复 记录 event-different-target",
      })).toEqual({
        action: "restore_record",
        status: "failed",
        committed: false,
        operation_id: "operation-restore-v2-commit",
        error_code: "idempotency_conflict",
      });
      expect(correctionCount(root)).toBe(2);

      expect(handleCoreRequest(runtime, {
        ...restoreRequest,
        received_at: "2026-08-22T14:06:01+08:00",
      })).toEqual({
        action: "restore_record",
        status: "failed",
        committed: false,
        operation_id: "operation-restore-v2-commit",
        error_code: "idempotency_conflict",
      });
      expect(correctionCount(root)).toBe(2);

      const repeatWithNewIdentity = handleCoreRequest(runtime, request(
        "restore_record",
        `恢复 记录 ${meal.record_id}`,
        "operation-restore-v2-already-active",
        "2026-08-22T14:07:00+08:00",
      ));
      expect(repeatWithNewIdentity).toEqual({
        action: "restore_record",
        status: "ignored",
        committed: false,
        operation_id: "operation-restore-v2-already-active",
        reason_code: "already_active",
      });
      expect(correctionCount(root)).toBe(2);
    } finally {
      runtime.close();
    }
  });
});
