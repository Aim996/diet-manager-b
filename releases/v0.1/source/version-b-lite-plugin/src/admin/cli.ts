import { backupDietDatabase, restoreDietDatabase } from "../storage/backup.js";

function usage(): never {
  throw new Error("DIET_ADMIN_USAGE: backup <private-root> <backup-file> | restore <private-root> <backup-file> <SHA256>");
}

async function main(args: readonly string[]): Promise<void> {
  const [operation, privateRuntimeRoot, backupPath, expectedSha256, ...extra] = args;
  if (extra.length !== 0 || privateRuntimeRoot === undefined || backupPath === undefined) usage();
  if (operation === "backup" && expectedSha256 === undefined) {
    process.stdout.write(`${JSON.stringify(await backupDietDatabase({ privateRuntimeRoot, backupPath }))}\n`);
    return;
  }
  if (operation === "restore" && expectedSha256 !== undefined) {
    process.stdout.write(`${JSON.stringify(restoreDietDatabase({
      privateRuntimeRoot,
      backupPath,
      expectedSha256,
    }))}\n`);
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
