import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync, } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isProxy } from "node:util/types";
import { CORE_RUNTIME_SECRET_FILENAME, installAuthoritySecret, } from "../application/core-runtime.js";
import { assertDietDatabaseIdentity, assertPrivateRuntimeRoot, DIET_DATABASE_FILENAME, } from "./database.js";
import { backupDietDatabase } from "./backup.js";
const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite");
const PORTABLE_BACKUP_FORMAT = "diet-manager/portable-backup/v1";
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
const SALT_BYTES = 32;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 67_108_864;
const MIN_PASSPHRASE_BYTES = 12;
const MAX_PASSPHRASE_BYTES = 1024;
function invalid(reason) {
    throw new Error(`DIET_PORTABLE_BACKUP_INVALID:${reason}`);
}
function exactInput(value, fields) {
    if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value) ||
        Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0"))
        return invalid("input");
    return value;
}
function absolutePath(value, reason) {
    if (typeof value !== "string" || value.length === 0 || !isAbsolute(value) || resolve(value) !== value) {
        return invalid(reason);
    }
    return value;
}
function ordinaryFile(path, reason) {
    let stat;
    try {
        stat = lstatSync(path, { bigint: true });
    }
    catch {
        return invalid(reason);
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n)
        return invalid(reason);
    return stat;
}
function existingParent(path) {
    const parent = dirname(path);
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync.native(parent) !== resolve(parent)) {
        return invalid("output_parent");
    }
    return parent;
}
function sha256Hex(buffer) {
    return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}
