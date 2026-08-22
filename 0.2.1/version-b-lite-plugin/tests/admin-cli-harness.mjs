import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "admin", "cli.js");

const { createCoreRuntime } = await import(
  pathToFileURL(join(here, "..", "dist", "application", "runtime.js")).href
);
const { handleCoreRequest } = await import(
  pathToFileURL(join(here, "..", "dist", "application", "command-handler.js")).href
);

function run(args, { stdinText = "" } = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    input: stdinText,
    encoding: "utf8",
    windowsHide: true,
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const failures = [];
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`ok - ${name}`);
  } else {
    failures.push(name);
    console.error(`FAIL - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

// 1. Portable verbs must fail closed when stdin/stdout are not a terminal.
{
  const { code, stdout, stderr } = run(
    ["backup-portable", "root", "file.dmb", "0.1.1"],
    { stdinText: "secret secret secret\n" },
  );
  check(
    "backup-portable rejects non-TTY",
    code !== 0 && /DIET_ADMIN_TTY_REQUIRED/u.test(stderr),
    `code=${code} stderr=${JSON.stringify(stderr)}`,
  );
  check(
    "backup-portable leaks nothing on non-TTY",
    !stdout.includes("secret") && !stderr.includes("secret"),
    `stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
  );
}
{
  const { code, stderr } = run(
    ["restore-portable", "root", "file.dmb", "A".repeat(64), "--replace-existing"],
    { stdinText: "secret secret secret\n" },
  );
  check(
    "restore-portable rejects non-TTY",
    code !== 0 && /DIET_ADMIN_TTY_REQUIRED/u.test(stderr),
    `code=${code} stderr=${JSON.stringify(stderr)}`,
  );
}

// 2. A passphrase smuggled in as a flag is rejected and never echoed anywhere.
{
  const { code, stdout, stderr } = run(
    ["backup-portable", "root", "file.dmb", "0.1.1", "--passphrase", "hunter2hunter2x"],
  );
  check(
    "passphrase flag is rejected as usage",
    code !== 0 && /DIET_ADMIN_USAGE/u.test(stderr),
    `code=${code} stderr=${JSON.stringify(stderr)}`,
  );
  check(
    "passphrase flag value never appears in output",
    !stdout.includes("hunter2hunter2x") && !stderr.includes("hunter2hunter2x"),
    `stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
  );
}

// 3. Same-root backup/restore round-trips through the CLI without a terminal.
{
  const root = mkdtempSync(join(tmpdir(), "diet-manager-admin-cli-"));
  const backup = join(tmpdir(), `diet-manager-admin-cli-${randomUUID()}.sqlite3`);
  try {
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-14T04:00:01.000Z",
    });
    handleCoreRequest(runtime, {
      action: "record_meal",
      source_text: "吃了一个苹果。",
      received_at: "2026-08-14T12:00:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "admin-cli-meal-001",
      source_message_id: "message-admin-cli-meal-001",
      conversation_id: "conversation-admin-cli-001",
      prior_context: [],
    });
    runtime.close();

    const backupRun = run(["backup", root, backup]);
    check(
      "backup verb succeeds",
      backupRun.code === 0,
      `code=${backupRun.code} stderr=${JSON.stringify(backupRun.stderr)}`,
    );
    const result = JSON.parse(backupRun.stdout.trim());
    check("backup verb reports an uppercase sha256", /^[A-F0-9]{64}$/u.test(result.sha256), result.sha256);

    const restoreRun = run(["restore", root, backup, result.sha256]);
    check(
      "restore verb succeeds",
      restoreRun.code === 0,
      `code=${restoreRun.code} stderr=${JSON.stringify(restoreRun.stderr)}`,
    );
    check(
      "restore verb echoes the backup path",
      JSON.parse(restoreRun.stdout.trim()).backup_path === backup,
      restoreRun.stdout,
    );
  } finally {
    rmSync(root, { recursive: true, force: false });
    rmSync(backup, { force: true });
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} assertion(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nall admin-cli assertions passed");
}
