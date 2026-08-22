import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_NAME = "diet-manager-b";
const EXPECTED_VERSION = "0.3.0";
const EXPECTED_FILENAME = `${EXPECTED_NAME}-${EXPECTED_VERSION}.tgz`;
const REQUIRED_FILES = Object.freeze([
  "dist/index.js",
  "dist/index.d.ts",
  "dist/cli/agent.js",
  "dist/openclaw/index.js",
  "dist/openclaw/index.d.ts",
  "skills/diet-manager-b/SKILL.md",
  "skills/diet-manager-b/references/agent-command-v2.md",
  "skills/diet-manager-b/references/natural-language-boundaries.md",
  "skills/diet-manager-b/references/receipt-and-progress.md",
  "skills/diet-manager-b/references/inventory-and-nutrition.md",
  "skills/diet-manager-b/references/correction-and-recovery.md",
]);
const EXACT_ALLOWED_FILES = new Set([
  "package.json",
  "openclaw.plugin.json",
  "skills/diet-manager-b/SKILL.md",
  "skills/diet-manager-b/agents/openai.yaml",
  "skills/diet-manager-b/references/agent-command-v2.md",
  "skills/diet-manager-b/references/natural-language-boundaries.md",
  "skills/diet-manager-b/references/receipt-and-progress.md",
  "skills/diet-manager-b/references/inventory-and-nutrition.md",
  "skills/diet-manager-b/references/correction-and-recovery.md",
]);
const FORBIDDEN_PATH = /(?:^|\/)(?:node_modules|tests?|__tests__)(?:\/|$)|(?:^|\/)\.env(?:[./]|$)|\.sqlite(?:3)?(?:[./-]|$)|authority[-_]?secret|secret/iu;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

class BuildError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new BuildError(code);
}

function ordinaryFile(path, code) {
  try {
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink()) fail(code);
  } catch (error) {
    if (error instanceof BuildError) throw error;
    fail(code);
  }
}

function loadPackage() {
  const packagePath = join(projectRoot, "package.json");
  ordinaryFile(packagePath, "DIET_PORTABLE_BUILD_PACKAGE_INVALID");
  let value;
  try {
    value = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch {
    fail("DIET_PORTABLE_BUILD_PACKAGE_INVALID");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("DIET_PORTABLE_BUILD_PACKAGE_INVALID");
  }
  if (value.name !== EXPECTED_NAME || value.version !== EXPECTED_VERSION) {
    fail("DIET_PORTABLE_BUILD_VERSION_MISMATCH");
  }
  return value;
}

function requireFiles() {
  for (const relativePath of REQUIRED_FILES) {
    ordinaryFile(join(projectRoot, ...relativePath.split("/")), "DIET_PORTABLE_BUILD_REQUIRED_FILE_MISSING");
  }
}

function resolveNpmCli() {
  const candidate = process.env.npm_execpath;
  if (typeof candidate !== "string" || candidate.length === 0 || basename(candidate).toLowerCase() !== "npm-cli.js") {
    fail("DIET_PORTABLE_BUILD_NPM_CLI_REQUIRED");
  }
  const npmCli = resolve(candidate);
  ordinaryFile(npmCli, "DIET_PORTABLE_BUILD_NPM_CLI_REQUIRED");
  return npmCli;
}

function readOutputIdentity(outputDir, errorCode) {
  let stats;
  let realPath;
  try {
    stats = lstatSync(outputDir);
    realPath = realpathSync.native(outputDir);
  } catch {
    fail(errorCode);
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(errorCode);
  return Object.freeze({
    dev: stats.dev,
    ino: stats.ino,
    realPath,
  });
}

function sameOutputIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.realPath === right.realPath;
}

function validateOutputDirectory(argument) {
  if (typeof argument !== "string" || argument.length === 0) {
    fail("DIET_PORTABLE_BUILD_ARGUMENTS_INVALID");
  }
  const outputDir = resolve(argument);
  const identity = readOutputIdentity(outputDir, "DIET_PORTABLE_BUILD_OUTPUT_NOT_ORDINARY");
  const artifactPath = join(outputDir, EXPECTED_FILENAME);
  if (existsSync(artifactPath)) fail("DIET_PORTABLE_BUILD_OUTPUT_EXISTS");
  let entries;
  try {
    entries = readdirSync(outputDir);
  } catch {
    fail("DIET_PORTABLE_BUILD_OUTPUT_NOT_ORDINARY");
  }
  if (entries.length !== 0) fail("DIET_PORTABLE_BUILD_OUTPUT_NOT_EMPTY");
  return Object.freeze({ outputDir, artifactPath, identity });
}

function revalidateOutputDirectory(output) {
  const current = readOutputIdentity(output.outputDir, "DIET_PORTABLE_BUILD_OUTPUT_CHANGED");
  if (!sameOutputIdentity(current, output.identity)) fail("DIET_PORTABLE_BUILD_OUTPUT_CHANGED");
  if (existsSync(output.artifactPath)) fail("DIET_PORTABLE_BUILD_OUTPUT_EXISTS");
  let entries;
  try {
    entries = readdirSync(output.outputDir);
  } catch {
    fail("DIET_PORTABLE_BUILD_OUTPUT_CHANGED");
  }
  if (entries.length !== 0) fail("DIET_PORTABLE_BUILD_OUTPUT_NOT_EMPTY");
}

function assertOutputIdentityUnchanged(output) {
  const current = readOutputIdentity(output.outputDir, "DIET_PORTABLE_BUILD_OUTPUT_CHANGED");
  if (!sameOutputIdentity(current, output.identity)) fail("DIET_PORTABLE_BUILD_OUTPUT_CHANGED");
}

function npmEnvironment(cacheRoot) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "npm_config_cache") delete env[key];
  }
  return {
    ...env,
    npm_config_cache: cacheRoot,
    npm_config_offline: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
    npm_config_loglevel: "silent",
  };
}