function sha256File(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}
function validatePassphrase(value) {
    if (!(value instanceof Uint8Array) || isProxy(value))
        return invalid("passphrase");
    if (value.length < MIN_PASSPHRASE_BYTES || value.length > MAX_PASSPHRASE_BYTES) {
        return invalid("passphrase");
    }
    return Uint8Array.from(value);
}
function validateSha256(value) {
    if (typeof value !== "string" || !/^[A-F0-9]{64}$/u.test(value))
        return invalid("expected_sha256");
    return value;
}
function readAuthoritySecret(root) {
    const path = join(root, CORE_RUNTIME_SECRET_FILENAME);
    const stat = ordinaryFile(path, "authority_secret");
    if (stat.size !== 32n)
        return invalid("authority_secret");
    return Uint8Array.from(readFileSync(path));
}
// 便携备份信封的固定键序序列化：同一份字节必须能稳定复现（用作 AAD），且不与
// canonicalJson 的 1 MiB 上限冲突（数据库 base64 可能远大于 1 MiB）。
function serializeHeader(header) {
    return JSON.stringify({
        format: header.format,
        product_version: header.product_version,
        sqlite_user_version: header.sqlite_user_version,
        created_at: header.created_at,
        kdf: {
            algorithm: header.kdf.algorithm,
            N: header.kdf.N,
            r: header.kdf.r,
            p: header.kdf.p,
            salt_base64: header.kdf.salt_base64,
        },
        encryption: {
            algorithm: header.encryption.algorithm,
            iv_base64: header.encryption.iv_base64,
        },
    });
}
function serializeEnvelope(envelope) {
    return JSON.stringify({
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
}
function serializePayload(payload) {
    return JSON.stringify({
        database_base64: payload.database_base64,
        database_sha256: payload.database_sha256,
        authority_secret_base64: payload.authority_secret_base64,
    });
}
function deriveKey(passphrase, salt) {
    return scryptSync(passphrase, salt, KEY_BYTES, {
        N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM,
    });
}
function parseEnvelope(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return invalid("envelope");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        return invalid("envelope");
    const envelope = parsed;
    if (envelope.format !== PORTABLE_BACKUP_FORMAT)
        return invalid("envelope");
    if (envelope.product_version !== "0.1.1")
        return invalid("envelope");
    if (envelope.sqlite_user_version !== 1)
        return invalid("envelope");
    if (typeof envelope.created_at !== "string" || envelope.created_at.length === 0)
        return invalid("envelope");
    if (typeof envelope.ciphertext_base64 !== "string" || envelope.ciphertext_base64.length === 0) {
        return invalid("envelope");
    }
    const kdf = envelope.kdf;
    if (typeof kdf !== "object" || kdf === null || Array.isArray(kdf) ||
        kdf.algorithm !== "scrypt" || kdf.N !== 32768 || kdf.r !== 8 || kdf.p !== 1 ||
        typeof kdf.salt_base64 !== "string" || Buffer.from(kdf.salt_base64, "base64").length !== SALT_BYTES) {
        return invalid("envelope");
    }
    const encryption = envelope.encryption;
    if (typeof encryption !== "object" || encryption === null || Array.isArray(encryption) ||
        encryption.algorithm !== "aes-256-gcm" ||
        typeof encryption.iv_base64 !== "string" || Buffer.from(encryption.iv_base64, "base64").length !== IV_BYTES ||
        typeof encryption.tag_base64 !== "string" || Buffer.from(encryption.tag_base64, "base64").length !== TAG_BYTES) {
        return invalid("envelope");
    }
    const result = {
        format: PORTABLE_BACKUP_FORMAT,
        product_version: "0.1.1",
        sqlite_user_version: 1,
        created_at: envelope.created_at,
        kdf: Object.freeze({
            algorithm: "scrypt",
            N: 32768,
            r: 8,
            p: 1,
            salt_base64: kdf.salt_base64,
        }),
        encryption: Object.freeze({
            algorithm: "aes-256-gcm",
            iv_base64: encryption.iv_base64,
            tag_base64: encryption.tag_base64,
        }),
        ciphertext_base64: envelope.ciphertext_base64,
    };
    // 拒绝非规范（重排/美化）JSON：磁盘字节必须是上面固定键序的逐字序列化。
    if (serializeEnvelope(result) !== text.trim())
        return invalid("envelope");
    return Object.freeze(result);
}
function decryptPayload(envelope, passphrase) {
    const header = {
        format: envelope.format,
        product_version: envelope.product_version,
        sqlite_user_version: envelope.sqlite_user_version,
        created_at: envelope.created_at,
        kdf: envelope.kdf,
        encryption: Object.freeze({
            algorithm: envelope.encryption.algorithm,
            iv_base64: envelope.encryption.iv_base64,
        }),
    };
    const aad = Buffer.from(serializeHeader(header), "utf8");
    const salt = Buffer.from(envelope.kdf.salt_base64, "base64");
    const iv = Buffer.from(envelope.encryption.iv_base64, "base64");
    const tag = Buffer.from(envelope.encryption.tag_base64, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext_base64, "base64");
    let key;
    try {
        key = deriveKey(passphrase, salt);
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(aad);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        let payload;
        try {
            payload = JSON.parse(plaintext.toString("utf8"));
        }
        catch {
            return invalid("payload");
        }
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
            return invalid("payload");
        }
        const record = payload;
        if (typeof record.database_base64 !== "string" ||
            typeof record.database_sha256 !== "string" ||
            typeof record.authority_secret_base64 !== "string") {
            return invalid("payload");
        }
        return Object.freeze({
            database_base64: record.database_base64,
            database_sha256: record.database_sha256,
            authority_secret_base64: record.authority_secret_base64,
        });
    }
    catch (error) {
        if (error instanceof Error && /^DIET_PORTABLE_BACKUP_INVALID:/.test(error.message))
            throw error;
        return invalid("authentication");
    }
    finally {
        key?.fill(0);
    }
}
function validateDatabaseFile(path) {
    const database = new DatabaseSync(path, {
        readOnly: true,
        timeout: 5_000,
        enableForeignKeyConstraints: true,
        enableDoubleQuotedStringLiterals: false,
        allowExtension: false,
        defensive: true,
    });
    try {
        assertDietDatabaseIdentity(database);
    }
    finally {
        database.close();
    }
}
export async function createPortableBackup(value) {
    const input = exactInput(value, ["privateRuntimeRoot", "outputPath", "passphrase", "productVersion", "createdAt"]);
    const root = assertPrivateRuntimeRoot(absolutePath(input.privateRuntimeRoot, "runtime_root"));
    const outputPath = absolutePath(input.outputPath, "output_path");
    const parent = existingParent(outputPath);
    if (existsSync(outputPath))
        return invalid("output_exists");
    const passphrase = validatePassphrase(input.passphrase);
    if (input.productVersion !== "0.1.1")
        return invalid("product_version");
    if (typeof input.createdAt !== "string" || input.createdAt.length === 0)
        return invalid("created_at");
    const tempDbPath = join(parent, `.diet-manager-portable-db-${randomUUID()}`);
    const candidatePath = join(parent, `.diet-manager-portable-candidate-${randomUUID()}`);
    try {
        await backupDietDatabase({ privateRuntimeRoot: root, backupPath: tempDbPath });
        const dbBytes = readFileSync(tempDbPath);
        const secret = readAuthoritySecret(root);
        const salt = randomBytes(SALT_BYTES);
        const iv = randomBytes(IV_BYTES);
        let key;
        let payload;
        try {
            key = deriveKey(passphrase, salt);
            const header = {
                format: PORTABLE_BACKUP_FORMAT,
                product_version: "0.1.1",
                sqlite_user_version: 1,
                created_at: input.createdAt,
                kdf: Object.freeze({
                    algorithm: "scrypt",
                    N: 32768,
                    r: 8,
                    p: 1,
                    salt_base64: Buffer.from(salt).toString("base64"),
                }),
                encryption: Object.freeze({
                    algorithm: "aes-256-gcm",
                    iv_base64: Buffer.from(iv).toString("base64"),
                }),
            };
            payload = Object.freeze({
                database_base64: dbBytes.toString("base64"),
                database_sha256: sha256Hex(dbBytes),
                authority_secret_base64: Buffer.from(secret).toString("base64"),
            });
            const cipher = createCipheriv("aes-256-gcm", key, iv);
            cipher.setAAD(Buffer.from(serializeHeader(header), "utf8"));
            const ciphertext = Buffer.concat([
                cipher.update(Buffer.from(serializePayload(payload), "utf8")),
                cipher.final(),
            ]);
            const tag = cipher.getAuthTag();
            const envelope = {
                ...header,
                encryption: Object.freeze({
                    algorithm: "aes-256-gcm",
                    iv_base64: header.encryption.iv_base64,
                    tag_base64: tag.toString("base64"),
                }),
                ciphertext_base64: ciphertext.toString("base64"),
            };
            writeFileSync(candidatePath, serializeEnvelope(envelope), { encoding: "utf8", flag: "wx" });
            // 写盘后回读、解码并认证，确认候选可被离线恢复。
            const verified = parseEnvelope(readFileSync(candidatePath, "utf8"));
            const roundTrip = decryptPayload(verified, passphrase);
            if (roundTrip.database_sha256 !== payload.database_sha256)
                return invalid("database_sha256");
        }
        finally {
            key?.fill(0);
        }
        renameSync(candidatePath, outputPath);
        const stat = ordinaryFile(outputPath, "output_file");
        if (stat.size > BigInt(Number.MAX_SAFE_INTEGER))
            return invalid("output_size");
        return Object.freeze({
            format: PORTABLE_BACKUP_FORMAT,
            backup_path: outputPath,
            bytes: Number(stat.size),
            sha256: sha256File(outputPath),
            product_version: "0.1.1",
            sqlite_user_version: 1,
        });
    }
    finally {
        rmSync(tempDbPath, { force: true });
        rmSync(candidatePath, { force: true });
    }
}
export function restorePortableBackup(value) {
    const input = exactInput(value, ["backupPath", "expectedSha256", "targetRuntimeRoot", "passphrase", "replaceExisting"]);
    const target = assertPrivateRuntimeRoot(absolutePath(input.targetRuntimeRoot, "target_root"));
    const backupPath = absolutePath(input.backupPath, "backup_path");
    const expected = validateSha256(input.expectedSha256);
    const passphrase = validatePassphrase(input.passphrase);
    const replaceExisting = input.replaceExisting === true;
    const backupStat = ordinaryFile(backupPath, "backup_file");
    if (backupStat.size > BigInt(MAX_BACKUP_BYTES))
        return invalid("oversize");
    if (sha256File(backupPath) !== expected)
        return invalid("expected_sha256");
    const envelope = parseEnvelope(readFileSync(backupPath, "utf8"));
    const payload = decryptPayload(envelope, passphrase);
    const dbBytes = Buffer.from(payload.database_base64, "base64");
    if (!/^[A-F0-9]{64}$/u.test(payload.database_sha256) || sha256Hex(dbBytes) !== payload.database_sha256) {
        return invalid("database_sha256");
    }
    const secret = Buffer.from(payload.authority_secret_base64, "base64");
    if (secret.length !== 32)
        return invalid("authority_secret");
    const databasePath = join(target, DIET_DATABASE_FILENAME);
    const candidateDbPath = join(target, `.${DIET_DATABASE_FILENAME}.restore-${randomUUID()}`);
    const previousPath = join(target, `.${DIET_DATABASE_FILENAME}.previous-${randomUUID()}`);
    let movedPrevious = false;
    let installed = false;
    try {
        writeFileSync(candidateDbPath, dbBytes, { flag: "wx" });
        validateDatabaseFile(candidateDbPath);
        if (existsSync(`${databasePath}-wal`) || existsSync(`${databasePath}-shm`))
            return invalid("target_active");
        const previousExists = existsSync(databasePath);
        if (previousExists && !replaceExisting)
            return invalid("target_exists");
        if (previousExists)
            ordinaryFile(databasePath, "database_file");
        if (previousExists) {
            renameSync(databasePath, previousPath);
            movedPrevious = true;
        }
        renameSync(candidateDbPath, databasePath);
        installed = true;
        installAuthoritySecret(target, Uint8Array.from(secret));
        validateDatabaseFile(databasePath);
        if (movedPrevious) {
            unlinkSync(previousPath);
            movedPrevious = false;
        }
        return Object.freeze({
            format: PORTABLE_BACKUP_FORMAT,
            backup_path: backupPath,
            bytes: Number(backupStat.size),
            sha256: expected,
            product_version: "0.1.1",
            sqlite_user_version: 1,
        });
    }
    catch (error) {
        if (installed && existsSync(databasePath))
            unlinkSync(databasePath);
        if (movedPrevious && existsSync(previousPath))
            renameSync(previousPath, databasePath);
        throw error;
    }
    finally {
        // The read-only validation open in validateDatabaseFile creates -wal/-shm
        // sidecars next to the candidate; remove them alongside the candidate leaf.
        for (const path of [candidateDbPath, `${candidateDbPath}-wal`, `${candidateDbPath}-shm`]) {
            rmSync(path, { force: true });
        }
    }
}
