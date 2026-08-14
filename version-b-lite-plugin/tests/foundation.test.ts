import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { describe, expect, test } from "vitest";
import * as foundation from "../src/index";
import * as openClawPlugin from "../src/openclaw/plugin.js";
import pluginEntry, {
  dietManagerParameters,
} from "../src/index";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(testsDirectory, "..");
const manifestPath = resolve(projectDirectory, "openclaw.plugin.json");
const packagePath = resolve(projectDirectory, "package.json");
const skillPath = resolve(projectDirectory, "skills", "diet-manager-b", "SKILL.md");
const dataDirectory = resolve(projectDirectory, "data");
const expectedContract = {
  id: "diet-manager/contract-v2",
  version: 2,
  sha256: "632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E",
} as const;
const expectedActions = [
  "record_meal",
  "record_water",
  "add_inventory",
  "query_inventory",
  "query_meals",
  "query_daily_summary",
  "correct_record",
  "undo_record",
] as const;
const expectedStatuses = [
  "committed",
  "committed_with_issues",
  "needs_clarification",
  "ignored",
  "failed",
] as const;

function businessDataFiles(): string[] {
  if (!existsSync(dataDirectory)) return [];
  return readdirSync(dataDirectory).filter((file) => {
    const extension = extname(file).toLowerCase();
    return extension === ".jsonl" || extension === ".sqlite" || extension === ".db";
  });
}

