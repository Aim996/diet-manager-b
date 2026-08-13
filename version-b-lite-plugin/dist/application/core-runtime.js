import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readSync, unlinkSync, writeSync, } from "node:fs";
import { dirname, join, parse } from "node:path";
import { isProxy } from "node:util/types";
import { canonicalJson } from "../authority/canonical-json.js";
import { dietManagerActions, } from "../contracts.js";
import { createDietDomainService } from "../domain/service.js";
import { cloneCoreParseInput } from "../parser/input-authority.js";
import { parseCoreCommand } from "../parser/parse-command.js";
import { assertPrivateRuntimeRoot } from "../storage/database.js";
import { openDietDatabase } from "../storage/database.js";
import { mapCoreCandidateToEnvelope } from "./mapping.js";
import { committedOutcome, failedOutcome, nonWritingOutcome } from "./outcome.js";
export const CORE_RUNTIME_SECRET_FILENAME = ".diet-manager-b.authority-secret";
function invalid(kind, reason) {
    throw new Error(kind === "secret"
        ? `CORE_RUNTIME_SECRET_INVALID:${reason}`
        : `STORAGE_PATH_INVALID:${reason}`);
}
function samePath(left, right) {
    return process.platform === "win32"
        ? left.toLowerCase() === right.toLowerCase()
        : left === right;
}
function identity(path) {
    const stat = lstatSync(path, { bigint: true });
    return Object.freeze({ path, dev: stat.dev, ino: stat.ino });
}
function sameIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
}
function ancestorChain(root) {
    const values = [];
    let current = root;
    for (;;) {
        values.push(identity(current));
        const parent = dirname(current);
        if (samePath(parent, current) || samePath(current, parse(current).root))
            break;
        current = parent;
    }
    return Object.freeze(values);
}
function createRuntimeRootAuthority(value) {
    const root = assertPrivateRuntimeRoot(value);
    return Object.freeze({ root, chain: ancestorChain(root) });
}
function assertRuntimeRootAuthority(authority) {
    let current;
    try {
        current = assertPrivateRuntimeRoot(authority.root);
    }
    catch {
        return invalid("root", "root_identity");
    }
    if (!samePath(current, authority.root))
        return invalid("root", "root_identity");
    let chain;
    try {
        chain = ancestorChain(current);
    }
    catch {
        return invalid("root", "root_identity");
    }
    if (chain.length !== authority.chain.length || chain.some((entry, index) => {
        const expected = authority.chain[index];
        return expected === undefined || !samePath(entry.path, expected.path) ||
            !sameIdentity(entry, expected);
    }))
        return invalid("root", "root_identity");
}
const HANDLE_IDENTITY_SCRIPT = String.raw `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class DietManagerFileIdentity {
  [StructLayout(LayoutKind.Sequential)] public struct FileTime { public uint Low; public uint High; }
  [StructLayout(LayoutKind.Sequential)] public struct Info {
    public uint Attributes; public FileTime Creation; public FileTime Access; public FileTime Write;
    public uint Volume; public uint SizeHigh; public uint SizeLow; public uint Links;
    public uint IndexHigh; public uint IndexLow;
  }
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
}
"@
`;
const HANDLE_RESULT_SCRIPT = String.raw `
$info = New-Object DietManagerFileIdentity+Info
if (-not [DietManagerFileIdentity]::GetFileInformationByHandle($stream.SafeFileHandle, [ref]$info)) { throw 'file_identity' }
$index = ([uint64]$info.IndexHigh -shl 32) -bor [uint64]$info.IndexLow
`;
const ACL_SET_SCRIPT = String.raw `
$ErrorActionPreference = 'Stop'
${HANDLE_IDENTITY_SCRIPT}
$stream = [System.IO.File]::Open($env:DIET_SECRET_PATH, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
try {
  $current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetOwner($current)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($value in @($current.Value, 'S-1-5-18', 'S-1-5-32-544')) {
    $sid = New-Object System.Security.Principal.SecurityIdentifier($value)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $env:DIET_SECRET_PATH -AclObject $acl
  $acl = Get-Acl -LiteralPath $env:DIET_SECRET_PATH
  $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
    [pscustomobject]@{ sid = $_.IdentityReference.Value; type = $_.AccessControlType.ToString(); rights = [int]$_.FileSystemRights; inherited = $_.IsInherited }
  })
  ${HANDLE_RESULT_SCRIPT}
  [pscustomobject]@{ owner = $owner; current = $current.Value; protected = $acl.AreAccessRulesProtected; rules = $rules; volume = $info.Volume.ToString(); index = $index.ToString() } | ConvertTo-Json -Compress -Depth 4
} finally {
  $stream.Dispose()
}
`;
const ACL_AUDIT_SCRIPT = String.raw `
$ErrorActionPreference = 'Stop'
${HANDLE_IDENTITY_SCRIPT}
$stream = [System.IO.File]::Open($env:DIET_SECRET_PATH, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
try {
  $acl = Get-Acl -LiteralPath $env:DIET_SECRET_PATH
  $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  $current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
    [pscustomobject]@{ sid = $_.IdentityReference.Value; type = $_.AccessControlType.ToString(); rights = [int]$_.FileSystemRights; inherited = $_.IsInherited }
  })
  ${HANDLE_RESULT_SCRIPT}
  [pscustomobject]@{ owner = $owner; current = $current; protected = $acl.AreAccessRulesProtected; rules = $rules; volume = $info.Volume.ToString(); index = $index.ToString() } | ConvertTo-Json -Compress -Depth 4
} finally {
  $stream.Dispose()
}
`;
function powershell(script, path) {
    const systemRoot = process.env.SystemRoot;
    if (typeof systemRoot !== "string" || systemRoot.length === 0)
        return invalid("secret", "permissions");
    const executable = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        env: { ...process.env, DIET_SECRET_PATH: path },
        timeout: 10_000,
        maxBuffer: 16_384,
        windowsHide: true,
    });
    if (result.error !== undefined || result.status !== 0 || result.signal !== null ||
        typeof result.stdout !== "string" || result.stdout.length > 16_384)
        return invalid("secret", "permissions");
    return result.stdout.trim();
}
function assertPrivateAclOutput(output, expectedIdentity) {
    let value;
    try {
        value = JSON.parse(output);
    }
    catch {
        return invalid("secret", "permissions");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return invalid("secret", "permissions");
    }
    const candidate = value;
    if (Object.keys(candidate).sort().join("\0") !== "current\0index\0owner\0protected\0rules\0volume" ||
        typeof candidate.current !== "string" || candidate.owner !== candidate.current ||
        candidate.protected !== true || !Array.isArray(candidate.rules) || candidate.rules.length !== 3 ||
        typeof candidate.volume !== "string" || !/^\d+$/.test(candidate.volume) ||
        typeof candidate.index !== "string" || !/^\d+$/.test(candidate.index) ||
        BigInt(candidate.volume) !== expectedIdentity.dev || BigInt(candidate.index) !== expectedIdentity.ino)
        return invalid("secret", "permissions");
    const expected = [candidate.current, "S-1-5-18", "S-1-5-32-544"].sort();
    const actual = candidate.rules.map((rule) => {
        if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
            return invalid("secret", "permissions");
        }
        const fields = rule;
        if (Object.keys(fields).sort().join("\0") !== "inherited\0rights\0sid\0type" ||
            typeof fields.sid !== "string" || fields.type !== "Allow" ||
            fields.rights !== 2_032_127 || fields.inherited !== false)
            return invalid("secret", "permissions");
        return fields.sid;
    }).sort();
    if (actual.join("\0") !== expected.join("\0"))
        return invalid("secret", "permissions");
}
function setPrivateAcl(path, expectedIdentity) {
    if (process.platform === "win32") {
        assertPrivateAclOutput(powershell(ACL_SET_SCRIPT, path), expectedIdentity);
    }
}
function auditPrivateAcl(path, expectedIdentity) {
    if (process.platform === "win32") {
        assertPrivateAclOutput(powershell(ACL_AUDIT_SCRIPT, path), expectedIdentity);
    }
}
function fdStat(descriptor) {
    return fstatSync(descriptor, { bigint: true });
}
function validateFileStat(stat) {
    if (!stat.isFile())
        return invalid("secret", "file");
    if (stat.nlink !== 1n)
        return invalid("secret", "link_count");
    if (stat.size !== 32n)
        return invalid("secret", "length");
    if (process.platform !== "win32" && (Number(stat.mode) & 0o077) !== 0) {
        return invalid("secret", "permissions");
    }
}
function pathMatchesFd(path, stat) {
    try {
        const pathStat = lstatSync(path, { bigint: true });
        return !pathStat.isSymbolicLink() && pathStat.dev === stat.dev && pathStat.ino === stat.ino;
    }
    catch {
        return false;
    }
}
function readSecret(path, authority) {
    assertRuntimeRootAuthority(authority);
    const saved = savedIdentity(path);
    if (saved === undefined) {
        const missing = new Error("missing");
        missing.code = "ENOENT";
        throw missing;
    }
    auditPrivateAcl(path, saved);
    assertRuntimeRootAuthority(authority);
    let descriptor;
    try {
        const noFollow = constants.O_NOFOLLOW ?? 0;
        descriptor = openSync(path, constants.O_RDONLY | noFollow);
        const before = fdStat(descriptor);
        validateFileStat(before);
        if (!sameIdentity(saved, before) || !pathMatchesFd(path, before)) {
            return invalid("secret", "identity");
        }
        const bytes = Buffer.alloc(32);
        let offset = 0;
        while (offset < bytes.length) {
            const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
            if (count === 0)
                return invalid("secret", "length");
            offset += count;
        }
        const after = fdStat(descriptor);
        validateFileStat(after);
        if (before.dev !== after.dev || before.ino !== after.ino ||
            !pathMatchesFd(path, after))
            return invalid("secret", "identity");
        assertRuntimeRootAuthority(authority);
        return Uint8Array.from(bytes);
    }
    catch (error) {
        if (error instanceof Error && /^(CORE_RUNTIME_SECRET_INVALID|STORAGE_PATH_INVALID):/.test(error.message)) {
            throw error;
        }
        if (error.code === "ENOENT")
            throw error;
        if (["EACCES", "EPERM"].includes(error.code ?? "")) {
            return invalid("secret", "permissions");
        }
        return invalid("secret", "identity");
    }
    finally {
        if (descriptor !== undefined)
            closeSync(descriptor);
    }
}
function savedIdentity(path) {
    try {
        return identity(path);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return undefined;
        throw error;
    }
}
function unlinkOnlyIdentity(path, saved) {
    if (saved === undefined)
        return;
    let current;
    try {
        current = identity(path);
    }
    catch {
        return;
    }
    if (sameIdentity(current, saved))
        unlinkSync(path);
}
function loadOrCreateRuntimeSecret(authority) {
    assertRuntimeRootAuthority(authority);
    const finalPath = join(authority.root, CORE_RUNTIME_SECRET_FILENAME);
    try {
        return readSecret(finalPath, authority);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    const candidatePath = join(authority.root, `.${CORE_RUNTIME_SECRET_FILENAME}.candidate-${randomUUID()}`);
    let descriptor;
    let candidateIdentity;
    try {
        const noFollow = constants.O_NOFOLLOW ?? 0;
        descriptor = openSync(candidatePath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | noFollow, 0o600);
        const created = fdStat(descriptor);
        if (!created.isFile() || created.nlink !== 1n || created.size !== 0n) {
            return invalid("secret", "identity");
        }
        candidateIdentity = Object.freeze({ path: candidatePath, dev: created.dev, ino: created.ino });
        if (!pathMatchesFd(candidatePath, created))
            return invalid("secret", "identity");
        if (process.platform !== "win32")
            chmodSync(candidatePath, 0o600);
        closeSync(descriptor);
        descriptor = undefined;
        setPrivateAcl(candidatePath, candidateIdentity);
        descriptor = openSync(candidatePath, constants.O_RDWR | noFollow);
        const protectedStat = fdStat(descriptor);
        if (!sameIdentity(candidateIdentity, protectedStat) ||
            !pathMatchesFd(candidatePath, protectedStat))
            return invalid("secret", "identity");
        const bytes = randomBytes(32);
        let offset = 0;
        while (offset < bytes.length) {
            offset += writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
        }
        fsyncSync(descriptor);
        const beforeAcl = fdStat(descriptor);
        validateFileStat(beforeAcl);
        if (!pathMatchesFd(candidatePath, beforeAcl))
            return invalid("secret", "identity");
        assertRuntimeRootAuthority(authority);
        try {
            linkSync(candidatePath, finalPath);
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
        }
        assertRuntimeRootAuthority(authority);
    }
    catch (error) {
        if (error instanceof Error && /^(CORE_RUNTIME_SECRET_INVALID|STORAGE_PATH_INVALID):/.test(error.message)) {
            throw error;
        }
        if (error.code === "ENOENT")
            return invalid("root", "root_identity");
        throw error;
    }
    finally {
        if (descriptor !== undefined)
            closeSync(descriptor);
        unlinkOnlyIdentity(candidatePath, candidateIdentity);
    }
    assertRuntimeRootAuthority(authority);
    return readSecret(finalPath, authority);
}
const liveByRoot = new Map();
const states = new WeakMap();
function runtimeInvalid(reason) {
    throw new TypeError(`CORE_RUNTIME_INVALID:${reason}`);
}
function clockValue(now) {
    let value;
    try {
        value = now();
    }
    catch {
        return runtimeInvalid("clock");
    }
    if (typeof value !== "string")
        return runtimeInvalid("clock");
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
        return runtimeInvalid("clock");
    }
    return value;
}
function exactOptions(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
        isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
        return runtimeInvalid("options");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 2 || keys.some((key) => typeof key !== "string") ||
        !keys.includes("officialDataRoot") || !keys.includes("now"))
        return runtimeInvalid("options");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
            return runtimeInvalid("options");
        }
    }
    const root = descriptors.officialDataRoot.value;
    const now = descriptors.now.value;
    if (typeof root !== "string")
        return runtimeInvalid("root");
    if (typeof now !== "function")
        return runtimeInvalid("clock");
    clockValue(now);
    return Object.freeze({ officialDataRoot: root, now: now });
}
export function createCoreRuntime(options) {
    const validated = exactOptions(options);
    const rootAuthority = createRuntimeRootAuthority(validated.officialDataRoot);
    const cached = liveByRoot.get(rootAuthority.root);
    if (cached !== undefined) {
        const cachedState = states.get(cached);
        if (cachedState === undefined)
            throw new Error("STORAGE_PATH_INVALID:root_identity");
        assertRuntimeRootAuthority(cachedState.rootAuthority);
        return cached;
    }
    let runtime;
    const state = { root: rootAuthority.root, rootAuthority,
        now: validated.now, closed: false };
    runtime = Object.freeze({
        close() {
            if (state.closed)
                return;
            state.closed = true;
            state.databaseRuntime?.close();
            state.databaseRuntime = undefined;
            state.session = undefined;
            if (liveByRoot.get(state.root) === runtime)
                liveByRoot.delete(state.root);
        },
    });
    states.set(runtime, state);
    assertRuntimeRootAuthority(rootAuthority);
    liveByRoot.set(rootAuthority.root, runtime);
    return runtime;
}
function acquireSession(runtime) {
    const state = states.get(runtime);
    if (state === undefined)
        return runtimeInvalid("runtime");
    if (state.closed)
        return runtimeInvalid("closed");
    assertRuntimeRootAuthority(state.rootAuthority);
    if (state.session !== undefined)
        return state.session;
    const secret = loadOrCreateRuntimeSecret(state.rootAuthority);
    assertRuntimeRootAuthority(state.rootAuthority);
    let databaseRuntime;
    try {
        databaseRuntime = openDietDatabase({ privateRuntimeRoot: state.root, now: state.now });
        assertRuntimeRootAuthority(state.rootAuthority);
        const session = Object.freeze({ database: databaseRuntime.database,
            service: createDietDomainService({ database: databaseRuntime.database, secret, now: state.now }) });
        assertRuntimeRootAuthority(state.rootAuthority);
        state.databaseRuntime = databaseRuntime;
        state.session = session;
        return session;
    }
    catch (error) {
        databaseRuntime?.close();
        throw error;
    }
}
const REQUEST_FIELDS = Object.freeze(["action", "source_text", "received_at", "timezone",
    "operation_id", "source_message_id", "conversation_id", "prior_context"]);
