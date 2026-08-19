import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const race = vi.hoisted(() => ({
  enabled: false,
  drifted: false,
  root: "",
}));

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    writeSync(...args: Parameters<typeof fs.writeSync>) {
      const result = fs.writeSync(...args);
      if (race.enabled) {
        race.enabled = false;
        race.drifted = true;
      }
      return result;
    },
    lstatSync(...args: Parameters<typeof fs.lstatSync>) {
      const stat = fs.lstatSync(...args) as ReturnType<typeof fs.lstatSync>;
      if (race.drifted && String(args[0]).toLowerCase() === race.root.toLowerCase()) {
        return new Proxy(stat as object, {
          get(target, property, receiver) {
            if (property === "ino") {
              const value = Reflect.get(target, property, receiver) as number | bigint;
              return typeof value === "bigint" ? value + 1n : value + 1;
            }
            return Reflect.get(target, property, receiver);
          },
        }) as ReturnType<typeof fs.lstatSync>;
      }
      return stat;
    },
  };
});

import { handleCoreRequest } from "../src/application/command-handler.js";
import { createCoreRuntime } from "../src/application/runtime.js";

const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
const roots = new Set<string>();

afterEach(() => {
  race.enabled = false;
  race.drifted = false;
  for (const root of roots) {
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: false });
    roots.delete(root);
  }
});

describe("Task 8 runtime filesystem race authority", () => {
  it("fails closed and identity-cleans the candidate when the root changes after candidate write", () => {
    const owner = fs.mkdtempSync(join(tmpdir(), `diet-manager-task8-race-${randomUUID()}-`));
    roots.add(owner);
    const root = join(owner, "runtime");
    fs.mkdirSync(root);
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    race.root = root;
    race.enabled = true;

    const outcome = handleCoreRequest(runtime, {
      action: "record_meal", source_text: "吃了一个苹果。",
      received_at: "2026-08-11T08:30:00+08:00", timezone: "Asia/Shanghai",
      operation_id: "operation-race", source_message_id: "message-race",
      conversation_id: "conversation-race", prior_context: [],
    });

    expect(outcome).toEqual({ action: "record_meal", status: "failed", committed: false,
      operation_id: "operation-race", error_code: "STORAGE_PATH_INVALID" });
    expect(fs.readdirSync(root)).toEqual([]);
    expect(fs.readdirSync(root)).toEqual([]);
    runtime.close();
  });

  it("revalidates the root chain before returning an initialized cached session", () => {
    const owner = fs.mkdtempSync(join(tmpdir(), `diet-manager-task8-race-${randomUUID()}-`));
    roots.add(owner);
    const root = join(owner, "runtime");
    fs.mkdirSync(root);
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    const request = {
      action: "record_meal" as const, source_text: "吃了一个苹果。",
      received_at: "2026-08-11T08:30:00+08:00", timezone: "Asia/Shanghai" as const,
      operation_id: "operation-cache", source_message_id: "message-cache",
      conversation_id: "conversation-cache", prior_context: [],
    };
    expect(handleCoreRequest(runtime, request).committed).toBe(true);
    race.root = root;
    race.drifted = true;
    expect(handleCoreRequest(runtime, request)).toEqual({ action: "record_meal",
      status: "failed", committed: false, operation_id: "operation-cache",
      error_code: "STORAGE_PATH_INVALID" });
    runtime.close();
  });
});
