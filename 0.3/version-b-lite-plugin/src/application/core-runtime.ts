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
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, parse } from "node:path";
import { isProxy } from "node:util/types";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson, canonicalSha256 } from "../authority/canonical-json.js";
import { dietManagerActions } from "../contracts/actions.js";
import {
  type CoreApplicationRequest,
  type CorrectionOutcomeView,
  type DailyProgressView,
  type DietManagerAction,
  type DietManagerOutcome,
  type InventoryView,
  type MealHistoryView,
  type MealReceipt,
  type MealReceiptInventoryStatus,
  type NutritionOutcomeItem,
  type ProductIdentityClarification,
} from "../contracts.js";
import {
  resolveProductIdentity,
  resolveExpiration,
} from "../domain/inventory-service.js";
import { deriveDomainId, toNaturalDate } from "../domain/identity.js";
import { currentConfiguredGoals, readAppliedCorrectionResult } from "../domain/effect-bundle.js";
import { computeGoalProgressBars, type ConfiguredGoals } from "../domain/goal-derivation.js";
import { readAppliedWaterClassificationResult } from "../domain/water-correction.js";
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
  OffsetIsoTimestamp,
  CorePurchaseCommandCandidate,
  CorePurchaseItemCandidate,
} from "../parser/types.js";
import { cloneSemanticCandidate, cloneSemanticProposalV2 } from "../semantic/candidate.js";
import { validateSemanticMealCandidate } from "../semantic/validate-candidate.js";
import { validateSemanticProposalV2 } from "../semantic/validate-proposal-v2.js";
import { assertPrivateRuntimeRoot } from "../storage/database.js";
import { openDietDatabase, type DietDatabaseRuntime } from "../storage/database.js";
import {
  assertCurrentInventoryLocationCorrectionLineage,
  parseProductPayloadJson,
  parseProjectionPayloadJson,
} from "../storage/inventory-repository.js";
import { listInventoryProjection, listWaterEvents } from "../repository/query.js";
import {
  readEffectiveMealState,
  resolveCorrectionTarget,
  resolveWaterCorrectionTarget,
  type ResolvedCorrectionTarget,
} from "../repository/correction-target.js";
import { normalizeMealLexeme } from "../parser/meal.js";
import {
  createPendingCandidate,
  consumePendingCandidate,
  listOpenPendingCandidates,
  readLatestPendingCandidateForConversation,
  transitionPendingCandidate,
  updatePendingCandidate,
  type PendingCandidate,
} from "../repository/pending-candidate-repository.js";
import { readInventoryQuantityModel } from "../repository/inventory-quantity-repository.js";
import {
  availableInventoryMicrounits,
  createInventoryQuantityFromPackageEvidence,
  inventoryQuantityBalance,
} from "../domain/inventory-quantity.js";
import {
  clonePendingCandidateDraft,
  createPendingCandidateDraft,
  isPendingReplyText,
  mergePendingCandidateReply,
  minimalClarificationQuestion,
  type PendingCandidateDraft,
} from "../semantic/pending-candidate.js";
import {
  mapResolvedNutritionAmountMicrounits,
  mapResolvedNutritionEvidenceToDomainSource,
  mapCoreCandidateToEnvelope,
  mapUndoCandidateToEnvelope,
  mapRestoreCandidateToEnvelope,
  type ResolvedCoreInventoryLocationCorrection,
  type ResolvedCoreMealAmountCorrection,
  type ResolvedCoreMealTimeCorrection,
  type ResolvedCoreNutritionSupplement,
  type ResolvedCorePurchaseItem,
  type ResolvedCoreWaterClassification,
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

// Windows environment names are case-insensitive, but spreading process.env yields
// a case-sensitive object: `{ ...process.env, PSModulePath: x }` leaves a
// pre-existing PSMODULEPATH entry in place and the child resolves that one instead.
// Drop every case-insensitive match before applying our own values.
function childEnvironment(overrides: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const reserved = new Set(Object.keys(overrides).map((key) => key.toUpperCase()));
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!reserved.has(key.toUpperCase())) env[key] = value;
  }
  return Object.assign(env, overrides);
}

