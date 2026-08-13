import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TASK_ID = 'SEL-PANTRY-001';
const OFFICIAL_SUFFIX = `official-manifest-sentinel\\${TASK_ID}`;
const ISOLATED_SUFFIX = `isolated-test-roots\\${TASK_ID}`;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPROVED_OFFICIAL_ROOT = path.join(PROJECT_ROOT, '.tmp', 'official-manifest-sentinel', TASK_ID);
const APPROVED_ISOLATED_BASE = path.join(PROJECT_ROOT, '.tmp', 'isolated-test-roots', TASK_ID);
const FORBIDDEN_OFFICIAL_LEAVES = new Set([
  'diet-manager-b.sqlite3', 'diet-manager-b.sqlite3-wal', 'diet-manager-b.sqlite3-shm',
  'secret', 'secret.json', 'secrets', 'state', 'state.json',
]);
const NATIVE_POWERSHELL = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const NATIVE_TIMEOUT_MS = 10_000;
const NATIVE_MAX_BYTES = 64 * 1024;

function fail(code) {
  throw new Error(`SEL_PANTRY_ROOT_${code}`);
}

function nativeScript(lines) {
  return lines.join('\n');
}

const NATIVE_TYPES = nativeScript([
  'Add-Type -TypeDefinition @"',
  'using System; using System.Runtime.InteropServices;',
  'public static class PantryNative {',
  '[StructLayout(LayoutKind.Sequential)] public struct INFO { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation; public System.Runtime.InteropServices.ComTypes.FILETIME Access; public System.Runtime.InteropServices.ComTypes.FILETIME Write; public uint Volume; public uint SizeHigh; public uint SizeLow; public uint Links; public uint IndexHigh; public uint IndexLow; }',
  '[StructLayout(LayoutKind.Sequential)] public struct DISPOSITION { public byte DeleteFile; }',
  '[DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateFileW(string name,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);',
  '[DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool GetFileInformationByHandle(IntPtr h,out INFO info);',
  '[DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool SetFileInformationByHandle(IntPtr h,int klass,ref DISPOSITION info,uint size);',
  '[DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool CloseHandle(IntPtr h);',
  '}',
  '"@',
  '$read=[uint32]0x80; $delete=[uint32]0x10000; $shareRead=[uint32]1; $open=[uint32]3; $flags=[uint32]0x02200000; $invalid=[IntPtr](-1)',
  'function OpenNative([string]$p,[bool]$deleteAccess) { $access=$read; if($deleteAccess){$access=$access -bor $delete}; $h=[PantryNative]::CreateFileW($p,$access,$shareRead,[IntPtr]::Zero,$open,$flags,[IntPtr]::Zero); if($h -eq $invalid){throw ("OPEN="+$p+":"+[Runtime.InteropServices.Marshal]::GetLastWin32Error())}; return $h }',
  'function NativeId([IntPtr]$h) { $i=New-Object PantryNative+INFO; if(-not [PantryNative]::GetFileInformationByHandle($h,[ref]$i)){throw ("INFO="+[Runtime.InteropServices.Marshal]::GetLastWin32Error())}; return ("$($i.Volume):$($i.IndexHigh):$($i.IndexLow)") }',
]);

function encodeNative(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function spawnNative(script, env, label, stdin = 'STOP\n') {
  if (process.platform !== 'win32') return Promise.reject(new Error(`SEL_PANTRY_ROOT_NATIVE_PLATFORM:${process.platform}`));
  return new Promise((resolve, reject) => {
    const child = spawn(NATIVE_POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeNative(script)], {
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`SEL_PANTRY_ROOT_NATIVE_TIMEOUT:${label}`)); }, NATIVE_TIMEOUT_MS);
    const append = (target, chunk) => {
      const value = target + chunk.toString('utf8');
      if (Buffer.byteLength(value, 'utf8') > NATIVE_MAX_BYTES) {
        child.kill();
        reject(new Error(`SEL_PANTRY_ROOT_NATIVE_MAX_BUFFER:${label}`));
      }
      return value;
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`SEL_PANTRY_ROOT_NATIVE_EXIT:${label}:${code}:${stderr.trim()}`));
      else resolve(stdout.trim());
    });
    child.stdin.end(stdin);
  });
}

