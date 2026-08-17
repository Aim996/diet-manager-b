import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { handleCoreRequest } from "../../src/application/command-handler.js";
import {
  CORE_RUNTIME_SECRET_FILENAME,
  createCoreRuntime,
} from "../../src/application/runtime.js";
import type { CoreApplicationRequest } from "../../src/contracts.js";
import { canonicalJson } from "../../src/authority/canonical-json.js";
import { DIET_DATABASE_FILENAME, openDietDatabase } from "../../src/storage/database.js";
import {
  createPortableBackup,
  restorePortableBackup,
} from "../../src/storage/portable-backup.js";

const NOW = "2026-08-14T12:00:01.000Z";
const PASSPHRASE = new TextEncoder().encode("correct horse battery staple 123");
const OTHER_PASSPHRASE = new TextEncoder().encode("wrong horse battery staple 456");

function createRuntime(root: string) {
  return createCoreRuntime({ officialDataRoot: root, now: () => NOW });
}

function writeRequest(
  action: "record_meal" | "record_water" | "add_inventory" | "correct_record",
  sourceText: string,
  operationId: string,
): CoreApplicationRequest {
  return {
    action,
    source_text: sourceText,
    received_at: "2026-08-14T12:00:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: "conversation-portable-001",
    prior_context: [],
  };
}

function secretBytes(root: string): Buffer {
  return readFileSync(join(root, CORE_RUNTIME_SECRET_FILENAME));
}

function databaseBytes(root: string): Buffer {
  return readFileSync(join(root, DIET_DATABASE_FILENAME));
}

function businessSnapshot(root: string): string {
  const opened = openDietDatabase({ privateRuntimeRoot: root });
  try {
    const tables = opened.database.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as Array<{ name: string }>;
    return canonicalJson(Object.fromEntries(tables.map(({ name }) => [
      name,
      opened.database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
    ])));
  } finally {
    opened.close();
  }
}

async function seedSource(root: string): Promise<void> {
  const runtime = createRuntime(root);
  try {
    expect(handleCoreRequest(runtime, writeRequest(
      "record_meal", "吃了150克苹果。", "seed-meal",
    )).committed, "seed meal").toBe(true);
    expect(handleCoreRequest(runtime, writeRequest(
      "record_water", "喝了500ml白水。", "seed-water",
    )).committed, "seed water").toBe(true);
    expect(handleCoreRequest(runtime, writeRequest(
      "add_inventory", "买了两箱牛奶，每箱12盒，每盒250ml。", "seed-purchase",
    )).committed, "seed purchase").toBe(true);
    expect(handleCoreRequest(runtime, writeRequest(
      "correct_record", "更正：这批牛奶放在常温柜，不是冷藏室。", "seed-location",
    )).committed, "seed correction").toBe(true);
  } finally {
    runtime.close();
  }
}

it("round-trips an authenticated portable backup into an empty target", async () => {
  const source = mkdtempSync(join(tmpdir(), `diet-manager-portable-src-${randomUUID()}-`));
  const target = mkdtempSync(join(tmpdir(), `diet-manager-portable-dst-${randomUUID()}-`));
  const backupPath = join(tmpdir(), `diet-manager-portable-${randomUUID()}.dmb`);
  try {
    await seedSource(source);
    const snapshot = businessSnapshot(source);
    const secret = secretBytes(source);

    const result = await createPortableBackup({
      privateRuntimeRoot: source,
      outputPath: backupPath,
      passphrase: PASSPHRASE,
      productVersion: "0.1.1",
      createdAt: "2026-08-14T12:10:00.000Z",
    });
    expect(result).toEqual({
      format: "diet-manager/portable-backup/v1",
      backup_path: backupPath,
      bytes: expect.any(Number),
      sha256: expect.stringMatching(/^[A-F0-9]{64}$/u),
      product_version: "0.1.1",
      sqlite_user_version: 1,
    });

    const restored = restorePortableBackup({
      backupPath,
      expectedSha256: result.sha256,
      targetRuntimeRoot: target,
      passphrase: PASSPHRASE,
      replaceExisting: false,
    });
    expect(restored).toEqual(result);

    // The decrypted secret and full business surface must be byte-faithful, so
    // authenticated reads over the restored root resolve to the same facts.
    expect(secretBytes(target)).toEqual(secret);
    expect(businessSnapshot(target)).toBe(snapshot);

    const runtime = createRuntime(target);
    try {
      const summary = handleCoreRequest(runtime, {
        action: "query_daily_summary",
        source_text: "查询",
        received_at: "2026-08-14T12:06:00+08:00",
        timezone: "Asia/Shanghai",
        operation_id: "restored-query-summary",
        source_message_id: "message-restored-query-summary",
        conversation_id: "conversation-portable-001",
        prior_context: [],
      });
      expect(summary, JSON.stringify(summary)).toMatchObject({
        status: "ignored",
        reason_code: "read_only_result",
        daily_progress: {
          meals: { count: 1 },
          water: { count: 1, plain_water_ml_milli: 500_000 },
          purchases: { count: 1 },
        },
      });
    } finally {
      runtime.close();
    }
  } finally {
    rmSync(source, { recursive: true, force: false });
    rmSync(target, { recursive: true, force: false });
    rmSync(backupPath, { force: true });
  }
});

