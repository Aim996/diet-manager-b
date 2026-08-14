import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, parse } from "node:path";
import { isProxy } from "node:util/types";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson, canonicalSha256 } from "../authority/canonical-json.js";
import {
  dietManagerActions,
  type CoreApplicationRequest,
  type DietManagerAction,
  type DietManagerOutcome,
  type MealReceipt,
  type MealReceiptInventoryStatus,
  type NutritionOutcomeItem,
  type ProductIdentityClarification,
} from "../contracts.js";
import {
  resolveProductIdentity,
  resolveExpiration,
} from "../domain/inventory-service.js";
import { deriveDomainId } from "../domain/identity.js";
import { createDietDomainService, type DietDomainService } from "../domain/service.js";
import type {
  DomainEnvelopeInput,
  DomainOperation,
  KnownStructuredAmount,
  ProductIdentityEvidence,
} from "../domain/types.js";
import { cloneCoreParseInput } from "../parser/input-authority.js";
import { parseCoreCommand } from "../parser/parse-command.js";
import type {
  CoreCommandCandidate,
  CoreInventoryCommandCandidate,
  CoreInventoryLocationCorrectionCandidate,
  CorePurchaseCommandCandidate,
  CorePurchaseItemCandidate,
} from "../parser/types.js";
import { assertPrivateRuntimeRoot } from "../storage/database.js";
import { openDietDatabase, type DietDatabaseRuntime } from "../storage/database.js";
import {
  assertCurrentInventoryLocationCorrectionLineage,
  parseProductPayloadJson,
  parseProjectionPayloadJson,
} from "../storage/inventory-repository.js";
import {
  mapResolvedNutritionAmountMicrounits,
  mapResolvedNutritionEvidenceToDomainSource,
  mapCoreCandidateToEnvelope,
  type ResolvedCoreInventoryLocationCorrection,
  type ResolvedCoreNutritionSupplement,
  type ResolvedCorePurchaseItem,
} from "./mapping.js";
import { committedOutcome, failedOutcome, nonWritingOutcome } from "./outcome.js";
import { cloneNutritionRuntimeConfig } from "../nutrition/config.js";
import { resolveNutrition } from "../nutrition/source-client.js";
import {
  claimNutritionResolution,
  completeNutritionResolution,
  type NutritionPreviewMaterialV6,
} from "../nutrition/resolution-claim.js";
import {
  buildNutritionRecords,
  adoptNutritionAmount,
  nutritionOutcomeItem,
  type NutritionRecords,
} from "../nutrition/nutrition-service.js";
import { assertNutritionRecordsPersisted } from "../nutrition/nutrition-repository.js";
import {
  freezeNutritionData,
  type NutritionRuntimeConfig,
  type NutritionSourceAdapter,
  type ResolvedNutritionEvidence,
  type SourceContext,
  type SourceRequest,
} from "../nutrition/types.js";

export const CORE_RUNTIME_SECRET_FILENAME = ".diet-manager-b.authority-secret";

interface Identity {
  readonly path: string;
  readonly dev: bigint;
  readonly ino: bigint;
}

interface RuntimeRootAuthority {
  readonly root: string;
  readonly chain: readonly Identity[];
}