async function nativeIdentity(file) {
  const output = await spawnNative(nativeScript([
    '$ErrorActionPreference="Stop"', NATIVE_TYPES,
    '$h=[IntPtr]::Zero',
    'try { $h=OpenNative $env:SEL_PANTRY_NATIVE_PATH $false; [Console]::Out.WriteLine("IDENTITY|$(NativeId $h)") } finally { if($h -ne [IntPtr]::Zero){[PantryNative]::CloseHandle($h)|Out-Null} }',
  ]), { SEL_PANTRY_NATIVE_PATH: file }, 'identity', '');
  const match = output.match(/^IDENTITY\|(.+)$/m);
  if (!match) fail('NATIVE_IDENTITY');
  return match[1];
}

async function nativeCleanup({ base, child, marker, baseId, childId, markerId }) {
  const output = await spawnNative(nativeScript([
    '$ErrorActionPreference="Stop"', NATIVE_TYPES,
    '$base=[IntPtr]::Zero; $child=[IntPtr]::Zero; $marker=[IntPtr]::Zero',
    'try {',
    '$base=OpenNative $env:SEL_PANTRY_NATIVE_BASE $false; if((NativeId $base) -ne $env:SEL_PANTRY_NATIVE_BASE_ID){throw "MISMATCH_BASE"}',
    '$child=OpenNative $env:SEL_PANTRY_NATIVE_CHILD $true; if((NativeId $child) -ne $env:SEL_PANTRY_NATIVE_CHILD_ID){throw "MISMATCH_CHILD"}',
    '$marker=OpenNative $env:SEL_PANTRY_NATIVE_MARKER $true; if((NativeId $marker) -ne $env:SEL_PANTRY_NATIVE_MARKER_ID){throw "MISMATCH_MARKER"}',
    '$d=New-Object PantryNative+DISPOSITION; $d.DeleteFile=1; if(-not [PantryNative]::SetFileInformationByHandle($marker,4,[ref]$d,1)){throw ("DELETE_MARKER="+[Runtime.InteropServices.Marshal]::GetLastWin32Error())}; [PantryNative]::CloseHandle($marker)|Out-Null; $marker=[IntPtr]::Zero;',
    'if(-not [PantryNative]::SetFileInformationByHandle($child,4,[ref]$d,1)){throw ("DELETE_CHILD="+[Runtime.InteropServices.Marshal]::GetLastWin32Error())}; [PantryNative]::CloseHandle($child)|Out-Null; $child=[IntPtr]::Zero; [Console]::Out.WriteLine("CLEANUP|PASS")',
    '} catch { [Console]::Out.WriteLine("CLEANUP|FAIL|$($_.Exception.Message)"); exit 0 } finally { if($marker -ne [IntPtr]::Zero){[PantryNative]::CloseHandle($marker)|Out-Null}; if($child -ne [IntPtr]::Zero){[PantryNative]::CloseHandle($child)|Out-Null}; if($base -ne [IntPtr]::Zero){[PantryNative]::CloseHandle($base)|Out-Null} }',
  ]), {
    SEL_PANTRY_NATIVE_BASE: base, SEL_PANTRY_NATIVE_CHILD: child, SEL_PANTRY_NATIVE_MARKER: marker,
    SEL_PANTRY_NATIVE_BASE_ID: baseId, SEL_PANTRY_NATIVE_CHILD_ID: childId, SEL_PANTRY_NATIVE_MARKER_ID: markerId,
  }, 'cleanup', '');
  if (output !== 'CLEANUP|PASS') fail(`ISOLATED_NATIVE_CLEANUP:${output}`);
}