function requestInvalid(reason) {
    throw new TypeError(`CORE_APPLICATION_REQUEST_INVALID:${reason}`);
}
function cloneRequest(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
        isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype)
        return requestInvalid("shape");
    const keys = Reflect.ownKeys(value);
    if (keys.length !== REQUEST_FIELDS.length || keys.some((key) => typeof key !== "string") ||
        REQUEST_FIELDS.some((key) => !keys.includes(key)))
        return requestInvalid("keys");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of REQUEST_FIELDS) {
        const descriptor = descriptors[key];
        if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
            return requestInvalid(`${key}:descriptor`);
        }
    }
    const action = descriptors.action.value;
    if (typeof action !== "string" || !dietManagerActions.includes(action)) {
        return requestInvalid("action");
    }
    const parseInput = cloneCoreParseInput(Object.fromEntries(REQUEST_FIELDS
        .filter((key) => key !== "action").map((key) => [key, descriptors[key].value])));
    const ordinary = JSON.parse(canonicalJson(parseInput));
    return Object.freeze({ action: action, ...ordinary });
}
function sanitizedCode(error) {
    if (!(error instanceof Error))
        return "CORE_APPLICATION_FAILED";
    if (error.message.startsWith("IDEMPOTENCY_CONFLICT:"))
        return "idempotency_conflict";
    const code = error.message.split(":", 1)[0];
    return /^[A-Z][A-Z0-9_]*$/u.test(code) ? code : "CORE_APPLICATION_FAILED";
}
function recordId(database, envelope, operation) {
    const rows = database.prepare(`SELECT event_id, event_type, fact_kind, operation_id
    FROM event_records WHERE envelope_id = ? AND operation_id = ?`)
        .all(envelope.envelope_id, operation.operation_id);
    const expected = operation.kind === "record_water"
        ? { event_type: "diet_water", fact_kind: "water" }
        : { event_type: "diet_meal", fact_kind: "meal" };
    if (rows.length !== 1 || rows[0]?.operation_id !== operation.operation_id ||
        rows[0]?.event_type !== expected.event_type || rows[0]?.fact_kind !== expected.fact_kind) {
        throw new Error("CORE_APPLICATION_RESULT_INVALID:event_identity");
    }
    return rows[0].event_id;
}
function executeCandidate(runtime, request, command) {
    const envelope = mapCoreCandidateToEnvelope(request, command);
    const session = acquireSession(runtime);
    const preview = session.service.preview(envelope);
    const result = session.service.execute({ envelope, token: preview.token,
        input_digest: preview.input_digest, data_revision: preview.data_revision });
    const operation = envelope.operations[0];
    if (operation === undefined || result.items.length !== 1 ||
        result.items[0]?.operation_id !== operation.operation_id ||
        (result.items[0]?.status !== "committed" && result.items[0]?.status !== "committed_with_issues")) {
        throw new Error("CORE_APPLICATION_RESULT_INVALID:terminal");
    }
    return Object.freeze({ status: result.items[0].status,
        record_id: recordId(session.database, envelope, operation) });
}
export function handleCoreRequest(runtime, value) {
    let request;
    try {
        request = cloneRequest(value);
    }
    catch {
        return failedOutcome("record_meal", undefined, "INVALID_REQUEST");
    }
    if (!["record_meal", "record_water", "add_inventory"].includes(request.action)) {
        return failedOutcome(request.action, request.operation_id, "ACTION_NOT_IMPLEMENTED");
    }
    let parsed;
    try {
        const { action: _action, ...parseInput } = request;
        parsed = parseCoreCommand(parseInput);
    }
    catch {
        return failedOutcome(request.action, request.operation_id, "INVALID_REQUEST");
    }
    if (parsed.disposition !== "candidate") {
        if (parsed.action !== request.action) {
            return failedOutcome(request.action, request.operation_id, "ACTION_CONFLICT");
        }
        return nonWritingOutcome(request.action, request.operation_id, parsed.disposition, parsed.reason_code);
    }
    if (parsed.command.action !== request.action) {
        return failedOutcome(request.action, request.operation_id, "ACTION_CONFLICT");
    }
    if (parsed.command.action === "add_inventory") {
        return failedOutcome(request.action, request.operation_id, "ACTION_NOT_IMPLEMENTED");
    }
    try {
        const result = executeCandidate(runtime, request, parsed.command);
        return committedOutcome(request.action, request.operation_id, result.status, result.record_id);
    }
    catch (error) {
        return failedOutcome(request.action, request.operation_id, sanitizedCode(error));
    }
}