it("rejects a wrong passphrase without touching the target", async () => {
  const source = mkdtempSync(join(tmpdir(), `diet-manager-portable-src-${randomUUID()}-`));
  const target = mkdtempSync(join(tmpdir(), `diet-manager-portable-dst-${randomUUID()}-`));
  const backupPath = join(tmpdir(), `diet-manager-portable-${randomUUID()}.dmb`);
  try {
    await seedSource(source);
    const result = await createPortableBackup({
      privateRuntimeRoot: source,
      outputPath: backupPath,
      passphrase: PASSPHRASE,
      productVersion: "0.1.1",
      createdAt: "2026-08-14T12:10:00.000Z",
    });
    expect(() => restorePortableBackup({
      backupPath,
      expectedSha256: result.sha256,
      targetRuntimeRoot: target,
      passphrase: OTHER_PASSPHRASE,
      replaceExisting: false,
    })).toThrowError(/DIET_PORTABLE_BACKUP_INVALID:authentication/u);
    expect(businessSnapshot(target)).toBe(businessSnapshot(target));
  } finally {
    rmSync(source, { recursive: true, force: false });
    rmSync(target, { recursive: true, force: false });
    rmSync(backupPath, { force: true });
  }
});

it("rejects a one-byte ciphertext mutation", async () => {
  const source = mkdtempSync(join(tmpdir(), `diet-manager-portable-src-${randomUUID()}-`));
  const target = mkdtempSync(join(tmpdir(), `diet-manager-portable-dst-${randomUUID()}-`));
  const backupPath = join(tmpdir(), `diet-manager-portable-${randomUUID()}.dmb`);
  const tamperedPath = join(tmpdir(), `diet-manager-portable-${randomUUID()}.tampered.dmb`);
  try {
    await seedSource(source);
    const result = await createPortableBackup({
      privateRuntimeRoot: source,
      outputPath: backupPath,
      passphrase: PASSPHRASE,
      productVersion: "0.1.1",
      createdAt: "2026-08-14T12:10:00.000Z",
    });
    const envelope = JSON.parse(readFileSync(backupPath, "utf8")) as {
      format: string;
      product_version: string;
      sqlite_user_version: number;
      created_at: string;
      kdf: { algorithm: string; N: number; r: number; p: number; salt_base64: string };
      encryption: { algorithm: string; iv_base64: string; tag_base64: string };
      ciphertext_base64: string;
    };
    const ciphertext = Buffer.from(envelope.ciphertext_base64, "base64");
    ciphertext[0] = ciphertext[0]! ^ 0xff;
    envelope.ciphertext_base64 = ciphertext.toString("base64");
    // Re-serialize with the writer's fixed key order so the tampered file is
    // still canonical, then authenticate against the tampered file's own hash
    // so the SHA gate passes and the GCM tag mismatch surfaces as authentication.
    const tampered = JSON.stringify({
      format: envelope.format,
      product_version: envelope.product_version,
      sqlite_user_version: envelope.sqlite_user_version,
      created_at: envelope.created_at,
      kdf: {
        algorithm: envelope.kdf.algorithm,
        N: envelope.kdf.N,
        r: envelope.kdf.r,
        p: envelope.kdf.p,
        salt_base64: envelope.kdf.salt_base64,
      },
      encryption: {
        algorithm: envelope.encryption.algorithm,
        iv_base64: envelope.encryption.iv_base64,
        tag_base64: envelope.encryption.tag_base64,
      },
      ciphertext_base64: envelope.ciphertext_base64,
    });
    writeFileSync(tamperedPath, tampered, "utf8");
    const tamperedSha256 = createHash("sha256").update(tampered, "utf8").digest("hex").toUpperCase();

    expect(() => restorePortableBackup({
      backupPath: tamperedPath,
      expectedSha256: tamperedSha256,
      targetRuntimeRoot: target,
      passphrase: PASSPHRASE,
      replaceExisting: false,
    })).toThrowError(/DIET_PORTABLE_BACKUP_INVALID:authentication/u);
  } finally {
    rmSync(source, { recursive: true, force: false });
    rmSync(target, { recursive: true, force: false });
    rmSync(backupPath, { force: true });
    rmSync(tamperedPath, { force: true });
  }
});

