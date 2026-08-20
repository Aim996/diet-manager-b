import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_COMMAND_SCHEMA_VERSION,
  cloneAgentCommandV1,
  createCoreRuntime,
  executeAgentCommand,
} from "../src/index.js";

const command = {
  schema_version: "diet-manager/agent-command/v1",
  action: "record_meal",
  source_text: "我吃了一个苹果",
} as const;

function semanticCandidate(sourceText: string) {
  return {
    schema_version: "diet-manager/semantic-candidate/v1",
    intent: "record_meal",
    source_text: sourceText,
    subject: {
      kind: "self",
      basis: "private_agent_default",
      evidence_span: null,
      explicit_other_spans: [],
    },
    items: [{
      raw_name: "苹果",
      normalized_hint: "apple",
      amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个苹果" },
    }],
    time: { kind: "unspecified", evidence_span: null },
  } as const;
}

describe("diet-manager/agent-command/v1", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: false });
  });

  it("rejects agent authority fields so an agent cannot select host-owned data or execution authority", () => {
    expect(cloneAgentCommandV1(command)).toEqual(command);
    expect(AGENT_COMMAND_SCHEMA_VERSION).toBe("diet-manager/agent-command/v1");

    for (const forbidden of [
      "official_data_root",
      "secret",
      "database_path",
      "host_id",
      "received_at",
      "operation_id",
      "prior_context",
    ]) {
      expect(() => cloneAgentCommandV1({ ...command, [forbidden]: "invented" }))
        .toThrow("DIET_AGENT_COMMAND_INVALID:keys");
    }
  });

  it("rejects proxy and accessor commands before their traps or getters can run", () => {
    let proxyTrapCalls = 0;
    const proxy = new Proxy({ ...command }, {
      getOwnPropertyDescriptor() {
        proxyTrapCalls += 1;
        throw new Error("proxy trap executed");
      },
    });
    let getterCalls = 0;
    const accessor = { ...command } as Record<string, unknown>;
    Object.defineProperty(accessor, "source_text", {
      enumerable: true,
      get(): never {
        getterCalls += 1;
        throw new Error("getter executed");
      },
    });

    expect(() => cloneAgentCommandV1(proxy)).toThrow("DIET_AGENT_COMMAND_INVALID:shape");
    expect(() => cloneAgentCommandV1(accessor)).toThrow("DIET_AGENT_COMMAND_INVALID:source_text:descriptor");
    expect(proxyTrapCalls).toBe(0);
    expect(getterCalls).toBe(0);
  });

  it("rejects empty and oversized source text so parsing never receives unbounded or absent evidence", () => {
    expect(() => cloneAgentCommandV1({ ...command, source_text: "" }))
      .toThrow("DIET_AGENT_COMMAND_INVALID:source_text");
    expect(() => cloneAgentCommandV1({ ...command, source_text: "a".repeat(4097) }))
      .toThrow("DIET_AGENT_COMMAND_INVALID:source_text");
  });

  it("rejects a semantic candidate for a non-meal action so meal evidence cannot change another action", () => {
    expect(() => cloneAgentCommandV1({
      ...command,
      action: "record_water",
      semantic_candidate: semanticCandidate(command.source_text),
    })).toThrow("DIET_AGENT_COMMAND_INVALID:semantic_candidate_action");
  });

  it("rejects a semantic candidate copied from different source text so evidence remains bound to the message", () => {
    expect(() => cloneAgentCommandV1({
      ...command,
      semantic_candidate: semanticCandidate("我吃了一个鸡蛋"),
    })).toThrow("DIET_AGENT_COMMAND_INVALID:semantic_candidate_source_text");
  });

  it("executes through the existing core and returns a validated outcome", async () => {
    const root = mkdtempSync(join(tmpdir(), "diet-agent-command-"));
    roots.push(root);
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-21T04:00:01.000Z" });
    try {
      const outcome = await executeAgentCommand(runtime, command, {
        received_at: "2026-08-21T12:00:00+08:00",
        timezone: "Asia/Shanghai",
        operation_id: "agent-command-operation-001",
        source_message_id: "agent-command-message-001",
        conversation_id: "agent-command-conversation-001",
      });
      expect(outcome).toMatchObject({
        action: "record_meal",
        committed: true,
        operation_id: "agent-command-operation-001",
      });
    } finally {
      runtime.close();
    }
  });
});
