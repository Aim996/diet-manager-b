import { createCoreRuntime } from "../application/runtime.js";
import { handleCoreRequest } from "../application/command-handler.js";
import type { DietManagerOutcome, NonWritingOutcome } from "../contracts.js";
import { backupDietDatabase, restoreDietDatabase } from "../storage/backup.js";
import { DIET_DATABASE_USER_VERSION } from "../storage/database.js";
import { createPortableBackup, restorePortableBackup } from "../storage/portable-backup.js";
import { readPassphraseFromTty } from "./passphrase.js";

function assertNonWriting(outcome: DietManagerOutcome): NonWritingOutcome {
  if (outcome.status === "failed") throw new Error(`DIET_INSTALL_INIT_FAILED:${outcome.error_code}`);
  if (outcome.status !== "ignored") throw new Error(`DIET_INSTALL_INIT_FAILED:${outcome.status}`);
  return outcome;
}

function initializeOfficialDataRoot(root: string): Record<string, unknown> {
  const runtime = createCoreRuntime({
    officialDataRoot: root,
    now: () => new Date().toISOString(),
  });
  try {
    const base = {
      source_text: "install-init",
      received_at: "2026-01-01T00:00:00+08:00",
      timezone: "Asia/Shanghai" as const,
      operation_id: "diet-manager-install-init",
      source_message_id: "diet-manager-install-init",
      conversation_id: "diet-manager-install-init",
      prior_context: [] as const,
    };
    const summary = assertNonWriting(handleCoreRequest(runtime, { ...base, action: "query_daily_summary" }));
    const meals = assertNonWriting(handleCoreRequest(runtime, { ...base, action: "query_meals" }));
    const inventory = assertNonWriting(handleCoreRequest(runtime, { ...base, action: "query_inventory" }));
    const progress = summary.daily_progress;
    const businessRows =
      (meals.meal_history?.meals.length ?? 0) +
      (inventory.inventory_view?.batches.length ?? 0) +
      (progress === undefined
        ? 0
        : progress.meals.count +
          progress.water.count +
          progress.purchases.count +
          progress.corrections.count +
          progress.inventory.deduction_count);
    if (businessRows !== 0) throw new Error("DIET_INSTALL_INIT_FAILED:non_empty");
    return {
      official_data_root: root,
      business_rows: 0,
      sqlite_user_version: DIET_DATABASE_USER_VERSION,
    };
  } finally {
    runtime.close();
  }
}

function usage(): never {
  process.stderr.write(
    "usage: backup <private-root> <backup-file> | " +
      "restore <private-root> <backup-file> <SHA256> | " +
      "backup-portable <private-root> <backup-file> 0.1.1 | " +
      "restore-portable <private-root> <backup-file> <SHA256> [--replace-existing] | " +
      "init-root <private-root>\n",
  );
  throw new Error("DIET_ADMIN_USAGE");
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(args: readonly string[]): Promise<void> {
  const [operation, ...rest] = args;
  if (operation === "backup") {
    const [privateRuntimeRoot, backupPath, ...extra] = rest;
    if (extra.length !== 0 || privateRuntimeRoot === undefined || backupPath === undefined) usage();
    writeJson(await backupDietDatabase({ privateRuntimeRoot, backupPath }));
    return;
  }
  if (operation === "restore") {
    const [privateRuntimeRoot, backupPath, expectedSha256, ...extra] = rest;
    if (extra.length !== 0 || privateRuntimeRoot === undefined ||
        backupPath === undefined || expectedSha256 === undefined) usage();
    writeJson(restoreDietDatabase({ privateRuntimeRoot, backupPath, expectedSha256 }));
    return;
  }
  if (operation === "backup-portable") {
    const [privateRuntimeRoot, backupPath, productVersion, ...extra] = rest;
    if (extra.length !== 0 || privateRuntimeRoot === undefined || backupPath === undefined) usage();
    if (productVersion !== "0.1.1") usage();
    const passphrase = await readPassphraseFromTty({ confirm: true });
    writeJson(await createPortableBackup({
      privateRuntimeRoot,
      outputPath: backupPath,
      passphrase,
      productVersion: "0.1.1",
      createdAt: new Date().toISOString(),
    }));
    return;
  }
  if (operation === "init-root") {
    const [privateRuntimeRoot, ...extra] = rest;
    if (extra.length !== 0 || privateRuntimeRoot === undefined) usage();
    writeJson(initializeOfficialDataRoot(privateRuntimeRoot));
    return;
  }
  if (operation === "restore-portable") {
    const [privateRuntimeRoot, backupPath, expectedSha256, ...extra] = rest;
    if (privateRuntimeRoot === undefined || backupPath === undefined || expectedSha256 === undefined) {
      usage();
    }
    const replaceExisting = extra.length === 1 && extra[0] === "--replace-existing";
    if (extra.length !== 0 && !replaceExisting) usage();
    const passphrase = await readPassphraseFromTty({ confirm: false });
    writeJson(restorePortableBackup({
      backupPath,
      expectedSha256,
      targetRuntimeRoot: privateRuntimeRoot,
      passphrase,
      replaceExisting,
    }));
    return;
  }
  usage();
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const code = error instanceof Error && /^[A-Z0-9_]+(?::[A-Za-z0-9_:-]+)?$/u.test(error.message)
    ? error.message
    : "DIET_ADMIN_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
