import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import { createCoreRuntime } from "../src/application/runtime.js";
import { handleCoreRequest } from "../src/application/command-handler.js";
import { executeAgentCommand } from "../src/public/execute.js";
import { DIET_DATABASE_FILENAME } from "../src/storage/database.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(here, "..");
const installer = join(projectDir, "scripts", "install-diet-manager.ps1");
const fakeOpenClaw = join(projectDir, "tests", "fixtures", "install", "fake-openclaw.ps1");
const nodePath = process.execPath;
const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as typeof import("node:sqlite");

function resolvePwsh(): string {
  const probe = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (probe.status === 0) return "pwsh";
  const candidates = [
    "C:/Users/10481/AppData/Local/Microsoft/WindowsApps/pwsh.exe",
    "C:/Program Files/PowerShell/7/pwsh.exe",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("pwsh not found");
}

const pwsh = resolvePwsh();

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runInstaller(args: string[], env: Record<string, string> = {}): RunResult {
  const result = spawnSync(pwsh, ["-NoProfile", "-NonInteractive", "-File", installer, ...args], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function makeWorld(): {
  base: string;
  officialRoot: string;
  backupRoot: string;
  programRoot: string;
  fakeState: string;
  cleanup: () => void;
} {
  const base = mkdtempSync(join(tmpdir(), "diet-manager-install-"));
  const officialRoot = join(base, "data");
  const backupRoot = join(base, "backups");
  const programRoot = join(base, "program");
  const fakeState = join(base, "openclaw-state.json");
  return {
    base,
    officialRoot,
    backupRoot,
    programRoot,
    fakeState,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

function installArgs(world: {
  officialRoot: string;
  backupRoot: string;
  programRoot: string;
}): string[] {
  return [
    "-Action", "Install",
    "-OfficialDataRoot", world.officialRoot,
    "-BackupRoot", world.backupRoot,
    "-ProgramRoot", world.programRoot,
    "-OpenClawPath", fakeOpenClaw,
    "-NodePath", nodePath,
    "-SourcePayload", projectDir,
    "-SkipDependencyInstall",
  ];
}

let opCounter = 0;
function nextOperationId(): string {
  opCounter += 1;
  return `install-lifecycle-op-${opCounter}`;
}

async function seedExactV1Data(world: ReturnType<typeof makeWorld>): Promise<Record<string, number>> {
  mkdirSync(world.officialRoot, { recursive: true });
  const runtime = createCoreRuntime({
    officialDataRoot: world.officialRoot,
    now: () => "2026-08-18T04:00:01.000Z",
  });
  const context = (suffix: string) => ({
    received_at: "2026-08-18T12:00:00+08:00",
    timezone: "Asia/Shanghai" as const,
    operation_id: `upgrade-v1-${suffix}`,
    source_message_id: `upgrade-v1-message-${suffix}`,
    conversation_id: "upgrade-v1-conversation",
  });
  try {
    const inventory = await executeAgentCommand(runtime, {
      schema_version: "diet-manager/agent-command/v2",
      action: "add_inventory",
      source_text: "买了两个苹果，放在冰箱里。",
      semantic_proposal: {
        kind: "inventory",
        product: { raw_name: "苹果", normalized_hint: "apple", evidence_span: "苹果" },
        package_amount: { kind: "exact", value: 2, unit: "个", evidence_span: "两个苹果" },
        per_package_content: null,
        location: { value: "冰箱", evidence_span: "冰箱" },
        expires_at: { kind: "unspecified", evidence_span: null },
        price: null,
      },
    }, context("inventory"));
    expect(inventory.committed).toBe(true);

    const mealCommand = {
      schema_version: "diet-manager/agent-command/v2" as const,
      action: "record_meal" as const,
      source_text: "午饭我吃了一个苹果。",
      semantic_proposal: {
        kind: "meal" as const,
        subject: { kind: "self" as const, basis: "explicit" as const, evidence_span: "我", explicit_other_spans: [] },
        occurrence: "completed" as const,
        meal_slot: "lunch" as const,
        items: [{
          raw_name: "苹果",
          normalized_hint: "apple",
          amount: { kind: "exact" as const, value: 1, unit: "个", evidence_span: "一个苹果" },
        }],
        occurred_at: { kind: "source_text" as const, evidence_span: "午饭" },
      },
    };
    const meal = await executeAgentCommand(runtime, mealCommand, context("meal"));
    expect(meal.committed).toBe(true);
    const replay = await executeAgentCommand(runtime, mealCommand, context("meal"));
    expect(replay.record_id).toBe(meal.record_id);

    const goal = await executeAgentCommand(runtime, {
      schema_version: "diet-manager/agent-command/v2",
      action: "set_goal",
      source_text: "热量目标改成每天2100千卡。",
      semantic_proposal: {
        kind: "goal",
        operation: "update",
        values: { energy_kcal: { value: 2100, evidence_span: "2100千卡" } },
      },
    }, context("goal"));
    expect(goal.committed).toBe(true);

    const correction = handleCoreRequest(runtime, {
      action: "correct_record",
      source_text: "把刚才苹果改成200克",
      received_at: "2026-08-18T12:05:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "upgrade-v1-correction",
      source_message_id: "upgrade-v1-message-correction",
      conversation_id: "upgrade-v1-conversation",
      prior_context: [],
    });
    expect(correction.committed, JSON.stringify(correction)).toBe(true);
  } finally {
    runtime.close();
  }

  const databasePath = join(world.officialRoot, DIET_DATABASE_FILENAME);
  const database = new DatabaseSync(databasePath);
  try {
    const count = (table: string): number => Number((database.prepare(
      `SELECT COUNT(*) AS count FROM ${table}`,
    ).get() as { count: number }).count);
    const snapshot = {
      meals: count("event_records"),
      inventory: count("inventory_batches"),
      nutrition: count("nutrition_snapshots"),
      goals: count("goal_versions"),
      corrections: count("correction_events"),
      idempotency: count("idempotency_records"),
    };
    expect(Object.values(snapshot).every((value) => value > 0)).toBe(true);
    database.exec("PRAGMA foreign_keys = OFF");
    for (const table of [
      "pending_candidates",
      "inventory_quantity_models",
      "nutrition_search_audit",
      "goal_recommendations",
    ]) database.exec(`DROP TABLE ${table}`);
    database.exec("DELETE FROM schema_migrations WHERE version = 2");
    database.exec("PRAGMA user_version = 1");
    return snapshot;
  } finally {
    database.close();
  }
}

function seedLegacyProgram(world: ReturnType<typeof makeWorld>): string {
  const legacy = join(world.programRoot, "versions", "0.2.2");
  mkdirSync(join(legacy, "dist"), { recursive: true });
  writeFileSync(join(legacy, "dist", "index.js"), "export {};\n");
  writeFileSync(join(world.programRoot, "current.json"), `${JSON.stringify({
    schema_version: "diet-manager/current/v1",
    product_version: "0.2.2",
    installed_version_path: legacy,
    official_data_root: world.officialRoot,
  })}\n`);
  return legacy;
}

test("preflight failure makes zero files", () => {
  const world = makeWorld();
  try {
    const badRoot = join(world.base, "not-a-directory");
    writeFileSync(badRoot, "occupied");
    const r = runInstaller([
      "-Action", "Install",
      "-OfficialDataRoot", badRoot,
      "-BackupRoot", world.backupRoot,
      "-ProgramRoot", world.programRoot,
      "-OpenClawPath", fakeOpenClaw,
      "-NodePath", nodePath,
      "-SkipDependencyInstall",
    ]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/DIET_INSTALL_PATH_INVALID/);
    expect(existsSync(world.programRoot)).toBe(false);
    expect(existsSync(world.officialRoot)).toBe(false);
  } finally {
    world.cleanup();
  }
});

test("fresh install creates empty schema, secret and zero business rows", () => {
  const world = makeWorld();
  try {
    const r = runInstaller(installArgs(world), { FAKE_OPENCLAW_STATE: world.fakeState });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const receipt = JSON.parse(r.stdout.trim());
    expect(receipt.schema_version).toBe("diet-manager/installation-receipt/v1");
    expect(receipt.action).toBe("install");
    expect(receipt.business_rows).toBe(0);

    expect(existsSync(join(world.programRoot, "versions", "0.3.0", "dist", "index.js"))).toBe(true);
    expect(existsSync(join(world.programRoot, "current.json"))).toBe(true);
    expect(existsSync(join(world.officialRoot, "diet-manager-b.sqlite3"))).toBe(true);
    expect(existsSync(join(world.officialRoot, ".diet-manager-b.authority-secret"))).toBe(true);
    expect(statSync(join(world.officialRoot, ".diet-manager-b.authority-secret")).size).toBe(32);
  } finally {
    world.cleanup();
  }
});

test("0.2.2 v1 backup upgrades in place without losing any legacy business domain", async () => {
  const world = makeWorld();
  try {
    const expected = await seedExactV1Data(world);
    const legacyPath = seedLegacyProgram(world);

    const upgrade = runInstaller(
      [
        "-Action", "Upgrade",
        "-OfficialDataRoot", world.officialRoot,
        "-BackupRoot", world.backupRoot,
        "-ProgramRoot", world.programRoot,
        "-OpenClawPath", fakeOpenClaw,
        "-NodePath", nodePath,
        "-SourcePayload", projectDir,
        "-SkipDependencyInstall",
      ],
      { FAKE_OPENCLAW_STATE: world.fakeState },
    );
    expect(upgrade.stderr).toBe("");
    expect(upgrade.code).toBe(0);
    const receipt = JSON.parse(upgrade.stdout.trim());
    expect(receipt.action).toBe("upgrade");
    expect(receipt.product_version).toBe("0.3.0");
    expect(existsSync(receipt.backup_path)).toBe(true);
    expect(existsSync(join(world.programRoot, "versions", "0.3.0", "dist", "index.js"))).toBe(true);
    expect(existsSync(legacyPath)).toBe(true);

    const backup = new DatabaseSync(receipt.backup_path, { readOnly: true });
    try {
      expect((backup.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(1);
    } finally {
      backup.close();
    }
    const upgraded = new DatabaseSync(join(world.officialRoot, DIET_DATABASE_FILENAME), { readOnly: true });
    try {
      const count = (table: string): number => Number((upgraded.prepare(
        `SELECT COUNT(*) AS count FROM ${table}`,
      ).get() as { count: number }).count);
      expect({
        meals: count("event_records"),
        inventory: count("inventory_batches"),
        nutrition: count("nutrition_snapshots"),
        goals: count("goal_versions"),
        corrections: count("correction_events"),
        idempotency: count("idempotency_records"),
      }).toEqual(expected);
      expect((upgraded.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(2);
    } finally {
      upgraded.close();
    }
    const backups = readdirSync(world.backupRoot).filter((name) => name.endsWith(".sqlite3"));
    expect(backups.length).toBeGreaterThanOrEqual(1);
  } finally {
    world.cleanup();
  }
});

test("injected gateway failure restores the exact 0.2.2 program, v1 database, and current config", async () => {
  const world = makeWorld();
  try {
    const expected = await seedExactV1Data(world);
    const legacyPath = seedLegacyProgram(world);
    const currentBefore = readFileSync(join(world.programRoot, "current.json"), "utf8");

    const upgrade = runInstaller(
      [
        "-Action", "Upgrade",
        "-OfficialDataRoot", world.officialRoot,
        "-BackupRoot", world.backupRoot,
        "-ProgramRoot", world.programRoot,
        "-OpenClawPath", fakeOpenClaw,
        "-NodePath", nodePath,
        "-SourcePayload", projectDir,
        "-SkipDependencyInstall",
      ],
      { FAKE_OPENCLAW_STATE: world.fakeState, FAKE_OPENCLAW_FAIL: "gateway health" },
    );
    expect(upgrade.code).not.toBe(0);
    expect(upgrade.stderr).toMatch(/DIET_INSTALL_/);

    // 回滚：current.json 未被切换到新版本，数据仍在。
    const currentAfter = readFileSync(join(world.programRoot, "current.json"), "utf8");
    expect(currentAfter).toBe(currentBefore);
    expect(existsSync(legacyPath)).toBe(true);
    expect(existsSync(join(world.programRoot, "versions", "0.3.0"))).toBe(false);

    const restored = new DatabaseSync(join(world.officialRoot, DIET_DATABASE_FILENAME), { readOnly: true });
    try {
      const count = (table: string): number => Number((restored.prepare(
        `SELECT COUNT(*) AS count FROM ${table}`,
      ).get() as { count: number }).count);
      expect({
        meals: count("event_records"),
        inventory: count("inventory_batches"),
        nutrition: count("nutrition_snapshots"),
        goals: count("goal_versions"),
        corrections: count("correction_events"),
        idempotency: count("idempotency_records"),
      }).toEqual(expected);
      expect((restored.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(1);
    } finally {
      restored.close();
    }
  } finally {
    world.cleanup();
  }
});

test("default uninstall preserves database, secret and backups", () => {
  const world = makeWorld();
  try {
    const install = runInstaller(installArgs(world), { FAKE_OPENCLAW_STATE: world.fakeState });
    expect(install.code).toBe(0);

    const uninstall = runInstaller(
      [
        "-Action", "Uninstall",
        "-OfficialDataRoot", world.officialRoot,
        "-ProgramRoot", world.programRoot,
        "-OpenClawPath", fakeOpenClaw,
        "-NodePath", nodePath,
        "-SkipDependencyInstall",
      ],
      { FAKE_OPENCLAW_STATE: world.fakeState },
    );
    expect(uninstall.stderr).toBe("");
    expect(uninstall.code).toBe(0);
    const receipt = JSON.parse(uninstall.stdout.trim());
    expect(receipt.action).toBe("uninstall");
    expect(receipt.data_preserved).toBe(true);

    expect(existsSync(join(world.officialRoot, "diet-manager-b.sqlite3"))).toBe(true);
    expect(existsSync(join(world.officialRoot, ".diet-manager-b.authority-secret"))).toBe(true);
  } finally {
    world.cleanup();
  }
});

test("-DeleteData without exact -ConfirmDataRoot fails and deletes nothing", () => {
  const world = makeWorld();
  try {
    const install = runInstaller(installArgs(world), { FAKE_OPENCLAW_STATE: world.fakeState });
    expect(install.code).toBe(0);

    const wrong = runInstaller(
      [
        "-Action", "Uninstall",
        "-OfficialDataRoot", world.officialRoot,
        "-ProgramRoot", world.programRoot,
        "-OpenClawPath", fakeOpenClaw,
        "-NodePath", nodePath,
        "-SkipDependencyInstall",
        "-DeleteData",
        "-ConfirmDataRoot", join(world.base, "some-other-root"),
      ],
      { FAKE_OPENCLAW_STATE: world.fakeState },
    );
    expect(wrong.code).not.toBe(0);
    expect(wrong.stderr).toMatch(/DIET_INSTALL_DELETE_CONFIRM_MISMATCH/);

    expect(existsSync(join(world.officialRoot, "diet-manager-b.sqlite3"))).toBe(true);
    expect(existsSync(join(world.officialRoot, ".diet-manager-b.authority-secret"))).toBe(true);
  } finally {
    world.cleanup();
  }
});
