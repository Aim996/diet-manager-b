import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

import pluginEntry from "../src/openclaw/index.js";
import { openDietDatabase } from "../src/storage/database.js";

interface RegisteredTool {
  execute(toolCallId: string, params: unknown): Promise<{ readonly details: unknown }>;
}

function registerPlugin(
  root: string,
  toolContext: { readonly sessionKey?: string; readonly sessionId?: string } = {
    sessionKey: "session-openclaw-host-context",
  },
): {
  readonly tool: RegisteredTool;
  readonly cleanup: () => void | Promise<void>;
} {
  const tools: RegisteredTool[] = [];
  let cleanup: (() => void | Promise<void>) | undefined;
  pluginEntry.register({
    pluginConfig: { official_data_root: root },
    registerTool(
      tool: RegisteredTool | ((context: { sessionKey?: string; sessionId?: string }) => RegisteredTool),
    ): void {
      tools.push(typeof tool === "function" ? tool(toolContext) : tool);
    },
    lifecycle: {
      registerRuntimeLifecycle(value: { cleanup(): void | Promise<void> }): void {
        cleanup = () => value.cleanup();
      },
    },
  } as never);
  const tool = tools[0];
  if (tool === undefined) throw new Error("diet_manager was not registered");
  return { tool, cleanup: () => cleanup?.() };
}

describe("OpenClaw trusted host context", () => {
  it("keeps host authority out of the model schema", () => {
    const metadata = getToolPluginMetadata(pluginEntry);
    const properties = metadata?.tools[0]?.parameters.properties ?? {};

    expect(Object.keys(properties).sort()).toEqual([
      "action",
      "items",
      "occurred_at_text",
      "semantic_candidate",
      "source_text",
    ]);
    for (const field of [
      "received_at",
      "timezone",
      "operation_id",
      "source_message_id",
      "conversation_id",
    ]) {
      expect(properties).not.toHaveProperty(field);
    }
  });

  it("executes a Skill-shaped request with adapter-generated authority and deduplicates a host retry", async () => {
    const root = mkdtempSync(join(tmpdir(), "diet-openclaw-host-context-"));
    const registered = registerPlugin(root);
    try {
      const request = {
        action: "record_water",
        source_text: "我喝了500毫升白水",
      };
      const first = await registered.tool.execute("trusted-tool-call-001", request);
      const retry = await registered.tool.execute("trusted-tool-call-001", request);

      expect(first.details).toEqual(retry.details);
      expect(first.details).toMatchObject({
        action: "record_water",
        committed: true,
        operation_id: "openclaw-operation-5b9331006994a07734aa68239c8e8792c4be7e9819934d8041db3d17ec9fddf0",
      });

      const database = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(database.database.prepare(
          `SELECT operation_id, source_message_id, conversation_id, received_at
           FROM event_records`,
        ).all()).toEqual([{
          operation_id: "openclaw-operation-5b9331006994a07734aa68239c8e8792c4be7e9819934d8041db3d17ec9fddf0",
          source_message_id: "openclaw-message-5b9331006994a07734aa68239c8e8792c4be7e9819934d8041db3d17ec9fddf0",
          conversation_id: "openclaw-conversation-6291e610787beb732baed9ecdae1af6575bdaed4b5ba776b4e9e62f2f279bf41",
          received_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
        }]);
      } finally {
        database.close();
      }
    } finally {
      await registered.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("isolates two trusted factory sessions even when the model request is identical", async () => {
    const root = mkdtempSync(join(tmpdir(), "diet-openclaw-session-isolation-"));
    const firstSession = registerPlugin(root, { sessionKey: "session-isolation-a" });
    const secondSession = registerPlugin(root, { sessionKey: "session-isolation-b" });
    try {
      const request = { action: "record_water", source_text: "我喝了500毫升白水" };
      const first = await firstSession.tool.execute("shared-tool-call", request);
      const second = await secondSession.tool.execute("shared-tool-call", request);

      expect(first.details).toMatchObject({ committed: true });
      expect(second.details).toMatchObject({ committed: true });
      const database = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(database.database.prepare(
          "SELECT DISTINCT conversation_id FROM event_records ORDER BY conversation_id",
        ).all()).toEqual([
          { conversation_id: "openclaw-conversation-261be88eee08420600915af8818e2e9eae927e5422a070a01c7acde00b07cb45" },
          { conversation_id: "openclaw-conversation-e6e4dc8743888be1298bf29de506c9419cb7412b76566d0a0ed73b4cadadf60d" },
        ]);
      } finally {
        database.close();
      }
    } finally {
      await firstSession.cleanup();
      await secondSession.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("uses trusted sessionId when sessionKey is unavailable", async () => {
    const root = mkdtempSync(join(tmpdir(), "diet-openclaw-session-id-"));
    const registered = registerPlugin(root, { sessionId: "trusted-session-id" });
    try {
      const result = await registered.tool.execute("session-id-tool-call", {
        action: "record_water",
        source_text: "我喝了500毫升白水",
      });
      expect(result.details).toMatchObject({ committed: true });
      const database = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(database.database.prepare(
          "SELECT DISTINCT conversation_id FROM event_records",
        ).all()).toEqual([{
          conversation_id: "openclaw-conversation-eeed260ffa2ae3888dfa604294a250cc20f9fc9004ecb4aa9d966c80d2f24ce5",
        }]);
      } finally {
        database.close();
      }
    } finally {
      await registered.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("fails closed without a trusted factory session before opening SQLite", async () => {
    const root = mkdtempSync(join(tmpdir(), "diet-openclaw-session-missing-"));
    const registered = registerPlugin(root, {});
    try {
      const result = await registered.tool.execute("missing-session-tool-call", {
        action: "record_water",
        source_text: "我喝了500毫升白水",
      });
      expect(result.details).toEqual({
        action: "record_water",
        status: "failed",
        committed: false,
        error_code: "APPLICATION_AUTHORITY_REQUIRED",
      });
      expect(existsSync(join(root, "diet-manager-b.sqlite3"))).toBe(false);
    } finally {
      await registered.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("rejects model-supplied host lookalikes before opening SQLite", async () => {
    const root = mkdtempSync(join(tmpdir(), "diet-openclaw-host-forgery-"));
    const registered = registerPlugin(root);
    try {
      const result = await registered.tool.execute("trusted-tool-call-002", {
        action: "record_water",
        source_text: "我喝了500毫升白水",
        received_at: "2000-01-01T00:00:00+08:00",
        operation_id: "model-operation",
        source_message_id: "model-message",
        conversation_id: "model-conversation",
      });

      expect(result.details).toEqual({
        action: "record_water",
        status: "failed",
        committed: false,
        error_code: "INVALID_REQUEST",
      });
      expect(existsSync(join(root, "diet-manager-b.sqlite3"))).toBe(false);
    } finally {
      await registered.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });
});
