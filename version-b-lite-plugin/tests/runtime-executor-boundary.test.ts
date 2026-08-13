import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { handleCoreRequest } from "../src/application/command-handler.js";
import { createCoreRuntime, type CoreRuntime } from "../src/application/runtime.js";
import { executeCoreEnvelope, registerCoreRuntime } from "../src/application/runtime-executor.js";

describe("Task 8 internal executor capability boundary", () => {
  it("rejects overwrite of a registered real runtime without changing its provider", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-executor-${randomUUID()}-`));
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    try {
      let trapCount = 0;
      expect(() => registerCoreRuntime(runtime, () => {
        trapCount += 1;
        throw new Error("hostile provider");
      })).toThrow("CORE_RUNTIME_INVALID:registered");
      expect(trapCount).toBe(0);
      expect(handleCoreRequest(runtime, {
        action: "record_meal", source_text: "吃了一个苹果。",
        received_at: "2026-08-11T08:30:00+08:00", timezone: "Asia/Shanghai",
        operation_id: "operation-executor", source_message_id: "message-executor",
        conversation_id: "conversation-executor", prior_context: [],
      }).committed).toBe(true);
      expect(trapCount).toBe(0);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("does not accept an unregistered forged runtime", () => {
    const fake = Object.freeze({ close() {} }) as CoreRuntime;
    expect(() => executeCoreEnvelope(fake, Object.freeze({}) as never)).toThrow(
      "CORE_RUNTIME_INVALID:runtime",
    );
  });
});
