import { backupDietDatabase, restoreDietDatabase } from "../storage/backup.js";
import { createPortableBackup, restorePortableBackup } from "../storage/portable-backup.js";
import { readPassphraseFromTty } from "./passphrase.js";

function usage(): never {
  process.stderr.write(
    "usage: backup <private-root> <backup-file> | " +
      "restore <private-root> <backup-file> <SHA256> | " +
      "backup-portable <private-root> <backup-file> 0.1.1 | " +
      "restore-portable <private-root> <backup-file> <SHA256> [--replace-existing]\n",
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
