import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleCoreRequest } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";

// DEC-031 restore_record：撤销后恢复（un-void）。
// R-1 先证「非 void 记录拒绝 / 未定位失败」，R-2 证恢复后营养/进度回到原值，
// R-3 证库存不足时 skipped_inventory 边界。

const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "diet-manager-b-restore-"));
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
  action: "record_meal" | "undo_record" | "restore_record",
  sourceText: string,
  operationId: string,
) {
  return {
    action,
    source_text: sourceText,
    received_at: "2026-08-11T08:30:00+08:00",
    timezone: "Asia/Shanghai" as const,
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: "conversation-restore",
    prior_context: [],
  };
}

describe("DEC-031 restore_record", () => {
  it("rejects restoring a still-active record as already_active", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-11T08:30:01.000Z",
    });
    try {
      const meal = handleCoreRequest(runtime, request(
        "record_meal", "吃了一个苹果。", "operation-restore-meal",
      ));
      expect(meal).toMatchObject({ action: "record_meal", committed: true });

      const restore = handleCoreRequest(runtime, request(
        "restore_record", "恢复刚才那条饮食记录", "operation-restore-001",
      ));
      expect(restore).toMatchObject({
        action: "restore_record",
        status: "ignored",
        committed: false,
        operation_id: "operation-restore-001",
        reason_code: "already_active",
      });
    } finally {
      runtime.close();
      removeRoot(root);
    }
  });
});