function invalid(kind: "secret" | "root", reason: string): never {
  throw new Error(kind === "secret"
    ? `CORE_RUNTIME_SECRET_INVALID:${reason}`
    : `STORAGE_PATH_INVALID:${reason}`);
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function identity(path: string): Identity {
  const stat = lstatSync(path, { bigint: true });
  return Object.freeze({ path, dev: stat.dev, ino: stat.ino });
}

function sameIdentity(left: Pick<Identity, "dev" | "ino">, right: Pick<Identity, "dev" | "ino">): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function ancestorChain(root: string): readonly Identity[] {
  const values: Identity[] = [];
  let current = root;
  for (;;) {
    values.push(identity(current));
    const parent = dirname(current);
    if (samePath(parent, current) || samePath(current, parse(current).root)) break;
    current = parent;
  }
  return Object.freeze(values);
}

function createRuntimeRootAuthority(value: string): RuntimeRootAuthority {
  const root = assertPrivateRuntimeRoot(value);
  return Object.freeze({ root, chain: ancestorChain(root) });
}

function assertRuntimeRootAuthority(authority: RuntimeRootAuthority): void {
  let current: string;
  try {
    current = assertPrivateRuntimeRoot(authority.root);
  } catch {
    return invalid("root", "root_identity");
  }
  if (!samePath(current, authority.root)) return invalid("root", "root_identity");
  let chain: readonly Identity[];
  try {
    chain = ancestorChain(current);
  } catch {
    return invalid("root", "root_identity");
  }
  if (
    chain.length !== authority.chain.length || chain.some((entry, index) => {
      const expected = authority.chain[index];
      return expected === undefined || !samePath(entry.path, expected.path) ||
        !sameIdentity(entry, expected);
    })
  ) return invalid("root", "root_identity");
}

const HANDLE_IDENTITY_SCRIPT = String.raw`
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

const HANDLE_RESULT_SCRIPT = String.raw`
$info = New-Object DietManagerFileIdentity+Info
if (-not [DietManagerFileIdentity]::GetFileInformationByHandle($stream.SafeFileHandle, [ref]$info)) { throw 'file_identity' }
$index = ([uint64]$info.IndexHigh -shl 32) -bor [uint64]$info.IndexLow
`;

const ACL_SET_SCRIPT = String.raw`
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

const ACL_AUDIT_SCRIPT = String.raw`
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

function powershell(script: string, path: string): string {
  const systemRoot = process.env.SystemRoot;
  if (typeof systemRoot !== "string" || systemRoot.length === 0) return invalid("secret", "permissions");
  const executable = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, DIET_SECRET_PATH: path },
    timeout: 10_000,
    maxBuffer: 16_384,
    windowsHide: true,
  });
  if (
    result.error !== undefined || result.status !== 0 || result.signal !== null ||
    typeof result.stdout !== "string" || result.stdout.length > 16_384
  ) return invalid("secret", "permissions");
  return result.stdout.trim();
}

function assertPrivateAclOutput(output: string, expectedIdentity: Identity): void {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return invalid("secret", "permissions");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("secret", "permissions");
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).sort().join("\0") !== "current\0index\0owner\0protected\0rules\0volume" ||
    typeof candidate.current !== "string" || candidate.owner !== candidate.current ||
    candidate.protected !== true || !Array.isArray(candidate.rules) || candidate.rules.length !== 3 ||
    typeof candidate.volume !== "string" || !/^\d+$/.test(candidate.volume) ||
    typeof candidate.index !== "string" || !/^\d+$/.test(candidate.index) ||
    BigInt(candidate.volume) !== expectedIdentity.dev || BigInt(candidate.index) !== expectedIdentity.ino
  ) return invalid("secret", "permissions");
  const expected = [candidate.current, "S-1-5-18", "S-1-5-32-544"].sort();
  const actual = candidate.rules.map((rule) => {
    if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
      return invalid("secret", "permissions");
    }
    const fields = rule as Record<string, unknown>;
    if (
      Object.keys(fields).sort().join("\0") !== "inherited\0rights\0sid\0type" ||
      typeof fields.sid !== "string" || fields.type !== "Allow" ||
      fields.rights !== 2_032_127 || fields.inherited !== false
    ) return invalid("secret", "permissions");
    return fields.sid;
  }).sort();
  if (actual.join("\0") !== expected.join("\0")) return invalid("secret", "permissions");
}

function setPrivateAcl(path: string, expectedIdentity: Identity): void {
  if (process.platform === "win32") {
    assertPrivateAclOutput(powershell(ACL_SET_SCRIPT, path), expectedIdentity);
  }
}

function auditPrivateAcl(path: string, expectedIdentity: Identity): void {
  if (process.platform === "win32") {
    assertPrivateAclOutput(powershell(ACL_AUDIT_SCRIPT, path), expectedIdentity);
  }
}

type BigIntStats = ReturnType<typeof fstatSync> & {
  dev: bigint; ino: bigint; mode: bigint; nlink: bigint; size: bigint;
};

function fdStat(descriptor: number): BigIntStats {
  return fstatSync(descriptor, { bigint: true }) as BigIntStats;
}

function validateFileStat(stat: BigIntStats): void {
  if (!stat.isFile()) return invalid("secret", "file");
  if (stat.nlink !== 1n) return invalid("secret", "link_count");
  if (stat.size !== 32n) return invalid("secret", "length");
  if (process.platform !== "win32" && (Number(stat.mode) & 0o077) !== 0) {
    return invalid("secret", "permissions");
  }
}

function pathMatchesFd(path: string, stat: BigIntStats): boolean {
  try {
    const pathStat = lstatSync(path, { bigint: true });
    return !pathStat.isSymbolicLink() && pathStat.dev === stat.dev && pathStat.ino === stat.ino;
  } catch {
    return false;
  }
}

function readSecret(path: string, authority: RuntimeRootAuthority): Uint8Array {
  assertRuntimeRootAuthority(authority);
  const saved = savedIdentity(path);
  if (saved === undefined) {
    const missing = new Error("missing") as NodeJS.ErrnoException;
    missing.code = "ENOENT";
    throw missing;
  }
  auditPrivateAcl(path, saved);
  assertRuntimeRootAuthority(authority);
  let descriptor: number | undefined;
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
      if (count === 0) return invalid("secret", "length");
      offset += count;
    }
    const after = fdStat(descriptor);
    validateFileStat(after);
    if (
      before.dev !== after.dev || before.ino !== after.ino ||
      !pathMatchesFd(path, after)
    ) return invalid("secret", "identity");
    assertRuntimeRootAuthority(authority);
    return Uint8Array.from(bytes);
  } catch (error) {
    if (error instanceof Error && /^(CORE_RUNTIME_SECRET_INVALID|STORAGE_PATH_INVALID):/.test(error.message)) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    if (["EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      return invalid("secret", "permissions");
    }
    return invalid("secret", "identity");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function savedIdentity(path: string): Identity | undefined {
  try {
    return identity(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function unlinkOnlyIdentity(path: string, saved: Identity | undefined): void {
  if (saved === undefined) return;
  let current: Identity;
  try {
    current = identity(path);
  } catch {
    return;
  }
  if (sameIdentity(current, saved)) unlinkSync(path);
}

function loadOrCreateRuntimeSecret(authority: RuntimeRootAuthority): Uint8Array {
  assertRuntimeRootAuthority(authority);
  const finalPath = join(authority.root, CORE_RUNTIME_SECRET_FILENAME);
  try {
    return readSecret(finalPath, authority);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const candidatePath = join(
    authority.root,
    `.${CORE_RUNTIME_SECRET_FILENAME}.candidate-${randomUUID()}`,
  );
  let descriptor: number | undefined;
  let candidateIdentity: Identity | undefined;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    descriptor = openSync(candidatePath,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | noFollow, 0o600);
    const created = fdStat(descriptor);
    if (!created.isFile() || created.nlink !== 1n || created.size !== 0n) {
      return invalid("secret", "identity");
    }
    candidateIdentity = Object.freeze({ path: candidatePath, dev: created.dev, ino: created.ino });
    if (!pathMatchesFd(candidatePath, created)) return invalid("secret", "identity");
    if (process.platform !== "win32") chmodSync(candidatePath, 0o600);
    closeSync(descriptor);
    descriptor = undefined;
    setPrivateAcl(candidatePath, candidateIdentity);
    descriptor = openSync(candidatePath, constants.O_RDWR | noFollow);
    const protectedStat = fdStat(descriptor);
    if (!sameIdentity(candidateIdentity, protectedStat) ||
        !pathMatchesFd(candidatePath, protectedStat)) return invalid("secret", "identity");
    const bytes = randomBytes(32);
    let offset = 0;
    while (offset < bytes.length) {
      offset += writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
    }
    fsyncSync(descriptor);
    const beforeAcl = fdStat(descriptor);
    validateFileStat(beforeAcl);
    if (!pathMatchesFd(candidatePath, beforeAcl)) return invalid("secret", "identity");
    assertRuntimeRootAuthority(authority);
    try {
      linkSync(candidatePath, finalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    assertRuntimeRootAuthority(authority);
  } catch (error) {
    if (error instanceof Error && /^(CORE_RUNTIME_SECRET_INVALID|STORAGE_PATH_INVALID):/.test(error.message)) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return invalid("root", "root_identity");
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    unlinkOnlyIdentity(candidatePath, candidateIdentity);
  }
  assertRuntimeRootAuthority(authority);
  return readSecret(finalPath, authority);
}

export interface CreateCoreRuntimeOptions {
  readonly officialDataRoot: string;
  readonly now: () => string;
  readonly nutritionConfig?: Readonly<NutritionRuntimeConfig>;
  readonly nutritionAdapters?: readonly NutritionSourceAdapter[];
  readonly nutritionCredential?: SourceContext["credential"];
}

export interface CoreRuntime {
  close(): void;
}

interface CoreRuntimeSession {
  readonly database: DatabaseSync;
  readonly service: DietDomainService;
  readonly authoritySecret: Uint8Array;
}

interface RuntimeState {
  readonly root: string;
  readonly rootAuthority: RuntimeRootAuthority;
  readonly now: () => string;
  readonly nutritionConfig: Readonly<NutritionRuntimeConfig>;
  readonly nutritionAdapters: readonly NutritionSourceAdapter[];
  readonly nutritionCredential: SourceContext["credential"];
  closed: boolean;
  databaseRuntime?: DietDatabaseRuntime;
  session?: CoreRuntimeSession;
}

const liveByRoot = new Map<string, CoreRuntime>();
const states = new WeakMap<CoreRuntime, RuntimeState>();
const nutritionFlights = new WeakMap<CoreRuntime, Map<string, Promise<NutritionPreviewMaterialV6>>>();

function runtimeInvalid(reason: string): never {
  throw new TypeError(`CORE_RUNTIME_INVALID:${reason}`);
}

function clockValue(now: () => string): string {
  let value: unknown;
  try {
    value = now();
  } catch {
    return runtimeInvalid("clock");
  }
  if (typeof value !== "string") return runtimeInvalid("clock");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    return runtimeInvalid("clock");
  }
  return value;
}

function exactOptions(value: unknown): CreateCoreRuntimeOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return runtimeInvalid("options");
  }
  const keys = Reflect.ownKeys(value);
  const allowed = ["officialDataRoot", "now", "nutritionConfig", "nutritionAdapters", "nutritionCredential"];
  if (keys.length < 2 || keys.length > allowed.length || keys.some((key) => typeof key !== "string" || !allowed.includes(key)) ||
      !keys.includes("officialDataRoot") || !keys.includes("now")) return runtimeInvalid("options");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
      return runtimeInvalid("options");
    }
  }
  const root = descriptors.officialDataRoot.value;
  const now = descriptors.now.value;
  if (typeof root !== "string") return runtimeInvalid("root");
  if (typeof now !== "function") return runtimeInvalid("clock");
  clockValue(now as () => string);
  const nutritionConfig = descriptors.nutritionConfig?.value ?? cloneNutritionRuntimeConfig(undefined);
  if (typeof nutritionConfig !== "object" || nutritionConfig === null || isProxy(nutritionConfig) ||
      typeof (nutritionConfig as NutritionRuntimeConfig).source_config_digest !== "string" ||
      !/^[A-F0-9]{64}$/u.test((nutritionConfig as NutritionRuntimeConfig).source_config_digest) ||
      !Array.isArray((nutritionConfig as NutritionRuntimeConfig).sources)) return runtimeInvalid("nutrition_config");
  const adaptersValue = descriptors.nutritionAdapters?.value ?? Object.freeze([]);
  if (typeof adaptersValue !== "object" || adaptersValue === null || isProxy(adaptersValue) || !Array.isArray(adaptersValue) ||
      adaptersValue.some((adapter) => typeof adapter !== "object" || adapter === null || isProxy(adapter) ||
        typeof (adapter as NutritionSourceAdapter).describe !== "function" ||
        typeof (adapter as NutritionSourceAdapter).probe !== "function" ||
        typeof (adapter as NutritionSourceAdapter).resolve !== "function")) return runtimeInvalid("nutrition_adapters");
  const credential = descriptors.nutritionCredential?.value ?? (() => undefined);
  if (typeof credential !== "function") return runtimeInvalid("nutrition_credential");
  return Object.freeze({
    officialDataRoot: root,
    now: now as () => string,
    nutritionConfig: nutritionConfig as Readonly<NutritionRuntimeConfig>,
    nutritionAdapters: Object.freeze([...(adaptersValue as NutritionSourceAdapter[])]),
    nutritionCredential: credential as SourceContext["credential"],
  });
}

export function createCoreRuntime(options: CreateCoreRuntimeOptions): CoreRuntime {
  const validated = exactOptions(options);
  const rootAuthority = createRuntimeRootAuthority(validated.officialDataRoot);
  const cached = liveByRoot.get(rootAuthority.root);
  if (cached !== undefined) {
    const cachedState = states.get(cached);
    if (cachedState === undefined) throw new Error("STORAGE_PATH_INVALID:root_identity");
    assertRuntimeRootAuthority(cachedState.rootAuthority);
    if (cachedState.nutritionConfig.source_config_digest !== validated.nutritionConfig?.source_config_digest) {
      throw new Error("CORE_RUNTIME_INVALID:nutrition_config_conflict");
    }
    return cached;
  }
  let runtime!: CoreRuntime;
  const state: RuntimeState = { root: rootAuthority.root, rootAuthority,
    now: validated.now,
    nutritionConfig: validated.nutritionConfig ?? cloneNutritionRuntimeConfig(undefined),
    nutritionAdapters: validated.nutritionAdapters ?? Object.freeze([]),
    nutritionCredential: validated.nutritionCredential ?? (() => undefined),
    closed: false };
  runtime = Object.freeze({
    close(): void {
      if (state.closed) return;
      state.closed = true;
      state.databaseRuntime?.close();
      state.databaseRuntime = undefined;
      state.session = undefined;
      if (liveByRoot.get(state.root) === runtime) liveByRoot.delete(state.root);
    },
  });
  states.set(runtime, state);
  assertRuntimeRootAuthority(rootAuthority);
  liveByRoot.set(rootAuthority.root, runtime);
  return runtime;
}

function acquireSession(runtime: CoreRuntime): CoreRuntimeSession {
  const state = states.get(runtime);
  if (state === undefined) return runtimeInvalid("runtime");
  if (state.closed) return runtimeInvalid("closed");
  assertRuntimeRootAuthority(state.rootAuthority);
  if (state.session !== undefined) return state.session;
  const secret = loadOrCreateRuntimeSecret(state.rootAuthority);
  assertRuntimeRootAuthority(state.rootAuthority);
  let databaseRuntime: DietDatabaseRuntime | undefined;
  try {
    databaseRuntime = openDietDatabase({ privateRuntimeRoot: state.root, now: state.now });
    assertRuntimeRootAuthority(state.rootAuthority);
    const session = Object.freeze({
      database: databaseRuntime.database,
      service: createDietDomainService({ database: databaseRuntime.database, secret, now: state.now }),
      authoritySecret: Uint8Array.from(secret),
    });
    assertRuntimeRootAuthority(state.rootAuthority);
    state.databaseRuntime = databaseRuntime;
    state.session = session;
    return session;
  } catch (error) {
    databaseRuntime?.close();
    throw error;
  }
}

const REQUEST_FIELDS = Object.freeze(["action", "source_text", "received_at", "timezone",
  "operation_id", "source_message_id", "conversation_id", "prior_context"] as const);

function requestInvalid(reason: string): never {
  throw new TypeError(`CORE_APPLICATION_REQUEST_INVALID:${reason}`);
}

function cloneRequest(value: unknown): Readonly<CoreApplicationRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return requestInvalid("shape");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== REQUEST_FIELDS.length || keys.some((key) => typeof key !== "string") ||
      REQUEST_FIELDS.some((key) => !keys.includes(key))) return requestInvalid("keys");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of REQUEST_FIELDS) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
      return requestInvalid(`${key}:descriptor`);
    }
  }
  const action = descriptors.action.value;
  if (typeof action !== "string" || !dietManagerActions.includes(action as DietManagerAction)) {
    return requestInvalid("action");
  }
  const parseInput = cloneCoreParseInput(Object.fromEntries(REQUEST_FIELDS
    .filter((key) => key !== "action").map((key) => [key, descriptors[key].value])) as CoreApplicationRequest);
  const ordinary = JSON.parse(canonicalJson(parseInput)) as Omit<CoreApplicationRequest, "action">;
  return Object.freeze({ action: action as DietManagerAction, ...ordinary });
}

function sanitizedCode(error: unknown): string {
  if (!(error instanceof Error)) return "CORE_APPLICATION_FAILED";
  if (error.message.startsWith("IDEMPOTENCY_CONFLICT:")) return "idempotency_conflict";
  const code = error.message.split(":", 1)[0];
  return /^[A-Z][A-Z0-9_]*$/u.test(code) ? code : "CORE_APPLICATION_FAILED";
}

interface PurchaseReference {
  readonly order: number;
  readonly raw_name: string;
  readonly normalized_name: string;
  readonly identity_reference: "explicit" | "same_attributes" | "deictic";
  readonly specification: Readonly<{ readonly value: number; readonly unit: string }> | null;
}

interface StoredProductIdentity {
  readonly product_id: string;
  readonly identity: Readonly<ProductIdentityEvidence>;
}

type PurchaseResolution =
  | Readonly<{ readonly status: "resolved"; readonly items: readonly Readonly<ResolvedCorePurchaseItem>[] }>
  | Readonly<{ readonly status: "needs_clarification"; readonly clarification: ProductIdentityClarification }>;

function purchaseReferences(
  command: Readonly<CorePurchaseCommandCandidate | CoreInventoryCommandCandidate>,
): readonly Readonly<PurchaseReference>[] {
  if ("items" in command) return command.items;
  return Object.freeze([Object.freeze({
    order: 0,
    raw_name: command.product.raw_text,
    normalized_name: "milk",
    identity_reference: "explicit" as const,
    specification: null,
  })]);
}

function requestedProductIdentity(reference: Readonly<PurchaseReference>): Readonly<ProductIdentityEvidence> {
  return Object.freeze({
    raw_name: reference.raw_name,
    normalized_name: reference.normalized_name,
    brand: null,
    variant_or_flavor: null,
    specification: reference.specification === null
      ? null
      : Object.freeze({
          value: reference.specification.value,
          unit: reference.specification.unit,
        }),
    evidence_kind: reference.identity_reference === "deictic" ? "unknown" : "explicit",
  });
}

function storedProductIdentities(database: DatabaseSync): readonly Readonly<StoredProductIdentity>[] {
  const rows = database.prepare(
    "SELECT product_id, payload_json FROM products ORDER BY product_id LIMIT 257",
  ).all() as Array<{ product_id: string; payload_json: string }>;
  if (rows.length > 256) throw new Error("CORE_APPLICATION_RESULT_INVALID:product_candidate_count");
  const identities = rows.flatMap((row) => {
    const parsed = parseProductPayloadJson(row.payload_json);
    return parsed.identity === null
      ? []
      : [Object.freeze({ product_id: row.product_id, identity: parsed.identity })];
  });
  return Object.freeze(identities);
}

function identityLabel(identity: Readonly<ProductIdentityEvidence>): string {
  const specification = identity.specification === null
    ? ""
    : ` ${identity.specification.value}${identity.specification.unit}`;
  const label = [identity.brand, identity.variant_or_flavor, identity.normalized_name]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" ") + specification;
  const sanitized = label.replace(/[\u0000-\u001F\u007F]/gu, " ").trim().slice(0, 128);
  return sanitized.length === 0 ? "product" : sanitized;
}

function productClarification(
  candidates: readonly Readonly<StoredProductIdentity>[],
): Readonly<ProductIdentityClarification> {
  const keys = ["A", "B", "C", "D"] as const;
  if (candidates.length < 2) throw new Error("CORE_APPLICATION_RESULT_INVALID:clarification_count");
  return Object.freeze({
    kind: "product_identity",
    options: Object.freeze(candidates.slice(0, 4).map((candidate, index) => Object.freeze({
      key: keys[index]!,
      label: identityLabel(candidate.identity),
    }))),
    free_text_allowed: true,
  });
}

function resolvePurchaseItems(
  database: DatabaseSync,
  request: Readonly<CoreApplicationRequest>,
  command: Readonly<CorePurchaseCommandCandidate | CoreInventoryCommandCandidate>,
): PurchaseResolution {
  const stored = storedProductIdentities(database);
  const byId = new Map(stored.map((candidate) => [candidate.product_id, candidate]));
  const resolved: ResolvedCorePurchaseItem[] = [];
  for (const reference of purchaseReferences(command)) {
    const requested = requestedProductIdentity(reference);
    let productId: string;
    let identity: Readonly<ProductIdentityEvidence>;
    if (reference.identity_reference === "deictic") {
      const matches = stored.filter((candidate) =>
        reference.normalized_name === "product" ||
        candidate.identity.normalized_name === reference.normalized_name);
      if (matches.length > 1) {
        return Object.freeze({ status: "needs_clarification", clarification: productClarification(matches) });
      }
      if (matches.length === 1) {
        productId = matches[0]!.product_id;
        identity = matches[0]!.identity;
      } else {
        const resolution = resolveProductIdentity({ requested, candidates: stored });
        if (resolution.status !== "new") {
          throw new Error("CORE_APPLICATION_RESULT_INVALID:deictic_resolution");
        }
        productId = resolution.product_id;
        identity = requested;
      }
    } else if (reference.identity_reference === "same_attributes") {
      const matches = stored.filter((candidate) =>
        candidate.identity.normalized_name === reference.normalized_name &&
        canonicalJson(candidate.identity.specification) === canonicalJson(reference.specification));
      if (matches.length > 1) {
        return Object.freeze({ status: "needs_clarification", clarification: productClarification(matches) });
      }
      if (matches.length === 1) {
        productId = matches[0]!.product_id;
        identity = matches[0]!.identity;
      } else {
        const resolution = resolveProductIdentity({ requested, candidates: stored });
        if (resolution.status === "needs_clarification") {
          const candidates = resolution.candidate_product_ids.map((id) => byId.get(id)!).filter(Boolean);
          return Object.freeze({ status: "needs_clarification", clarification: productClarification(candidates) });
        }
        productId = resolution.product_id;
        identity = resolution.status === "reuse_exact" ? byId.get(productId)!.identity : requested;
      }
    } else {
      const resolution = resolveProductIdentity({ requested, candidates: stored });
      if (resolution.status === "needs_clarification") {
        const candidates = resolution.candidate_product_ids.map((id) => byId.get(id)!).filter(Boolean);
        return Object.freeze({ status: "needs_clarification", clarification: productClarification(candidates) });
      }
      productId = resolution.product_id;
      identity = resolution.status === "reuse_exact" ? byId.get(productId)!.identity : requested;
    }
    const batchKey = createHash("sha256").update(canonicalJson({
      operation_id: request.operation_id,
      item_order: reference.order,
      product_id: productId,
    }), "utf8").digest("hex");
    resolved.push(Object.freeze({
      product_id: productId,
      batch_id: deriveDomainId("batch", batchKey, 0),
      identity,
    }));
  }
  return Object.freeze({ status: "resolved", items: Object.freeze(resolved) });
}

function resolveLocationCorrection(
  database: DatabaseSync,
  authoritySecret: Uint8Array,
  command: Readonly<CoreInventoryLocationCorrectionCandidate>,
): Readonly<
  | { status: "resolved"; resolution: Readonly<ResolvedCoreInventoryLocationCorrection> }
  | { status: "already_current" }
> {
  const rows = database.prepare(
    `SELECT i.batch_id, i.payload_json, b.stocked_at, p.normalized_name
     FROM inventory_batch_projections i
     JOIN inventory_batches b ON b.batch_id = i.batch_id
     JOIN products p ON p.product_id = b.product_id
     WHERE p.normalized_name = ?
     ORDER BY i.batch_id`,
  ).all(command.product_reference) as Array<{
    batch_id: string;
    payload_json: string;
    stocked_at: string;
    normalized_name: string;
  }>;
  const available = rows.flatMap((row) => {
    try {
      const projection = parseProjectionPayloadJson(row.payload_json);
      if (projection.version !== 2 || projection.pantry_evidence === null) return [];
      const revision = assertCurrentInventoryLocationCorrectionLineage(
        database,
        authoritySecret,
        row.batch_id,
        projection.pantry_evidence,
      );
      return [{ row, projection, revision }];
    } catch {
      throw new Error("CORE_APPLICATION_AUTHORITY_INVALID:location_correction_projection");
    }
  });
  const candidates = available.filter(({ projection }) =>
    projection.pantry_evidence!.location.value === command.previous_location);
  if (candidates.length !== 1) {
    if (
      candidates.length === 0 && available.length === 1 &&
      available[0]!.projection.pantry_evidence!.location.value === command.next_location
    ) return Object.freeze({ status: "already_current" as const });
    throw new Error(candidates.length === 0
      ? "CORE_APPLICATION_TARGET_INVALID:location_correction_missing"
      : "CORE_APPLICATION_TARGET_INVALID:location_correction_ambiguous");
  }
  const selected = candidates[0]!;
  return Object.freeze({
    status: "resolved" as const,
    resolution: Object.freeze({
      batch_id: selected.row.batch_id,
      base_revision: selected.revision,
      previous_location: selected.projection.pantry_evidence!.location,
      previous_expiration: selected.projection.pantry_evidence!.expiration,
      expected_expiration: selected.projection.pantry_evidence!.expiration.basis === "explicit"
        ? selected.projection.pantry_evidence!.expiration
        : resolveExpiration({
            reliability: "reliable_rule",
            explicit_at: null,
            duration_days: 7,
            anchor_at: selected.row.stocked_at,
            rule_version: "diet-manager/fresh-milk-shelf-life-v1",
          }),
    }),
  });
}

function recordId(database: DatabaseSync, envelope: DomainEnvelopeInput, operation: DomainOperation): string {
  const rows = database.prepare(`SELECT event_id, event_type, fact_kind, operation_id
    FROM event_records WHERE envelope_id = ? AND operation_id = ?`)
    .all(envelope.envelope_id, operation.operation_id) as Array<{
      event_id: string; event_type: string; fact_kind: string; operation_id: string;
    }>;
  const expected = operation.kind === "record_water"
    ? { event_type: "diet_water", fact_kind: "water" }
    : operation.kind === "add_inventory"
      ? { event_type: "inventory_stock", fact_kind: "inventory" }
      : operation.kind === "correct_record"
        ? "correction_kind" in operation && operation.correction_kind === "inventory_location"
          ? { event_type: "inventory_adjusted", fact_kind: "inventory" }
          : "correction_kind" in operation && operation.correction_kind === "nutrition_supplement"
            ? { event_type: "nutrition_supplemented", fact_kind: "correction" }
            : { event_type: "diet_correction", fact_kind: "correction" }
        : { event_type: "diet_meal", fact_kind: "meal" };
  if (rows.length !== 1 || rows[0]?.operation_id !== operation.operation_id ||
      rows[0]?.event_type !== expected.event_type || rows[0]?.fact_kind !== expected.fact_kind) {
    throw new Error("CORE_APPLICATION_RESULT_INVALID:event_identity");
  }
  return rows[0].event_id;
}

function executeCandidate(
  runtime: CoreRuntime,
  request: Readonly<CoreApplicationRequest>,
  command: CoreCommandCandidate,
  purchaseResolutions: readonly Readonly<ResolvedCorePurchaseItem>[] = Object.freeze([]),
  existingSession?: CoreRuntimeSession,
  correctionResolution?: Readonly<
    ResolvedCoreInventoryLocationCorrection | ResolvedCoreNutritionSupplement
  >,
  nutritionEvidence: readonly Readonly<ResolvedNutritionEvidence>[] = Object.freeze([]),
): { readonly status: "committed" | "committed_with_issues";
    readonly record_id: string; readonly record_ids?: readonly string[] } {
  const envelope = mapCoreCandidateToEnvelope(
    request,
    command,
    purchaseResolutions,
    correctionResolution,
    nutritionEvidence,
  );
  const session = existingSession ?? acquireSession(runtime);
  const preview = session.service.preview(envelope);
  const result = session.service.execute({ envelope, token: preview.token,
    input_digest: preview.input_digest, data_revision: preview.data_revision });
  if (
    envelope.operations.length === 0 || result.items.length !== envelope.operations.length ||
    (result.status !== "committed" && result.status !== "committed_with_issues") ||
    result.items.some((item, index) =>
      item.operation_id !== envelope.operations[index]?.operation_id ||
      (item.status !== "committed" && item.status !== "committed_with_issues"))
  ) {
    throw new Error("CORE_APPLICATION_RESULT_INVALID:terminal");
  }
  const recordIds = Object.freeze(envelope.operations.map((operation) =>
    recordId(session.database, envelope, operation)));
  return Object.freeze({
    status: result.status,
    record_id: recordIds[0]!,
    ...(recordIds.length === 1 ? {} : { record_ids: recordIds }),
  });
}

export function handleCoreRequest(runtime: CoreRuntime, value: CoreApplicationRequest): DietManagerOutcome {
  let request: Readonly<CoreApplicationRequest>;
  try { request = cloneRequest(value); } catch {
    return failedOutcome("record_meal", undefined, "INVALID_REQUEST");
  }
  if (!["record_meal", "record_water", "add_inventory", "correct_record"].includes(request.action)) {
    return failedOutcome(request.action, request.operation_id, "ACTION_NOT_IMPLEMENTED");
  }
  let parsed;
  try {
    const { action: _action, ...parseInput } = request;
    parsed = parseCoreCommand(parseInput);
  } catch {
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
  try {
    if (parsed.command.action === "add_inventory") {
      const session = acquireSession(runtime);
      const resolution = resolvePurchaseItems(session.database, request, parsed.command);
      if (resolution.status === "needs_clarification") {
        return nonWritingOutcome(
          request.action,
          request.operation_id,
          "needs_clarification",
          "product_identity_ambiguous",
          resolution.clarification,
        );
      }
      const result = executeCandidate(runtime, request, parsed.command, resolution.items, session);
      return committedOutcome(
        request.action,
        request.operation_id,
        result.status,
        result.record_id,
        result.record_ids,
      );
    }
    if (parsed.command.action === "correct_record") {
      if (!("correction_kind" in parsed.command)) {
        return failedOutcome(request.action, request.operation_id, "ACTION_NOT_IMPLEMENTED");
      }
      const session = acquireSession(runtime);
      const resolution = resolveLocationCorrection(
        session.database,
        session.authoritySecret,
        parsed.command,
      );
      if (resolution.status === "already_current") {
        return nonWritingOutcome(
          request.action,
          request.operation_id,
          "ignored",
          "location_correction_already_current",
        );
      }
      const result = executeCandidate(
        runtime,
        request,
        parsed.command,
        Object.freeze([]),
        session,
        resolution.resolution,
      );
      return committedOutcome(request.action, request.operation_id, result.status, result.record_id);
    }
    const result = executeCandidate(runtime, request, parsed.command);
    return committedOutcome(request.action, request.operation_id, result.status, result.record_id);
  } catch (error) {
    return failedOutcome(request.action, request.operation_id, sanitizedCode(error));
  }
}

// Public plugin execution is asynchronous so nutrition adapters can be awaited without
// weakening the existing synchronous internal/test compatibility surface.
function nutritionClaimIdentity(request: Readonly<CoreApplicationRequest>): string {
  return canonicalSha256({
    authority_kind: "diet-manager/nutrition-claim-identity/v1",
    operation_id: request.operation_id,
    source_message_id: request.source_message_id,
    conversation_id: request.conversation_id,
  });
}

function nutritionSourceRequest(item: Readonly<{ normalized_name: string; kind: string }>): Readonly<SourceRequest> {
  return freezeNutritionData({
    normalized_food_name: item.normalized_name,
    brand: null,
    variant: null,
    package_specification: null,
    processing_state: null,
    minimum_food_category: item.kind === "nutritious_drink" ? "processed_beverage" : "food",
    locale: "zh-CN",
  });
}

interface NutritionResolutionCommand {
  readonly operation_id: string;
  readonly items: readonly Readonly<{
    readonly normalized_name: string;
    readonly kind: "food" | "nutritious_drink";
    readonly quantity: number | null;
    readonly unit: string | null;
    readonly estimated: boolean | null;
  }>[];
}

interface NutritionSupplementTarget {
  readonly event_id: string;
  readonly item_id: string;
  readonly item_order: number;
  readonly normalized_name: string;
  readonly item_kind: "food" | "nutritious_drink";
  readonly amount: Readonly<KnownStructuredAmount>;
  readonly previous_snapshot_id: string;
  readonly base_revision: number;
  readonly already_current: boolean;
}

function resolveNutritionSupplementTarget(
  database: DatabaseSync,
  targetEventId: string,
  operationId: string,
): Readonly<NutritionSupplementTarget> {
  const rows = database.prepare(
    `SELECT e.event_id, i.item_id, i.item_order, i.item_type, i.normalized_name, i.payload_json
     FROM event_records e JOIN meal_items i ON i.event_id = e.event_id
     WHERE e.event_id = ? AND e.event_type = 'diet_meal'
     ORDER BY i.item_order`,
  ).all(targetEventId) as Array<{
    event_id: string;
    item_id: string;
    item_order: number;
    item_type: string;
    normalized_name: string;
    payload_json: string;
  }>;
  const row = rows[0];
  if (rows.length !== 1 || row === undefined || row.item_order !== 0) {
    throw new Error(rows.length === 0
      ? "NUTRITION_SUPPLEMENT_TARGET_INVALID:missing"
      : "NUTRITION_SUPPLEMENT_TARGET_INVALID:ambiguous_item");
  }
  let itemPayload: unknown;
  try { itemPayload = JSON.parse(row.payload_json) as unknown; } catch {
    throw new Error("NUTRITION_SUPPLEMENT_AUTHORITY_INVALID:item_payload");
  }
  if (
    canonicalJson(itemPayload) !== row.payload_json ||
    typeof itemPayload !== "object" || itemPayload === null || Array.isArray(itemPayload)
  ) throw new Error("NUTRITION_SUPPLEMENT_AUTHORITY_INVALID:item_payload");
  const amount = (itemPayload as Record<string, unknown>).amount;
  if (typeof amount !== "object" || amount === null || Array.isArray(amount)) {
    throw new Error("NUTRITION_SUPPLEMENT_AUTHORITY_INVALID:amount");
  }
  const known = amount as unknown as KnownStructuredAmount;
  if (
    typeof known.unit !== "string" || known.unit.length === 0 ||
    !Number.isSafeInteger(known.observed_microunits) || known.observed_microunits <= 0 ||
    (known.evidence !== "explicit" && known.evidence !== "estimated_upper_bound")
  ) throw new Error("NUTRITION_SUPPLEMENT_TARGET_INVALID:amount");
  const snapshots = database.prepare(
    `SELECT snapshot_id, source_ref, payload_json FROM nutrition_snapshots
     WHERE meal_event_id = ? AND intake_item_id = ? AND schema_version = 'domain/v2'
     ORDER BY rowid`,
  ).all(targetEventId, row.item_id) as Array<{
    snapshot_id: string;
    source_ref: string;
    payload_json: string;
  }>;
  if (snapshots.length === 0) throw new Error("NUTRITION_SUPPLEMENT_TARGET_INVALID:snapshot");
  const existing = database.prepare(
    `SELECT c.correction_id, c.target_event_id, c.base_revision, c.operation,
            b.effect_state, b.result_status
     FROM correction_events c
     JOIN event_records e ON e.operation_id = c.request_id
       AND e.event_type = 'nutrition_supplemented'
     JOIN effect_bundle_commits b
       ON b.envelope_id = e.envelope_id AND b.operation_id = e.operation_id
     WHERE c.request_id = ?`,
  ).get(operationId) as {
    correction_id: string;
    target_event_id: string;
    base_revision: number;
    operation: string;
    effect_state: string;
    result_status: string;
  } | undefined;
  let previousSnapshotId = snapshots.at(-1)!.snapshot_id;
  let revision = (database.prepare(
    "SELECT COUNT(*) AS count FROM correction_events WHERE target_event_id = ?",
  ).get(targetEventId) as { count: number }).count + 1;
  if (existing !== undefined) {
    if (
      existing.target_event_id !== targetEventId ||
      existing.operation !== "change_nutrition_source" ||
      !Number.isSafeInteger(existing.base_revision) || existing.base_revision < 1
    ) throw new Error("NUTRITION_SUPPLEMENT_AUTHORITY_INVALID:existing_fact");
    revision = existing.base_revision;
    if (existing.effect_state === "pending" && existing.result_status === "facts_committed_effects_pending") {
      // The new Snapshot is written atomically with the effect, so the current tail is still the original input.
      previousSnapshotId = snapshots.at(-1)!.snapshot_id;
    } else if (
      (existing.effect_state === "succeeded" && existing.result_status === "applied") ||
      (existing.effect_state === "permanent_business_skip" &&
        existing.result_status === "applied_with_issues")
    ) {
      const appliedIndex = snapshots.findIndex((candidate) => {
        let payload: unknown;
        try { payload = JSON.parse(candidate.payload_json) as unknown; } catch { return false; }
        return canonicalJson(payload) === candidate.payload_json &&
          typeof payload === "object" && payload !== null && !Array.isArray(payload) &&
          (payload as Record<string, unknown>).correction_id === existing.correction_id;
      });
      if (appliedIndex <= 0 || snapshots.some((candidate, index) => index !== appliedIndex && (() => {
        try {
          const payload = JSON.parse(candidate.payload_json) as unknown;
          return typeof payload === "object" && payload !== null && !Array.isArray(payload) &&
            (payload as Record<string, unknown>).correction_id === existing.correction_id;
        } catch { return false; }
      })())) throw new Error("NUTRITION_SUPPLEMENT_AUTHORITY_INVALID:snapshot_chain");
      previousSnapshotId = snapshots[appliedIndex - 1]!.snapshot_id;
    } else {
      throw new Error("NUTRITION_SUPPLEMENT_AUTHORITY_INVALID:effect_state");
    }
  }
  return Object.freeze({
    event_id: row.event_id,
    item_id: row.item_id,
    item_order: row.item_order,
    normalized_name: row.normalized_name,
    item_kind: row.item_type === "nutrition_drink" ? "nutritious_drink" : "food",
    amount: Object.freeze({ ...known }),
    previous_snapshot_id: previousSnapshotId,
    base_revision: revision,
    already_current: existing === undefined && snapshots.at(-1)!.source_ref !== "unknown",
  });
}

async function resolveNutritionMaterial(
  runtime: CoreRuntime,
  request: Readonly<CoreApplicationRequest>,
  command: Readonly<NutritionResolutionCommand>,
  session: CoreRuntimeSession,
): Promise<NutritionPreviewMaterialV6> {
  const state = states.get(runtime);
  if (state === undefined || state.closed) return runtimeInvalid("runtime");
  const baseInputDigest = canonicalSha256({ request, command });
  let flights = nutritionFlights.get(runtime);
  if (flights === undefined) {
    flights = new Map();
    nutritionFlights.set(runtime, flights);
  }
  const active = flights.get(baseInputDigest);
  if (active !== undefined) return active;
  const flight = (async (): Promise<NutritionPreviewMaterialV6> => {
    const identityDigest = nutritionClaimIdentity(request);
    const ownerNonce = randomUUID();
    const startedAt = clockValue(state.now);
    const deadlineMs = state.nutritionConfig.resolution_deadline_ms;
    const deadlineAt = new Date(Date.parse(startedAt) + deadlineMs).toISOString();
    let claim = claimNutritionResolution({
      database: session.database,
      authority_secret: session.authoritySecret,
      envelope_id: `nutrition-resolution-${identityDigest.slice(0, 32).toLowerCase()}`,
      idempotency_key: `nutrition-resolution-${identityDigest}`,
      operation_id: command.operation_id,
      base_input_digest: baseInputDigest,
      source_message_id: request.source_message_id,
      conversation_id: request.conversation_id,
      source_config_digest: state.nutritionConfig.source_config_digest,
      owner_nonce: ownerNonce,
      now: startedAt,
      lease_expires_at: deadlineAt,
    });
    while (claim.kind === "pending") {
      if (Date.now() >= Date.parse(deadlineAt)) throw new Error("NUTRITION_RESOLUTION_PENDING:deadline");
      const retryAfterMs = claim.retry_after_ms;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, retryAfterMs))));
      claim = claimNutritionResolution({
        database: session.database,
        authority_secret: session.authoritySecret,
        envelope_id: `nutrition-resolution-${identityDigest.slice(0, 32).toLowerCase()}`,
        idempotency_key: `nutrition-resolution-${identityDigest}`,
        operation_id: command.operation_id,
        base_input_digest: baseInputDigest,
        source_message_id: request.source_message_id,
        conversation_id: request.conversation_id,
        source_config_digest: state.nutritionConfig.source_config_digest,
        owner_nonce: ownerNonce,
        now: new Date().toISOString(),
        lease_expires_at: new Date(Date.now() + deadlineMs).toISOString(),
      });
    }
    if (claim.kind === "complete") return claim.material;
    const parent = new AbortController();
    const timer = setTimeout(() => parent.abort(new Error("nutrition_deadline")), Math.max(0, Date.parse(deadlineAt) - Date.now()));
    let evidence: readonly Readonly<ResolvedNutritionEvidence>[];
    try {
      const context: SourceContext = Object.freeze({
        signal: parent.signal,
        deadline_at: deadlineAt,
        now: state.now,
        credential: state.nutritionCredential,
      });
      const values: Readonly<ResolvedNutritionEvidence>[] = [];
      for (const item of command.items) {
        const resolved = await resolveNutrition(nutritionSourceRequest(item), context, {
          adapters: state.nutritionAdapters,
          config: state.nutritionConfig,
        });
        values.push(adoptNutritionAmount(item, resolved));
      }
      evidence = Object.freeze(values);
    } finally {
      clearTimeout(timer);
      if (!parent.signal.aborted) parent.abort();
    }
    const material = freezeNutritionData({
      authority_kind: "diet-manager/domain-preview/v6",
      base_input_digest: baseInputDigest,
      resolved_evidence_digest: canonicalSha256(evidence),
      source_config_digest: state.nutritionConfig.source_config_digest,
      operation_id: command.operation_id,
      source_message_id: request.source_message_id,
      conversation_id: request.conversation_id,
      meal_fact_identities: [],
      nutrition_evidence: evidence,
      effect_identities: [],
    }) as NutritionPreviewMaterialV6;
    return completeNutritionResolution({
      database: session.database,
      authority_secret: session.authoritySecret,
      envelope_id: claim.envelope_id,
      owner_nonce: claim.owner_nonce,
      generation: claim.generation,
      material,
      now: clockValue(state.now),
    }).material;
  })();
  flights.set(baseInputDigest, flight);
  try {
    return await flight;
  } finally {
    if (flights.get(baseInputDigest) === flight) flights.delete(baseInputDigest);
  }
}

function storedMealItems(database: DatabaseSync, eventId: string): readonly Readonly<{
  item_id: string;
  normalized_name: string;
}>[] {
  return Object.freeze(database.prepare(`SELECT item_id, normalized_name FROM meal_items
    WHERE event_id = ? ORDER BY item_order`).all(eventId) as unknown as Array<{
      item_id: string;
      normalized_name: string;
    }>);
}

function storedMealReceipt(
  database: DatabaseSync,
  eventId: string,
  nutritionItems: readonly Readonly<NutritionOutcomeItem>[],
): Readonly<MealReceipt> {
  const row = database.prepare(
    `SELECT e.envelope_id,e.payload_json,f.payload_json AS finalization_payload
     FROM event_records e JOIN envelope_finalizations f ON f.envelope_id = e.envelope_id
     WHERE e.event_id = ? AND e.event_type = 'diet_meal'`,
  ).get(eventId) as { envelope_id: string; payload_json: string; finalization_payload: string } | undefined;
  if (row === undefined) throw new Error("CORE_APPLICATION_RECEIPT_INVALID:missing");
  let eventPayload: unknown;
  let finalization: unknown;
  try {
    eventPayload = JSON.parse(row.payload_json);
    finalization = JSON.parse(row.finalization_payload);
  } catch {
    throw new Error("CORE_APPLICATION_RECEIPT_INVALID:json");
  }
  if (canonicalJson(eventPayload) !== row.payload_json || canonicalJson(finalization) !== row.finalization_payload ||
      typeof eventPayload !== "object" || eventPayload === null || Array.isArray(eventPayload) ||
      typeof (eventPayload as Record<string, unknown>).source_text !== "string" ||
      typeof finalization !== "object" || finalization === null || Array.isArray(finalization)) {
    throw new Error("CORE_APPLICATION_RECEIPT_INVALID:authority");
  }
  const executionPayload = (finalization as Record<string, unknown>).payload;
  const receiptData = typeof executionPayload === "object" && executionPayload !== null && !Array.isArray(executionPayload)
    ? (executionPayload as Record<string, unknown>).receipt_data
    : undefined;
  const blocks = typeof receiptData === "object" && receiptData !== null && !Array.isArray(receiptData)
    ? (receiptData as Record<string, unknown>).blocks
    : undefined;
  if (!Array.isArray(blocks)) throw new Error("CORE_APPLICATION_RECEIPT_INVALID:blocks");
  const itemBlocks = blocks.filter((block) => typeof block === "object" && block !== null && !Array.isArray(block) &&
    (block as Record<string, unknown>).kind === "item") as Array<Record<string, unknown>>;
  const storedItems = storedMealItems(database, eventId);
  if (itemBlocks.length !== storedItems.length || nutritionItems.length !== storedItems.length) {
    throw new Error("CORE_APPLICATION_RECEIPT_INVALID:item_count");
  }
  const items = storedItems.map((stored, index) => {
    const block = itemBlocks[index]!;
    const amount = block.amount as Record<string, unknown> | undefined;
    const inventory = block.inventory_effect as Record<string, unknown> | undefined;
    const nutrition = nutritionItems[index]!;
    const observed = amount?.observed_microunits;
    if (block.item_order !== index || block.name !== stored.normalized_name ||
        (observed !== null && (!Number.isSafeInteger(observed) || Number(observed) <= 0)) ||
        typeof amount?.unit !== "string" ||
        !["explicit", "estimated", "unknown"].includes(String(amount.evidence)) ||
        typeof inventory?.status !== "string" || nutrition.item_id !== stored.item_id) {
      throw new Error("CORE_APPLICATION_RECEIPT_INVALID:item");
    }
    return Object.freeze({
      item_id: stored.item_id,
      name: stored.normalized_name,
      quantity: observed === null ? null : Number(observed) / 1_000_000,
      unit: observed === null ? null : amount.unit,
      derived: amount.evidence === "estimated",
      nutrition: Object.freeze({ status: nutrition.coverage_status, source: nutrition.source_label }),
      inventory: Object.freeze({ status: inventory.status as MealReceiptInventoryStatus }),
    });
  });
  return Object.freeze({
    raw_text: (eventPayload as Record<string, unknown>).source_text as string,
    items: Object.freeze(items),
  });
}

async function handleNutritionSupplement(
  runtime: CoreRuntime,
  request: Readonly<CoreApplicationRequest>,
  command: Extract<CoreCommandCandidate, { action: "correct_record"; kind: "nutrition_supplement" }>,
): Promise<DietManagerOutcome> {
  try {
    const session = acquireSession(runtime);
    if (command.target_record_id === null) {
      return nonWritingOutcome(request.action, request.operation_id, "needs_clarification", "target_ambiguous");
    }
    const target = resolveNutritionSupplementTarget(
      session.database,
      command.target_record_id,
      command.operation_id,
    );
    if (target.already_current) {
      return nonWritingOutcome(
        request.action,
        request.operation_id,
        "ignored",
        "nutrition_already_current",
      );
    }
    const resolutionCommand: NutritionResolutionCommand = Object.freeze({
      operation_id: command.operation_id,
      items: Object.freeze([Object.freeze({
        normalized_name: target.normalized_name,
        kind: target.item_kind,
        quantity: target.amount.observed_microunits / 1_000_000,
        unit: target.amount.unit,
        estimated: target.amount.evidence !== "explicit",
      })]),
    });
    const material = await resolveNutritionMaterial(runtime, request, resolutionCommand, session);
    const evidence = material.nutrition_evidence[0];
    if (material.nutrition_evidence.length !== 1 || evidence === undefined) {
      throw new Error("NUTRITION_RESOLUTION_AUTHORITY_INVALID:item_count");
    }
    const source = mapResolvedNutritionEvidenceToDomainSource(evidence);
    const adopted = mapResolvedNutritionAmountMicrounits(evidence);
    if (source === null || adopted === null) {
      return nonWritingOutcome(request.action, request.operation_id, "ignored", "nutrition_still_unknown");
    }
    const correctionResolution: ResolvedCoreNutritionSupplement = Object.freeze({
      target_event_id: target.event_id,
      base_revision: target.base_revision,
      item_order: target.item_order,
      previous_snapshot_id: target.previous_snapshot_id,
      replacement_amount: Object.freeze({
        ...target.amount,
        nutrition_adoption_microunits: adopted,
      }),
      replacement_nutrition_source: source,
      replacement_nutrition_evidence: evidence,
    });
    const execution = executeCandidate(
      runtime,
      request,
      command,
      Object.freeze([]),
      session,
      correctionResolution,
    );
    const supplementEvent = session.database.prepare(
      "SELECT committed_at FROM event_records WHERE event_id = ?",
    ).get(execution.record_id) as { committed_at: string } | undefined;
    if (supplementEvent === undefined) {
      throw new Error("NUTRITION_REPOSITORY_INVALID:supplement_event");
    }
    const records = [buildNutritionRecords({
      operation_id: command.operation_id,
      meal_event_id: target.event_id,
      intake_item_id: target.item_id,
      item_name: target.normalized_name,
      subject_type: evidence.source_type === "product_label" ? "product" : "food",
      subject_id: target.normalized_name,
      created_at: supplementEvent.committed_at,
    }, evidence)];
    try {
      assertNutritionRecordsPersisted(session.database, records);
    } catch {
      return committedOutcome(request.action, request.operation_id, "committed_with_issues", execution.record_id);
    }
    return committedOutcome(
      request.action,
      request.operation_id,
      execution.status,
      execution.record_id,
      undefined,
      [nutritionOutcomeItem(target.normalized_name, records[0]!)],
    );
  } catch (error) {
    return failedOutcome(request.action, request.operation_id, sanitizedCode(error));
  }
}

export async function handleCoreRequestAsync(
  runtime: CoreRuntime,
  value: CoreApplicationRequest,
): Promise<DietManagerOutcome> {
  let request: Readonly<CoreApplicationRequest>;
  try { request = cloneRequest(value); } catch {
    return failedOutcome("record_meal", undefined, "INVALID_REQUEST");
  }
  let parsed;
  try {
    const { action: _action, ...parseInput } = request;
    parsed = parseCoreCommand(parseInput);
  } catch {
    return failedOutcome(request.action, request.operation_id, "INVALID_REQUEST");
  }
  if (
    parsed.disposition === "candidate" && parsed.command.action === "correct_record" &&
    "kind" in parsed.command && parsed.command.kind === "nutrition_supplement"
  ) return handleNutritionSupplement(runtime, request, parsed.command);
  if (request.action !== "record_meal") return handleCoreRequest(runtime, value);
  if (parsed.disposition !== "candidate" || parsed.command.action !== "record_meal") {
    return handleCoreRequest(runtime, value);
  }
  try {
    const session = acquireSession(runtime);
    const material = await resolveNutritionMaterial(runtime, request, parsed.command, session);
    if (material.nutrition_evidence.length !== parsed.command.items.length) {
      throw new Error("NUTRITION_RESOLUTION_AUTHORITY_INVALID:item_count");
    }
    const execution = executeCandidate(
      runtime,
      request,
      parsed.command,
      Object.freeze([]),
      session,
      undefined,
      material.nutrition_evidence,
    );
    const outcome = committedOutcome(
      request.action,
      request.operation_id,
      execution.status,
      execution.record_id,
      execution.record_ids,
    );
    if (!outcome.committed) return outcome;
    const event = session.database.prepare("SELECT committed_at FROM event_records WHERE event_id = ?")
      .get(outcome.record_id) as { committed_at: string } | undefined;
    const storedItems = storedMealItems(session.database, outcome.record_id);
    if (event === undefined || storedItems.length !== parsed.command.items.length) {
      throw new Error("NUTRITION_REPOSITORY_INVALID:meal_identity");
    }
    const records: Readonly<NutritionRecords>[] = parsed.command.items.map((item, index) => {
      const stored = storedItems[index]!;
      if (stored.normalized_name !== item.normalized_name) throw new Error("NUTRITION_REPOSITORY_INVALID:item_name");
      return buildNutritionRecords({
        operation_id: parsed.command.operation_id,
        meal_event_id: outcome.record_id,
        intake_item_id: stored.item_id,
        item_name: stored.normalized_name,
        subject_type: material.nutrition_evidence[index]!.source_type === "product_label" ? "product" : "food",
        subject_id: stored.normalized_name,
        created_at: event.committed_at,
      }, material.nutrition_evidence[index]!);
    });
    try {
      assertNutritionRecordsPersisted(session.database, records);
    } catch {
      return committedOutcome(request.action, request.operation_id, "committed_with_issues", outcome.record_id,
        "record_ids" in outcome ? outcome.record_ids : undefined);
    }
    const nutritionItems = records.map((record, index) =>
      nutritionOutcomeItem(storedItems[index]!.normalized_name, record));
    const receipt = storedMealReceipt(session.database, outcome.record_id, nutritionItems);
    return committedOutcome(request.action, request.operation_id, outcome.status, outcome.record_id,
      "record_ids" in outcome ? outcome.record_ids : undefined,
      nutritionItems,
      receipt);
  } catch (error) {
    return failedOutcome(request.action, request.operation_id, sanitizedCode(error));
  }
}
