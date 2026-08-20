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
      "items",
      "occurred_at_text",
      "operation_id",
      "received_at",
      "semantic_candidate",
      "source_message_id",
      "source_text",
      "timezone",
    ]);
    expect(metadata?.tools[0]?.parameters).toMatchObject({
      required: ["action"],
      additionalProperties: false,
    });
    for (const forbidden of [
      "official_data_root",
      "secret",
      "token",
      "data_revision",
      "prior_context",
    ]) {
      expect(properties).not.toHaveProperty(forbidden);
    }
  });

  it("accepts the legacy public shape but requires application authority before writing", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-legacy-${randomUUID()}-`));
    const registered = registerPlugin({ official_data_root: root });
    try {
      const result = await registered.tool.execute("tool-call-legacy-001", {
        action: "record_meal",
        operation_id: "legacy-operation-001",
        source_text: "刚吃了一个苹果",
        occurred_at_text: "刚才",
        items: [{ name: "苹果", quantity: 1, unit: "个" }],
      });
      expect(result.details).toEqual({
        action: "record_meal",
        status: "failed",
        committed: false,
        operation_id: "legacy-operation-001",
        error_code: "APPLICATION_AUTHORITY_REQUIRED",
      });
      expect(readdirSync(root)).toEqual([]);
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("ignores legacy evidence fields when complete core authority is present", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-legacy-extra-${randomUUID()}-`));
    const registered = registerPlugin({ official_data_root: root });
    try {
      const result = await registered.tool.execute("tool-call-legacy-extra-001", {
        ...mealParams(),
        occurred_at_text: "明天",
        items: [{ name: "不可信旧字段" }],
      });
      expect(result.details).toMatchObject({
        action: "record_meal",
        committed: true,
        operation_id: "operation-openclaw-meal-001",
      });
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
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

  it("uses the configured private FDC credential without exposing it in the public request", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-fdc-${randomUUID()}-`));
    const previousKey = process.env.FDC_API_KEY;
    const previousFetch = globalThis.fetch;
    let observedUrl = "";
    let observedKey: string | null = null;
    process.env.FDC_API_KEY = "test-fdc-key-001";
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      observedUrl = String(input);
      observedKey = new Headers(init?.headers).get("X-Api-Key");
      return new Response(JSON.stringify({
        foods: [{
          fdcId: 746782,
          description: "Milk, whole",
          dataType: "Foundation",
          publicationDate: "2026-04-01",
          foodNutrients: [
            { nutrientId: 1008, unitName: "kcal", value: 61 },
            { nutrientId: 1003, unitName: "g", value: 3.15 },
            { nutrientId: 1004, unitName: "g", value: 3.25 },
            { nutrientId: 1005, unitName: "g", value: 4.8 },
            { nutrientId: 1079, unitName: "g", value: 0 },
          ],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const registered = registerPlugin({
      official_data_root: root,
      nutrition: {
        policy_version: "2026-08-14.1",
        resolution_deadline_ms: 2_000,
        sources: [{
          source_id: "public.usda_fooddata_central",
          enabled: true,
          backend_id: "fooddata-central",
          backend_version: "api-v1",
        }],
        credential_refs: { "public.usda_fooddata_central": "env:FDC_API_KEY" },
      },
    });
    try {
      const result = await registered.tool.execute("tool-call-fdc-001", {
        ...mealParams(),
        source_text: "喝了250ml牛奶。",
        operation_id: "operation-openclaw-fdc-001",
        source_message_id: "message-openclaw-fdc-001",
      });
      expect(result.details).toMatchObject({
        committed: true,
        nutrition_items: [{ source_label: "public_reference" }],
        receipt: { items: [{ nutrition: { source: "public_reference", status: "complete" } }] },
      });
      expect(observedUrl).toBe("https://api.nal.usda.gov/fdc/v1/foods/search");
      expect(observedUrl).not.toContain("test-fdc-key-001");
      expect(observedKey).toBe("test-fdc-key-001");
      expect(JSON.stringify(result.details)).not.toContain("test-fdc-key-001");
    } finally {
      await registered.lifecycle()?.cleanup();
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.FDC_API_KEY;
      else process.env.FDC_API_KEY = previousKey;
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("returns ordered multi-event purchase record IDs through the registered tool", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-purchase-${randomUUID()}-`));
    const registered = registerPlugin({ official_data_root: root });
    try {
      const result = await registered.tool.execute("tool-call-purchase-001", {
        ...mealParams(),
        action: "add_inventory",
        source_text: "买了牛奶、鸡蛋和苹果。",
        operation_id: "operation-openclaw-purchase-001",
        source_message_id: "message-openclaw-purchase-001",
      });
      expect(result.details).toMatchObject({
        action: "add_inventory",
        status: "committed",
        committed: true,
        operation_id: "operation-openclaw-purchase-001",
        record_id: expect.stringMatching(/^event-[a-f0-9]{32}$/u),
        record_ids: [
          expect.stringMatching(/^event-[a-f0-9]{32}$/u),
          expect.stringMatching(/^event-[a-f0-9]{32}$/u),
          expect.stringMatching(/^event-[a-f0-9]{32}$/u),
        ],
      });
      expect(Object.isFrozen(result.details)).toBe(true);
      const details = result.details as { record_id: string; record_ids: readonly string[] };
      expect(details.record_ids[0]).toBe(details.record_id);
      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(inspection.database.prepare(
          "SELECT operation_id FROM event_records ORDER BY committed_at",
        ).all()).toEqual([
          { operation_id: "operation-openclaw-purchase-001:item:0" },
          { operation_id: "operation-openclaw-purchase-001:item:1" },
          { operation_id: "operation-openclaw-purchase-001:item:2" },
        ]);
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

  it("sanitizes revoked request proxies without rejecting execute", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-revoked-${randomUUID()}-`));
    const registered = registerPlugin({ official_data_root: root });
    const revoked = Proxy.revocable(mealParams(), {});
    revoked.revoke();
    try {
      const result = await registered.tool.execute("tool-call-revoked-001", revoked.proxy);
      expect(result.details).toEqual({
        action: "record_meal",
        status: "failed",
        committed: false,
        error_code: "INVALID_REQUEST",
      });
      expect(Object.isFrozen(result.details)).toBe(true);
      expect(readdirSync(root)).toEqual([]);
    } finally {
      await registered.lifecycle()?.cleanup();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("rejects accessor authority fields without invoking the getter", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-accessor-${randomUUID()}-`));
    const registered = registerPlugin({ official_data_root: root });
    let getterCalls = 0;
    const params = mealParams();
    Object.defineProperty(params, "source_text", {
      enumerable: true,
      get(): never {
        getterCalls += 1;
        throw new Error("source getter executed");
      },
    });
    try {
      const result = await registered.tool.execute("tool-call-accessor-001", params);
      expect(getterCalls).toBe(0);
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

  it("does not inspect nested legacy evidence when complete core authority is present", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-nested-${randomUUID()}-`));
    const registered = registerPlugin({ official_data_root: root });
    let traps = 0;
    const nested = new Proxy({ name: "untrusted" }, {
      get(): never {
        traps += 1;
        throw new Error("nested legacy evidence trap executed");
      },
    });
    try {
      const result = await registered.tool.execute("tool-call-nested-001", {
        ...mealParams(),
        items: [nested],
      });
      expect(traps).toBe(0);
      expect(result.details).toMatchObject({ committed: true });
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

  it("sanitizes revoked plugin config proxies without rejecting execute", async () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task9-config-revoked-${randomUUID()}-`));
    const revoked = Proxy.revocable({ official_data_root: root }, {});
    const registered = registerPlugin(revoked.proxy);
    revoked.revoke();
    try {
      const result = await registered.tool.execute("tool-call-config-revoked-001", mealParams());
      expect(result.details).toMatchObject({
        status: "failed",
        committed: false,
        error_code: "PLUGIN_CONFIG_INVALID",
      });
      expect(Object.isFrozen(result.details)).toBe(true);
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
      const sharedSecond = await second.tool.execute("tool-call-shared-b", {
        ...mealParams(),
        operation_id: "operation-openclaw-shared-b",
        source_message_id: "message-openclaw-shared-b",
      });
      expect(sharedSecond.details, JSON.stringify(sharedSecond.details)).toMatchObject({ committed: true });

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
