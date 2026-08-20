import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

import pluginEntry from "../../src/openclaw/index.js";
import { openDietDatabase } from "../../src/storage/database.js";

interface RegisteredTool {
  execute(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
  ): Promise<{ readonly details: unknown }>;
}

interface RuntimeLifecycle {
  cleanup(): void | Promise<void>;
}

function registerPlugin(root: string): {
  readonly tool: RegisteredTool;
  lifecycle: () => RuntimeLifecycle | undefined;
} {
  const tools: RegisteredTool[] = [];
  let lifecycle: RuntimeLifecycle | undefined;
  pluginEntry.register({
    pluginConfig: { official_data_root: root },
    registerTool(tool: RegisteredTool): void {
      tools.push(tool);
    },
    lifecycle: {
      registerRuntimeLifecycle(value: RuntimeLifecycle): void {
        lifecycle = value;
      },
    },
  } as never);
  const tool = tools[0];
  if (tool === undefined) throw new Error("diet_manager was not registered");
  return { tool, lifecycle: () => lifecycle };
}

function semanticCandidate(sourceText = "中午扒了两碗米饭，这会儿还撑着") {
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
      raw_name: "米饭",
      normalized_hint: "rice",
      amount: {
        kind: "exact",
        value: 2,
        unit: "bowl",
        evidence_span: "两碗米饭",
      },
    }],
    time: { kind: "source_text", evidence_span: "中午" },
  };
}

function semanticParams() {
  const sourceText = "中午扒了两碗米饭，这会儿还撑着";
  return {
    action: "record_meal",
    source_text: sourceText,
    received_at: "2026-08-20T12:30:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: "operation-openclaw-semantic-001",
    source_message_id: "message-openclaw-semantic-001",
    conversation_id: "conversation-openclaw-semantic",
    semantic_candidate: semanticCandidate(sourceText),
  };
}

function eventCount(root: string): number {
  const runtime = openDietDatabase({ privateRuntimeRoot: root });
  try {
    return (runtime.database.prepare(
      "SELECT COUNT(*) AS count FROM event_records",
    ).get() as { count: number }).count;
  } finally {
    runtime.close();
  }
}

