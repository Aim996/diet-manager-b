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
const NATIVE_TIMEOUT_MS = 20_000;
const NATIVE_STOP_TIMEOUT_MS = 1_000;
const NATIVE_MAX_BYTES = 64 * 1024;
const NATIVE_GUARD_HOOK_KEYS = new Set([
  'SEL_PANTRY_NATIVE_EXIT_AFTER_READY',
  'SEL_PANTRY_NATIVE_OUTPUT_OVERFLOW',
  'SEL_PANTRY_NATIVE_STOP_HANG',
  'SEL_PANTRY_NATIVE_FORCE_ERROR',
  'SEL_PANTRY_NATIVE_FORCE_OVERFLOW',
]);

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
    let terminal;
    const terminate = (code) => {
      if (!terminal) terminal = new Error(`SEL_PANTRY_ROOT_NATIVE_${code}:${label}`);
      child.kill();
    };
    const timer = setTimeout(() => terminate('TIMEOUT'), NATIVE_TIMEOUT_MS);
    const append = (target, chunk) => {
      const value = target + chunk.toString('utf8');
      if (Buffer.byteLength(value, 'utf8') > NATIVE_MAX_BYTES) {
        terminate('MAX_BUFFER');
        return target;
      }
      return value;
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.once('error', () => { clearTimeout(timer); reject(new Error(`SEL_PANTRY_ROOT_NATIVE_SPAWN:${label}`)); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (terminal) reject(terminal);
      else if (code !== 0) reject(new Error(`SEL_PANTRY_ROOT_NATIVE_EXIT:${label}`));
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

async function nativeCleanup({ base, child, marker, baseId, childId, markerId, deleteKind }) {
  const output = await spawnNative(nativeScript([
    '$ErrorActionPreference="Stop"', NATIVE_TYPES,
    '$base=[IntPtr]::Zero; $child=[IntPtr]::Zero; $marker=[IntPtr]::Zero',
    'try {',
    '$base=OpenNative $env:SEL_PANTRY_NATIVE_BASE $false; if((NativeId $base) -ne $env:SEL_PANTRY_NATIVE_BASE_ID){throw "MISMATCH_BASE"}',
    '$child=OpenNative $env:SEL_PANTRY_NATIVE_CHILD $true; if((NativeId $child) -ne $env:SEL_PANTRY_NATIVE_CHILD_ID){throw "MISMATCH_CHILD"}',
    '$d=New-Object PantryNative+DISPOSITION; $d.DeleteFile=1;',
    'if($env:SEL_PANTRY_NATIVE_DELETE_KIND -eq "marker"){$marker=OpenNative $env:SEL_PANTRY_NATIVE_MARKER $true;if((NativeId $marker) -ne $env:SEL_PANTRY_NATIVE_MARKER_ID){throw "MISMATCH_MARKER"};if(-not [PantryNative]::SetFileInformationByHandle($marker,4,[ref]$d,1)){throw ("DELETE_MARKER="+[Runtime.InteropServices.Marshal]::GetLastWin32Error())};[PantryNative]::CloseHandle($marker)|Out-Null;$marker=[IntPtr]::Zero}',
    'elseif($env:SEL_PANTRY_NATIVE_DELETE_KIND -eq "child"){if(-not [PantryNative]::SetFileInformationByHandle($child,4,[ref]$d,1)){throw ("DELETE_CHILD="+[Runtime.InteropServices.Marshal]::GetLastWin32Error())};[PantryNative]::CloseHandle($child)|Out-Null;$child=[IntPtr]::Zero}',
    'else{throw "DELETE_KIND"};[Console]::Out.WriteLine("CLEANUP|PASS")',
    '} catch { [Console]::Out.WriteLine("CLEANUP|FAIL|$($_.Exception.Message)"); exit 0 } finally { if($marker -ne [IntPtr]::Zero){[PantryNative]::CloseHandle($marker)|Out-Null}; if($child -ne [IntPtr]::Zero){[PantryNative]::CloseHandle($child)|Out-Null}; if($base -ne [IntPtr]::Zero){[PantryNative]::CloseHandle($base)|Out-Null} }',
  ]), {
    SEL_PANTRY_NATIVE_BASE: base, SEL_PANTRY_NATIVE_CHILD: child, SEL_PANTRY_NATIVE_MARKER: marker,
    SEL_PANTRY_NATIVE_BASE_ID: baseId, SEL_PANTRY_NATIVE_CHILD_ID: childId,
    SEL_PANTRY_NATIVE_MARKER_ID: markerId ?? '', SEL_PANTRY_NATIVE_DELETE_KIND: deleteKind,
  }, 'cleanup', '');
  if (output !== 'CLEANUP|PASS') fail('ISOLATED_NATIVE_CLEANUP');
}

function decodeNativeEventName(encoded) {
  if (typeof encoded !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    fail('NATIVE_GUARD_STATUS');
  }
  const value = Buffer.from(encoded, 'base64');
  if (value.toString('base64') !== encoded) fail('NATIVE_GUARD_STATUS');
  return value.toString('utf8');
}

function classifyNativeEvents(serialized, watchSpecs, isolatedBase, childName, markerName) {
  const tokens = serialized === 'QUIET' ? [] : serialized.split(';');
  const events = [];
  let nativeError = false;
  for (const token of tokens) {
    if (token === 'ERROR') {
      nativeError = true;
      continue;
    }
    const match = token.match(/^(\d+)@([1-5])@(.+)$/);
    if (!match) fail('NATIVE_GUARD_STATUS');
    const watch = Number(match[1]);
    if (!Number.isSafeInteger(watch) || !watchSpecs[watch]) fail('NATIVE_GUARD_STATUS');
    events.push({ watch, action: Number(match[2]), name: decodeNativeEventName(match[3]) });
  }

  let officialChanged = false;
  const expectedChild = childName.toLowerCase();
  const expectedMarker = `${childName}\\${markerName}`.toLowerCase();
  let childCreated = false;
  let markerCreated = false;
  let markerRemoved = false;
  let childRemoved = false;
  let isolatedChanged = false;

  for (const event of events) {
    const spec = watchSpecs[event.watch];
    const name = event.name.replaceAll('/', '\\').toLowerCase();
    if (spec.kind === 'official-content') {
      officialChanged = true;
      continue;
    }
    if (spec.kind === 'official-ancestor') {
      if (name === spec.target.toLowerCase()) officialChanged = true;
      continue;
    }
    if (spec.kind === 'isolated-ancestor') {
      if (name === spec.target.toLowerCase() && !(spec.direct && event.action === 3)) isolatedChanged = true;
      continue;
    }
    if (spec.kind !== 'isolated-content') fail('NATIVE_GUARD_STATUS');
    if (name !== expectedChild && name !== expectedMarker) {
      isolatedChanged = true;
      continue;
    }
    if (name === expectedChild) {
      if (event.action === 1 && !childCreated && !markerCreated && !childRemoved) childCreated = true;
      else if (event.action === 3 && childCreated && !childRemoved) { /* owned directory metadata */ }
      else if (event.action === 2 && childCreated && markerRemoved && !childRemoved) childRemoved = true;
      else isolatedChanged = true;
      continue;
    }
    if (event.action === 1 && childCreated && !markerCreated && !childRemoved) markerCreated = true;
    else if (event.action === 3 && markerCreated && !markerRemoved) { /* owned marker write */ }
    else if (event.action === 2 && markerCreated && !markerRemoved) markerRemoved = true;
    else isolatedChanged = true;
  }
  if (!childCreated || !markerCreated || !markerRemoved || !childRemoved) isolatedChanged = true;
  return { officialChanged, isolatedChanged, nativeError };
}

function nativeWatchSpecs(official, isolated) {
  const specs = [
    { kind: 'official-content', directory: official.root, subtree: true },
    { kind: 'isolated-content', directory: isolated.root, subtree: true },
  ];
  for (const authority of [official, isolated]) {
    for (const record of authority.ancestors) {
      const parent = path.dirname(record.file);
      if (path.resolve(parent).toLowerCase() === path.resolve(record.file).toLowerCase()) continue;
      specs.push({
        kind: authority.role === 'OFFICIAL' ? 'official-ancestor' : 'isolated-ancestor',
        directory: parent,
        subtree: false,
        target: path.basename(record.file),
        direct: path.resolve(record.file).toLowerCase() === path.resolve(authority.root).toLowerCase(),
      });
    }
  }
  if (specs.length > 63) fail('NATIVE_WATCH_CAP');
  return specs;
}

function guardHookEnvironment(hookEnv) {
  if (hookEnv === undefined) return {};
  if (hookEnv === null || typeof hookEnv !== 'object' || Array.isArray(hookEnv) || Object.getPrototypeOf(hookEnv) !== Object.prototype) {
    fail('NATIVE_GUARD_ENV');
  }
  const result = {};
  for (const key of Reflect.ownKeys(hookEnv)) {
    if (typeof key !== 'string' || !NATIVE_GUARD_HOOK_KEYS.has(key)) fail('NATIVE_GUARD_ENV');
    const descriptor = Object.getOwnPropertyDescriptor(hookEnv, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.value !== '1') fail('NATIVE_GUARD_ENV');
    result[key] = descriptor.value;
  }
  return result;
}

async function startOfficialGuard(official, isolated, childName, markerName, hookEnv = {}) {
  const watchSpecs = nativeWatchSpecs(official, isolated);
  const safeHookEnv = guardHookEnvironment(hookEnv);
  const encodedWatchSpecs = Buffer.from(JSON.stringify(watchSpecs.map(({ directory, subtree }) => ({ directory, subtree }))), 'utf8').toString('base64');
  const script = nativeScript([
    '$ErrorActionPreference="Stop"',
    'Add-Type -TypeDefinition @"',
    'using System; using System.Runtime.InteropServices; public static class PantryRdcw { [StructLayout(LayoutKind.Sequential)] public struct OVERLAPPED { public IntPtr Internal; public IntPtr InternalHigh; public uint Offset; public uint OffsetHigh; public IntPtr hEvent; } [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr CreateFileW(string n,uint a,uint s,IntPtr sec,uint d,uint f,IntPtr t); [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool ReadDirectoryChangesW(IntPtr h,IntPtr b,uint l,[MarshalAs(UnmanagedType.Bool)] bool subtree,uint filter,out uint bytes,IntPtr ov,IntPtr cb); [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool GetOverlappedResult(IntPtr h,IntPtr ov,out uint bytes,[MarshalAs(UnmanagedType.Bool)] bool wait); [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool CancelIoEx(IntPtr h,IntPtr ov); [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr CreateEventW(IntPtr a,[MarshalAs(UnmanagedType.Bool)] bool m,[MarshalAs(UnmanagedType.Bool)] bool i,string n); [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool ResetEvent(IntPtr h); [DllImport("kernel32.dll",SetLastError=true)] public static extern uint WaitForMultipleObjects(uint count,IntPtr[] handles,[MarshalAs(UnmanagedType.Bool)] bool waitAll,uint milliseconds); [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr GetStdHandle(int id); [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool CloseHandle(IntPtr h); }',
    '"@',
    '$list=[uint32]1;$attr=[uint32]0x80;$share=[uint32]7;$open=[uint32]3;$flags=[uint32]0x42200000;$invalid=[IntPtr](-1);$filter=[uint32]0x1f;$aborted=[uint32]995;$infinite=[uint32]::MaxValue',
    'function ResetOv($w){if(-not [PantryRdcw]::ResetEvent($w.e)){throw "RESET"};[Runtime.InteropServices.Marshal]::StructureToPtr((New-Object PantryRdcw+OVERLAPPED -Property @{hEvent=$w.e}),$w.ov,$false)}',
    'function BeginRead($w){ResetOv $w;$x=[uint32]0;if(-not [PantryRdcw]::ReadDirectoryChangesW($w.h,$w.b,65536,$w.sub,$filter,[ref]$x,$w.ov,[IntPtr]::Zero)){throw "ARM"}}',
    'function OpenWatch($p,$sub){$h=[PantryRdcw]::CreateFileW($p,$list -bor $attr,$share,[IntPtr]::Zero,$open,$flags,[IntPtr]::Zero);if($h -eq $invalid){throw "OPEN"};$e=[PantryRdcw]::CreateEventW([IntPtr]::Zero,$true,$false,$null);if($e -eq [IntPtr]::Zero){throw "EVENT"};$ov=[Runtime.InteropServices.Marshal]::AllocHGlobal(32);$b=[Runtime.InteropServices.Marshal]::AllocHGlobal(65536);$w=[PSCustomObject]@{h=$h;e=$e;ov=$ov;b=$b;sub=$sub};BeginRead $w;return $w}',
    'function ParseEvents($watch,$buffer,$count){$result=@();$offset=0;while($offset -lt $count){$next=[Runtime.InteropServices.Marshal]::ReadInt32($buffer,$offset);$action=[Runtime.InteropServices.Marshal]::ReadInt32($buffer,$offset+4);$length=[Runtime.InteropServices.Marshal]::ReadInt32($buffer,$offset+8);if($length -lt 0 -or (($length % 2) -ne 0) -or ($offset+12+$length -gt $count)){throw "RECORD"};$name=[Runtime.InteropServices.Marshal]::PtrToStringUni([IntPtr]::Add($buffer,$offset+12),[int]($length/2));$encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($name));$result+=("$watch@$action@$encoded");if($next -eq 0){break};if($next -lt 12 -or ($offset+$next -ge $count)){throw "RECORD"};$offset+=$next};return $result}',
    'function CompleteAndRearm($w,$watch){$n=[uint32]0;if(-not [PantryRdcw]::GetOverlappedResult($w.h,$w.ov,[ref]$n,$false)){throw "COMPLETE"};if($n -eq 0){throw "OVERFLOW"};$events=ParseEvents $watch $w.b $n;BeginRead $w;return $events}',
    'function FinishWatch($w,$watch){[PantryRdcw]::CancelIoEx($w.h,$w.ov)|Out-Null;$n=[uint32]0;if([PantryRdcw]::GetOverlappedResult($w.h,$w.ov,[ref]$n,$true)){if($n -eq 0){throw "ZERO"};return (ParseEvents $watch $w.b $n)};if([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq $aborted){return @()};throw "CANCEL"}',
    'function Quiesce($w){if(-not $w.h -or -not $w.ov){return $false};if([PantryRdcw]::CancelIoEx($w.h,$w.ov)){$n=[uint32]0;if([PantryRdcw]::GetOverlappedResult($w.h,$w.ov,[ref]$n,$true)){return $true};return ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq $aborted)};return ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168)}',
    '$w=@();$events=@();$nativeError=$false;$sync=0;try{$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SEL_PANTRY_NATIVE_WATCHES));$parsed=$json|ConvertFrom-Json;$specs=@();foreach($spec in $parsed){$specs+=$spec};if($specs.Count -lt 2 -or $specs.Count -gt 63){throw "WATCH_COUNT"};foreach($spec in $specs){$w+=OpenWatch ([string]$spec.directory) ([bool]$spec.subtree)};$inputHandle=[PantryRdcw]::GetStdHandle(-10);$watchHandles=[IntPtr[]]@($w|ForEach-Object{$_.e});$handles=[IntPtr[]](@($watchHandles)+@($inputHandle));$inputIndex=$w.Count;[Console]::Out.WriteLine("READY");[Console]::Out.Flush();if($env:SEL_PANTRY_NATIVE_EXIT_AFTER_READY -eq "1"){exit 9};if($env:SEL_PANTRY_NATIVE_OUTPUT_OVERFLOW -eq "1"){[Console]::Out.WriteLine("X"*70000);[Console]::Out.Flush()};while($true){$wait=[PantryRdcw]::WaitForMultipleObjects([uint32]$handles.Length,$handles,$false,$infinite);if($wait -eq 0xffffffff){throw "WAIT"};$index=[int]$wait;if($index -eq $inputIndex){$command=[Console]::In.ReadLine();if($command -eq "SYNC"){while($true){$pending=[PantryRdcw]::WaitForMultipleObjects([uint32]$watchHandles.Length,$watchHandles,$false,0);if($pending -eq 258){break};if($pending -ge $w.Count){throw "SYNC_WAIT"};$events+=CompleteAndRearm $w[[int]$pending] ([int]$pending);if($events.Count -gt 256){throw "EVENT_CAP"}};$sync++;[Console]::Out.WriteLine("SYNC|$sync");[Console]::Out.Flush();continue};if($command -ne "STOP"){throw "COMMAND"};if($env:SEL_PANTRY_NATIVE_STOP_HANG -eq "1"){Start-Sleep -Seconds 30};break};if($index -lt 0 -or $index -ge $w.Count){throw "WAIT_INDEX"};$events+=CompleteAndRearm $w[$index] $index;if($events.Count -gt 256){throw "EVENT_CAP"}};for($index=$w.Count-1;$index -ge 0;$index--){$events+=FinishWatch $w[$index] $index};if(($env:SEL_PANTRY_NATIVE_FORCE_ERROR -eq "1") -or ($env:SEL_PANTRY_NATIVE_FORCE_OVERFLOW -eq "1")){$nativeError=$true};if($events.Count -eq 0 -and -not $nativeError){$serialized="QUIET"}else{$serialized=($events -join ";");if($nativeError){if($serialized){$serialized+=";ERROR"}else{$serialized="ERROR"}}};[Console]::Out.WriteLine("STATUS|"+$serialized);[Console]::Out.Flush()}catch{[Console]::Out.WriteLine("STATUS|ERROR");[Console]::Out.Flush()}finally{$safe=@();foreach($x in $w){$safe+=,(Quiesce $x)};foreach($x in $w){if($x.h){[PantryRdcw]::CloseHandle($x.h)|Out-Null};if($x.e){[PantryRdcw]::CloseHandle($x.e)|Out-Null}};for($index=0;$index -lt $w.Count;$index++){if($safe[$index]){if($w[$index].ov){[Runtime.InteropServices.Marshal]::FreeHGlobal($w[$index].ov)};if($w[$index].b){[Runtime.InteropServices.Marshal]::FreeHGlobal($w[$index].b)}}}}',
  ]);
  if (process.platform !== 'win32') fail(`NATIVE_PLATFORM:${process.platform}`);
  const child = spawn(NATIVE_POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeNative(script)], {
    shell: false, windowsHide: true, env: { ...process.env, ...safeHookEnv, SEL_PANTRY_NATIVE_WATCHES: encodedWatchSpecs }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let resolved = false;
  let terminal;
  let exited = false;
  let stopPromise;
  let nextSync = 0;
  const syncWaiters = new Map();
  const terminalError = (code) => { if (!terminal) terminal = new Error(`SEL_PANTRY_ROOT_${code}`); };
  const rejectSyncWaiters = (error) => {
    for (const { timer, reject } of syncWaiters.values()) { clearTimeout(timer); reject(error); }
    syncWaiters.clear();
  };
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { terminalError('NATIVE_READY_TIMEOUT'); child.kill(); }, NATIVE_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout, 'utf8') > NATIVE_MAX_BYTES) { terminalError('NATIVE_GUARD_OVERFLOW'); child.kill(); }
      if (!resolved && stdout.includes('READY')) { resolved = true; clearTimeout(timer); resolve(); }
      for (const match of stdout.matchAll(/SYNC\|(\d+)\r?\n/g)) {
        const sequence = Number(match[1]);
        const waiter = syncWaiters.get(sequence);
        if (waiter) { clearTimeout(waiter.timer); syncWaiters.delete(sequence); waiter.resolve(); }
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); if (Buffer.byteLength(stderr, 'utf8') > NATIVE_MAX_BYTES) { terminalError('NATIVE_GUARD_OVERFLOW'); child.kill(); } });
    child.once('error', () => { clearTimeout(timer); terminalError('NATIVE_GUARD_EXIT'); if (!resolved) reject(terminal); });
    child.once('exit', (code) => { clearTimeout(timer); exited = true; if (!terminal && code !== 0) terminalError('NATIVE_GUARD_EXIT'); rejectSyncWaiters(terminal ?? new Error('SEL_PANTRY_ROOT_NATIVE_GUARD_EXIT')); if (!resolved) reject(terminal ?? new Error('SEL_PANTRY_ROOT_NATIVE_READY_EXIT')); });
  });
  await ready;
  return {
    checkpoint() {
      if (terminal || exited) return Promise.reject(terminal ?? new Error('SEL_PANTRY_ROOT_NATIVE_GUARD_EXIT'));
      const sequence = ++nextSync;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { syncWaiters.delete(sequence); terminalError('NATIVE_GUARD_SYNC_TIMEOUT'); child.kill(); reject(terminal); }, NATIVE_STOP_TIMEOUT_MS);
        syncWaiters.set(sequence, { timer, resolve, reject });
        child.stdin.write('SYNC\n', (error) => {
          if (!error) return;
          clearTimeout(timer);
          syncWaiters.delete(sequence);
          terminalError('NATIVE_GUARD_EXIT');
          reject(terminal);
        });
      });
    },
    async stop() {
      if (stopPromise) return stopPromise;
      stopPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { terminalError('NATIVE_GUARD_STOP_TIMEOUT'); child.kill(); }, NATIVE_STOP_TIMEOUT_MS);
        child.once('exit', (code) => {
          clearTimeout(timer);
          if (terminal || code !== 0) { reject(terminal ?? new Error('SEL_PANTRY_ROOT_NATIVE_GUARD_EXIT')); return; }
          const status = stdout.match(/STATUS\|(.+)$/m);
          if (!status) { reject(new Error('SEL_PANTRY_ROOT_NATIVE_GUARD_STATUS')); return; }
          resolve(classifyNativeEvents(status[1], watchSpecs, isolated.root, childName, markerName));
        });
        if (exited) { clearTimeout(timer); reject(terminal ?? new Error('SEL_PANTRY_ROOT_NATIVE_GUARD_EXIT')); return; }
        child.stdin.end('STOP\n');
      });
      return stopPromise;
    },
    pid: child.pid,
    watchSpecs: Object.freeze(watchSpecs.map((spec) => Object.freeze({ ...spec }))),
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

