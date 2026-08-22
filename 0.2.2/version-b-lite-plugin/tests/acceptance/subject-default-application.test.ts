import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleCoreRequest } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { openDietDatabase } from "../../src/storage/database.js";

const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "diet-manager-subject-default-"));
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
  action: "record_meal" | "record_water",
  sourceText: string,
  operationId: string,
) {
  return {
    action,
    source_text: sourceText,
    received_at: "2026-08-20T14:00:00+08:00",
    timezone: "Asia/Shanghai" as const,
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: "conversation-subject-default",
    prior_context: [],
  };
}

function eventCount(root: string): number {
  const databaseRuntime = openDietDatabase({ privateRuntimeRoot: root });
  try {
    const row = databaseRuntime.database.prepare(
      "SELECT COUNT(*) AS count FROM event_records",
    ).get() as { count: number };
    return row.count;
  } finally {
    databaseRuntime.close();
  }
}

describe("private-agent subject defaults", () => {
  it("defaults a typical omitted-subject water statement to self and persists it", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-20T06:00:00.000Z",
    });

    const outcome = handleCoreRequest(
      runtime,
      request(
        "record_water",
        "这会儿喝了600毫升矿泉水。",
        "operation-subject-water-001",
      ),
    );

    expect(outcome).toMatchObject({
      action: "record_water",
      status: "committed",
      committed: true,
    });
    runtime.close();
    expect(eventCount(root)).toBe(1);
  });

  it("accepts an explicit self confirmation with a punctuated meal object", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-20T06:00:00.000Z",
    });

    const outcome = handleCoreRequest(
      runtime,
      request(
        "record_meal",
        "是我自己喝的，250毫升牛奶。",
        "operation-subject-meal-002",
      ),
    );

    expect(outcome).toMatchObject({
      action: "record_meal",
      status: "committed_with_issues",
      committed: true,
    });
    runtime.close();
    expect(eventCount(root)).toBe(1);
  });

  it("keeps an explicit colleague outside the current user's records", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-20T06:00:00.000Z",
    });

    const outcome = handleCoreRequest(
      runtime,
      request(
        "record_water",
        "同事这会儿喝了600毫升矿泉水。",
        "operation-subject-colleague-003",
      ),
    );

    expect(outcome).toEqual({
      action: "record_water",
      status: "ignored",
      committed: false,
      operation_id: "operation-subject-colleague-003",
      reason_code: "non_self_subject",
    });
    runtime.close();
    expect(readdirSync(root)).toEqual([]);
  });
});