// The ACL audit pins PSModulePath to Windows PowerShell's own system modules:
// an inherited path lets PowerShell 7's Core-only Microsoft.PowerShell.Security
// win command discovery, so Get-Acl and Set-Acl fail to autoload entirely.
function powershell(script: string, path: string): string {
  const systemRoot = process.env.SystemRoot;
  if (typeof systemRoot !== "string" || systemRoot.length === 0) return invalid("secret", "permissions");
  const shellHome = join(systemRoot, "System32", "WindowsPowerShell", "v1.0");
  const executable = join(shellHome, "powershell.exe");
  const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: childEnvironment({ PSModulePath: join(shellHome, "Modules"), DIET_SECRET_PATH: path }),
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

function writeAuthoritySecretFile(
  authority: RuntimeRootAuthority,
  bytes: Uint8Array,
  replace: boolean,
): void {
  assertRuntimeRootAuthority(authority);
  if (bytes.length !== 32) return invalid("secret", "length");
  const finalPath = join(authority.root, CORE_RUNTIME_SECRET_FILENAME);
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
    let offset = 0;
    while (offset < bytes.length) {
      offset += writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
    }
    fsyncSync(descriptor);
    const beforeAcl = fdStat(descriptor);
    validateFileStat(beforeAcl);
    if (!pathMatchesFd(candidatePath, beforeAcl)) return invalid("secret", "identity");
    assertRuntimeRootAuthority(authority);
    closeSync(descriptor);
    descriptor = undefined;
    if (replace) {
      renameSync(candidatePath, finalPath);
      candidateIdentity = undefined;
    } else {
      try {
        linkSync(candidatePath, finalPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
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
}

function loadOrCreateRuntimeSecret(authority: RuntimeRootAuthority): Uint8Array {
  assertRuntimeRootAuthority(authority);
  const finalPath = join(authority.root, CORE_RUNTIME_SECRET_FILENAME);
  try {
    return readSecret(finalPath, authority);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  writeAuthoritySecretFile(authority, randomBytes(32), false);
  assertRuntimeRootAuthority(authority);
  return readSecret(finalPath, authority);
}

// 便携灾备恢复：把已解密的 32 字节 authority secret 写入目标根，复用 core-runtime 的
// 独占 ACL/身份保护，确保恢复后的根能被 readSecret 重新打开。
export function installAuthoritySecret(root: string, bytes: Uint8Array): void {
  if (bytes.length !== 32) return invalid("secret", "length");
  const authority = createRuntimeRootAuthority(root);
  writeAuthoritySecretFile(authority, Uint8Array.from(bytes), true);
  assertRuntimeRootAuthority(authority);
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
const SEMANTIC_CANDIDATE_FIELD = "semantic_candidate" as const;
const SEMANTIC_PROPOSAL_FIELD = "semantic_proposal" as const;

function requestInvalid(reason: string): never {
  throw new TypeError(`CORE_APPLICATION_REQUEST_INVALID:${reason}`);
}

function cloneRequest(value: unknown): Readonly<CoreApplicationRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return requestInvalid("shape");
  const keys = Reflect.ownKeys(value);
  const hasSemanticCandidate = keys.includes(SEMANTIC_CANDIDATE_FIELD);
  const hasSemanticProposal = keys.includes(SEMANTIC_PROPOSAL_FIELD);
  if (hasSemanticCandidate && hasSemanticProposal) return requestInvalid("semantic_fields");
  const expectedLength = REQUEST_FIELDS.length + (hasSemanticCandidate || hasSemanticProposal ? 1 : 0);
  if (keys.length !== expectedLength || keys.some((key) => typeof key !== "string") ||
      REQUEST_FIELDS.some((key) => !keys.includes(key))) return requestInvalid("keys");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const optionalField = hasSemanticCandidate
    ? SEMANTIC_CANDIDATE_FIELD
    : hasSemanticProposal
      ? SEMANTIC_PROPOSAL_FIELD
      : null;
  for (const key of optionalField === null ? REQUEST_FIELDS : [...REQUEST_FIELDS, optionalField]) {
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
  const ordinary = JSON.parse(canonicalJson(parseInput)) as Omit<
    CoreApplicationRequest,
    "action" | "semantic_candidate" | "semantic_proposal"
  >;
  if (!hasSemanticCandidate && !hasSemanticProposal) {
    return Object.freeze({ action: action as DietManagerAction, ...ordinary });
  }
  if (hasSemanticProposal) {
    const semanticProposal = cloneSemanticProposalV2(
      descriptors.semantic_proposal.value,
      action as DietManagerAction,
      ordinary.source_text,
    );
    return Object.freeze({
      action: action as DietManagerAction,
      ...ordinary,
      semantic_proposal: semanticProposal,
    });
  }
  const semanticCandidate = cloneSemanticCandidate(descriptors.semantic_candidate.value);
  return Object.freeze({
    action: action as DietManagerAction,
    ...ordinary,
    semantic_candidate: semanticCandidate,
  });
}

function parseApplicationRequest(request: Readonly<CoreApplicationRequest>) {
  if (request.semantic_proposal !== undefined) {
    return validateSemanticProposalV2({
      semantic_proposal: request.semantic_proposal,
      action: request.action,
      source_text: request.source_text,
      received_at: request.received_at as OffsetIsoTimestamp,
      timezone: request.timezone,
      operation_id: request.operation_id,
      source_message_id: request.source_message_id,
      conversation_id: request.conversation_id,
      prior_context: request.prior_context,
    });
  }
  if (request.semantic_candidate === undefined) {
    const {
      action: _action,
      semantic_candidate: _candidate,
      semantic_proposal: _proposal,
      ...parseInput
    } = request;
    return parseCoreCommand(parseInput);
  }
  return validateSemanticMealCandidate({
    candidate: request.semantic_candidate,
    action: request.action,
    source_text: request.source_text,
    received_at: request.received_at as OffsetIsoTimestamp,
    timezone: request.timezone,
    operation_id: request.operation_id,
  });
}

const PENDING_CANDIDATE_TTL_MS = 5 * 60 * 1_000;

type PendingRequestPreparation =
  | Readonly<{ readonly kind: "request"; readonly request: Readonly<CoreApplicationRequest> }>
  | Readonly<{ readonly kind: "outcome"; readonly outcome: DietManagerOutcome }>;

function pendingCandidateIdentity(request: Readonly<CoreApplicationRequest>): Readonly<{
  readonly candidate_id: string;
  readonly idempotency_key: string;
}> {
  const digest = createHash("sha256")
    .update("diet-manager/pending-candidate/v1\n", "ascii")
    .update(request.conversation_id, "utf8").update("\0", "ascii")
    .update(request.source_message_id, "utf8").digest("hex");
  return Object.freeze({
    candidate_id: `pending-${digest.slice(0, 32)}`,
    idempotency_key: `pending-${digest}`,
  });
}

function pendingTimestamp(value: string): string {
  return new Date(value).toISOString();
}

function pendingStatusOutcome(
  request: Readonly<CoreApplicationRequest>,
  reasonCode: string,
  status: "ignored" | "needs_clarification" = "ignored",
  question?: string,
  pendingCandidate?: Readonly<{
    readonly missing_field: string;
    readonly expires_at: string;
    readonly revision: number;
  }>,
): DietManagerOutcome {
  return nonWritingOutcome(
    request.action,
    request.operation_id,
    status,
    reasonCode,
    undefined,
    undefined,
    undefined,
    undefined,
    question,
    undefined,
    pendingCandidate,
  );
}

function latestPendingStatusOutcome(
  request: Readonly<CoreApplicationRequest>,
  latest: Readonly<PendingCandidate> | undefined,
): DietManagerOutcome {
  if (latest === undefined) return pendingStatusOutcome(request, "pending_candidate_not_found");
  if (latest.status === "expired") return pendingStatusOutcome(request, "pending_candidate_expired");
  if (latest.status === "cancelled") return pendingStatusOutcome(request, "pending_candidate_cancelled");
  if (latest.status === "consumed") return pendingStatusOutcome(request, "pending_candidate_consumed");
  return pendingStatusOutcome(
    request,
    "pending_candidate_ambiguous",
    "needs_clarification",
    "存在多个待补充记录，请把要记录的内容完整说一遍。",
  );
}

function persistPendingClarification(
  runtime: CoreRuntime,
  request: Readonly<CoreApplicationRequest>,
  reasonCode: string,
): DietManagerOutcome | null {
  if (request.semantic_proposal === undefined) return null;
  const createdAt = pendingTimestamp(request.received_at);
  const expiresAt = new Date(Date.parse(createdAt) + PENDING_CANDIDATE_TTL_MS).toISOString();
  const draft = createPendingCandidateDraft({
    action: request.action,
    source_text: request.source_text,
    proposal: request.semantic_proposal,
    created_at: createdAt,
    expires_at: expiresAt,
  });
  if (draft.missing_fields.length !== 1) return null;
  const identity = pendingCandidateIdentity(request);
  const session = acquireSession(runtime);
  const candidate = createPendingCandidate(session.database, {
    ...identity,
    conversation_id: request.conversation_id,
    action: request.action,
    original_proposal: draft,
    current_proposal: draft,
    missing_fields: draft.missing_fields,
    created_at: draft.created_at,
    expires_at: draft.expires_at,
  });
  if (candidate.status !== "open") return latestPendingStatusOutcome(request, candidate);
  return pendingStatusOutcome(
    request,
    reasonCode,
    "needs_clarification",
    minimalClarificationQuestion(draft),
    Object.freeze({
      missing_field: draft.missing_fields[0]!,
      expires_at: candidate.expires_at,
      revision: candidate.revision,
    }),
  );
}

function updateStoredPendingDraft(
  database: DatabaseSync,
  candidate: Readonly<PendingCandidate>,
  draft: Readonly<PendingCandidateDraft>,
): Readonly<PendingCandidate> {
  return updatePendingCandidate(database, {
    candidate_id: candidate.candidate_id,
    expected_revision: candidate.revision,
    current_proposal: draft,
    missing_fields: draft.missing_fields,
    expires_at: draft.expires_at,
  });
}

function preparePendingReply(
  runtime: CoreRuntime,
  request: Readonly<CoreApplicationRequest>,
): PendingRequestPreparation {
  if (request.semantic_candidate !== undefined || request.semantic_proposal !== undefined ||
      !["record_meal", "record_water", "set_profile"].includes(request.action) ||
      !isPendingReplyText(request.source_text)) {
    return Object.freeze({ kind: "request" as const, request });
  }
  const session = acquireSession(runtime);
  const now = pendingTimestamp(request.received_at);
  const open = listOpenPendingCandidates(session.database, request.conversation_id, now);
  if (open.length === 0) {
    return Object.freeze({
      kind: "outcome" as const,
      outcome: latestPendingStatusOutcome(
        request,
        readLatestPendingCandidateForConversation(session.database, request.conversation_id),
      ),
    });
  }
  if (open.length !== 1) {
    return Object.freeze({
      kind: "outcome" as const,
      outcome: pendingStatusOutcome(
        request,
        "pending_candidate_ambiguous",
        "needs_clarification",
        "存在多个待补充记录，请把要记录的内容完整说一遍。",
      ),
    });
  }
  let candidate = open[0]!;
  if (candidate.action !== request.action) {
    return Object.freeze({
      kind: "outcome" as const,
      outcome: pendingStatusOutcome(
        request,
        "pending_candidate_action_mismatch",
        "needs_clarification",
        "这条回复与待补充记录的类型不一致，请把完整内容重新说一遍。",
      ),
    });
  }
  let draft: Readonly<PendingCandidateDraft>;
  try {
    draft = clonePendingCandidateDraft(candidate.current_proposal);
  } catch {
    return Object.freeze({
      kind: "outcome" as const,
      outcome: failedOutcome(request.action, request.operation_id, "PENDING_CANDIDATE_INVALID"),
    });
  }
  if (canonicalJson(candidate.missing_fields) !== canonicalJson(draft.missing_fields)) {
    return Object.freeze({
      kind: "outcome" as const,
      outcome: failedOutcome(request.action, request.operation_id, "PENDING_CANDIDATE_INVALID"),
    });
  }
  const merged = mergePendingCandidateReply(draft, request.source_text, now);
  if (merged.disposition === "expired") {
    transitionPendingCandidate(session.database, {
      candidate_id: candidate.candidate_id,
      expected_revision: candidate.revision,
      status: "expired",
      transitioned_at: now,
    });
    return Object.freeze({
      kind: "outcome" as const,
      outcome: pendingStatusOutcome(request, "pending_candidate_expired"),
    });
  }
  if (merged.disposition === "cancelled") {
    transitionPendingCandidate(session.database, {
      candidate_id: candidate.candidate_id,
      expected_revision: candidate.revision,
      status: "cancelled",
      transitioned_at: now,
    });
    return Object.freeze({
      kind: "outcome" as const,
      outcome: pendingStatusOutcome(request, "pending_candidate_cancelled"),
    });
  }
  if (merged.disposition === "still_missing") {
    candidate = updateStoredPendingDraft(session.database, candidate, merged.draft);
    return Object.freeze({
      kind: "outcome" as const,
      outcome: pendingStatusOutcome(
        request,
        "pending_candidate_still_missing",
        "needs_clarification",
        minimalClarificationQuestion(merged.draft),
        Object.freeze({
          missing_field: merged.draft.missing_fields[0]!,
          expires_at: candidate.expires_at,
          revision: candidate.revision,
        }),
      ),
    });
  }
  if (merged.disposition === "exhausted") {
    candidate = updateStoredPendingDraft(session.database, candidate, merged.draft);
    transitionPendingCandidate(session.database, {
      candidate_id: candidate.candidate_id,
      expected_revision: candidate.revision,
      status: "cancelled",
      transitioned_at: now,
    });
    return Object.freeze({
      kind: "outcome" as const,
      outcome: pendingStatusOutcome(request, "pending_candidate_exhausted"),
    });
  }
  consumePendingCandidate(session.database, {
    candidate_id: candidate.candidate_id,
    expected_revision: candidate.revision,
    current_proposal: merged.draft,
    missing_fields: merged.draft.missing_fields,
    expires_at: merged.draft.expires_at,
    consumed_at: now,
  });
  return Object.freeze({
    kind: "request" as const,
    request: Object.freeze({
      ...request,
      source_text: merged.draft.source_text,
      semantic_proposal: merged.draft.proposal,
    }),
  });
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

function locationCorrectionClarification(
  candidates: readonly Readonly<{ row: { readonly batch_id: string } }>[],
): Readonly<ProductIdentityClarification> {
  const keys = ["A", "B", "C", "D"] as const;
  return Object.freeze({
    kind: "product_identity",
    options: Object.freeze(candidates.slice(0, 4).map((candidate, index) => Object.freeze({
      key: keys[index]!,
      label: `批次 ${candidate.row.batch_id}`,
    }))),
    free_text_allowed: true,
  });
}

function resolveLocationCorrection(
  database: DatabaseSync,
  authoritySecret: Uint8Array,
  command: Readonly<CoreInventoryLocationCorrectionCandidate>,
): Readonly<
  | { status: "resolved"; resolution: Readonly<ResolvedCoreInventoryLocationCorrection> }
  | { status: "already_current" }
  | { status: "needs_clarification"; clarification: ProductIdentityClarification }
> {
  const referenceColumn = command.batch_reference.kind === "batch_id"
    ? "i.batch_id"
    : "p.normalized_name";
  const referenceValue = command.batch_reference.kind === "batch_id"
    ? command.batch_reference.batch_id
    : command.product_reference;
  const rows = database.prepare(
    `SELECT i.batch_id, i.payload_json, b.stocked_at, p.normalized_name
     FROM inventory_batch_projections i
     JOIN inventory_batches b ON b.batch_id = i.batch_id
     JOIN products p ON p.product_id = b.product_id
     WHERE ${referenceColumn} = ?
     ORDER BY i.batch_id`,
  ).all(referenceValue) as Array<{
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
  if (candidates.length === 1) {
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
  if (candidates.length > 1) {
    return Object.freeze({
      status: "needs_clarification" as const,
      clarification: locationCorrectionClarification(candidates),
    });
  }
  if (
    available.length === 1 &&
    available[0]!.projection.pantry_evidence!.location.value === command.next_location
  ) {
    return Object.freeze({ status: "already_current" as const });
  }
  throw new Error("CORE_APPLICATION_TARGET_INVALID:location_correction_missing");
}

function resolveMealCorrection(
  database: DatabaseSync,
  authoritySecret: Uint8Array,
  target: Readonly<ResolvedCorrectionTarget>,
  command: Extract<CoreCommandCandidate, {
    action: "correct_record";
    correction_kind: "meal_amount" | "meal_time";
  }>,
): Readonly<ResolvedCoreMealAmountCorrection | ResolvedCoreMealTimeCorrection> {
  if (command.correction_kind === "meal_time") {
    return Object.freeze({
      target_event_id: target.target_event_id,
      base_revision: target.base_revision,
    });
  }
  const normalizedName = normalizeMealLexeme(command.target_item_text);
  if (normalizedName === null) {
    throw new Error("MEAL_CORRECTION_TARGET_INVALID:item_missing");
  }
  const state = readEffectiveMealState(database, authoritySecret, target.target_event_id);
  const matches = state.snapshot.items.filter((item) => item.normalized_name === normalizedName);
  if (matches.length !== 1) {
    throw new Error(matches.length === 0
      ? "MEAL_CORRECTION_TARGET_INVALID:item_missing"
      : "MEAL_CORRECTION_TARGET_INVALID:item_ambiguous");
  }
  const item = matches[0]!;
  const newObserved = Math.round(command.replacement_quantity * 1_000_000);
  const previousObserved = item.amount.observed_microunits;
  const scale = previousObserved !== null && previousObserved > 0
    ? newObserved / previousObserved
    : null;
  const newAdoption = scale === null || item.amount.nutrition_adoption_microunits === null
    ? null
    : Math.round(item.amount.nutrition_adoption_microunits * scale);
  const newDeduction = scale === null || item.amount.inventory_deduction_microunits === null
    ? null
    : Math.round(item.amount.inventory_deduction_microunits * scale);
  return Object.freeze({
    target_event_id: target.target_event_id,
    base_revision: target.base_revision,
    item_order: item.item_order,
    replacement_amount: Object.freeze({
      unit: command.replacement_unit,
      observed_microunits: newObserved,
      nutrition_adoption_microunits: newAdoption,
      inventory_deduction_microunits: newDeduction,
      template_reference_microunits: null,
      evidence: "explicit" as const,
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
        : operation.kind === "undo_record" || operation.kind === "restore_record"
          ? { event_type: "diet_correction", fact_kind: "correction" }
          : operation.kind === "set_profile"
            ? { event_type: "diet_profile", fact_kind: "profile" }
            : operation.kind === "set_goal"
              ? { event_type: "diet_goal", fact_kind: "goal" }
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

function readDailyProgress(
  session: CoreRuntimeSession,
  request: Readonly<CoreApplicationRequest>,
): Readonly<DailyProgressView> {
  const date = toNaturalDate(new Date(request.received_at).toISOString(), "Asia/Shanghai");
  const summary = session.service.query(Object.freeze({
    kind: "query_daily_summary" as const,
    operation_id: request.operation_id,
    date,
    timezone: "Asia/Shanghai" as const,
  }));
  const meals = session.service.query(Object.freeze({
    kind: "query_meals" as const,
    operation_id: request.operation_id,
    date,
    timezone: "Asia/Shanghai" as const,
  }));
  if (summary.kind !== "daily_summary" || meals.kind !== "meals") {
    throw new Error("CORE_APPLICATION_QUERY_INVALID:kind");
  }
  const water = listWaterEvents({
    database: session.database,
    authoritySecret: session.authoritySecret,
    date,
    timezone: "Asia/Shanghai",
  });
  // Authenticate every current Pantry lineage before exposing aggregate inventory counters.
  listInventoryProjection({ database: session.database, authoritySecret: session.authoritySecret });
  const start = new Date(`${date}T00:00:00.000+08:00`).toISOString();
  const end = new Date(Date.parse(start) + 86_400_000).toISOString();
  const count = (sql: string): number => {
    const row = session.database.prepare(sql).get(start, end) as { count: number };
    if (!Number.isSafeInteger(row.count) || row.count < 0) throw new Error("CORE_APPLICATION_QUERY_INVALID:count");
    return row.count;
  };
  const deductionCount = count(
    `SELECT COUNT(*) AS count FROM inventory_transactions t
     JOIN event_records e ON e.event_id = t.event_id
     WHERE t.direction = 'out' AND t.reason_code = 'meal_consumption'
       AND e.lifecycle_status = 'active' AND e.occurred_at_text >= ? AND e.occurred_at_text < ?`,
  );
  const purchaseCount = count(
    `SELECT COUNT(*) AS count FROM event_records
     WHERE event_type = 'inventory_stock' AND lifecycle_status = 'active'
       AND COALESCE(occurred_at_text, received_at) >= ? AND COALESCE(occurred_at_text, received_at) < ?`,
  );
  const correctionCount = count(
    `SELECT COUNT(*) AS count FROM event_records
     WHERE event_type IN ('diet_correction','nutrition_supplemented','inventory_adjusted')
       AND lifecycle_status = 'active'
       AND COALESCE(occurred_at_text, received_at) >= ? AND COALESCE(occurred_at_text, received_at) < ?`,
  );
  const waterTotal = water.reduce((sum, item) => sum + item.plain_water_ml_milli, 0);
  if (!Number.isSafeInteger(waterTotal)) throw new Error("CORE_APPLICATION_QUERY_INVALID:water_sum");
  const configuredGoals: ConfiguredGoals = currentConfiguredGoals(session.database, "user:self");
  const nutrients = summary.nutrients;
  const current = Object.freeze({
    energy_kcal: nutrients.energy_kcal_milli === null ? 0 : nutrients.energy_kcal_milli / 1_000,
    protein_g: nutrients.protein_mg === null ? 0 : nutrients.protein_mg / 1_000,
    fat_g: nutrients.fat_mg === null ? 0 : nutrients.fat_mg / 1_000,
    carbohydrate_g: nutrients.carbohydrate_mg === null ? 0 : nutrients.carbohydrate_mg / 1_000,
    fiber_g: nutrients.fiber_mg === null ? 0 : nutrients.fiber_mg / 1_000,
    water_ml: nutrients.water_ml_milli === null ? 0 : nutrients.water_ml_milli / 1_000,
  });
  const configured_goals = Object.freeze({
    energy_kcal: configuredGoals.energy_kcal,
    protein_g: configuredGoals.protein_g,
    fat_g: configuredGoals.fat_g,
    carbohydrate_g: configuredGoals.carbohydrate_g,
    fiber_g: configuredGoals.fiber_g,
    water_ml: configuredGoals.water_ml,
  });
  const progress = computeGoalProgressBars(configuredGoals, current);
  return Object.freeze({
    date,
    timezone: "Asia/Shanghai" as const,
    meals: Object.freeze({ count: meals.meals.length }),
    water: Object.freeze({ count: water.length, plain_water_ml_milli: waterTotal }),
    nutrition: Object.freeze({
      coverage_status: summary.coverage_status,
      nutrients: Object.freeze({ ...summary.nutrients }),
    }),
    inventory: Object.freeze({ deduction_count: deductionCount }),
    purchases: Object.freeze({ count: purchaseCount }),
    corrections: Object.freeze({ count: correctionCount }),
    configured_goals,
    progress,
  });
}

function readMealHistory(
  session: CoreRuntimeSession,
  request: Readonly<CoreApplicationRequest>,
): Readonly<MealHistoryView> {
  const date = toNaturalDate(new Date(request.received_at).toISOString(), "Asia/Shanghai");
  const result = session.service.query(Object.freeze({
    kind: "query_meals" as const,
    operation_id: request.operation_id,
    date,
    timezone: "Asia/Shanghai" as const,
  }));
  if (result.kind !== "meals") throw new Error("CORE_APPLICATION_QUERY_INVALID:kind");
  return Object.freeze({
    date,
    timezone: "Asia/Shanghai" as const,
    meals: Object.freeze(result.meals.map((meal) => Object.freeze({
      occurred_at: meal.occurred_at,
      meal_slot: meal.meal_slot,
      location: meal.location,
      audit_ref: Object.freeze({ ...meal.audit_ref }),
      items: Object.freeze(meal.items.map((item) => {
        const amount = item.amount;
        const observed = amount.observed_microunits;
        const unit = amount.unit;
        const evidence = amount.evidence;
        if ((observed !== null && (!Number.isSafeInteger(observed) || Number(observed) <= 0)) ||
            typeof unit !== "string" ||
            !["explicit", "estimated_upper_bound", "unknown"].includes(String(evidence)) ||
            (observed === null) !== (evidence === "unknown")) {
          throw new Error("CORE_APPLICATION_QUERY_INVALID:meal_amount");
        }
        return Object.freeze({
          item_order: item.item_order,
          item_type: item.item_type,
          name: item.normalized_name,
          quantity_microunits: observed as number | null,
          unit,
          quantity_evidence: evidence as "explicit" | "estimated_upper_bound" | "unknown",
        });
      })),
    }))),
  });
}

function readInventoryView(
  session: CoreRuntimeSession,
  request: Readonly<CoreApplicationRequest>,
): Readonly<InventoryView> {
  const result = session.service.query(Object.freeze({
    kind: "query_inventory" as const,
    operation_id: request.operation_id,
  }));
  if (result.kind !== "inventory") throw new Error("CORE_APPLICATION_QUERY_INVALID:kind");
  return Object.freeze({
    batches: Object.freeze(result.batches.map((batch) => {
      const model = readInventoryQuantityModel(session.database, batch.batch_id);
      let quantityBalance;
      if (model !== undefined) {
        const expected = batch.pantry_evidence === undefined ? null :
          createInventoryQuantityFromPackageEvidence(batch.pantry_evidence.package_quantity);
        if (expected === null || expected.package_unit !== model.package_unit ||
            expected.original_package_microunits !== model.original_package_microunits ||
            expected.per_package_base_microunits !== model.per_package_base_microunits ||
            expected.base_unit !== model.base_unit || expected.conversion_source !== model.conversion_source) {
          throw new Error("CORE_APPLICATION_QUERY_INVALID:inventory_quantity_model");
        }
        const quantity = Object.freeze({
          package_unit: model.package_unit,
          original_package_microunits: model.original_package_microunits,
          per_package_base_microunits: model.per_package_base_microunits,
          base_unit: model.base_unit,
          remaining_base_microunits: model.remaining_base_microunits,
          conversion_source: model.conversion_source,
        });
        const derived = inventoryQuantityBalance(quantity);
        const packageMilliunits = model.remaining_base_microunits === null
          ? batch.quantity_microunits === null
            ? model.original_package_microunits
            : (() => {
                if (batch.unit !== model.package_unit || batch.quantity_microunits % 1_000 !== 0) {
                  throw new Error("CORE_APPLICATION_QUERY_INVALID:inventory_quantity_projection");
                }
                return batch.quantity_microunits / 1_000;
              })()
          : derived.package_milliunits;
        if (model.remaining_base_microunits !== null) {
          const expectedProjection = batch.quantity_microunits === null
            ? null
            : availableInventoryMicrounits(quantity, batch.unit);
          if (expectedProjection === null || expectedProjection !== batch.quantity_microunits) {
            throw new Error("CORE_APPLICATION_QUERY_INVALID:inventory_quantity_projection");
          }
        }
        quantityBalance = Object.freeze({
          ...derived,
          package_milliunits: packageMilliunits,
          whole_packages: Math.floor(packageMilliunits / 1_000),
          revision: model.revision,
        });
      }
      return Object.freeze({
      batch_id: batch.batch_id,
      product_id: batch.product_id,
      name: batch.normalized_name,
      product_type: batch.product_type,
      quantity_microunits: batch.quantity_microunits,
      unit: batch.unit,
      quantity_status: batch.quantity_status,
      effective_status: batch.effective_status,
      expiration_at: batch.effective_expiration_at ?? null,
      location: batch.pantry_evidence?.location.value ?? "unknown",
      ...(quantityBalance === undefined ? {} : { quantity_balance: quantityBalance }),
    });
    })),
  });
}

export function handleCoreRequest(runtime: CoreRuntime, value: CoreApplicationRequest): DietManagerOutcome {
  let request: Readonly<CoreApplicationRequest>;
  try { request = cloneRequest(value); } catch {
    return failedOutcome("record_meal", undefined, "INVALID_REQUEST");
  }
  try {
    const prepared = preparePendingReply(runtime, request);
    if (prepared.kind === "outcome") return prepared.outcome;
    request = prepared.request;
  } catch (error) {
    return failedOutcome(request.action, request.operation_id, sanitizedCode(error));
  }
  let parsed: ReturnType<typeof parseApplicationRequest> | undefined;
  if (request.semantic_candidate !== undefined || request.semantic_proposal !== undefined) {
    try {
      parsed = parseApplicationRequest(request);
    } catch {
      return failedOutcome(request.action, request.operation_id, "INVALID_REQUEST");
    }
    if (parsed.disposition === "rejected") {
      return failedOutcome(request.action, request.operation_id, parsed.error_code);
    }
  }
  if (request.action === "query_daily_summary" || request.action === "query_meals" ||
      request.action === "query_inventory") {
    try {
      const session = acquireSession(runtime);
      const progress = request.action === "query_daily_summary" ? readDailyProgress(session, request) : undefined;
      const meals = request.action === "query_meals" ? readMealHistory(session, request) : undefined;
      const inventory = request.action === "query_inventory" ? readInventoryView(session, request) : undefined;
      return nonWritingOutcome(
        request.action,
        request.operation_id,
        "ignored",
        "read_only_result",
        undefined,
        progress,
        meals,
        inventory,
      );
    } catch (error) {
      return failedOutcome(request.action, request.operation_id, sanitizedCode(error));
    }
  }
  if (!["record_meal", "record_water", "add_inventory", "correct_record", "undo_record", "restore_record", "set_profile", "set_goal"].includes(request.action)) {
    return failedOutcome(request.action, request.operation_id, "ACTION_NOT_IMPLEMENTED");
  }
  if (parsed === undefined) {
    try {
      parsed = parseApplicationRequest(request);
    } catch {
      return failedOutcome(request.action, request.operation_id, "INVALID_REQUEST");
    }
  }
  if (parsed.disposition === "rejected") {
    return failedOutcome(request.action, request.operation_id, parsed.error_code);
  }
  if (parsed.disposition !== "candidate") {
    if (parsed.action !== request.action) {
      return failedOutcome(request.action, request.operation_id, "ACTION_CONFLICT");
    }
    if (parsed.disposition === "needs_clarification") {
      try {
        const pending = persistPendingClarification(runtime, request, parsed.reason_code);
        if (pending !== null) return pending;
      } catch (error) {
        return failedOutcome(request.action, request.operation_id, sanitizedCode(error));
      }
    }
    return nonWritingOutcome(
      request.action,
      request.operation_id,
      parsed.disposition,
      parsed.reason_code,
      undefined,
      undefined,
      undefined,
      undefined,
      parsed.disposition === "needs_clarification" ? parsed.question : undefined,
      parsed.disposition === "needs_clarification" && "missing_items" in parsed
        ? parsed.missing_items
        : undefined,
    );
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
      if (parsed.command.correction_kind === "inventory_location") {
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
        if (resolution.status === "needs_clarification") {
          return nonWritingOutcome(
            request.action,
            request.operation_id,
            "needs_clarification",
            "location_correction_ambiguous",
            resolution.clarification,
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
      if (parsed.command.correction_kind === "water_classification") {
        const resolvedTarget = resolveWaterCorrectionTarget({
          database: session.database,
          authoritySecret: session.authoritySecret,
          conversationId: request.conversation_id,
          reference: parsed.command.target,
        });
        if (!resolvedTarget.active) {
          return nonWritingOutcome(
            request.action,
            request.operation_id,
            "ignored",
            "already_voided",
          );
        }
        const correctionResolution: ResolvedCoreWaterClassification = Object.freeze({
          target_event_id: resolvedTarget.target_event_id,
          base_revision: resolvedTarget.base_revision,
        });
        const envelope = mapCoreCandidateToEnvelope(
          request,
          parsed.command,
          Object.freeze([]),
          correctionResolution,
        );
        const preview = session.service.preview(envelope);
        let result;
        try {
          result = session.service.execute({
            envelope,
            token: preview.token,
            input_digest: preview.input_digest,
            data_revision: preview.data_revision,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (
            message.startsWith("CORRECTION_TARGET_INVALID:stale_revision") ||
            message.startsWith("PREVIEW_STALE:data_revision")
          ) {
            return failedOutcome(request.action, request.operation_id, "correction_conflict");
          }
          throw error;
        }
        if (
          envelope.operations.length !== 1 ||
          result.items.length !== 1 ||
          (result.status !== "committed" && result.status !== "committed_with_issues") ||
          result.items[0]?.operation_id !== envelope.operations[0]?.operation_id ||
          (result.items[0]?.status !== "committed" && result.items[0]?.status !== "committed_with_issues")
        ) {
          throw new Error("CORE_APPLICATION_RESULT_INVALID:terminal");
        }
        const correctionResult = readAppliedWaterClassificationResult({
          database: session.database,
          envelopeId: envelope.envelope_id,
          operationId: parsed.command.operation_id,
          operationSequence: 0,
          idempotencyKey: envelope.idempotency_key,
        });
        const correctionView: CorrectionOutcomeView = {
          correction_id: correctionResult.correction_id,
          target_event_id: correctionResult.target_event_id,
          revision: correctionResult.revision,
          operation: "change_water_classification",
          current_active: true,
          compensation_transaction_id: correctionResult.compensation_transaction_id,
        };
        return committedOutcome(
          request.action,
          request.operation_id,
          correctionResult.status,
          recordId(session.database, envelope, envelope.operations[0]!),
          undefined,
          undefined,
          undefined,
          correctionView,
        );
      }
      const resolvedTarget = resolveCorrectionTarget({
        database: session.database,
        authoritySecret: session.authoritySecret,
        conversationId: request.conversation_id,
        reference: parsed.command.target,
      });
      if (!resolvedTarget.active) {
        return nonWritingOutcome(
          request.action,
          request.operation_id,
          "ignored",
          "already_voided",
        );
      }
      const correctionResolution = resolveMealCorrection(
        session.database,
        session.authoritySecret,
        resolvedTarget,
        parsed.command,
      );
      const envelope = mapCoreCandidateToEnvelope(
        request,
        parsed.command,
        Object.freeze([]),
        correctionResolution,
      );
      const preview = session.service.preview(envelope);
      let result;
      try {
        result = session.service.execute({
          envelope,
          token: preview.token,
          input_digest: preview.input_digest,
          data_revision: preview.data_revision,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (
          message.startsWith("CORRECTION_TARGET_INVALID:stale_revision") ||
          message.startsWith("PREVIEW_STALE:data_revision")
        ) {
          return failedOutcome(request.action, request.operation_id, "correction_conflict");
        }
        throw error;
      }
      if (
        envelope.operations.length !== 1 ||
        result.items.length !== 1 ||
        (result.status !== "committed" && result.status !== "committed_with_issues") ||
        result.items[0]?.operation_id !== envelope.operations[0]?.operation_id ||
        (result.items[0]?.status !== "committed" && result.items[0]?.status !== "committed_with_issues")
      ) {
        throw new Error("CORE_APPLICATION_RESULT_INVALID:terminal");
      }
      const correctionResult = readAppliedCorrectionResult({
        database: session.database,
        envelopeId: envelope.envelope_id,
        operationId: parsed.command.operation_id,
        operationSequence: 0,
        idempotencyKey: envelope.idempotency_key,
      });
      const correctionView: CorrectionOutcomeView = {
        correction_id: correctionResult.correction_id,
        target_event_id: correctionResult.target_event_id,
        revision: correctionResult.revision,
        operation: parsed.command.correction_kind === "meal_amount" ? "change_amount" : "change_time",
        current_active: true,
        compensation_transaction_id: correctionResult.compensation_transaction_id,
      };
      return committedOutcome(
        request.action,
        request.operation_id,
        correctionResult.status,
        recordId(session.database, envelope, envelope.operations[0]!),
        undefined,
        undefined,
        undefined,
        correctionView,
      );
    }
    if (parsed.command.action === "undo_record") {
      const session = acquireSession(runtime);
      let resolvedTarget;
      try {
        resolvedTarget = resolveCorrectionTarget({
          database: session.database,
          authoritySecret: session.authoritySecret,
          conversationId: request.conversation_id,
          reference: parsed.command.target,
        });
      } catch (error) {
        if (
          parsed.command.target.kind === "sole_active_meal_in_conversation" &&
          error instanceof Error &&
          error.message === "CORRECTION_TARGET_AMBIGUOUS"
        ) {
          return nonWritingOutcome(
            request.action,
            request.operation_id,
            "needs_clarification",
            "target_ambiguous",
            undefined,
            undefined,
            undefined,
            undefined,
            "同一会话里有多条有效饮食记录，请说明要撤销哪一条。",
          );
        }
        throw error;
      }
      if (!resolvedTarget.active) {
        return nonWritingOutcome(
          request.action,
          request.operation_id,
          "ignored",
          "already_voided",
        );
      }
      const envelope = mapUndoCandidateToEnvelope(
        request,
        parsed.command,
        resolvedTarget.target_event_id,
        resolvedTarget.base_revision,
      );
      const preview = session.service.preview(envelope);
      let result;
      try {
        result = session.service.execute({
          envelope,
          token: preview.token,
          input_digest: preview.input_digest,
          data_revision: preview.data_revision,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (
          message.startsWith("CORRECTION_TARGET_INVALID:stale_revision") ||
          message.startsWith("PREVIEW_STALE:data_revision")
        ) {
          const rechecked = resolveCorrectionTarget({
            database: session.database,
            authoritySecret: session.authoritySecret,
            conversationId: request.conversation_id,
            reference: parsed.command.target,
          });
          if (!rechecked.active) {
            return nonWritingOutcome(
              request.action,
              request.operation_id,
              "ignored",
              "already_voided",
            );
          }
          return failedOutcome(request.action, request.operation_id, "correction_conflict");
        }
        throw error;
      }
      if (
        envelope.operations.length !== 1 ||
        result.items.length !== 1 ||
        (result.status !== "committed" && result.status !== "committed_with_issues") ||
        result.items[0]?.operation_id !== envelope.operations[0]?.operation_id ||
        (result.items[0]?.status !== "committed" && result.items[0]?.status !== "committed_with_issues")
      ) {
        throw new Error("CORE_APPLICATION_RESULT_INVALID:terminal");
      }
      const correctionResult = readAppliedCorrectionResult({
        database: session.database,
        envelopeId: envelope.envelope_id,
        operationId: parsed.command.operation_id,
        operationSequence: 0,
        idempotencyKey: envelope.idempotency_key,
      });
      const correctionView: CorrectionOutcomeView = {
        correction_id: correctionResult.correction_id,
        target_event_id: correctionResult.target_event_id,
        revision: correctionResult.revision,
        operation: "void_event",
        current_active: false,
        compensation_transaction_id: correctionResult.compensation_transaction_id,
      };
      return committedOutcome(
        request.action,
        request.operation_id,
        correctionResult.status,
        recordId(session.database, envelope, envelope.operations[0]!),
        undefined,
        undefined,
        undefined,
        correctionView,
      );
    }
    if (parsed.command.action === "restore_record") {
      const session = acquireSession(runtime);
      const resolvedTarget = resolveCorrectionTarget({
        database: session.database,
        authoritySecret: session.authoritySecret,
        conversationId: request.conversation_id,
        reference: parsed.command.target,
      });
      if (resolvedTarget.active) {
        return nonWritingOutcome(
          request.action,
          request.operation_id,
          "ignored",
          "already_active",
        );
      }
      const envelope = mapRestoreCandidateToEnvelope(
        request,
        parsed.command,
        resolvedTarget.target_event_id,
        resolvedTarget.base_revision,
      );
      const preview = session.service.preview(envelope);
      let result;
      try {
        result = session.service.execute({
          envelope,
          token: preview.token,
          input_digest: preview.input_digest,
          data_revision: preview.data_revision,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (
          message.startsWith("CORRECTION_TARGET_INVALID:stale_revision") ||
          message.startsWith("PREVIEW_STALE:data_revision")
        ) {
          const rechecked = resolveCorrectionTarget({
            database: session.database,
            authoritySecret: session.authoritySecret,
            conversationId: request.conversation_id,
            reference: parsed.command.target,
          });
          if (rechecked.active) {
            return nonWritingOutcome(
              request.action,
              request.operation_id,
              "ignored",
              "already_active",
            );
          }
          return failedOutcome(request.action, request.operation_id, "correction_conflict");
        }
        throw error;
      }
      if (
        envelope.operations.length !== 1 ||
        result.items.length !== 1 ||
        (result.status !== "committed" && result.status !== "committed_with_issues") ||
        result.items[0]?.operation_id !== envelope.operations[0]?.operation_id ||
        (result.items[0]?.status !== "committed" && result.items[0]?.status !== "committed_with_issues")
      ) {
        throw new Error("CORE_APPLICATION_RESULT_INVALID:terminal");
      }
      const correctionResult = readAppliedCorrectionResult({
        database: session.database,
        envelopeId: envelope.envelope_id,
        operationId: parsed.command.operation_id,
        operationSequence: 0,
        idempotencyKey: envelope.idempotency_key,
      });
      const correctionView: CorrectionOutcomeView = {
        correction_id: correctionResult.correction_id,
        target_event_id: correctionResult.target_event_id,
        revision: correctionResult.revision,
        operation: "restore_event",
        current_active: true,
        compensation_transaction_id: correctionResult.compensation_transaction_id,
      };
      return committedOutcome(
        request.action,
        request.operation_id,
        correctionResult.status,
        recordId(session.database, envelope, envelope.operations[0]!),
        undefined,
        undefined,
        undefined,
        correctionView,
      );
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
  payload_json: string;
}>[] {
  return Object.freeze(database.prepare(`SELECT item_id, normalized_name, payload_json FROM meal_items
    WHERE event_id = ? ORDER BY item_order`).all(eventId) as unknown as Array<{
      item_id: string;
      normalized_name: string;
      payload_json: string;
    }>);
}

function inventoryReceiptMessage(status: MealReceiptInventoryStatus, shortageMicrounits: number | null): string {
  if (status === "matched") return shortageMicrounits !== null && shortageMicrounits > 0
    ? "库存不足，已扣减现有量"
    : "库存已扣减";
  if (status === "skipped_insufficient") return "未匹配有效库存";
  if (status === "skipped_unit_incompatible") return "库存单位无法可靠换算";
  if (status === "skipped_ambiguous") return "存在多个库存候选，未自动扣减";
  if (status === "skipped_outside") return "未联动家庭库存";
  if (status === "skipped_by_user") return "已按要求不扣库存";
  return "数量不明确，未扣库存";
}

function storedMealReceipt(
  database: DatabaseSync,
  eventId: string,
  nutritionItems: readonly Readonly<NutritionOutcomeItem>[],
): Readonly<MealReceipt> {
  const row = database.prepare(
    `SELECT e.envelope_id,e.payload_json,f.payload_json AS finalization_payload,c.idempotency_key
     FROM event_records e JOIN envelope_finalizations f ON f.envelope_id = e.envelope_id
     JOIN command_envelopes c ON c.envelope_id = e.envelope_id
     WHERE e.event_id = ? AND e.event_type = 'diet_meal'`,
  ).get(eventId) as {
    envelope_id: string; payload_json: string; finalization_payload: string; idempotency_key: string;
  } | undefined;
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
    let itemPayload: unknown;
    try { itemPayload = JSON.parse(stored.payload_json); } catch {
      throw new Error("CORE_APPLICATION_RECEIPT_INVALID:item_payload");
    }
    if (canonicalJson(itemPayload) !== stored.payload_json || typeof itemPayload !== "object" ||
        itemPayload === null || Array.isArray(itemPayload) ||
        typeof (itemPayload as Record<string, unknown>).amount !== "object" ||
        (itemPayload as Record<string, unknown>).amount === null) {
      throw new Error("CORE_APPLICATION_RECEIPT_INVALID:item_payload");
    }
    const storedAmount = (itemPayload as Record<string, unknown>).amount as Record<string, unknown>;
    const requestedDeduction = storedAmount.inventory_deduction_microunits;
    if (requestedDeduction !== null &&
        (!Number.isSafeInteger(requestedDeduction) || Number(requestedDeduction) < 0)) {
      throw new Error("CORE_APPLICATION_RECEIPT_INVALID:item_amount");
    }
    const effectId = deriveDomainId("effect", row.idempotency_key, index * 10);
    const transactionRows = database.prepare(
      `SELECT unit,payload_json FROM inventory_transactions
       WHERE event_id = ? AND idempotency_key = ? AND direction = 'out'
         AND reason_code = 'meal_consumption' AND lifecycle_status = 'active'
       ORDER BY transaction_id`,
    ).all(eventId, effectId) as Array<{ unit: string; payload_json: string }>;
    let deductedMicrounits = 0;
    for (const transaction of transactionRows) {
      let payload: unknown;
      try { payload = JSON.parse(transaction.payload_json); } catch {
        throw new Error("CORE_APPLICATION_RECEIPT_INVALID:inventory_transaction");
      }
      if (canonicalJson(payload) !== transaction.payload_json || typeof payload !== "object" ||
          payload === null || Array.isArray(payload)) {
        throw new Error("CORE_APPLICATION_RECEIPT_INVALID:inventory_transaction");
      }
      const delta = (payload as Record<string, unknown>).quantity_delta_microunits;
      if (!Number.isSafeInteger(delta) || Number(delta) >= 0 || transaction.unit !== amount.unit) {
        throw new Error("CORE_APPLICATION_RECEIPT_INVALID:inventory_transaction");
      }
      deductedMicrounits += -Number(delta);
      if (!Number.isSafeInteger(deductedMicrounits)) {
        throw new Error("CORE_APPLICATION_RECEIPT_INVALID:inventory_transaction");
      }
    }
    const shortageMicrounits = requestedDeduction === null
      ? null
      : Math.max(0, Number(requestedDeduction) - deductedMicrounits);
    const inventoryStatus = inventory.status as MealReceiptInventoryStatus;
    return Object.freeze({
      item_id: stored.item_id,
      name: stored.normalized_name,
      quantity: observed === null ? null : Number(observed) / 1_000_000,
      unit: observed === null ? null : amount.unit,
      derived: amount.evidence === "estimated",
      nutrition: Object.freeze({ status: nutrition.coverage_status, source: nutrition.source_label }),
      inventory: Object.freeze({
        status: inventoryStatus,
        deducted_quantity: deductedMicrounits / 1_000_000,
        deducted_unit: deductedMicrounits === 0 ? null : amount.unit,
        shortage_quantity: shortageMicrounits === null ? null : shortageMicrounits / 1_000_000,
        message: inventoryReceiptMessage(inventoryStatus, shortageMicrounits),
      }),
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
  try {
    const prepared = preparePendingReply(runtime, request);
    if (prepared.kind === "outcome") return prepared.outcome;
    request = prepared.request;
  } catch (error) {
    return failedOutcome(request.action, request.operation_id, sanitizedCode(error));
  }
  let parsed;
  try {
    parsed = parseApplicationRequest(request);
  } catch {
    return failedOutcome(request.action, request.operation_id, "INVALID_REQUEST");
  }
  if (parsed.disposition === "rejected") {
    return failedOutcome(request.action, request.operation_id, parsed.error_code);
  }
  if (parsed.disposition === "needs_clarification") {
    try {
      const pending = persistPendingClarification(runtime, request, parsed.reason_code);
      if (pending !== null) return pending;
    } catch (error) {
      return failedOutcome(request.action, request.operation_id, sanitizedCode(error));
    }
  }
  if (
    parsed.disposition === "candidate" && parsed.command.action === "correct_record" &&
    "kind" in parsed.command && parsed.command.kind === "nutrition_supplement"
  ) return handleNutritionSupplement(runtime, request, parsed.command);
  if (request.action !== "record_meal") return handleCoreRequest(runtime, request);
  if (parsed.disposition !== "candidate" || parsed.command.action !== "record_meal") {
    return handleCoreRequest(runtime, request);
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
