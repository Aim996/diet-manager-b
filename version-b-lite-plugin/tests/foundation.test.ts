import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { describe, expect, test } from "vitest";
import * as foundation from "../src/index";
import pluginEntry, {
  dietManagerParameters,
  handleFoundationAction,
} from "../src/index";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(testsDirectory, "..");
const manifestPath = resolve(projectDirectory, "openclaw.plugin.json");
const packagePath = resolve(projectDirectory, "package.json");
const dataDirectory = resolve(projectDirectory, "data");
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
  "foundation_not_implemented",
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

describe("diet manager B 基底", () => {
  test("declares the official tool-plugin metadata and exact action boundary", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const metadata = getToolPluginMetadata(pluginEntry);

    expect(metadata).toMatchObject({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      activation: { onStartup: true },
    });
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
    expect(dietManagerParameters.properties).toMatchObject({
      operation_id: { type: "string" },
      source_text: { type: "string" },
      occurred_at_text: { type: "string" },
      items: { type: "array" },
    });
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
    expect(packageManifest.devDependencies?.["@types/node"]).toBe("^24.0.0");
    expect(packageManifest.engines?.node).toBe(">=24.14.0 <25");
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

  test.each(expectedActions)("returns the non-writing foundation outcome for %s", async (action) => {
    const before = businessDataFiles();

    const result = await handleFoundationAction({ action });

    expect(result).toMatchObject({
      action,
      status: "foundation_not_implemented",
      committed: false,
    });
    expect(result).not.toHaveProperty("operation_id");
    expect(result).not.toHaveProperty("record_id");
    expect(businessDataFiles()).toEqual(before);
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

  test("implements the CONTRACT-v2 non-writing and committed outcome boundary", () => {
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
  });
});