function snapshotOfficial(root, authority, hooks = {}) {
  const files = [];
  function visit(directory, relative = '') {
    assertAuthority(authority);
    const before = lstatOrdinary(directory, 'OFFICIAL_DIRECTORY');
    if (!before.isDirectory()) fail('OFFICIAL_DIRECTORY_REPLACED');
    hooks.beforeOfficialReadDir?.({ directory });
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
  const childName = crypto.randomUUID();
  const markerName = '.sel-pantry-root-marker';
  const child = path.join(isolatedBase, childName);
  const marker = path.join(child, markerName);
  const guard = await startOfficialGuard(official, isolated, childName, markerName, hooks.nativeGuardEnv);
  let isolatedNativeId;
  let ownedChild;
  let ownedMarker;
  let nativeChildId;
  let nativeMarkerId;
  let failure;
  let before;
  try {
    hooks.onNativeGuardStarted?.({ pid: guard.pid, watchSpecs: guard.watchSpecs });
    isolatedNativeId = await nativeIdentity(isolatedBase);
    before = snapshotOfficial(officialRoot, official, hooks);
    hooks.afterSnapshot?.({ officialRoot, isolatedBase });
    assertBothAuthorities(official, isolated);
    fs.mkdirSync(child);
    ownedChild = lstatOrdinary(child, 'ISOLATED_CHILD');
    if (!ownedChild.isDirectory()) fail('ISOLATED_CHILD_NOT_DIRECTORY');
    nativeChildId = await nativeIdentity(child);
    await guard.checkpoint();
    assertBothAuthorities(official, isolated);
    assertOwnedChild(child, ownedChild);
    const markerValue = `SEL-PANTRY-001:${path.basename(child)}`;
    fs.writeFileSync(marker, markerValue, { encoding: 'utf8', flag: 'wx' });
    ownedMarker = lstatOrdinary(marker, 'ISOLATED_MARKER');
    if (!ownedMarker.isFile()) fail('ISOLATED_MARKER_REPLACED');
    nativeMarkerId = await nativeIdentity(marker);
    await guard.checkpoint();
    assertBothAuthorities(official, isolated);
    assertOwnedChild(child, ownedChild);
    assertOwnedMarker(marker, ownedMarker);
    if (fs.readFileSync(marker, 'utf8') !== markerValue) fail('ISOLATED_MARKER');
    assertBothAuthorities(official, isolated);
    assertOwnedChild(child, ownedChild);
    assertOwnedMarker(marker, ownedMarker);
    hooks.afterMarker?.({ child, marker });
    await guard.checkpoint();
    assertBothAuthorities(official, isolated);
    assertOwnedChild(child, ownedChild);
    assertOwnedMarker(marker, ownedMarker);
    await nativeCleanup({ base: isolatedBase, child, marker, baseId: isolatedNativeId, childId: nativeChildId, markerId: nativeMarkerId, deleteKind: 'marker' });
    ownedMarker = undefined;
    await guard.checkpoint();
    await nativeCleanup({ base: isolatedBase, child, marker, baseId: isolatedNativeId, childId: nativeChildId, deleteKind: 'child' });
    ownedChild = undefined;
    await guard.checkpoint();

    assertBothAuthorities(official, isolated);
    if (JSON.stringify(before) !== JSON.stringify(snapshotOfficial(officialRoot, official, hooks))) fail('OFFICIAL_DELTA');
    assertBothAuthorities(official, isolated);
    hooks.beforeIsolatedReadDir?.({ isolatedBase });
    assertEmptyIsolatedBase(isolatedBase);
  } catch (error) {
    failure = error;
  } finally {
    if (ownedChild) {
      try {
        if (ownedMarker) {
          await nativeCleanup({ base: isolatedBase, child, marker, baseId: isolatedNativeId, childId: nativeChildId, markerId: nativeMarkerId, deleteKind: 'marker' });
          ownedMarker = undefined;
          await guard.checkpoint();
        }
        await nativeCleanup({ base: isolatedBase, child, marker, baseId: isolatedNativeId, childId: nativeChildId, deleteKind: 'child' });
        ownedChild = undefined;
        await guard.checkpoint();
      } catch (cleanupError) {
        if (!failure) failure = cleanupError;
      }
    }
    try {
      const status = await guard.stop();
      if (status.nativeError && !failure) failure = new Error('SEL_PANTRY_ROOT_OFFICIAL_NATIVE_CHANGED');
      else if (status.officialChanged && !failure) failure = new Error('SEL_PANTRY_ROOT_OFFICIAL_NATIVE_CHANGED');
      else if (status.isolatedChanged && !failure) failure = new Error('SEL_PANTRY_ROOT_ISOLATED_NATIVE_CHANGED');
      if (!failure) {
        assertBothAuthorities(official, isolated);
        if (JSON.stringify(before) !== JSON.stringify(snapshotOfficial(officialRoot, official))) fail('OFFICIAL_DELTA');
        assertBothAuthorities(official, isolated);
        assertEmptyIsolatedBase(isolatedBase);
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
