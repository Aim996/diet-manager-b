import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { describe, expect, test } from "vitest";
import * as foundation from "../src/index";
import * as openClawPlugin from "../src/openclaw/index.js";
import pluginEntry, {
  dietManagerParameters,
} from "../src/openclaw/index.js";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(testsDirectory, "..");
const manifestPath = resolve(projectDirectory, "openclaw.plugin.json");
const packagePath = resolve(projectDirectory, "package.json");
const dataDirectory = resolve(projectDirectory, "data");
const expectedContract = {
  id: "diet-manager/contract-v3",
  version: 3,
  sha256: "B4F475C389FA9A5EA5DD23F9E737A157B5B44B47311AB38AB16354F5C9556ADC",
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
  "set_profile",
  "set_goal",
  "restore_record",
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

    expect(manifest.skills).toEqual(["./skills"]);
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
      "semantic_candidate",
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
    expect(tool?.description).toContain("at most once for one inbound message");
    expect(tool?.description).toContain("do not retry, inspect files, run commands");
    expect(tool?.description).toContain("only create a reminder when the user explicitly asks");
    expect(tool?.description).toContain("Never say recorded, noted, saved, or updated when committed=false");
    expect(tool?.description).toContain("Do not add encouragement, onboarding, capability offers, or reminder suggestions");
    expect(tool?.description).toContain("Never advise the user to repeat the same unchanged request");
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
      peerDependenciesMeta?: Record<string, { optional?: unknown }>;
      openclaw?: { extensions?: unknown };
    };

    expect(packageManifest.dependencies?.typebox).toBeDefined();
    expect((packageManifest as { name?: unknown }).name).toBe("diet-manager-b");
    expect(packageManifest.devDependencies?.["@types/node"]).toBe("^24.0.0");
    expect(packageManifest.engines?.node).toBe(">=24.15.0 <25");
    expect(packageManifest.peerDependencies?.openclaw).toBe(">=2026.5.17");
    expect(packageManifest.peerDependenciesMeta?.openclaw?.optional).toBe(true);
    expect(packageManifest.openclaw?.extensions).toEqual(["./dist/openclaw/index.js"]);
    expect(packageManifest.scripts?.["plugin:build"]).toContain("./dist/openclaw/index.js");
    expect(packageManifest.scripts?.["plugin:validate"]).toContain("./dist/openclaw/index.js");
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

  test("implements the exact CONTRACT-v3 command outcome boundary", () => {
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

  test("accepts CONTRACT-v3 extended daily_progress with configured goals and progress bars", () => {
    const validator = Reflect.get(foundation, "assertDietManagerOutcome") as
      | ((value: unknown) => unknown)
      | undefined;
    expect(() =>
      validator?.({
        action: "query_daily_summary",
        status: "ignored",
        committed: false,
        reason_code: "read_only_result",
        daily_progress: {
          date: "2026-08-19",
          timezone: "Asia/Shanghai",
          meals: { count: 1 },
          water: { count: 0, plain_water_ml_milli: 0 },
          nutrition: {
            coverage_status: "partial",
            nutrients: {
              energy_kcal_milli: 300000,
              protein_mg: 20000,
              fat_mg: 10000,
              carbohydrate_mg: 40000,
              fiber_mg: 5000,
              water_ml_milli: 0,
            },
          },
          inventory: { deduction_count: 0 },
          purchases: { count: 0 },
          corrections: { count: 0 },
          configured_goals: {
            energy_kcal: 2000,
            protein_g: 100,
            fat_g: 70,
            carbohydrate_g: 200,
            fiber_g: 28,
            water_ml: 2450,
          },
          progress: {
            energy_kcal: {
              current: 300,
              target: 2000,
              percentage: 15,
              filled_cells: 2,
              bar_text: "██░░░░░░░░",
            },
          },
        },
      }),
    ).not.toThrow();
  });
});