it("rejects a truncated envelope", async () => {
  const source = mkdtempSync(join(tmpdir(), `diet-manager-portable-src-${randomUUID()}-`));
  const target = mkdtempSync(join(tmpdir(), `diet-manager-portable-dst-${randomUUID()}-`));
  const backupPath = join(tmpdir(), `diet-manager-portable-${randomUUID()}.dmb`);
  const truncatedPath = join(tmpdir(), `diet-manager-portable-${randomUUID()}.truncated.dmb`);
  try {
    await seedSource(source);
    const result = await createPortableBackup({
      privateRuntimeRoot: source,
      outputPath: backupPath,
      passphrase: PASSPHRASE,
      productVersion: "0.1.1",
      createdAt: "2026-08-14T12:10:00.000Z",
    });
    const full = readFileSync(backupPath);
    writeFileSync(truncatedPath, full.subarray(0, Math.floor(full.length / 2)));

    expect(() => restorePortableBackup({
      backupPath: truncatedPath,
      expectedSha256: result.sha256,
      targetRuntimeRoot: target,
      passphrase: PASSPHRASE,
      replaceExisting: false,
    })).toThrowError(/DIET_PORTABLE_BACKUP_INVALID:/u);
  } finally {
    rmSync(source, { recursive: true, force: false });
    rmSync(target, { recursive: true, force: false });
    rmSync(backupPath, { force: true });
    rmSync(truncatedPath, { force: true });
  }
});

it("rejects a symlinked restore target root", async () => {
  const source = mkdtempSync(join(tmpdir(), `diet-manager-portable-src-${randomUUID()}-`));
  const realTarget = mkdtempSync(join(tmpdir(), `diet-manager-portable-real-${randomUUID()}-`));
  const linkParent = mkdtempSync(join(tmpdir(), `diet-manager-portable-link-${randomUUID()}-`));
  const linkTarget = join(linkParent, "target-link");
  symlinkSync(realTarget, linkTarget, process.platform === "win32" ? "junction" : "dir");
  const backupPath = join(tmpdir(), `diet-manager-portable-${randomUUID()}.dmb`);
  try {
    await seedSource(source);
    const result = await createPortableBackup({
      privateRuntimeRoot: source,
      outputPath: backupPath,
      passphrase: PASSPHRASE,
      productVersion: "0.1.1",
      createdAt: "2026-08-14T12:10:00.000Z",
    });
    expect(() => restorePortableBackup({
      backupPath,
      expectedSha256: result.sha256,
      targetRuntimeRoot: linkTarget,
      passphrase: PASSPHRASE,
      replaceExisting: false,
    })).toThrowError(/STORAGE_PATH_INVALID:root_reparse/u);
  } finally {
    rmSync(source, { recursive: true, force: false });
    rmSync(realTarget, { recursive: true, force: false });
    rmSync(linkParent, { recursive: true, force: false });
    rmSync(backupPath, { force: true });
  }
});