async function startOfficialGuard(root, hookEnv = {}) {
  const script = nativeScript([
    '$ErrorActionPreference="Stop"', NATIVE_TYPES,
    '$root=$env:SEL_PANTRY_NATIVE_ROOT; $paths=@(); $p=[IO.Path]::GetFullPath($root); while($true){if(Test-Path -LiteralPath $p){$paths+=,$p};$parent=[IO.Directory]::GetParent($p);if($null -eq $parent){break};$p=$parent.FullName}; [array]::Reverse($paths); $handles=@(); $ids=@(); $watcher=$null',
    'try { foreach($entry in $paths){$h=OpenNative $entry $false;$handles+=,$h;$ids+=,(NativeId $h)}; $watcher=New-Object IO.FileSystemWatcher $root; $watcher.IncludeSubdirectories=$true; $watcher.NotifyFilter=[IO.NotifyFilters]::FileName -bor [IO.NotifyFilters]::DirectoryName -bor [IO.NotifyFilters]::LastWrite -bor [IO.NotifyFilters]::Size -bor [IO.NotifyFilters]::Security; $watcher.EnableRaisingEvents=$true; foreach($kind in @("Changed","Created","Deleted","Renamed","Error")){Register-ObjectEvent -InputObject $watcher -EventName $kind -SourceIdentifier ("sel-pantry-native-"+$kind)|Out-Null}; [Console]::Out.WriteLine("READY|$($ids -join ",")"); [Console]::Out.Flush(); $null=[Console]::In.ReadLine(); Start-Sleep -Milliseconds 100; $events=@(Get-Event|Where-Object{$_.SourceIdentifier -like "sel-pantry-native-*"}); $errs=@($events|Where-Object{$_.SourceIdentifier -eq "sel-pantry-native-Error"}); $after=@();foreach($h in $handles){$after+=,(NativeId $h)}; $forced=($env:SEL_PANTRY_NATIVE_FORCE_ERROR -eq "1") -or ($env:SEL_PANTRY_NATIVE_FORCE_OVERFLOW -eq "1"); $changed=($events.Count -gt 0) -or $forced; $hasError=($errs.Count -gt 0) -or $forced; [Console]::Out.WriteLine("STATUS|changed=$changed|error=$hasError|ids_exact=$([string]($ids -join ",") -eq [string]($after -join ","))"); [Console]::Out.Flush() } catch { [Console]::Out.WriteLine("STATUS|changed=true|error=true|ids_exact=false|message=$($_.Exception.Message)"); [Console]::Out.Flush() } finally { if($watcher){$watcher.EnableRaisingEvents=$false;$watcher.Dispose()};foreach($h in $handles){[PantryNative]::CloseHandle($h)|Out-Null} }',
  ]);
  if (process.platform !== 'win32') fail(`NATIVE_PLATFORM:${process.platform}`);
  const child = spawn(NATIVE_POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeNative(script)], {
    shell: false, windowsHide: true, env: { ...process.env, SEL_PANTRY_NATIVE_ROOT: root, ...hookEnv }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let resolved = false;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('SEL_PANTRY_ROOT_NATIVE_READY_TIMEOUT')); }, NATIVE_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout, 'utf8') > NATIVE_MAX_BYTES) { child.kill(); reject(new Error('SEL_PANTRY_ROOT_NATIVE_MAX_BUFFER:guard')); }
      if (!resolved && stdout.includes('READY|')) { resolved = true; clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('exit', (code) => { if (!resolved) reject(new Error(`SEL_PANTRY_ROOT_NATIVE_READY_EXIT:${code}:${stderr.trim()}`)); });
  });
  await ready;
  return {
    async stop() {
      return new Promise((resolve, reject) => {
        child.once('exit', (code) => {
          if (code !== 0) { reject(new Error(`SEL_PANTRY_ROOT_NATIVE_GUARD_EXIT:${code}:${stderr.trim()}`)); return; }
          const status = stdout.match(/STATUS\|changed=(True|False)\|error=(True|False)\|ids_exact=(True|False)/);
          if (!status) { reject(new Error(`SEL_PANTRY_ROOT_NATIVE_GUARD_STATUS:${stdout.trim()}`)); return; }
          resolve({ changed: status[1] === 'True', error: status[2] === 'True', idsExact: status[3] === 'True' });
        });
        child.stdin.end('STOP\n');
      });
    },
  };
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--official-manifest-root', '--isolated-root-base'].includes(key)) fail('ARGUMENT');
    const value = argv[index + 1];
    if (!value || value.startsWith('--') || values.has(key)) fail('ARGUMENT');
    values.set(key, value);
    index += 1;
  }
  return { officialRoot: values.get('--official-manifest-root'), isolatedBase: values.get('--isolated-root-base') };
}