describe("OpenClaw semantic meal candidate boundary", () => {
  it("registers the exact optional semantic meal candidate schema", () => {
    const metadata = getToolPluginMetadata(pluginEntry);
    const parameters = metadata?.tools[0]?.parameters as {
      required?: string[];
      properties?: Record<string, unknown>;
    };

    expect(parameters.required).toEqual(["action"]);
    expect(parameters.properties?.semantic_candidate).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["schema_version", "intent", "source_text", "subject", "items", "time"],
      properties: {
        schema_version: { const: "diet-manager/semantic-candidate/v1", type: "string" },
        intent: { const: "record_meal", type: "string" },
        source_text: { type: "string", minLength: 1, maxLength: 4096 },
        subject: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "basis", "evidence_span", "explicit_other_spans"],
          properties: {
            kind: { const: "self", type: "string" },
            basis: {
              anyOf: [
                { const: "explicit", type: "string" },
                { const: "private_agent_default", type: "string" },
              ],
            },
            evidence_span: {
              anyOf: [{ type: "string", minLength: 1, maxLength: 256 }, { type: "null" }],
            },
            explicit_other_spans: {
              type: "array",
              minItems: 0,
              maxItems: 64,
              items: { type: "string", minLength: 1, maxLength: 256 },
            },
          },
        },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 64,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["raw_name", "normalized_hint", "amount"],
            properties: {
              raw_name: { type: "string", minLength: 1, maxLength: 256 },
              normalized_hint: { type: "string", minLength: 1, maxLength: 256 },
              amount: {
                anyOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["kind", "value", "unit", "evidence_span"],
                    properties: {
                      kind: { const: "exact", type: "string" },
                      value: { type: "number", exclusiveMinimum: 0 },
                      unit: { type: "string", minLength: 1, maxLength: 64 },
                      evidence_span: { type: "string", minLength: 1, maxLength: 256 },
                    },
                  },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["kind"],
                    properties: { kind: { const: "unknown", type: "string" } },
                  },
                ],
              },
            },
          },
        },
        time: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "evidence_span"],
          properties: {
            kind: {
              anyOf: [
                { const: "source_text", type: "string" },
                { const: "unspecified", type: "string" },
              ],
            },
            evidence_span: {
              anyOf: [{ type: "string", minLength: 1, maxLength: 256 }, { type: "null" }],
            },
          },
        },
      },
    });
  });

  it("commits the pressure-scenario meal through the registered tool", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-openclaw-semantic-${randomUUID()}-`));
    const registered = registerPlugin(root);
    try {
      const result = await registered.tool.execute("tool-call-semantic-001", semanticParams());

      expect(result.details).toMatchObject({
        action: "record_meal",
        committed: true,
        operation_id: "operation-openclaw-semantic-001",
      });
      expect(eventCount(root)).toBe(1);
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("ignores an explicit other person even when the candidate claims default self", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-openclaw-other-${randomUUID()}-`));
    const registered = registerPlugin(root);
    const sourceText = "我同事中午吃了一个鸡蛋";
    const params = {
      ...semanticParams(),
      source_text: sourceText,
      operation_id: "operation-openclaw-other-001",
      source_message_id: "message-openclaw-other-001",
      semantic_candidate: {
        ...semanticCandidate(sourceText),
        subject: {
          kind: "self",
          basis: "private_agent_default",
          evidence_span: null,
          explicit_other_spans: ["我同事"],
        },
        items: [{
          raw_name: "鸡蛋",
          normalized_hint: "egg",
          amount: {
            kind: "exact",
            value: 1,
            unit: "piece",
            evidence_span: "一个鸡蛋",
          },
        }],
        time: { kind: "source_text", evidence_span: "中午" },
      },
    };
    try {
      const result = await registered.tool.execute("tool-call-other-001", params);

      expect(result.details).toEqual({
        action: "record_meal",
        status: "ignored",
        committed: false,
        operation_id: "operation-openclaw-other-001",
        reason_code: "non_self_subject",
      });
      expect(eventCount(root)).toBe(0);
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it.each([
    "source_text",
    "received_at",
    "timezone",
    "operation_id",
    "source_message_id",
    "conversation_id",
  ])("does not let semantic_candidate replace host authority field %s", async (field) => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-openclaw-authority-${randomUUID()}-`));
    const registered = registerPlugin(root);
    const params = semanticParams() as Record<string, unknown>;
    delete params[field];
    try {
      const result = await registered.tool.execute(`tool-call-missing-${field}`, params);
      expect(result.details).toMatchObject({
        status: "failed",
        committed: false,
        error_code: "APPLICATION_AUTHORITY_REQUIRED",
      });
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("rejects a nested semantic accessor without executing it", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-openclaw-accessor-${randomUUID()}-`));
    const registered = registerPlugin(root);
    const params = semanticParams();
    let getterCalls = 0;
    Object.defineProperty(params.semantic_candidate, "subject", {
      enumerable: true,
      get(): never {
        getterCalls += 1;
        throw new Error("nested subject getter executed");
      },
    });
    try {
      const result = await registered.tool.execute("tool-call-semantic-accessor", params);
      expect(getterCalls).toBe(0);
      expect(result.details).toMatchObject({
        status: "failed",
        committed: false,
        error_code: "INVALID_REQUEST",
      });
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("rejects a nested semantic proxy without executing traps", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-openclaw-proxy-${randomUUID()}-`));
    const registered = registerPlugin(root);
    const params = semanticParams();
    let trapCalls = 0;
    params.semantic_candidate.items[0]!.amount = new Proxy(
      params.semantic_candidate.items[0]!.amount,
      {
        get(): never {
          trapCalls += 1;
          throw new Error("nested amount trap executed");
        },
      },
    );
    try {
      const result = await registered.tool.execute("tool-call-semantic-proxy", params);
      expect(trapCalls).toBe(0);
      expect(result.details).toMatchObject({
        status: "failed",
        committed: false,
        error_code: "INVALID_REQUEST",
      });
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("rejects nested semantic extra fields", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-openclaw-extra-${randomUUID()}-`));
    const registered = registerPlugin(root);
    const params = semanticParams();
    const firstItem = params.semantic_candidate.items[0] as Record<string, unknown>;
    firstItem.extra = true;
    try {
      const result = await registered.tool.execute("tool-call-semantic-extra", params);
      expect(result.details).toMatchObject({
        status: "failed",
        committed: false,
        error_code: "INVALID_REQUEST",
      });
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it.each([
    [
      "an item mentioned only as present",
      "桌上有一个苹果，我吃了一个鸡蛋",
      [{
        raw_name: "苹果",
        normalized_hint: "apple",
        amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个苹果" },
      }],
      "failed",
      "SEMANTIC_EVIDENCE_INVALID",
    ],
    [
      "two items reusing one occurrence",
      "我吃了一个鸡蛋",
      [
        {
          raw_name: "鸡蛋",
          normalized_hint: "egg",
          amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
        },
        {
          raw_name: "鸡蛋",
          normalized_hint: "egg",
          amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
        },
      ],
      "failed",
      "SEMANTIC_EVIDENCE_INVALID",
    ],
    ["an explicit next-morning plan", "我明早吃一个鸡蛋", undefined, "ignored", "future_plan"],
    ["a not-yet statement", "我尚未吃一个鸡蛋", undefined, "ignored", "not_occurred"],
    ["a missed-opportunity statement", "我没来得及吃一个鸡蛋", undefined, "ignored", "not_occurred"],
  ] as const)("keeps %s at zero registered-tool writes", async (
    _label,
    sourceText,
    suppliedItems,
    status,
    code,
  ) => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-openclaw-zero-${randomUUID()}-`));
    const registered = registerPlugin(root);
    const eggItems = [{
      raw_name: "鸡蛋",
      normalized_hint: "egg",
      amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
    }];
    const params = {
      ...semanticParams(),
      source_text: sourceText,
      operation_id: `operation-openclaw-zero-${randomUUID()}`,
      source_message_id: `message-openclaw-zero-${randomUUID()}`,
      semantic_candidate: {
        ...semanticCandidate(sourceText),
        items: suppliedItems ?? eggItems,
        time: { kind: "unspecified", evidence_span: null },
      },
    };
    try {
      const result = await registered.tool.execute("tool-call-semantic-zero", params);

      expect(result.details).toMatchObject({
        action: "record_meal",
        status,
        committed: false,
        ...(status === "failed" ? { error_code: code } : { reason_code: code }),
      });
      expect(eventCount(root)).toBe(0);
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("rejects a custom-prototype array without invoking inherited code or writing", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-openclaw-array-${randomUUID()}-`));
    const registered = registerPlugin(root);
    const params = semanticParams();
    const items = [...params.semantic_candidate.items];
    let inheritedGetterCalls = 0;
    const hostilePrototype = Object.create(Array.prototype) as unknown[];
    Object.defineProperty(hostilePrototype, "map", {
      get() {
        inheritedGetterCalls += 1;
        return Array.prototype.map;
      },
    });
    Object.setPrototypeOf(items, hostilePrototype);
    params.semantic_candidate.items = items;
    try {
      const result = await registered.tool.execute("tool-call-semantic-array", params);

      expect(result.details).toMatchObject({
        status: "failed",
        committed: false,
        error_code: "INVALID_REQUEST",
      });
      expect(inheritedGetterCalls).toBe(0);
      expect(eventCount(root)).toBe(0);
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });
});