function runNpm(npmCli, args, cacheRoot) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: npmEnvironment(cacheRoot),
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error !== undefined || result.signal !== null || result.status !== 0) {
    fail("DIET_PORTABLE_BUILD_NPM_FAILED");
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    fail("DIET_PORTABLE_BUILD_NPM_OUTPUT_INVALID");
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null || typeof parsed[0] !== "object") {
    fail("DIET_PORTABLE_BUILD_NPM_OUTPUT_INVALID");
  }
  return parsed[0];
}

function lexicalSort(paths) {
  return [...paths].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function validatePackResult(result) {
  if (result.name !== EXPECTED_NAME || result.version !== EXPECTED_VERSION || result.filename !== EXPECTED_FILENAME) {
    fail("DIET_PORTABLE_BUILD_NPM_OUTPUT_INVALID");
  }
  if (!Array.isArray(result.files)) fail("DIET_PORTABLE_BUILD_NPM_OUTPUT_INVALID");
  const paths = [];
  const slashPaths = new Map();
  const collisionKeys = new Map();
  for (const file of result.files) {
    if (file === null || typeof file !== "object" || typeof file.path !== "string" || file.path.length === 0) {
      fail("DIET_PORTABLE_BUILD_NPM_OUTPUT_INVALID");
    }
    const slashPath = file.path.replaceAll("\\", "/");
    const segments = slashPath.split("/");
    if (slashPath.startsWith("/")
      || /^[A-Za-z]:\//u.test(slashPath)
      || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      fail("DIET_PORTABLE_BUILD_NPM_OUTPUT_INVALID");
    }
    paths.push(file.path);
    slashPaths.set(file.path, slashPath);
  }
  if (new Set(paths).size !== paths.length) fail("DIET_PORTABLE_BUILD_NPM_OUTPUT_INVALID");
  for (const path of paths) {
    const collisionKey = slashPaths.get(path).normalize("NFC").toLowerCase().normalize("NFC");
    const previous = collisionKeys.get(collisionKey);
    if (previous !== undefined && previous !== path) fail("DIET_PORTABLE_BUILD_PATH_COLLISION");
    collisionKeys.set(collisionKey, path);
  }
  const sorted = lexicalSort(paths);
  for (const path of sorted) {
    const slashPath = slashPaths.get(path);
    if (FORBIDDEN_PATH.test(slashPath)) fail("DIET_PORTABLE_BUILD_FORBIDDEN_FILE");
    const allowed = EXACT_ALLOWED_FILES.has(slashPath)
      || /^dist\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:js|d\.ts)$/u.test(slashPath);
    if (!allowed) fail("DIET_PORTABLE_BUILD_FILE_NOT_ALLOWED");
  }
  const normalizedPaths = [...slashPaths.values()];
  for (const required of REQUIRED_FILES) {
    if (!normalizedPaths.includes(required)) fail("DIET_PORTABLE_BUILD_REQUIRED_FILE_MISSING");
  }
  return sorted;
}

function readArtifactIdentity(artifactPath, errorCode) {
  try {
    const stats = lstatSync(artifactPath);
    if (!stats.isFile() || stats.isSymbolicLink()) fail(errorCode);
    return Object.freeze({
      dev: stats.dev,
      ino: stats.ino,
      birthtimeMs: stats.birthtimeMs,
      size: stats.size,
    });
  } catch (error) {
    if (error instanceof BuildError) throw error;
    fail(errorCode);
  }
}

function sameArtifactIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeMs === right.birthtimeMs
    && left.size === right.size;
}

function revokeOwnedArtifact(artifactPath, ownedIdentity) {
  if (ownedIdentity === undefined || !existsSync(artifactPath)) return;
  try {
    const current = readArtifactIdentity(artifactPath, "DIET_PORTABLE_BUILD_ARTIFACT_INVALID");
    if (sameArtifactIdentity(current, ownedIdentity)) rmSync(artifactPath, { force: false });
  } catch {
    // Never broaden cleanup to a path whose current identity cannot be proven.
  }
}

function verifyArtifact(realResult, artifactPath) {
  ordinaryFile(artifactPath, "DIET_PORTABLE_BUILD_ARTIFACT_INVALID");
  if (!Number.isSafeInteger(realResult.size) || realResult.size < 1 || typeof realResult.integrity !== "string") {
    fail("DIET_PORTABLE_BUILD_NPM_OUTPUT_INVALID");
  }
  const bytes = readFileSync(artifactPath);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (statSync(artifactPath).size !== bytes.length || realResult.size !== bytes.length || realResult.integrity !== integrity) {
    fail("DIET_PORTABLE_BUILD_INTEGRITY_MISMATCH");
  }
  return { integrity, size: bytes.length };
}

function publishArtifact(stagedArtifact, output) {
  revalidateOutputDirectory(output);
  try {
    copyFileSync(stagedArtifact, output.artifactPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error !== null && typeof error === "object" && error.code === "EEXIST") {
      fail("DIET_PORTABLE_BUILD_OUTPUT_EXISTS");
    }
    fail("DIET_PORTABLE_BUILD_PUBLISH_FAILED");
  }
  return readArtifactIdentity(output.artifactPath, "DIET_PORTABLE_BUILD_ARTIFACT_INVALID");
}

function cleanupPrivateRoot(privateRoot) {
  try {
    rmSync(privateRoot, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function main() {
  if (process.argv.length !== 3) fail("DIET_PORTABLE_BUILD_ARGUMENTS_INVALID");
  loadPackage();
  requireFiles();
  const npmCli = resolveNpmCli();
  const output = validateOutputDirectory(process.argv[2]);
  const privateRoot = mkdtempSync(join(tmpdir(), "diet-portable-build-"));
  const cacheRoot = join(privateRoot, "npm-cache");
  const stagingRoot = join(privateRoot, "staging");
  mkdirSync(cacheRoot, { mode: 0o700 });
  mkdirSync(stagingRoot, { mode: 0o700 });
  const stagedArtifact = join(stagingRoot, EXPECTED_FILENAME);
  let receipt;
  let publishedIdentity;
  let buildFailure;
  try {
    const dryResult = runNpm(npmCli, ["pack", "--json", "--dry-run"], cacheRoot);
    const dryFiles = validatePackResult(dryResult);
    const realResult = runNpm(npmCli, ["pack", "--json", "--pack-destination", stagingRoot], cacheRoot);
    const realFiles = validatePackResult(realResult);
    if (JSON.stringify(realFiles) !== JSON.stringify(dryFiles)) {
      fail("DIET_PORTABLE_BUILD_FILE_LIST_MISMATCH");
    }
    const stagingEntries = readdirSync(stagingRoot);
    if (stagingEntries.length !== 1 || stagingEntries[0] !== EXPECTED_FILENAME) {
      fail("DIET_PORTABLE_BUILD_ARTIFACT_INVALID");
    }
    const verified = verifyArtifact(realResult, stagedArtifact);
    publishedIdentity = publishArtifact(stagedArtifact, output);
    assertOutputIdentityUnchanged(output);
    verifyArtifact(realResult, output.artifactPath);
    receipt = {
      filename: EXPECTED_FILENAME,
      integrity: verified.integrity,
      size: verified.size,
      files: dryFiles,
    };
  } catch (error) {
    buildFailure = error;
  }
  const cleaned = cleanupPrivateRoot(privateRoot);
  if (buildFailure !== undefined || !cleaned) {
    revokeOwnedArtifact(output.artifactPath, publishedIdentity);
    if (!cleaned) cleanupPrivateRoot(privateRoot);
    if (!cleaned) fail("DIET_PORTABLE_BUILD_CLEANUP_FAILED");
    throw buildFailure;
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

try {
  main();
} catch (error) {
  const code = error instanceof BuildError ? error.code : "DIET_PORTABLE_BUILD_UNAVAILABLE";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
