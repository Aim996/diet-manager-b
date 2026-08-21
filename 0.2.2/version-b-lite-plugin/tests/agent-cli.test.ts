import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import {
  assertDietManagerOutcome,
  type AgentCommandV1,
  type DietManagerAction,
  type DietManagerOutcome,
} from "../src/index.js";

const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as typeof import("node:sqlite");

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(projectRoot, "dist", "cli", "agent.js");
const databaseFilename = "diet-manager-b.sqlite3";
const deploymentEnvironmentNames = new Set([
  "DIET_MANAGER_CONFIG_FILE",
  "DIET_MANAGER_CONVERSATION_ID",
  "DIET_MANAGER_DATA_ROOT",
]);
const ownedRoots = new Set<string>();

interface CliOptions {
  readonly root?: string;
  readonly input: string;
  readonly args?: readonly string[];
  readonly configFile?: string;
  readonly conversationId?: string;
  readonly environment?: Readonly<Record<string, string>>;
}

function newRoot(prefix = "diet-agent-cli-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  ownedRoots.add(root);
  return root;
}

afterEach(() => {
  for (const root of ownedRoots) rmSync(root, { recursive: true, force: false });
  ownedRoots.clear();
});

function deploymentEnvironment(options: CliOptions): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!deploymentEnvironmentNames.has(key.toUpperCase())) environment[key] = value;
  }
  if (options.root !== undefined) environment.DIET_MANAGER_DATA_ROOT = options.root;
  if (options.configFile !== undefined) environment.DIET_MANAGER_CONFIG_FILE = options.configFile;
  if (options.conversationId !== undefined) {
    environment.DIET_MANAGER_CONVERSATION_ID = options.conversationId;
  }
  Object.assign(environment, options.environment);
  return environment;
}

function runRawCli(options: CliOptions): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [cli, ...(options.args ?? ["execute"])], {
    input: options.input,
    encoding: "utf8",
    windowsHide: true,
    env: deploymentEnvironment(options),
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
}

function command(action: DietManagerAction, sourceText: string): AgentCommandV1 {
  return {
    schema_version: "diet-manager/agent-command/v1",
    action,
    source_text: sourceText,
  };
}

function runCli(
  root: string | undefined,
  input: unknown,
  options: Omit<CliOptions, "root" | "input"> = {},
): SpawnSyncReturns<string> {
  return runRawCli({
    ...options,
    root,
    input: `${JSON.stringify(input)}\n`,
    conversationId: options.conversationId ?? "cli-test-conversation",
  });
}

function parseSuccessfulOutcome(result: SpawnSyncReturns<string>): DietManagerOutcome {
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.trim().split(/\r?\n/u)).toHaveLength(1);
  const outcome = JSON.parse(result.stdout) as unknown;
  expect(assertDietManagerOutcome(outcome)).toBe(outcome);
  return outcome as DietManagerOutcome;
}

function expectProtocolFailure(
  result: SpawnSyncReturns<string>,
  code: "DIET_AGENT_CLI_CONFIG_REQUIRED" | "DIET_AGENT_CLI_INPUT_TOO_LARGE" |
    "DIET_AGENT_CLI_INVALID_INPUT" | "DIET_AGENT_CLI_OUTPUT_FAILED" |
    "DIET_AGENT_CLI_UNAVAILABLE",
): void {
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(`${code}\n`);
}

function databasePath(root: string): string {
  return join(root, databaseFilename);
}

function businessSnapshot(root: string): string {
  const database = new DatabaseSync(databasePath(root), { readOnly: true });
  try {
    const tables = database.prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
       ORDER BY name`,
    ).all() as Array<{ name: string }>;
    return JSON.stringify(tables.map(({ name }) => ({
      name,
      rows: database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
    })));
  } finally {
    database.close();
  }
}

function businessRowCount(root: string, table?: string): number {
  if (!existsSync(databasePath(root))) return 0;
  const database = new DatabaseSync(databasePath(root), { readOnly: true });
  try {
    if (table !== undefined) {
      return (database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count;
    }
    const tables = database.prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'`,
    ).all() as Array<{ name: string }>;
    return tables.reduce((total, { name }) => total +
      (database.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as { count: number }).count, 0);
  } finally {
    database.close();
  }
}