function windowsPath(value) {
  return value.replaceAll('/', '\\');
}

function identity(stats) {
  return `${stats.dev}:${stats.ino}`;
}

function sameIdentity(left, right) {
  return identity(left) === identity(right);
}

function maybeLstat(file) {
  try {
    return fs.lstatSync(file, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function lstatOrdinary(file, code) {
  const stats = fs.lstatSync(file, { bigint: true });
  // On Windows, lstat identifies both symbolic links and junction reparse points.
  if (stats.isSymbolicLink()) fail(`${code}_REPARSE`);
  return stats;
}

function captureExistingAncestors(target, role) {
  const windows = windowsPath(target);
  const parsed = path.win32.parse(windows);
  let current = parsed.root;
  const captured = [];
  for (const piece of windows.slice(parsed.root.length).split('\\').filter(Boolean)) {
    current = path.win32.join(current, piece);
    if (!maybeLstat(current)) continue;
    const stats = lstatOrdinary(current, role);
    if (!stats.isDirectory()) fail(`${role}_NOT_DIRECTORY`);
    captured.push({ file: current, stats });
  }
  return captured;
}

function captureRoot(role, root, suffix) {
  if (typeof root !== 'string' || !path.win32.isAbsolute(root)) fail(`${role}_NOT_ABSOLUTE`);
  if (!windowsPath(root).endsWith(suffix)) fail(`${role}_SUFFIX`);
  const approved = role === 'OFFICIAL' ? APPROVED_OFFICIAL_ROOT : APPROVED_ISOLATED_BASE;
  if (path.resolve(root).toLowerCase() !== path.resolve(approved).toLowerCase()) fail(`${role}_BINDING`);
  const ancestors = captureExistingAncestors(root, role);
  const rootRecord = ancestors.at(-1);
  if (!rootRecord || path.resolve(rootRecord.file).toLowerCase() !== path.resolve(root).toLowerCase()) fail(`${role}_MISSING`);
  return { role, root, stats: rootRecord.stats, ancestors };
}

function assertAuthority(authority) {
  for (const record of authority.ancestors) {
    const actual = lstatOrdinary(record.file, authority.role);
    if (!actual.isDirectory() || !sameIdentity(record.stats, actual)) fail(`${authority.role}_PATH_REPLACED`);
  }
}

function guardOfficialLeaf(relativePath) {
  const leaf = path.win32.basename(windowsPath(relativePath)).toLowerCase();
  if (FORBIDDEN_OFFICIAL_LEAVES.has(leaf)) fail(`OFFICIAL_FORBIDDEN_LEAF:${leaf}`);
}

function readBoundFile(file, expected) {
  const pathBefore = lstatOrdinary(file, 'OFFICIAL_ENTRY');
  if (!pathBefore.isFile() || !sameIdentity(pathBefore, expected)) fail('OFFICIAL_FILE_REPLACED');
  const descriptor = fs.openSync(file, 'r');
  try {
    const fdBefore = fs.fstatSync(descriptor, { bigint: true });
    if (!fdBefore.isFile() || !sameIdentity(pathBefore, fdBefore)) fail('OFFICIAL_FILE_REPLACED');
    const bytes = fs.readFileSync(descriptor);
    const fdAfter = fs.fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatOrdinary(file, 'OFFICIAL_ENTRY');
    if (!sameIdentity(fdBefore, fdAfter) || !sameIdentity(pathBefore, pathAfter)) fail('OFFICIAL_FILE_REPLACED');
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function snapshotOfficial(root, authority) {
  const files = [];
  function visit(directory, relative = '') {
    assertAuthority(authority);
    const before = lstatOrdinary(directory, 'OFFICIAL_DIRECTORY');
    if (!before.isDirectory()) fail('OFFICIAL_DIRECTORY_REPLACED');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relativePath = relative ? path.posix.join(relative, entry.name) : entry.name;
      // The business-leaf guard applies equally to files and empty directories.
      guardOfficialLeaf(relativePath);
      const stats = lstatOrdinary(file, 'OFFICIAL_ENTRY');
      if (stats.isDirectory()) {
        visit(file, relativePath);
      } else {
        if (!stats.isFile()) fail('OFFICIAL_ENTRY_NOT_FILE');
        const bytes = readBoundFile(file, stats);
        files.push({
          relative_path: relativePath.replaceAll('\\', '/'),
          bytes: bytes.length,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        });
      }
    }
    const after = lstatOrdinary(directory, 'OFFICIAL_DIRECTORY');
    if (!sameIdentity(before, after)) fail('OFFICIAL_DIRECTORY_REPLACED');
    assertAuthority(authority);
  }
  visit(root);
  return files.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
}

function assertBothAuthorities(official, isolated) {
  assertAuthority(official);
  assertAuthority(isolated);
}

function assertEmptyIsolatedBase(base) {
  if (fs.readdirSync(base).length) fail('ISOLATED_RESIDUE');
}

function assertOwnedChild(child, expected) {
  const actual = lstatOrdinary(child, 'ISOLATED_CHILD');
  if (!actual.isDirectory()) fail('ISOLATED_CHILD_NOT_DIRECTORY');
  if (!sameIdentity(expected, actual)) fail('ISOLATED_CHILD_REPLACED');
}

function assertOwnedMarker(marker, expected) {
  const actual = lstatOrdinary(marker, 'ISOLATED_MARKER');
  if (!actual.isFile() || !sameIdentity(expected, actual)) fail('ISOLATED_MARKER_REPLACED');
}

export async function validateRoots({ officialRoot, isolatedBase }, hooks = {}) {
  if (typeof officialRoot !== 'string' || !path.win32.isAbsolute(officialRoot)) fail('OFFICIAL_NOT_ABSOLUTE');
  if (typeof isolatedBase !== 'string' || !path.win32.isAbsolute(isolatedBase)) fail('ISOLATED_NOT_ABSOLUTE');
  if (path.resolve(officialRoot).toLowerCase() === path.resolve(isolatedBase).toLowerCase()) fail('ROLES_SAME');
  const official = captureRoot('OFFICIAL', officialRoot, OFFICIAL_SUFFIX);
  const isolated = captureRoot('ISOLATED', isolatedBase, ISOLATED_SUFFIX);
  assertBothAuthorities(official, isolated);
  assertEmptyIsolatedBase(isolatedBase);
  const guard = await startOfficialGuard(officialRoot, hooks.nativeGuardEnv);
  let isolatedNativeId;
  const child = path.join(isolatedBase, crypto.randomUUID());
  const marker = path.join(child, '.sel-pantry-root-marker');
  let ownedChild;
  let ownedMarker;
  let nativeChildId;
  let nativeMarkerId;
  let failure;
  let before;
  try {
    isolatedNativeId = await nativeIdentity(isolatedBase);
    before = snapshotOfficial(officialRoot, official);
    hooks.afterSnapshot?.({ officialRoot, isolatedBase });
    assertBothAuthorities(official, isolated);
    fs.mkdirSync(child);
    ownedChild = lstatOrdinary(child, 'ISOLATED_CHILD');
    if (!ownedChild.isDirectory()) fail('ISOLATED_CHILD_NOT_DIRECTORY');
    nativeChildId = await nativeIdentity(child);
    assertBothAuthorities(official, isolated);
    assertOwnedChild(child, ownedChild);
    const markerValue = `SEL-PANTRY-001:${path.basename(child)}`;
    fs.writeFileSync(marker, markerValue, { encoding: 'utf8', flag: 'wx' });
    ownedMarker = lstatOrdinary(marker, 'ISOLATED_MARKER');
    if (!ownedMarker.isFile()) fail('ISOLATED_MARKER_REPLACED');
    nativeMarkerId = await nativeIdentity(marker);
    assertBothAuthorities(official, isolated);
    assertOwnedChild(child, ownedChild);
    assertOwnedMarker(marker, ownedMarker);
    if (fs.readFileSync(marker, 'utf8') !== markerValue) fail('ISOLATED_MARKER');
    assertBothAuthorities(official, isolated);
    assertOwnedChild(child, ownedChild);
    assertOwnedMarker(marker, ownedMarker);
    hooks.afterMarker?.({ child, marker });
    assertBothAuthorities(official, isolated);
    assertOwnedChild(child, ownedChild);
    assertOwnedMarker(marker, ownedMarker);
    await nativeCleanup({ base: isolatedBase, child, marker, baseId: isolatedNativeId, childId: nativeChildId, markerId: nativeMarkerId });
    ownedChild = undefined;
    ownedMarker = undefined;

    assertBothAuthorities(official, isolated);
    if (JSON.stringify(before) !== JSON.stringify(snapshotOfficial(officialRoot, official))) fail('OFFICIAL_DELTA');
    assertBothAuthorities(official, isolated);
    assertEmptyIsolatedBase(isolatedBase);
  } catch (error) {
    failure = error;
  } finally {
    if (ownedChild) {
      try {
        await nativeCleanup({ base: isolatedBase, child, marker, baseId: isolatedNativeId, childId: nativeChildId, markerId: nativeMarkerId });
      } catch (cleanupError) {
        if (!failure) failure = cleanupError;
      }
    }
    try {
      const status = await guard.stop();
      if (status.changed || status.error || !status.idsExact) {
        if (!failure) failure = new Error('SEL_PANTRY_ROOT_OFFICIAL_NATIVE_CHANGED');
      }
    } catch (guardError) {
      if (!failure) failure = guardError;
    }
  }
  if (failure) throw failure;
  return { official_delta: 0, isolated_removed: true };
}

async function expectRejected(label, options, hooks, expectedCode) {
  try {
    await validateRoots(options, hooks);
  } catch (error) {
    if (error.message === `SEL_PANTRY_ROOT_${expectedCode}`) return;
    fail(`SELF_TEST_WRONG:${label}:${error.message}`);
  }
  fail(`SELF_TEST_ACCEPTED:${label}`);
}

function createOwnedDirectory(parent) {
  const file = path.join(parent, `.sel-pantry-self-${crypto.randomUUID()}`);
  fs.mkdirSync(file);
  return { file, stats: lstatOrdinary(file, 'SELF_TEST') };
}

function createOwnedFile(parent, value = 'self-test') {
  const file = path.join(parent, `.sel-pantry-self-${crypto.randomUUID()}`);
  fs.writeFileSync(file, value, { encoding: 'utf8', flag: 'wx' });
  return { file, stats: lstatOrdinary(file, 'SELF_TEST') };
}

function removeOwnedFile(owned) {
  const actual = maybeLstat(owned.file);
  if (!actual) return;
  if (!actual.isFile() || actual.isSymbolicLink() || !sameIdentity(owned.stats, actual)) fail('SELF_TEST_FOREIGN_PRESERVED');
  fs.unlinkSync(owned.file);
}

function removeOwnedDirectory(owned) {
  const actual = maybeLstat(owned.file);
  if (!actual) return;
  if (!actual.isDirectory() || actual.isSymbolicLink() || !sameIdentity(owned.stats, actual)) fail('SELF_TEST_FOREIGN_PRESERVED');
  fs.rmdirSync(owned.file);
}

async function selfTest(options) {
  const { officialRoot, isolatedBase } = options;
  await validateRoots(options);
  await expectRejected('relative official', { officialRoot: 'relative', isolatedBase }, {}, 'OFFICIAL_NOT_ABSOLUTE');
  await expectRejected('wrong official suffix', { officialRoot: path.dirname(officialRoot), isolatedBase }, {}, 'OFFICIAL_SUFFIX');
  await expectRejected('same role path', { officialRoot, isolatedBase: officialRoot }, {}, 'ROLES_SAME');
  await expectRejected('external suffix impersonation', { officialRoot: 'E:\\external\\official-manifest-sentinel\\SEL-PANTRY-001', isolatedBase }, {}, 'OFFICIAL_BINDING');

  const reparse = path.join(officialRoot, `.sel-pantry-self-${crypto.randomUUID()}`);
  fs.symlinkSync(officialRoot, reparse, 'junction');
  const reparseStats = fs.lstatSync(reparse, { bigint: true });
    try { await expectRejected('official reparse child', options, {}, 'OFFICIAL_ENTRY_REPARSE'); }
  finally {
    const actual = maybeLstat(reparse);
    if (actual && sameIdentity(reparseStats, actual)) fs.unlinkSync(reparse);
    else if (actual) fail('SELF_TEST_FOREIGN_PRESERVED');
  }
  for (const leaf of ['diet-manager-b.sqlite3', 'diet-manager-b.sqlite3-wal', 'diet-manager-b.sqlite3-shm', 'secret', 'state']) {
    const container = createOwnedDirectory(officialRoot);
    const file = { file: path.join(container.file, leaf), stats: undefined };
    fs.writeFileSync(file.file, 'forbidden', { flag: 'wx' });
    file.stats = lstatOrdinary(file.file, 'SELF_TEST');
    try { await expectRejected(`official file ${leaf}`, options, {}, `OFFICIAL_FORBIDDEN_LEAF:${leaf}`); }
    finally { removeOwnedFile(file); removeOwnedDirectory(container); }
  }
  for (const leaf of ['secret', 'state']) {
    const container = createOwnedDirectory(officialRoot);
    const directory = { file: path.join(container.file, leaf), stats: undefined };
    fs.mkdirSync(directory.file);
    directory.stats = lstatOrdinary(directory.file, 'SELF_TEST');
    try { await expectRejected(`official directory ${leaf}`, options, {}, `OFFICIAL_FORBIDDEN_LEAF:${leaf}`); }
    finally { removeOwnedDirectory(directory); removeOwnedDirectory(container); }
  }

  let changed;
  await expectRejected('official content replacement', options, {
    afterSnapshot: ({ officialRoot: root }) => { changed = createOwnedFile(root, 'changed'); },
  }, 'OFFICIAL_DELTA');
  removeOwnedFile(changed);
  await expectRejected('native watcher error', options, { nativeGuardEnv: { SEL_PANTRY_NATIVE_FORCE_ERROR: '1' } }, 'OFFICIAL_NATIVE_CHANGED');
  await expectRejected('native watcher overflow', options, { nativeGuardEnv: { SEL_PANTRY_NATIVE_FORCE_OVERFLOW: '1' } }, 'OFFICIAL_NATIVE_CHANGED');
  let leftover;
  await expectRejected('isolated leftover', options, {
    afterSnapshot: ({ isolatedBase: base }) => { leftover = createOwnedDirectory(base); },
  }, 'ISOLATED_RESIDUE');
  removeOwnedDirectory(leftover);

  let displacedChild;
  let foreignChild;
  let foreignCanary;
  let displacedMarker;
  await expectRejected('isolated child replacement preserves foreign canary', options, {
    afterMarker: ({ child, marker }) => {
      displacedChild = { file: path.join(isolatedBase, `.sel-pantry-self-${crypto.randomUUID()}`), stats: lstatOrdinary(child, 'SELF_TEST') };
      displacedMarker = { file: path.join(displacedChild.file, path.basename(marker)), stats: lstatOrdinary(marker, 'SELF_TEST') };
      fs.renameSync(child, displacedChild.file);
      fs.mkdirSync(child);
      foreignChild = { file: child, stats: lstatOrdinary(child, 'SELF_TEST') };
      foreignCanary = { file: path.join(child, 'foreign-canary'), stats: undefined };
      fs.writeFileSync(foreignCanary.file, 'foreign-owned', { flag: 'wx' });
      foreignCanary.stats = lstatOrdinary(foreignCanary.file, 'SELF_TEST');
    },
  }, 'ISOLATED_CHILD_REPLACED');
  if (fs.readFileSync(foreignCanary.file, 'utf8') !== 'foreign-owned') fail('SELF_TEST_FOREIGN_DELETED');
  removeOwnedFile(foreignCanary);
  removeOwnedDirectory(foreignChild);
  removeOwnedFile(displacedMarker);
  removeOwnedDirectory(displacedChild);

  let officialOriginal;
  let officialDisplaced;
  let officialReplacement;
  await expectRejected('official root replacement', options, {
    afterSnapshot: () => {
      officialOriginal = lstatOrdinary(officialRoot, 'SELF_TEST');
      officialDisplaced = path.join(path.dirname(officialRoot), `.sel-pantry-self-${crypto.randomUUID()}`);
      fs.renameSync(officialRoot, officialDisplaced);
      fs.mkdirSync(officialRoot);
      officialReplacement = { file: officialRoot, stats: lstatOrdinary(officialRoot, 'SELF_TEST') };
    },
  }, 'OFFICIAL_PATH_REPLACED');
  if (officialReplacement) {
    removeOwnedDirectory(officialReplacement);
    if (!sameIdentity(officialOriginal, lstatOrdinary(officialDisplaced, 'SELF_TEST'))) fail('SELF_TEST_FOREIGN_PRESERVED');
    fs.renameSync(officialDisplaced, officialRoot);
  }

  let isolatedOriginal;
  let isolatedDisplaced;
  let isolatedReplacement;
  await expectRejected('isolated base replacement', options, {
    afterSnapshot: () => {
      isolatedOriginal = lstatOrdinary(isolatedBase, 'SELF_TEST');
      isolatedDisplaced = path.join(path.dirname(isolatedBase), `.sel-pantry-self-${crypto.randomUUID()}`);
      fs.renameSync(isolatedBase, isolatedDisplaced);
      fs.mkdirSync(isolatedBase);
      isolatedReplacement = { file: isolatedBase, stats: lstatOrdinary(isolatedBase, 'SELF_TEST') };
    },
  }, 'ISOLATED_PATH_REPLACED');
  removeOwnedDirectory(isolatedReplacement);
  if (!sameIdentity(isolatedOriginal, lstatOrdinary(isolatedDisplaced, 'SELF_TEST'))) fail('SELF_TEST_FOREIGN_PRESERVED');
  fs.renameSync(isolatedDisplaced, isolatedBase);
  console.log('SEL_PANTRY_ROOTS|SELF_TEST|PASS|mutations=19|controls=1');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    try {
      const options = parseArgs(process.argv.slice(2).filter((arg) => arg !== '--self-test'));
      if (process.argv.includes('--self-test')) await selfTest(options);
      else {
        await validateRoots(options);
        console.log('SEL_PANTRY_ROOTS|PASS|official_delta=0|isolated_removed=true');
      }
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  })();
}
