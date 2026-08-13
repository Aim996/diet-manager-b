import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TASK_ID = 'SEL-PANTRY-001';
const OFFICIAL_SUFFIX = `official-manifest-sentinel\\${TASK_ID}`;
const ISOLATED_SUFFIX = `isolated-test-roots\\${TASK_ID}`;
const FORBIDDEN_OFFICIAL_LEAVES = new Set([
  'diet-manager-b.sqlite3',
  'diet-manager-b.sqlite3-wal',
  'diet-manager-b.sqlite3-shm',
  'secret',
  'secret.json',
  'secrets',
  'state',
  'state.json',
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
  return {
    officialRoot: values.get('--official-manifest-root'),
    isolatedBase: values.get('--isolated-root-base'),
  };
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

function lstatOrdinary(file, code) {
  const stats = fs.lstatSync(file);
  // Node reports Windows junctions and symbolic links as symbolic links to lstat.
  if (stats.isSymbolicLink()) fail(`${code}_REPARSE`);
  return stats;
}

function maybeLstat(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function existingAncestors(target, code) {
  const windows = windowsPath(target);
  const parsed = path.win32.parse(windows);
  let current = parsed.root;
  const pieces = windows.slice(parsed.root.length).split('\\').filter(Boolean);
  for (const piece of pieces) {
    current = path.win32.join(current, piece);
    if (!maybeLstat(current)) continue;
    const stats = lstatOrdinary(current, code);
    if (!stats.isDirectory()) fail(`${code}_NOT_DIRECTORY`);
  }
}

function assertRoot(role, root, suffix) {
  if (typeof root !== 'string' || !path.win32.isAbsolute(root)) fail(`${role}_NOT_ABSOLUTE`);
  if (!windowsPath(root).endsWith(suffix)) fail(`${role}_SUFFIX`);
  existingAncestors(root, role);
  if (!maybeLstat(root)) fail(`${role}_MISSING`);
  const stats = lstatOrdinary(root, role);
  if (!stats.isDirectory()) fail(`${role}_NOT_DIRECTORY`);
  return stats;
}

function guardOfficialLeaf(relativePath) {
  const leaf = path.win32.basename(windowsPath(relativePath)).toLowerCase();
  if (FORBIDDEN_OFFICIAL_LEAVES.has(leaf)) fail(`OFFICIAL_FORBIDDEN_LEAF:${leaf}`);
}

function snapshotOfficial(root) {
  const files = [];
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relativePath = relative ? path.posix.join(relative, entry.name) : entry.name;
      const stats = lstatOrdinary(file, 'OFFICIAL_ENTRY');
      if (stats.isDirectory()) {
        visit(file, relativePath);
        continue;
      }
      if (!stats.isFile()) fail('OFFICIAL_ENTRY_NOT_FILE');
      guardOfficialLeaf(relativePath);
      const bytes = fs.readFileSync(file);
      files.push({
        relative_path: relativePath.replaceAll('\\', '/'),
        bytes: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  visit(root);
  return files.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
}

function assertEmptyIsolatedBase(base) {
  const entries = fs.readdirSync(base);
  if (entries.length) fail('ISOLATED_RESIDUE');
}

function removeChild(child, baseIdentity) {
  try {
    const base = lstatOrdinary(path.dirname(child), 'ISOLATED');
    if (!sameIdentity(base, baseIdentity)) fail('ISOLATED_BASE_REPLACED');
    if (!maybeLstat(child)) return;
    const childStats = fs.lstatSync(child);
    // rm of a Windows junction/symlink removes the reparse entry rather than its target.
    if (childStats.isSymbolicLink()) fs.unlinkSync(child);
    else fs.rmSync(child, { recursive: true, force: true, maxRetries: 0 });
    if (maybeLstat(child)) fail('ISOLATED_CLEANUP');
  } catch (error) {
    if (String(error.message).startsWith('SEL_PANTRY_ROOT_')) throw error;
    fail('ISOLATED_CLEANUP');
  }
}

export function validateRoots({ officialRoot, isolatedBase }, hooks = {}) {
  if (typeof officialRoot !== 'string' || !path.win32.isAbsolute(officialRoot)) fail('OFFICIAL_NOT_ABSOLUTE');
  if (typeof isolatedBase !== 'string' || !path.win32.isAbsolute(isolatedBase)) fail('ISOLATED_NOT_ABSOLUTE');
  if (path.resolve(officialRoot).toLowerCase() === path.resolve(isolatedBase).toLowerCase()) fail('ROLES_SAME');
  const officialIdentity = assertRoot('OFFICIAL', officialRoot, OFFICIAL_SUFFIX);
  const isolatedIdentity = assertRoot('ISOLATED', isolatedBase, ISOLATED_SUFFIX);
  assertEmptyIsolatedBase(isolatedBase);
  const before = snapshotOfficial(officialRoot);
  hooks.afterSnapshot?.({ officialRoot, isolatedBase });

  const child = path.join(isolatedBase, crypto.randomUUID());
  let created = false;
  let expectedChildIdentity;
  let failure;
  try {
    fs.mkdirSync(child);
    created = true;
    expectedChildIdentity = lstatOrdinary(child, 'ISOLATED_CHILD');
    if (!expectedChildIdentity.isDirectory()) fail('ISOLATED_CHILD_NOT_DIRECTORY');
    const marker = path.join(child, '.sel-pantry-root-marker');
    const markerValue = `SEL-PANTRY-001:${path.basename(child)}`;
    fs.writeFileSync(marker, markerValue, { encoding: 'utf8', flag: 'wx' });
    if (fs.readFileSync(marker, 'utf8') !== markerValue) fail('ISOLATED_MARKER');
    hooks.afterMarker?.({ child, marker });
    const actualChild = lstatOrdinary(child, 'ISOLATED_CHILD');
    if (!sameIdentity(expectedChildIdentity, actualChild)) fail('ISOLATED_CHILD_REPLACED');
    fs.unlinkSync(marker);
    fs.rmdirSync(child);
    created = false;

    const officialAfterIdentity = lstatOrdinary(officialRoot, 'OFFICIAL');
    if (!sameIdentity(officialIdentity, officialAfterIdentity)) fail('OFFICIAL_REPLACED');
    if (JSON.stringify(before) !== JSON.stringify(snapshotOfficial(officialRoot))) fail('OFFICIAL_DELTA');
    assertEmptyIsolatedBase(isolatedBase);
  } catch (error) {
    failure = error;
  } finally {
    if (created || maybeLstat(child)) {
      try {
        removeChild(child, isolatedIdentity);
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

function selfTest(options) {
  const { officialRoot, isolatedBase } = options;
  try {
    validateRoots(options);
    expectRejected('relative official', { officialRoot: 'relative', isolatedBase }, {}, 'OFFICIAL_NOT_ABSOLUTE');
    expectRejected('wrong official suffix', { officialRoot: path.dirname(officialRoot), isolatedBase }, {}, 'OFFICIAL_SUFFIX');
    expectRejected('same role path', { officialRoot, isolatedBase: officialRoot }, {}, 'ROLES_SAME');
    const reparse = path.join(officialRoot, '.official-reparse');
    fs.symlinkSync(officialRoot, reparse, 'junction');
    try {
      expectRejected('official reparse child', options, {}, 'OFFICIAL_ENTRY_REPARSE');
    } finally {
      if (maybeLstat(reparse)) fs.unlinkSync(reparse);
    }
    for (const leaf of ['diet-manager-b.sqlite3', 'diet-manager-b.sqlite3-wal', 'diet-manager-b.sqlite3-shm', 'secret', 'state']) {
      const file = path.join(officialRoot, leaf);
      fs.writeFileSync(file, 'forbidden');
      try {
        expectRejected(`official leaf ${leaf}`, options, {}, `OFFICIAL_FORBIDDEN_LEAF:${leaf}`);
      } finally {
        if (maybeLstat(file)) fs.unlinkSync(file);
      }
    }
    expectRejected('official replacement', options, {
      afterSnapshot: ({ officialRoot: root }) => {
        const source = path.join(root, '.replace-source');
        fs.writeFileSync(source, 'before');
        fs.writeFileSync(source, 'after');
      },
    }, 'OFFICIAL_DELTA');
    expectRejected('isolated leftover', options, {
      afterSnapshot: ({ isolatedBase: base }) => fs.mkdirSync(path.join(base, 'leftover')),
    }, 'ISOLATED_RESIDUE');
    fs.rmSync(path.join(isolatedBase, 'leftover'), { recursive: true, force: true });
    expectRejected('isolated child replacement', options, {
      afterMarker: ({ child }) => {
        fs.rmSync(child, { recursive: true, force: true });
        fs.mkdirSync(child);
      },
    }, 'ISOLATED_CHILD_REPLACED');
  } finally {
    fs.rmSync(path.join(isolatedBase, 'leftover'), { recursive: true, force: true });
    fs.rmSync(path.join(officialRoot, '.replace-source'), { force: true });
  }
  console.log('SEL_PANTRY_ROOTS|SELF_TEST|PASS|mutations=12|controls=1');
}

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