function writeConfig(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

function runtimeConfig(root: string, conversationId = "configured-conversation") {
  return {
    schema_version: "diet-manager/runtime-config/v1",
    official_data_root: root,
    timezone: "Asia/Shanghai",
    conversation_id: conversationId,
  };
}

describe("standalone agent JSON CLI", () => {
  it("records and queries through fresh processes so a restart cannot lose committed SQLite state", () => {
    const root = newRoot();

    const record = parseSuccessfulOutcome(runCli(root, command("record_meal", "我吃了一个苹果")));
    expect(record).toMatchObject({ action: "record_meal", committed: true });
    expect(existsSync(databasePath(root))).toBe(true);

    const query = parseSuccessfulOutcome(runCli(root, command("query_meals", "查询今天的饮食记录")));
    expect(query.meal_history?.meals).toHaveLength(1);
  }, 60_000);

  it("requires exactly the execute subcommand so protocol typos cannot open the runtime", () => {
    const root = newRoot();
    const result = runRawCli({
      root,
      args: ["execute", "extra"],
      input: `${JSON.stringify(command("query_meals", "查询今天的饮食记录"))}\n`,
    });

    expectProtocolFailure(result, "DIET_AGENT_CLI_INVALID_INPUT");
    expect(existsSync(databasePath(root))).toBe(false);
  });

  it("requires an administrator-selected data root so the working directory cannot become storage", () => {
    const result = runCli(undefined, command("query_meals", "查询今天的饮食记录"));

    expectProtocolFailure(result, "DIET_AGENT_CLI_CONFIG_REQUIRED");
  });

  it.each([
    ["malformed JSON", "{not-json}\n"],
    ["array top-level", `${JSON.stringify([command("query_meals", "查询今天的饮食记录")])}\n`],
  ])("rejects %s so non-command JSON cannot reach SQLite", (_name, input) => {
    const root = newRoot();
    const result = runRawCli({ root, input, conversationId: "cli-test-conversation" });

    expectProtocolFailure(result, "DIET_AGENT_CLI_INVALID_INPUT");
    expect(existsSync(databasePath(root))).toBe(false);
  });

  it("rejects a duplicate required JSON key before the last value can reach SQLite", () => {
    const root = newRoot();
    const input = [
      "{",
      '"schema_version":"diet-manager/agent-command/v1",',
      '"action":"record_water",',
      '"source_text":"我没有喝水",',
      '"source_text":"我喝了500毫升白水"',
      "}\n",
    ].join("");

    const result = runRawCli({ root, input, conversationId: "cli-test-conversation" });

    expectProtocolFailure(result, "DIET_AGENT_CLI_INVALID_INPUT");
    expect(existsSync(databasePath(root))).toBe(false);
  });

  it("rejects a nested duplicate JSON key in an otherwise valid semantic command", () => {
    const root = newRoot();
    const sourceText = "中午吃了两碗米饭";
    const valid = {
      ...command("record_meal", sourceText),
      semantic_candidate: {
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
          amount: { kind: "exact", value: 2, unit: "bowl", evidence_span: "两碗米饭" },
        }],
        time: { kind: "source_text", evidence_span: "中午" },
      },
    };
    const input = `${JSON.stringify(valid).replace(
      '"raw_name":"米饭"',
      '"raw_name":"伪造食物","raw_name":"米饭"',
    )}\n`;

    const result = runRawCli({ root, input, conversationId: "cli-test-conversation" });

    expectProtocolFailure(result, "DIET_AGENT_CLI_INVALID_INPUT");
    expect(existsSync(databasePath(root))).toBe(false);
  });

  it.each([
    "official_data_root",
    "secret",
    "database_path",
    "host_id",
    "received_at",
    "timezone",
    "operation_id",
    "source_message_id",
    "conversation_id",
    "timestamp",
    "prior_context",
    "unknown_key",
  ])("rejects business JSON key %s so agent input cannot acquire host authority", (key) => {
    const root = newRoot();
    const result = runCli(root, { ...command("record_meal", "我吃了一个苹果"), [key]: "forbidden" });

    expectProtocolFailure(result, "DIET_AGENT_CLI_INVALID_INPUT");
    expect(existsSync(databasePath(root))).toBe(false);
  });

  it("bounds stdin by UTF-8 bytes so multibyte input cannot bypass the 64-KiB limit", () => {
    const root = newRoot();
    const oversized = `${JSON.stringify({
      ...command("record_meal", "我吃了一个苹果"),
      padding: "界".repeat(22_000),
    })}\n`;
    expect(Buffer.byteLength(oversized, "utf8")).toBeGreaterThan(65_536);

    const result = runRawCli({ root, input: oversized, conversationId: "cli-test-conversation" });

    expectProtocolFailure(result, "DIET_AGENT_CLI_INPUT_TOO_LARGE");
    expect(existsSync(databasePath(root))).toBe(false);
  });

  it("maps a stdout EPIPE to one stable diagnostic without retrying the committed write", () => {
    const root = newRoot("diet-agent-cli-epipe-");
    const preload = join(root, "stdout-epipe.mjs");
    writeFileSync(preload, `
const sensitive = process.env.DIET_CLI_TEST_SENSITIVE_PATH;
process.stdout.write = function (_chunk, encoding, callback) {
  const done = typeof encoding === "function" ? encoding : callback;
  const error = Object.assign(new Error("broken pipe at " + sensitive), { code: "EPIPE" });
  queueMicrotask(() => {
    if (typeof done === "function") done(error);
    process.stdout.emit("error", error);
  });
  return false;
};
`, "utf8");

    const result = runRawCli({
      root,
      input: `${JSON.stringify(command("record_water", "我喝了500毫升白水"))}\n`,
      conversationId: "cli-test-conversation",
      environment: {
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
        DIET_CLI_TEST_SENSITIVE_PATH: root,
      },
    });

    expectProtocolFailure(result, "DIET_AGENT_CLI_OUTPUT_FAILED");
    expect(result.stderr).not.toContain(root);
    expect(businessRowCount(root, "event_records")).toBe(1);
  });

  it("returns an ignored future plan with zero business rows instead of treating it as a meal fact", () => {
    const root = newRoot();
    const outcome = parseSuccessfulOutcome(runCli(
      root,
      command("record_meal", "我计划明天吃一个苹果"),
    ));

    expect(outcome).toMatchObject({ action: "record_meal", status: "ignored", committed: false });
    expect(businessRowCount(root)).toBe(0);
  });

  it("redacts an unavailable configured root from stable startup diagnostics", () => {
    const container = newRoot("diet-agent-cli-redaction-");
    const missingRoot = join(container, "sensitive-deployment-root-that-does-not-exist");
    const result = runCli(missingRoot, command("query_meals", "查询今天的饮食记录"));

    expectProtocolFailure(result, "DIET_AGENT_CLI_UNAVAILABLE");
    expect(result.stderr).not.toContain(missingRoot);
  });

  it("loads the exact ordinary config file when environment deployment values are absent", () => {
    const container = newRoot("diet-agent-cli-config-");
    const dataRoot = join(container, "data");
    mkdirSync(dataRoot);
    const configFile = join(container, "runtime.json");
    writeConfig(configFile, runtimeConfig(dataRoot));

    const outcome = parseSuccessfulOutcome(runRawCli({
      configFile,
      input: `${JSON.stringify(command("record_meal", "我吃了一个苹果"))}\n`,
    }));
    expect(outcome).toMatchObject({ action: "record_meal", committed: true });

    const database = new DatabaseSync(databasePath(dataRoot), { readOnly: true });
    try {
      expect(database.prepare("SELECT DISTINCT conversation_id FROM event_records").all())
        .toEqual([{ conversation_id: "configured-conversation" }]);
    } finally {
      database.close();
    }
  }, 60_000);

  it("lets administrator environment values override both config-file deployment values", () => {
    const container = newRoot("diet-agent-cli-precedence-");
    const configuredRoot = join(container, "configured-data");
    const environmentRoot = join(container, "environment-data");
    mkdirSync(configuredRoot);
    mkdirSync(environmentRoot);
    const configFile = join(container, "runtime.json");
    writeConfig(configFile, runtimeConfig(configuredRoot));

    const outcome = parseSuccessfulOutcome(runRawCli({
      root: environmentRoot,
      configFile,
      conversationId: "environment-conversation",
      input: `${JSON.stringify(command("record_meal", "我吃了一个苹果"))}\n`,
    }));
    expect(outcome).toMatchObject({ action: "record_meal", committed: true });
    expect(existsSync(databasePath(configuredRoot))).toBe(false);

    const database = new DatabaseSync(databasePath(environmentRoot), { readOnly: true });
    try {
      expect(database.prepare("SELECT DISTINCT conversation_id FROM event_records").all())
        .toEqual([{ conversation_id: "environment-conversation" }]);
    } finally {
      database.close();
    }
  }, 60_000);

  it("derives one stable non-reversible standalone conversation domain from the physical root", () => {
    const root = newRoot("diet-agent-cli-standalone-");
    for (const sourceText of ["我吃了一个苹果", "我吃了一个鸡蛋"]) {
      parseSuccessfulOutcome(runRawCli({
        root,
        input: `${JSON.stringify(command("record_meal", sourceText))}\n`,
      }));
    }

    const expected = `standalone-${createHash("sha256")
      .update(realpathSync(root), "utf8")
      .digest("hex")}`;
    const database = new DatabaseSync(databasePath(root), { readOnly: true });
    try {
      expect(database.prepare("SELECT DISTINCT conversation_id FROM event_records").all())
        .toEqual([{ conversation_id: expected }]);
    } finally {
      database.close();
    }
    expect(expected).not.toContain(root);
  }, 60_000);

  it.each([
    ["unknown keys", (root: string) => ({ ...runtimeConfig(root), extra: true })],
    ["a missing official data root", () => ({
      schema_version: "diet-manager/runtime-config/v1",
      timezone: "Asia/Shanghai",
    })],
    ["the wrong timezone", (root: string) => ({ ...runtimeConfig(root), timezone: "UTC" })],
  ])("rejects config with %s before opening SQLite", (_name, makeConfig) => {
    const container = newRoot("diet-agent-cli-invalid-config-");
    const dataRoot = join(container, "data");
    mkdirSync(dataRoot);
    const configFile = join(container, "runtime.json");
    writeConfig(configFile, makeConfig(dataRoot));

    const result = runRawCli({
      configFile,
      input: `${JSON.stringify(command("query_meals", "查询今天的饮食记录"))}\n`,
    });

    expectProtocolFailure(result, "DIET_AGENT_CLI_CONFIG_REQUIRED");
    expect(existsSync(databasePath(dataRoot))).toBe(false);
  });

  it("rejects malformed config JSON before opening SQLite", () => {
    const container = newRoot("diet-agent-cli-malformed-config-");
    const dataRoot = join(container, "data");
    mkdirSync(dataRoot);
    const configFile = join(container, "runtime.json");
    writeFileSync(configFile, "{malformed", "utf8");

    const result = runRawCli({
      root: dataRoot,
      configFile,
      input: `${JSON.stringify(command("query_meals", "查询今天的饮食记录"))}\n`,
    });

    expectProtocolFailure(result, "DIET_AGENT_CLI_CONFIG_REQUIRED");
    expect(existsSync(databasePath(dataRoot))).toBe(false);
  });

  it("rejects an oversized config before reading beyond 16 KiB or opening SQLite", () => {
    const container = newRoot("diet-agent-cli-large-config-");
    const dataRoot = join(container, "data");
    mkdirSync(dataRoot);
    const configFile = join(container, "runtime.json");
    const prefix = JSON.stringify(runtimeConfig(dataRoot));
    writeFileSync(configFile, prefix + " ".repeat(16_385 - Buffer.byteLength(prefix)), "utf8");

    const result = runRawCli({
      root: dataRoot,
      configFile,
      input: `${JSON.stringify(command("query_meals", "查询今天的饮食记录"))}\n`,
    });

    expectProtocolFailure(result, "DIET_AGENT_CLI_CONFIG_REQUIRED");
    expect(existsSync(databasePath(dataRoot))).toBe(false);
  });

  it.each(["missing file", "directory"])("rejects a non-ordinary config %s before opening SQLite", (kind) => {
    const container = newRoot("diet-agent-cli-non-file-config-");
    const dataRoot = join(container, "data");
    mkdirSync(dataRoot);
    const configFile = join(container, kind === "directory" ? "config-directory" : "missing.json");
    if (kind === "directory") mkdirSync(configFile);

    const result = runRawCli({
      root: dataRoot,
      configFile,
      input: `${JSON.stringify(command("query_meals", "查询今天的饮食记录"))}\n`,
    });

    expectProtocolFailure(result, "DIET_AGENT_CLI_CONFIG_REQUIRED");
    expect(existsSync(databasePath(dataRoot))).toBe(false);
  });

  it("rejects a symlink or reparse-point config before opening SQLite", () => {
    const container = newRoot("diet-agent-cli-link-config-");
    const dataRoot = join(container, "data");
    mkdirSync(dataRoot);
    const target = join(container, "target.json");
    writeConfig(target, runtimeConfig(dataRoot));
    let configFile = join(container, "runtime-link.json");
    try {
      symlinkSync(target, configFile, "file");
    } catch (error) {
      if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      const targetDirectory = join(container, "target-directory");
      mkdirSync(targetDirectory);
      configFile = join(container, "runtime-junction");
      symlinkSync(targetDirectory, configFile, "junction");
    }

    const result = runRawCli({
      root: dataRoot,
      configFile,
      input: `${JSON.stringify(command("query_meals", "查询今天的饮食记录"))}\n`,
    });

    expectProtocolFailure(result, "DIET_AGENT_CLI_CONFIG_REQUIRED");
    expect(existsSync(databasePath(dataRoot))).toBe(false);
  });

  it("rejects a config below a symlink or junction ancestor so a linked parent cannot redirect deployment authority", () => {
    const container = newRoot("diet-agent-cli-parent-link-config-");
    const dataRoot = join(container, "data");
    const realConfigDirectory = join(container, "real-config-directory");
    const linkedConfigDirectory = join(container, "linked-config-directory");
    mkdirSync(dataRoot);
    mkdirSync(realConfigDirectory);
    writeConfig(join(realConfigDirectory, "runtime.json"), runtimeConfig(dataRoot));
    symlinkSync(
      realConfigDirectory,
      linkedConfigDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = runRawCli({
      configFile: join(linkedConfigDirectory, "runtime.json"),
      input: `${JSON.stringify(command("query_meals", "查询今天的饮食记录"))}\n`,
    });

    expectProtocolFailure(result, "DIET_AGENT_CLI_CONFIG_REQUIRED");
    expect(existsSync(databasePath(dataRoot))).toBe(false);
  });

  it("rejects a same-length in-place config rewrite between descriptor read and validation", () => {
    const container = newRoot("diet-agent-cli-config-race-");
    const firstRoot = join(container, "data-a");
    const secondRoot = join(container, "data-b");
    mkdirSync(firstRoot);
    mkdirSync(secondRoot);
    const configFile = join(container, "runtime.json");
    const original = `${JSON.stringify(runtimeConfig(firstRoot))}\n`;
    const replacement = `${JSON.stringify(runtimeConfig(secondRoot))}\n`;
    expect(Buffer.byteLength(replacement)).toBe(Buffer.byteLength(original));
    writeFileSync(configFile, original, "utf8");

    const preload = join(container, "rewrite-after-config-read.mjs");
    writeFileSync(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const target = fs.statSync(process.env.DIET_CLI_TEST_RACE_CONFIG);
const originalReadSync = fs.readSync;
let rewritten = false;
fs.readSync = function (...args) {
  const count = Reflect.apply(originalReadSync, this, args);
  const opened = fs.fstatSync(args[0]);
  if (!rewritten && count > 0 && opened.dev === target.dev && opened.ino === target.ino) {
    rewritten = true;
    fs.writeFileSync(
      process.env.DIET_CLI_TEST_RACE_CONFIG,
      process.env.DIET_CLI_TEST_RACE_REPLACEMENT,
      "utf8",
    );
  }
  return count;
};
syncBuiltinESMExports();
`, "utf8");

    const result = runRawCli({
      configFile,
      input: `${JSON.stringify(command("query_meals", "查询今天的饮食记录"))}\n`,
      environment: {
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
        DIET_CLI_TEST_RACE_CONFIG: configFile,
        DIET_CLI_TEST_RACE_REPLACEMENT: replacement,
      },
    });

    expectProtocolFailure(result, "DIET_AGENT_CLI_CONFIG_REQUIRED");
    expect(existsSync(databasePath(firstRoot))).toBe(false);
    expect(existsSync(databasePath(secondRoot))).toBe(false);
  });

  it("executes all eleven actions through isolated processes with only intended SQLite writes", () => {
    const root = newRoot("diet-agent-cli-actions-");
    const actions = [
      { action: "record_meal", sourceText: "我吃了一个苹果", writeTable: "event_records" },
      { action: "record_water", sourceText: "我喝了500毫升白水", writeTable: "event_records" },
      { action: "add_inventory", sourceText: "今天带回来一盒鸡蛋，先放进库存。", writeTable: "inventory_batches" },
      { action: "query_inventory", sourceText: "查询库存", writeTable: null },
      { action: "query_meals", sourceText: "查询今天的饮食记录", writeTable: null },
      { action: "query_daily_summary", sourceText: "查询今天的饮食总结", writeTable: null },
      { action: "correct_record", sourceText: "把刚才苹果改成200克", writeTable: "correction_events" },
      { action: "undo_record", sourceText: "撤销刚才那条饮食记录", writeTable: "correction_events" },
      { action: "set_profile", sourceText: "身高180体重70公斤男30岁减脂", writeTable: "user_profiles" },
      { action: "set_goal", sourceText: "热量目标1800千卡", writeTable: "goal_versions" },
      { action: "restore_record", sourceText: "恢复刚才那条饮食记录", writeTable: "correction_events" },
    ] as const satisfies readonly Array<{
      action: DietManagerAction;
      sourceText: string;
      writeTable: string | null;
    }>;

    for (const entry of actions) {
      const before = existsSync(databasePath(root)) ? businessSnapshot(root) : undefined;
      const beforeTableCount = before === undefined || entry.writeTable === null
        ? undefined
        : businessRowCount(root, entry.writeTable);
      const outcome = parseSuccessfulOutcome(runCli(root, command(entry.action, entry.sourceText)));

      expect(outcome.action).toBe(entry.action);
      if (entry.writeTable === null) {
        expect(businessSnapshot(root), `${entry.action} changed business state`).toBe(before);
      } else {
        expect(outcome.committed, JSON.stringify(outcome)).toBe(true);
        expect(businessRowCount(root, entry.writeTable), `${entry.action} did not persist its business row`)
          .toBeGreaterThan(beforeTableCount ?? 0);
      }
    }
  }, 120_000);
});
