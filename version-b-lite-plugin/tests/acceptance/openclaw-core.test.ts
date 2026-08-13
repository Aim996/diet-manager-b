import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

import pluginEntry from "../../src/index.js";
import { openDietDatabase } from "../../src/storage/database.js";

interface RegisteredTool {
  readonly name: string;
  execute(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
  ): Promise<{ readonly details: unknown }>;
}

interface RuntimeLifecycle {
  readonly id: string;
  cleanup(): void | Promise<void>;
}

function registerPlugin(
  pluginConfig: unknown,
  options: { readonly lifecycleFailure?: Error } = {},
): {
  readonly tool: RegisteredTool;
  lifecycle: () => RuntimeLifecycle | undefined;
} {
  const tools: RegisteredTool[] = [];
  let lifecycle: RuntimeLifecycle | undefined;
  const api = {
    pluginConfig,
    registerTool(tool: RegisteredTool): void {
      tools.push(tool);
    },
    lifecycle: {
      registerRuntimeLifecycle(value: RuntimeLifecycle): void {
        if (options.lifecycleFailure !== undefined) throw options.lifecycleFailure;
        lifecycle = value;
      },
    },
  };
  pluginEntry.register(api as never);
  const tool = tools[0];
  if (tool === undefined) throw new Error("diet_manager was not registered");
  return { tool, lifecycle: () => lifecycle };
}

function mealParams(): Record<string, unknown> {
  return {
    action: "record_meal",
    source_text: "吃了一个苹果。",
    received_at: "2026-08-11T08:30:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: "operation-openclaw-meal-001",
    source_message_id: "message-openclaw-meal-001",
    conversation_id: "conversation-openclaw-core",
  };
}

