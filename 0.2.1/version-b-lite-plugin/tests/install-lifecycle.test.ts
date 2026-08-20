import { spawnSync } from "node:child_process";
import {
  existsSync,
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

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(here, "..");
const installer = join(projectDir, "scripts", "install-diet-manager.ps1");
const fakeOpenClaw = join(projectDir, "tests", "fixtures", "install", "fake-openclaw.ps1");
const nodePath = process.execPath;

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

function recordMeal(root: string, sourceText: string): void {
  const runtime = createCoreRuntime({
    officialDataRoot: root,
    now: () => "2026-08-18T04:00:01.000Z",
  });
  try {
    const outcome = handleCoreRequest(runtime, {
      action: "record_meal",
      source_text: sourceText,
      received_at: "2026-08-18T12:00:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: nextOperationId(),
      source_message_id: "m-install-lifecycle",
      conversation_id: "c-install-lifecycle",
      prior_context: [],
    });
    if (outcome.committed !== true) {
      throw new Error(`record_meal not committed (${outcome.status}): ${JSON.stringify(outcome)}`);
    }
  } finally {
    runtime.close();
  }
}

function queryMealCount(root: string): number {
  const runtime = createCoreRuntime({
    officialDataRoot: root,
    now: () => "2026-08-18T04:00:01.000Z",
  });
  try {
    const outcome = handleCoreRequest(runtime, {
      action: "query_meals",
      source_text: "查询",
      received_at: "2026-08-18T12:00:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: nextOperationId(),
      source_message_id: "m-install-lifecycle",
      conversation_id: "c-install-lifecycle",
      prior_context: [],
    });
    if (outcome.status !== "ignored") {
      throw new Error(`query_meals failed: ${outcome.status}`);
    }
    return outcome.meal_history?.meals.length ?? 0;
  } finally {
    runtime.close();
  }
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

    expect(existsSync(join(world.programRoot, "versions", "0.1.1", "dist", "index.js"))).toBe(true);
    expect(existsSync(join(world.programRoot, "current.json"))).toBe(true);
    expect(existsSync(join(world.officialRoot, "diet-manager-b.sqlite3"))).toBe(true);
    expect(existsSync(join(world.officialRoot, ".diet-manager-b.authority-secret"))).toBe(true);
    expect(statSync(join(world.officialRoot, ".diet-manager-b.authority-secret")).size).toBe(32);
  } finally {
    world.cleanup();
  }
});

test("compatible upgrade creates and verifies a backup before switch", () => {
  const world = makeWorld();
  try {
    const install = runInstaller(installArgs(world), { FAKE_OPENCLAW_STATE: world.fakeState });
    expect(install.code).toBe(0);

    recordMeal(world.officialRoot, "吃了一个苹果。");
    expect(queryMealCount(world.officialRoot)).toBe(1);

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
    expect(existsSync(receipt.backup_path)).toBe(true);

    // 升级后数据仍保留。
    expect(queryMealCount(world.officialRoot)).toBe(1);
    // 升级前备份目录里确实落了备份文件。
    const backups = readdirSync(world.backupRoot).filter((name) => name.endsWith(".sqlite3"));
    expect(backups.length).toBeGreaterThanOrEqual(1);
  } finally {
    world.cleanup();
  }
});

test("injected gateway failure rolls back old program and config", () => {
  const world = makeWorld();
  try {
    const install = runInstaller(installArgs(world), { FAKE_OPENCLAW_STATE: world.fakeState });
    expect(install.code).toBe(0);
    const currentBefore = readFileSync(join(world.programRoot, "current.json"), "utf8");

    recordMeal(world.officialRoot, "吃了一个苹果。");
    expect(queryMealCount(world.officialRoot)).toBe(1);

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
    expect(queryMealCount(world.officialRoot)).toBe(1);
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