describe("diet manager B core plugin boundary", () => {
  test("declares the official tool-plugin metadata and exact action boundary", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const metadata = getToolPluginMetadata(pluginEntry);

    expect(metadata).toMatchObject({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      activation: { onStartup: true },
    });
    expect(metadata?.name).toBe("Diet Manager B");
    expect(metadata?.description).not.toContain("foundation");
    expect(metadata?.description).not.toContain("non-writing");
    expect(manifest).toMatchObject({
      configSchema: { type: "object", properties: {}, additionalProperties: false },
      activation: { onStartup: true },
      contracts: { tools: ["diet_manager"] },
    });
    expect(manifest).not.toHaveProperty("entry");
    expect(manifest).not.toHaveProperty("tools");
    expect(metadata?.tools.map((tool) => tool.name)).toEqual(["diet_manager"]);

    const actionSchema = dietManagerParameters.properties.action as {
      anyOf: Array<{ const: string }>;
    };
    expect(actionSchema.anyOf.map((item) => item.const)).toEqual(expectedActions);
    expect(Object.keys(dietManagerParameters.properties).sort()).toEqual([
      "action",
      "conversation_id",
      "items",
      "occurred_at_text",
      "operation_id",
      "received_at",
      "source_message_id",
      "source_text",
      "timezone",
    ]);
    expect(dietManagerParameters.required).toEqual(["action"]);
    expect(dietManagerParameters.additionalProperties).toBe(false);
    for (const field of ["official_data_root", "secret", "token", "data_revision", "prior_context"]) {
      expect(dietManagerParameters.properties).not.toHaveProperty(field);
    }
  });

  test("binds the frozen contract, official root, and optional nutrition config across schemas", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, any>;
    const metadata = getToolPluginMetadata(pluginEntry);
    const runtimeContract = Reflect.get(foundation, "dietManagerContract");

    expect(runtimeContract).toEqual(expectedContract);
    expect(metadata?.configSchema).toEqual(manifest.configSchema);
    expect(Object.keys(metadata?.configSchema.properties ?? {})).toEqual([
      "official_data_root",
      "nutrition",
    ]);
    expect(metadata?.configSchema).toMatchObject({
      required: ["official_data_root"],
      additionalProperties: false,
      "x-diet-manager-contract": expectedContract,
      properties: {
        official_data_root: {
          type: "string",
          description: expect.not.stringContaining("gate validation"),
          "x-diet-manager-root-semantics": "backend_owned_existing_absolute_runtime_root",
        },
      },
    });
    expect(dietManagerParameters).toMatchObject({
      "x-diet-manager-contract": expectedContract,
    });
  });

  test("publishes the frozen contract identity in the Skill without weakening write authority", () => {
    const skill = readFileSync(skillPath, "utf8");

    expect(skill).toContain(`contract_id=${expectedContract.id}`);
    expect(skill).toContain(`contract_version=${expectedContract.version}`);
    expect(skill).toContain(`contract_sha256=${expectedContract.sha256}`);
    expect(skill).toContain("只有工具返回 `committed=true` 才能告诉用户“已记录”");
    expect(skill).toContain("技术日志可以说明失败原因，但不属于饮食记录");
    expect(skill).toContain("`official_data_root` 只由后端配置和管理");
    expect(skill).toContain("把用户原话逐字放入 `source_text`");
    expect(skill).toContain("不要传入数据路径、secret、token 或 revision");
    expect(skill).toContain("`occurred_at_text` 和 `items`，但它们只是兼容字段");
    expect(skill).toContain("实际请求写入时必须同时提供 `action`、逐字 `source_text`");
    expect(skill).toContain("牛奶、汤、豆浆、咖啡和茶按饮食处理，不按白水处理");
    expect(skill).toContain("健康建议请求不进入饮食记录");
    expect(skill).toContain("保留整句原话并单次使用 `record_meal`");
    expect(skill).toContain("本阶段后端可能返回 `needs_clarification`");
    expect(skill).toContain("不要擅自改写原话拆成两次调用");
    expect(skill).toContain("这些调用元数据不是食物、数量或营养事实");
    expect(skill).toContain("直接告诉用户本次未记录，不创建便签、记忆或替代记录");
  });

  test("teaches natural-language callers the complete runtime authority recipe", () => {
    const metadata = getToolPluginMetadata(pluginEntry);
    const tool = metadata?.tools[0];
    const properties = dietManagerParameters.properties as Record<string, {
      description?: string;
    }>;

    expect(tool?.description).toContain("all seven fields");
    expect(tool?.description).toContain("current OpenClaw message/session metadata");
    expect(tool?.description).toContain("do not write a note, memory, or fallback record");
    expect(tool?.description).toContain("never estimate nutrition values yourself");
    for (const field of [
      "source_text",
      "received_at",
      "timezone",
      "operation_id",
      "source_message_id",
      "conversation_id",
    ]) {
      expect(properties[field]?.description, field).toContain("Operational calls require this field");
    }
  });

  test("keeps runtime/root ownership private to the OpenClaw module", () => {
    expect(Object.keys(openClawPlugin).sort()).toEqual([
      "default",
      "dietManagerParameters",
    ]);
  });

  test("declares OpenClaw extension packaging and the required dependencies", () => {
    const packageManifest = JSON.parse(readFileSync(packagePath, "utf8")) as {
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      engines?: Record<string, unknown>;
      peerDependencies?: Record<string, unknown>;
      openclaw?: { extensions?: unknown };
    };

    expect(packageManifest.dependencies?.typebox).toBeDefined();
    expect((packageManifest as { name?: unknown }).name).toBe("diet-manager-b");
    expect(packageManifest.devDependencies?.["@types/node"]).toBe("^24.0.0");
    expect(packageManifest.engines?.node).toBe(">=24.15.0 <25");
    expect(packageManifest.peerDependencies?.openclaw).toBe(">=2026.5.17");
    expect(packageManifest.openclaw?.extensions).toEqual(["./dist/index.js"]);
    expect(packageManifest.scripts?.["plugin:build"]).toBeDefined();
    expect(packageManifest.scripts?.["plugin:validate"]).toBeDefined();
  });

  test("declares no SQLite dependency", () => {
    const packageManifest = JSON.parse(readFileSync(packagePath, "utf8")) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const dependencyNames = Object.keys({
      ...packageManifest.dependencies,
      ...packageManifest.devDependencies,
    });

    expect(dependencyNames.filter((name) => name.toLowerCase().includes("sqlite"))).toEqual([]);
  });

  test("removes the obsolete public foundation handler and status", () => {
    expect(Reflect.has(foundation, "handleFoundationAction")).toBe(false);
    expect(Reflect.get(foundation, "dietManagerStatuses")).not.toContain(
      "foundation_not_implemented",
    );
    expect(businessDataFiles()).toEqual([]);
  });

  test("keeps the legacy request and item shapes type-compatible", () => {
    const legacyRequest: import("../src/index.js").DietManagerRequest = {
      action: "record_meal",
      operation_id: "legacy-operation",
      source_text: "刚吃了一个苹果",
      occurred_at_text: "刚才",
      items: [{ name: "苹果", quantity: 1, unit: "个" }],
      received_at: "2026-08-11T08:30:00+08:00",
      timezone: "Asia/Shanghai",
      source_message_id: "legacy-message",
      conversation_id: "legacy-conversation",
    };
    const legacyItem: import("../src/index.js").DietManagerItem = {
      name: "苹果",
    };
    expect(legacyRequest.items).toEqual([{ name: "苹果", quantity: 1, unit: "个" }]);
    expect(legacyItem.name).toBe("苹果");
  });

  test("rejects outcomes whose committed flag contradicts their status", () => {
    const validator = Reflect.get(foundation, "assertDietManagerOutcome") as
      | ((value: unknown) => unknown)
      | undefined;

    expect(validator).toBeTypeOf("function");
    expect(() =>
      validator?.({
        action: "record_meal",
        status: "committed",
        committed: false,
      }),
    ).toThrowError("DIET_MANAGER_OUTCOME_INVALID:commit_status");
    expect(() =>
      validator?.({
        action: "record_meal",
        status: "failed",
        committed: true,
      }),
    ).toThrowError("DIET_MANAGER_OUTCOME_INVALID:commit_status");
    expect(() =>
      validator?.({
        action: "record_meal",
        status: "failed",
        committed: false,
        record_id: "must-not-exist",
      }),
    ).toThrowError("DIET_MANAGER_OUTCOME_INVALID:failed_record_id");
  });

  test("implements the exact CONTRACT-v2 command outcome boundary", () => {
    const statuses = Reflect.get(foundation, "dietManagerStatuses") as
      | readonly string[]
      | undefined;
    const validator = Reflect.get(foundation, "assertDietManagerOutcome") as
      | ((value: unknown) => unknown)
      | undefined;

    expect(statuses).toEqual(expectedStatuses);
    expect(() =>
      validator?.({
        action: "record_meal",
        status: "needs_clarification",
        committed: false,
        reason_code: "meal_identity_missing",
      }),
    ).not.toThrow();
    expect(() =>
      validator?.({
        action: "record_water",
        status: "ignored",
        committed: false,
        reason_code: "future_plan",
      }),
    ).not.toThrow();
    expect(() =>
      validator?.({
        action: "record_water",
        status: "ignored",
        committed: false,
        reason_code: "future_plan",
        record_id: "must-not-exist",
      }),
    ).toThrowError("DIET_MANAGER_OUTCOME_INVALID:failed_record_id");
    expect(() =>
      validator?.({
        action: "record_meal",
        status: "needs_clarification",
        committed: false,
      }),
    ).toThrowError("DIET_MANAGER_OUTCOME_INVALID:reason_code");
    expect(() =>
      validator?.({
        action: "record_water",
        status: "ignored",
        committed: false,
      }),
    ).toThrowError("DIET_MANAGER_OUTCOME_INVALID:reason_code");
    expect(() =>
      validator?.({
        action: "record_meal",
        status: "failed",
        committed: false,
      }),
    ).toThrowError("DIET_MANAGER_OUTCOME_INVALID:error_code");
    expect(() =>
      validator?.({
        action: "record_meal",
        status: "committed",
        committed: true,
      }),
    ).toThrowError("DIET_MANAGER_OUTCOME_INVALID:committed_identity");
    expect(() =>
      validator?.({
        action: "add_inventory",
        status: "needs_clarification",
        committed: false,
        operation_id: "operation-purchase-ambiguous",
        reason_code: "product_identity_ambiguous",
        clarification: {
          kind: "product_identity",
          options: [{ key: "A", label: "milk 250ml" }, { key: "B", label: "milk 500ml" }],
          free_text_allowed: true,
        },
      }),
    ).not.toThrow();
    expect(() =>
      validator?.({
        action: "add_inventory",
        status: "committed",
        committed: true,
        operation_id: "operation-purchase-multi",
        record_id: "event-first",
        record_ids: ["event-first", "event-second"],
      }),
    ).not.toThrow();
    expect(() =>
      validator?.({
        action: "add_inventory",
        status: "needs_clarification",
        committed: false,
        reason_code: "product_identity_ambiguous",
        clarification: {
          kind: "product_identity",
          options: [{ key: "A", label: "only one" }],
          free_text_allowed: true,
        },
      }),
    ).toThrowError("DIET_MANAGER_OUTCOME_INVALID:clarification");
    expect(() =>
      validator?.({
        action: "add_inventory",
        status: "committed",
        committed: true,
        operation_id: "operation-purchase-multi",
        record_id: "event-first",
        record_ids: ["event-second", "event-first"],
      }),
    ).toThrowError("DIET_MANAGER_OUTCOME_INVALID:record_ids");
  });
});