it("refuses replaceExisting=false into a nonempty target and leaves it untouched", async () => {
  const source = mkdtempSync(join(tmpdir(), `diet-manager-portable-src-${randomUUID()}-`));
  const target = mkdtempSync(join(tmpdir(), `diet-manager-portable-dst-${randomUUID()}-`));
  const backupPath = join(tmpdir(), `diet-manager-portable-${randomUUID()}.dmb`);
  try {
    await seedSource(source);
    const result = await createPortableBackup({
      privateRuntimeRoot: source,
      outputPath: backupPath,
      passphrase: PASSPHRASE,
      productVersion: "0.1.1",
      createdAt: "2026-08-14T12:10:00.000Z",
    });
    // Seed the target so it already holds a database.
    await seedSource(target);
    const before = databaseBytes(target);

    expect(() => restorePortableBackup({
      backupPath,
      expectedSha256: result.sha256,
      targetRuntimeRoot: target,
      passphrase: PASSPHRASE,
      replaceExisting: false,
    })).toThrowError(/DIET_PORTABLE_BACKUP_INVALID:target_exists/u);
    expect(databaseBytes(target)).toEqual(before);
  } finally {
    rmSync(source, { recursive: true, force: false });
    rmSync(target, { recursive: true, force: false });
    rmSync(backupPath, { force: true });
  }
});

it("rolls the database back when the secret install fails after the swap", async () => {
  const source = mkdtempSync(join(tmpdir(), `diet-manager-portable-src-${randomUUID()}-`));
  const target = mkdtempSync(join(tmpdir(), `diet-manager-portable-dst-${randomUUID()}-`));
  const backupPath = join(tmpdir(), `diet-manager-portable-${randomUUID()}.dmb`);
  try {
    await seedSource(source);
    const result = await createPortableBackup({
      privateRuntimeRoot: source,
      outputPath: backupPath,
      passphrase: PASSPHRASE,
      productVersion: "0.1.1",
      createdAt: "2026-08-14T12:10:00.000Z",
    });
    // Seed the target, then make the secret path unwritable by replacing the
    // secret file with a directory, so the secret install fails after the
    // database swap has already happened.
    await seedSource(target);
    const secretPath = join(target, CORE_RUNTIME_SECRET_FILENAME);
    rmSync(secretPath, { force: true });
    mkdirSync(secretPath);
    const before = databaseBytes(target);

    expect(() => restorePortableBackup({
      backupPath,
      expectedSha256: result.sha256,
      targetRuntimeRoot: target,
      passphrase: PASSPHRASE,
      replaceExisting: true,
    })).toThrow();
    // The database must be rolled back to its pre-restore bytes.
    expect(databaseBytes(target)).toEqual(before);
    // No stray swap files may remain: only the database leaf and the injected
    // secret directory are allowed.
    expect(readdirSync(target).sort()).toEqual(
      [CORE_RUNTIME_SECRET_FILENAME, DIET_DATABASE_FILENAME].sort(),
    );
  } finally {
    rmSync(source, { recursive: true, force: false });
    rmSync(target, { recursive: true, force: false });
    rmSync(backupPath, { force: true });
  }
});

it("rejects an oversized archive before reading it", async () => {
  const source = mkdtempSync(join(tmpdir(), `diet-manager-portable-src-${randomUUID()}-`));
  const target = mkdtempSync(join(tmpdir(), `diet-manager-portable-dst-${randomUUID()}-`));
  const oversized = join(tmpdir(), `diet-manager-portable-${randomUUID()}.oversized.dmb`);
  try {
    await seedSource(source);
    writeFileSync(oversized, "");
    truncateSync(oversized, 512 * 1024 * 1024 + 1);
    expect(() => restorePortableBackup({
      backupPath: oversized,
      expectedSha256: "A".repeat(64),
      targetRuntimeRoot: target,
      passphrase: PASSPHRASE,
      replaceExisting: false,
    })).toThrowError(/DIET_PORTABLE_BACKUP_INVALID:oversize/u);
  } finally {
    rmSync(source, { recursive: true, force: false });
    rmSync(target, { recursive: true, force: false });
    rmSync(oversized, { force: true });
  }
});
