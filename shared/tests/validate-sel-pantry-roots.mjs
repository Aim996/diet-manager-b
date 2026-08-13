import crypto from 'node:crypto';
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

function fail(code) {
  throw new Error(`SEL_PANTRY_ROOT_${code}`);
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

function cleanupOwnedChild({ child, marker, childStats, markerStats, official, isolated }) {
  assertBothAuthorities(official, isolated);
  const current = maybeLstat(child);
  if (!current) return;
  if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(childStats, current)) fail('ISOLATED_CHILD_REPLACED');
  const currentMarker = maybeLstat(marker);
  if (currentMarker) {
    if (!markerStats || !currentMarker.isFile() || currentMarker.isSymbolicLink() || !sameIdentity(markerStats, currentMarker)) fail('ISOLATED_MARKER_REPLACED');
    assertBothAuthorities(official, isolated);
    assertOwnedChild(child, childStats);
    assertOwnedMarker(marker, markerStats);
    fs.unlinkSync(marker);
    if (maybeLstat(marker)) fail('ISOLATED_MARKER_REPLACED');
  }
  assertBothAuthorities(official, isolated);
  assertOwnedChild(child, childStats);
  // Never recurse: a nonempty child is preserved for inspection instead of deleted.
  try {
    fs.rmdirSync(child);
  } catch {
    fail('ISOLATED_CLEANUP_NONEMPTY');
  }
  if (maybeLstat(child)) fail('ISOLATED_CLEANUP');
}

export function validateRoots({ officialRoot, isolatedBase }, hooks = {}) {
  if (typeof officialRoot !== 'string' || !path.win32.isAbsolute(officialRoot)) fail('OFFICIAL_NOT_ABSOLUTE');
  if (typeof isolatedBase !== 'string' || !path.win32.isAbsolute(isolatedBase)) fail('ISOLATED_NOT_ABSOLUTE');
  if (path.resolve(officialRoot).toLowerCase() === path.resolve(isolatedBase).toLowerCase()) fail('ROLES_SAME');
  const official = captureRoot('OFFICIAL', officialRoot, OFFICIAL_SUFFIX);
  const isolated = captureRoot('ISOLATED', isolatedBase, ISOLATED_SUFFIX);
  assertBothAuthorities(official, isolated);
  assertEmptyIsolatedBase(isolatedBase);
  const before = snapshotOfficial(officialRoot, official);
  hooks.afterSnapshot?.({ officialRoot, isolatedBase });

  const child = path.join(isolatedBase, crypto.randomUUID());
  const marker = path.join(child, '.sel-pantry-root-marker');
  let ownedChild;
  let ownedMarker;
  let failure;
  try {
    assertBothAuthorities(official, isolated);
    fs.mkdirSync(child);
    ownedChild = lstatOrdinary(child, 'ISOLATED_CHILD');
    if (!ownedChild.isDirectory()) fail('ISOLATED_CHILD_NOT_DIRECTORY');
    assertBothAuthorities(official, isolated);
    assertOwnedChild(child, ownedChild);
    const markerValue = `SEL-PANTRY-001:${path.basename(child)}`;
    fs.writeFileSync(marker, markerValue, { encoding: 'utf8', flag: 'wx' });
    ownedMarker = lstatOrdinary(marker, 'ISOLATED_MARKER');
    if (!ownedMarker.isFile()) fail('ISOLATED_MARKER_REPLACED');
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
    cleanupOwnedChild({ child, marker, childStats: ownedChild, markerStats: ownedMarker, official, isolated });
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
        cleanupOwnedChild({ child, marker, childStats: ownedChild, markerStats: ownedMarker, official, isolated });
      } catch (cleanupError) {
        if (!failure) failure = cleanupError;
      }
    }
  }
  if (failure) throw failure;
  return { official_delta: 0, isolated_removed: true };
}

