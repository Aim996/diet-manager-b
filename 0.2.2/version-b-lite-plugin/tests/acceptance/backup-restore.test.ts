import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { handleCoreRequest } from "../../src/application/command-handler.js";
import { CORE_RUNTIME_SECRET_FILENAME, createCoreRuntime } from "../../src/application/runtime.js";
import { backupDietDatabase, restoreDietDatabase } from "../../src/storage/backup.js";

function request(
  action: "record_meal" | "record_water" | "query_daily_summary",
  sourceText: string,
  operationId: string,
) {
  return {
    action,
    source_text: sourceText,
    received_at: "2026-08-14T12:00:00+08:00",
    timezone: "Asia/Shanghai" as const,
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: "conversation-backup-restore-001",
    prior_context: [],
  };
}

it("backs up and restores the fixed database while preserving the private authority secret", async () => {
  const root = mkdtempSync(join(tmpdir(), `diet-manager-backup-source-${randomUUID()}-`));
  const backupRoot = mkdtempSync(join(tmpdir(), `diet-manager-backup-target-${randomUUID()}-`));
  const backupPath = join(backupRoot, "diet-manager-backup.sqlite3");
  let runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-14T04:00:01.000Z" });
  try {
    expect(handleCoreRequest(runtime, request("record_meal", "吃了一个苹果。", "operation-backup-meal-001"))
      .committed).toBe(true);
    const secretBefore = readFileSync(join(root, CORE_RUNTIME_SECRET_FILENAME));
    const result = await backupDietDatabase({ privateRuntimeRoot: root, backupPath });
    expect(result).toMatchObject({
      backup_path: backupPath,
      bytes: expect.any(Number),
      sha256: expect.stringMatching(/^[A-F0-9]{64}$/u),
    });

    runtime.close();
    runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-14T04:05:01.000Z" });
    expect(handleCoreRequest(runtime, request("record_water", "喝了500ml白水。", "operation-after-backup-water-001"))
      .committed).toBe(true);
    runtime.close();

    expect(restoreDietDatabase({
      privateRuntimeRoot: root,
      backupPath,
      expectedSha256: result.sha256,
    })).toEqual(result);
    expect(readFileSync(join(root, CORE_RUNTIME_SECRET_FILENAME))).toEqual(secretBefore);

    runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-14T04:10:01.000Z" });
    const progress = handleCoreRequest(runtime, request(
      "query_daily_summary",
      "查询今天进度。",
      "operation-after-restore-query-001",
    ));
    expect(progress).toMatchObject({
      status: "ignored",
      reason_code: "read_only_result",
      daily_progress: {
        meals: { count: 1 },
        water: { count: 0, plain_water_ml_milli: 0 },
      },
    });
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: false });
    rmSync(backupRoot, { recursive: true, force: false });
  }
});
