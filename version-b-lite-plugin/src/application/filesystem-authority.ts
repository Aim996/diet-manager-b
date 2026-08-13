import { randomBytes, randomUUID } from "node:crypto";
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

import { assertPrivateRuntimeRoot } from "../storage/database.js";

export const CORE_RUNTIME_SECRET_FILENAME = ".diet-manager-b.authority-secret";

interface Identity {
  readonly path: string;
  readonly dev: bigint;
  readonly ino: bigint;
}

export interface RuntimeRootAuthority {
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

export function createRuntimeRootAuthority(value: string): RuntimeRootAuthority {
  const root = assertPrivateRuntimeRoot(value);
  return Object.freeze({ root, chain: ancestorChain(root) });
}

export function assertRuntimeRootAuthority(authority: RuntimeRootAuthority): void {
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

const ACL_SET_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
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
`;

const ACL_AUDIT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath $env:DIET_SECRET_PATH
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
  [pscustomobject]@{ sid = $_.IdentityReference.Value; type = $_.AccessControlType.ToString(); rights = [int]$_.FileSystemRights; inherited = $_.IsInherited }
})
[pscustomobject]@{ owner = $owner; current = $current; protected = $acl.AreAccessRulesProtected; rules = $rules } | ConvertTo-Json -Compress -Depth 4
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

function setPrivateAcl(path: string): void {
  if (process.platform === "win32" && powershell(ACL_SET_SCRIPT, path) !== "") {
    return invalid("secret", "permissions");
  }
}

function auditPrivateAcl(path: string): void {
  if (process.platform !== "win32") return;
  let value: unknown;
  try {
    value = JSON.parse(powershell(ACL_AUDIT_SCRIPT, path));
  } catch {
    return invalid("secret", "permissions");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("secret", "permissions");
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).sort().join("\0") !== "current\0owner\0protected\0rules" ||
    typeof candidate.current !== "string" || candidate.owner !== candidate.current ||
    candidate.protected !== true || !Array.isArray(candidate.rules) || candidate.rules.length !== 3
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
  let descriptor: number | undefined;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    descriptor = openSync(path, constants.O_RDONLY | noFollow);
    const before = fdStat(descriptor);
    validateFileStat(before);
    if (!pathMatchesFd(path, before)) return invalid("secret", "identity");
    auditPrivateAcl(path);
    if (!pathMatchesFd(path, before)) return invalid("secret", "identity");
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

export function loadOrCreateRuntimeSecret(authority: RuntimeRootAuthority): Uint8Array {
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
    candidateIdentity = savedIdentity(candidatePath);
    if (candidateIdentity === undefined) return invalid("secret", "identity");
    const bytes = randomBytes(32);
    let offset = 0;
    while (offset < bytes.length) {
      offset += writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
    }
    fsyncSync(descriptor);
    if (process.platform !== "win32") chmodSync(candidatePath, 0o600);
    const beforeAcl = fdStat(descriptor);
    validateFileStat(beforeAcl);
    if (!pathMatchesFd(candidatePath, beforeAcl)) return invalid("secret", "identity");
    setPrivateAcl(candidatePath);
    const afterAcl = fdStat(descriptor);
    validateFileStat(afterAcl);
    if (
      beforeAcl.dev !== afterAcl.dev || beforeAcl.ino !== afterAcl.ino ||
      !pathMatchesFd(candidatePath, afterAcl)
    ) return invalid("secret", "identity");
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