function expectRejected(label, options, hooks, expectedCode) {
  try {
    validateRoots(options, hooks);
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

function selfTest(options) {
  const { officialRoot, isolatedBase } = options;
  validateRoots(options);
  expectRejected('relative official', { officialRoot: 'relative', isolatedBase }, {}, 'OFFICIAL_NOT_ABSOLUTE');
  expectRejected('wrong official suffix', { officialRoot: path.dirname(officialRoot), isolatedBase }, {}, 'OFFICIAL_SUFFIX');
  expectRejected('same role path', { officialRoot, isolatedBase: officialRoot }, {}, 'ROLES_SAME');
  expectRejected('external suffix impersonation', { officialRoot: 'E:\\external\\official-manifest-sentinel\\SEL-PANTRY-001', isolatedBase }, {}, 'OFFICIAL_BINDING');

  const reparse = path.join(officialRoot, `.sel-pantry-self-${crypto.randomUUID()}`);
  fs.symlinkSync(officialRoot, reparse, 'junction');
  const reparseStats = fs.lstatSync(reparse, { bigint: true });
  try { expectRejected('official reparse child', options, {}, 'OFFICIAL_ENTRY_REPARSE'); }
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
    try { expectRejected(`official file ${leaf}`, options, {}, `OFFICIAL_FORBIDDEN_LEAF:${leaf}`); }
    finally { removeOwnedFile(file); removeOwnedDirectory(container); }
  }
  for (const leaf of ['secret', 'state']) {
    const container = createOwnedDirectory(officialRoot);
    const directory = { file: path.join(container.file, leaf), stats: undefined };
    fs.mkdirSync(directory.file);
    directory.stats = lstatOrdinary(directory.file, 'SELF_TEST');
    try { expectRejected(`official directory ${leaf}`, options, {}, `OFFICIAL_FORBIDDEN_LEAF:${leaf}`); }
    finally { removeOwnedDirectory(directory); removeOwnedDirectory(container); }
  }

  let changed;
  expectRejected('official content replacement', options, {
    afterSnapshot: ({ officialRoot: root }) => { changed = createOwnedFile(root, 'changed'); },
  }, 'OFFICIAL_DELTA');
  removeOwnedFile(changed);
  let leftover;
  expectRejected('isolated leftover', options, {
    afterSnapshot: ({ isolatedBase: base }) => { leftover = createOwnedDirectory(base); },
  }, 'ISOLATED_RESIDUE');
  removeOwnedDirectory(leftover);

  let displacedChild;
  let foreignChild;
  let foreignCanary;
  let displacedMarker;
  expectRejected('isolated child replacement preserves foreign canary', options, {
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
  expectRejected('official root replacement', options, {
    afterSnapshot: () => {
      officialOriginal = lstatOrdinary(officialRoot, 'SELF_TEST');
      officialDisplaced = path.join(path.dirname(officialRoot), `.sel-pantry-self-${crypto.randomUUID()}`);
      fs.renameSync(officialRoot, officialDisplaced);
      fs.mkdirSync(officialRoot);
      officialReplacement = { file: officialRoot, stats: lstatOrdinary(officialRoot, 'SELF_TEST') };
    },
  }, 'OFFICIAL_PATH_REPLACED');
  removeOwnedDirectory(officialReplacement);
  if (!sameIdentity(officialOriginal, lstatOrdinary(officialDisplaced, 'SELF_TEST'))) fail('SELF_TEST_FOREIGN_PRESERVED');
  fs.renameSync(officialDisplaced, officialRoot);

  let isolatedOriginal;
  let isolatedDisplaced;
  let isolatedReplacement;
  expectRejected('isolated base replacement', options, {
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
  console.log('SEL_PANTRY_ROOTS|SELF_TEST|PASS|mutations=17|controls=1');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2).filter((arg) => arg !== '--self-test'));
    if (process.argv.includes('--self-test')) selfTest(options);
    else {
      validateRoots(options);
      console.log('SEL_PANTRY_ROOTS|PASS|official_delta=0|isolated_removed=true');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