describe("SEL-CORE Task 9 OpenClaw adapter", () => {
  it("publishes only exact ordinary request fields and no authority parameters", () => {
    const metadata = getToolPluginMetadata(pluginEntry);
    const properties = metadata?.tools[0]?.parameters.properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual([
      "action",
      "conversation_id",
      "operation_id",
      "received_at",
      "source_message_id",
      "source_text",
      "timezone",
    ]);
    expect(metadata?.tools[0]?.parameters).toMatchObject({
      required: [
        "action",
        "source_text",
        "received_at",
        "timezone",
        "operation_id",
        "source_message_id",
        "conversation_id",
      ],
      additionalProperties: false,
    });
    for (const forbidden of [
      "official_data_root",
      "secret",
      "token",
      "data_revision",
      "prior_context",
      "items",
      "occurred_at_text",
    ]) {
      expect(properties).not.toHaveProperty(forbidden);
    }
  });

  it("commits a real meal through the registered tool and plugin-owned config root", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-${randomUUID()}-`));
    const registered = registerPlugin({ official_data_root: root });
    try {
      const result = await registered.tool.execute("tool-call-meal-001", mealParams());

      expect(result.details).toMatchObject({
        action: "record_meal",
        status: "committed_with_issues",
        committed: true,
        operation_id: "operation-openclaw-meal-001",
        record_id: expect.stringMatching(/^event-[a-f0-9]{32}$/),
      });
      expect(registered.lifecycle()).toMatchObject({ id: "diet-manager-b-runtime" });
      expect(Object.isFrozen(result.details)).toBe(true);

      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(inspection.database.prepare(
          "SELECT event_type, fact_kind, operation_id FROM event_records",
        ).all()).toEqual([{
          event_type: "diet_meal",
          fact_kind: "meal",
          operation_id: "operation-openclaw-meal-001",
        }]);
      } finally {
        inspection.close();
      }
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("commits explicit plain water as one water event through the registered tool", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-water-${randomUUID()}-`));
    const registered = registerPlugin({ official_data_root: root });
    try {
      const result = await registered.tool.execute("tool-call-water-001", {
        ...mealParams(),
        action: "record_water",
        source_text: "喝了500ml白水。",
        operation_id: "operation-openclaw-water-001",
        source_message_id: "message-openclaw-water-001",
      });
      expect(result.details).toMatchObject({
        action: "record_water",
        status: "committed",
        committed: true,
        operation_id: "operation-openclaw-water-001",
        record_id: expect.stringMatching(/^event-[a-f0-9]{32}$/),
      });
      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(inspection.database.prepare(
          "SELECT event_type, fact_kind, operation_id, meal_id, meal_slot FROM event_records",
        ).all()).toEqual([{
          event_type: "diet_water",
          fact_kind: "water",
          operation_id: "operation-openclaw-water-001",
          meal_id: null,
          meal_slot: null,
        }]);
      } finally {
        inspection.close();
      }
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("returns an ignored future plan without creating runtime files", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-ignore-${randomUUID()}-`));
    const registered = registerPlugin({ official_data_root: root });
    try {
      const result = await registered.tool.execute("tool-call-ignore-001", {
        ...mealParams(),
        source_text: "明天准备吃鸡蛋。",
        operation_id: "operation-openclaw-ignore-001",
        source_message_id: "message-openclaw-ignore-001",
      });
      expect(result.details).toEqual({
        action: "record_meal",
        status: "ignored",
        committed: false,
        operation_id: "operation-openclaw-ignore-001",
        reason_code: "future_plan",
      });
      expect(readdirSync(root)).toEqual([]);
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("rejects caller-supplied authority fields instead of ignoring them", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-exact-${randomUUID()}-`));
    const registered = registerPlugin({ official_data_root: root });
    try {
      const result = await registered.tool.execute("tool-call-extra-001", {
        ...mealParams(),
        official_data_root: join(root, "caller-chosen"),
        token: "caller-token",
        data_revision: 99,
      });
      expect(result.details).toEqual({
        action: "record_meal",
        status: "failed",
        committed: false,
        operation_id: "operation-openclaw-meal-001",
        error_code: "INVALID_REQUEST",
      });
      expect(readdirSync(root)).toEqual([]);
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("rejects proxy parameters without executing traps", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-proxy-${randomUUID()}-`));
    const registered = registerPlugin({ official_data_root: root });
    let traps = 0;
    const params = new Proxy(mealParams(), {
      get(): never {
        traps += 1;
        throw new Error("tool parameter trap executed");
      },
    });
    try {
      const result = await registered.tool.execute("tool-call-proxy-001", params);
      expect(traps).toBe(0);
      expect(result.details).toMatchObject({
        status: "failed",
        committed: false,
        error_code: "INVALID_REQUEST",
      });
      expect(readdirSync(root)).toEqual([]);
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("rejects proxy plugin config without executing traps", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-config-${randomUUID()}-`));
    let traps = 0;
    const config = new Proxy({ official_data_root: root }, {
      get(): never {
        traps += 1;
        throw new Error("plugin config trap executed");
      },
    });
    const registered = registerPlugin(config);
    try {
      const result = await registered.tool.execute("tool-call-config-001", mealParams());
      expect(traps).toBe(0);
      expect(result.details).toMatchObject({
        status: "failed",
        committed: false,
        error_code: "PLUGIN_CONFIG_INVALID",
      });
      expect(readdirSync(root)).toEqual([]);
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("reuses the same physical Windows root when only path casing changes", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-root-${randomUUID()}-`));
    const config = { official_data_root: root };
    const registered = registerPlugin(config);
    try {
      const first = await registered.tool.execute("tool-call-root-001", mealParams());
      expect(first.details).toMatchObject({ committed: true });
      config.official_data_root = root.toUpperCase();
      const result = await registered.tool.execute("tool-call-root-002", mealParams());
      expect(result.details).toEqual(first.details);
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("fails closed when a registered API changes to another physical root", async () => {
    const firstRoot = mkdtempSync(join(tmpdir(), `diet-manager-task9-root-a-${randomUUID()}-`));
    const secondRoot = mkdtempSync(join(tmpdir(), `diet-manager-task9-root-b-${randomUUID()}-`));
    const config = { official_data_root: firstRoot };
    const registered = registerPlugin(config);
    try {
      expect((await registered.tool.execute("tool-call-root-a", mealParams())).details)
        .toMatchObject({ committed: true });
      config.official_data_root = secondRoot;
      const result = await registered.tool.execute("tool-call-root-b", mealParams());
      expect(result.details).toMatchObject({
        status: "failed",
        committed: false,
        error_code: "PLUGIN_CONFIG_CONFLICT",
      });
      expect(readdirSync(secondRoot)).toEqual([]);
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(firstRoot, { recursive: true, force: false });
      rmSync(secondRoot, { recursive: true, force: false });
    }
  });

  it("keeps a shared runtime live until both plugin APIs finish cleanup", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-shared-${randomUUID()}-`));
    const first = registerPlugin({ official_data_root: root });
    const second = registerPlugin({ official_data_root: root });
    try {
      expect((await first.tool.execute("tool-call-shared-a", mealParams())).details)
        .toMatchObject({ committed: true });
      expect((await second.tool.execute("tool-call-shared-b", {
        ...mealParams(),
        operation_id: "operation-openclaw-shared-b",
        source_message_id: "message-openclaw-shared-b",
      })).details).toMatchObject({ committed: true });

      await first.lifecycle()?.cleanup();

      expect((await second.tool.execute("tool-call-shared-c", {
        ...mealParams(),
        operation_id: "operation-openclaw-shared-c",
        source_message_id: "message-openclaw-shared-c",
      })).details).toMatchObject({ committed: true });
    } finally {
      await first.lifecycle()?.cleanup();
      await second.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("does not close another API runtime when configured root drifts to it", async () => {
    const firstRoot = mkdtempSync(join(tmpdir(), `diet-manager-task9-drift-a-${randomUUID()}-`));
    const secondRoot = mkdtempSync(join(tmpdir(), `diet-manager-task9-drift-b-${randomUUID()}-`));
    const firstConfig = { official_data_root: firstRoot };
    const first = registerPlugin(firstConfig);
    const second = registerPlugin({ official_data_root: secondRoot });
    try {
      expect((await first.tool.execute("tool-call-drift-a", mealParams())).details)
        .toMatchObject({ committed: true });
      expect((await second.tool.execute("tool-call-drift-b", {
        ...mealParams(),
        operation_id: "operation-openclaw-drift-b",
        source_message_id: "message-openclaw-drift-b",
      })).details).toMatchObject({ committed: true });

      firstConfig.official_data_root = secondRoot;
      expect((await first.tool.execute("tool-call-drift-conflict", mealParams())).details)
        .toMatchObject({ error_code: "PLUGIN_CONFIG_CONFLICT" });

      expect((await second.tool.execute("tool-call-drift-c", {
        ...mealParams(),
        operation_id: "operation-openclaw-drift-c",
        source_message_id: "message-openclaw-drift-c",
      })).details).toMatchObject({ committed: true });
    } finally {
      await first.lifecycle()?.cleanup();
      await second.lifecycle()?.cleanup();
      rmSync(firstRoot, { recursive: true, force: false });
      rmSync(secondRoot, { recursive: true, force: false });
    }
  });

  it("does not close a shared runtime when lifecycle registration fails", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-lifecycle-${randomUUID()}-`));
    const owner = registerPlugin({ official_data_root: root });
    const rejected = registerPlugin(
      { official_data_root: root },
      { lifecycleFailure: new Error("lifecycle unavailable") },
    );
    try {
      expect((await owner.tool.execute("tool-call-lifecycle-owner", mealParams())).details)
        .toMatchObject({ committed: true });
      expect((await rejected.tool.execute("tool-call-lifecycle-rejected", {
        ...mealParams(),
        operation_id: "operation-openclaw-lifecycle-rejected",
        source_message_id: "message-openclaw-lifecycle-rejected",
      })).details).toMatchObject({
        committed: false,
        error_code: "PLUGIN_RUNTIME_UNAVAILABLE",
      });

      expect((await owner.tool.execute("tool-call-lifecycle-after", {
        ...mealParams(),
        operation_id: "operation-openclaw-lifecycle-after",
        source_message_id: "message-openclaw-lifecycle-after",
      })).details).toMatchObject({ committed: true });
    } finally {
      await owner.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("returns a sanitized failure when the configured root is unavailable", async () => {
    const owner = mkdtempSync(join(tmpdir(), `diet-manager-task9-missing-${randomUUID()}-`));
    const missing = join(owner, "does-not-exist");
    const registered = registerPlugin({ official_data_root: missing });
    try {
      const result = await registered.tool.execute("tool-call-missing-001", mealParams());
      expect(result.details).toEqual({
        action: "record_meal",
        status: "failed",
        committed: false,
        operation_id: "operation-openclaw-meal-001",
        error_code: "PLUGIN_RUNTIME_UNAVAILABLE",
      });
      const publicBytes = JSON.stringify(result.details);
      expect(publicBytes).not.toContain(missing);
      expect(publicBytes).not.toContain("吃了一个苹果");
      expect(existsSync(missing)).toBe(false);
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(owner, { recursive: true, force: false });
    }
  });
});
