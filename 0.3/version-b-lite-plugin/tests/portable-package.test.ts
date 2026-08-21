import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productionBuilder = join(projectRoot, "scripts", "build-portable.mjs");
const expectedFilename = "diet-manager-b-0.3.0.tgz";
const mandatoryFiles = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/cli/agent.js",
  "dist/openclaw/index.js",
  "dist/openclaw/index.d.ts",
  "skills/diet-manager-b/SKILL.md",
  "skills/diet-manager-b/references/agent-command-v1.md",
] as const;
const ownedTempRoots: string[] = [];

function makeTemp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  ownedTempRoots.push(root);
  return root;
}

afterEach(() => {
  while (ownedTempRoots.length > 0) {
    const root = ownedTempRoots.pop()!;
    rmSync(root, { recursive: true, force: true });
  }
});

function currentNpmCli(): string {
  const value = process.env.npm_execpath;
  if (value === undefined || basename(value).toLowerCase() !== "npm-cli.js" || !existsSync(value)) {
    throw new Error("portable-package tests require the current npm CLI in npm_execpath");
  }
  return resolve(value);
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runBuilder(
  builder: string,
  outputDir: string,
  options: { cwd?: string; npmCli?: string; env?: NodeJS.ProcessEnv } = {},
): RunResult {
  const env = { ...process.env, ...options.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "npm_execpath") delete env[key];
  }
  env.npm_execpath = options.npmCli ?? currentNpmCli();
  const result = spawnSync(process.execPath, [builder, outputDir], {
    cwd: options.cwd ?? dirname(dirname(builder)),
    encoding: "utf8",
    env,
    windowsHide: true,
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

interface Fixture {
  readonly root: string;
  readonly builder: string;
}

function makeFixture(options: { version?: string; omit?: string; forbidden?: string } = {}): Fixture {
  const base = makeTemp("diet-portable-fixture-");
  const root = join(base, "package source");
  const builder = join(root, "scripts", "build-portable.mjs");
  mkdirSync(join(root, "scripts"), { recursive: true });
  if (existsSync(productionBuilder)) copyFileSync(productionBuilder, builder);
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    name: "diet-manager-b",
    private: true,
    version: options.version ?? "0.3.0",
    type: "module",
    files: ["dist", "skills", "openclaw.plugin.json"],
  }, null, 2)}\n`);
  writeFileSync(join(root, "openclaw.plugin.json"), "{}\n");

  const fixtureFiles = [
    ...mandatoryFiles,
    "skills/diet-manager-b/agents/openai.yaml",
  ];
  for (const path of fixtureFiles) {
    if (path === options.omit) continue;
    const target = join(root, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, path.endsWith(".md") ? "# fixture\n" : "export {};\n");
  }
  if (options.forbidden !== undefined) {
    const target = join(root, ...options.forbidden.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "export const leaked = true;\n");
  }
  return { root, builder };
}

function emptyOutput(base: string, name = "out"): string {
  const output = join(base, name);
  mkdirSync(output);
  return output;
}

function extractPackedTarball(artifact: string, destination: string): void {
  const tar = gunzipSync(readFileSync(artifact));
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return;
    const field = (start: number, length: number) => header.subarray(start, start + length)
      .toString("utf8").replace(/\0.*$/su, "");
    const path = [field(345, 155), field(0, 100)].filter(Boolean).join("/");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || !path.startsWith("package/") || path.includes("..")) {
      throw new Error("invalid npm tar entry");
    }
    const target = join(destination, ...path.split("/"));
    const type = header[156];
    if (type === 0 || type === 0x30) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, tar.subarray(offset + 512, offset + 512 + size));
    } else if (type === 0x35) {
      mkdirSync(target, { recursive: true });
    } else {
      throw new Error("unsupported npm tar entry");
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("unterminated npm tarball");
}

function writeChildProcessGuard(root: string): { hook: string; marker: string; calls: string } {
  const hook = join(root, "portable-child-guard.cjs");
  const marker = join(root, "forbidden-child-called.txt");
  const calls = join(root, "child-calls.jsonl");
  writeFileSync(hook, `
const child = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { syncBuiltinESMExports } = require("node:module");
const forbidden = /^(?:powershell|pwsh|cmd|tar|openclaw)(?:\\.exe)?$/iu;
function inspect(file, args, rest = []) {
  const rendered = typeof file === "string" ? file : String(file);
  const options = rest.find((value) => value && typeof value === "object" && !Array.isArray(value));
  fs.appendFileSync(process.env.DIET_PORTABLE_CHILD_CALLS, JSON.stringify({
    file: rendered,
    args,
    offline: options && options.env ? options.env.npm_config_offline : undefined,
  }) + "\\n");
  if (forbidden.test(path.basename(rendered))) {
    fs.appendFileSync(process.env.DIET_PORTABLE_FORBIDDEN_MARKER, path.basename(rendered) + "\\n");
    throw new Error("forbidden packaging child process");
  }
}
for (const name of ["spawn", "spawnSync", "execFile", "execFileSync"]) {
  const original = child[name];
  child[name] = function guarded(file, args, ...rest) {
    inspect(file, Array.isArray(args) ? args : [], rest);
    return original.call(this, file, args, ...rest);
  };
}
for (const name of ["exec", "execSync"]) {
  const original = child[name];
  child[name] = function guarded(command, ...rest) {
    const match = String(command).match(/(?:^|[\\\\/"'\\s])(powershell|pwsh|cmd|tar|openclaw)(?:\\.exe)?(?:\\s|$)/iu);
    if (match) inspect(match[1], []);
    return original.call(this, command, ...rest);
  };
}
syncBuiltinESMExports();
`);
  return { hook, marker, calls };
}

function writeCleanupFailureHook(root: string): { hook: string; privateRootLog: string } {
  const hook = join(root, "portable-cleanup-failure.cjs");
  const privateRootLog = join(root, "private-root.txt");
  writeFileSync(hook, `
const fs = require("node:fs");
const path = require("node:path");
const { syncBuiltinESMExports } = require("node:module");
const originalRmSync = fs.rmSync;
let injected = false;
fs.rmSync = function injectedCleanupFailure(target, options) {
  const leaf = path.basename(String(target));
  if (!injected && leaf.startsWith("diet-portable-build-") && fs.existsSync(process.env.DIET_TEST_FINAL_ARTIFACT)) {
    injected = true;
    fs.writeFileSync(process.env.DIET_TEST_PRIVATE_ROOT_LOG, String(target));
    if (process.env.DIET_TEST_REPLACE_PUBLISHED === "true") {
      originalRmSync(process.env.DIET_TEST_FINAL_ARTIFACT, { force: false });
      fs.writeFileSync(process.env.DIET_TEST_FINAL_ARTIFACT, "competitor-owned-after-publish");
    }
    const error = new Error("injected private cleanup failure");
    error.code = "EACCES";
    throw error;
  }
  return originalRmSync.call(this, target, options);
};
syncBuiltinESMExports();
`);
  return { hook, privateRootLog };
}

describe("portable npm package", () => {
  it("builds one verified tarball in a Unicode output path without platform shell tools", () => {
    const base = makeTemp("diet portable 打包-");
    const output = emptyOutput(base, "输出 artifacts 空目录");
    const guardRoot = makeTemp("diet-portable-guard-");
    const guard = writeChildProcessGuard(guardRoot);
    const npmCli = currentNpmCli();
    const existingNodeOptions = process.env.NODE_OPTIONS?.trim();
    const nodeOptions = `${existingNodeOptions === undefined || existingNodeOptions === "" ? "" : `${existingNodeOptions} `}--require=${guard.hook}`;

    const result = runBuilder(productionBuilder, output, {
      cwd: projectRoot,
      npmCli,
      env: {
        NODE_OPTIONS: nodeOptions,
        DIET_PORTABLE_CHILD_CALLS: guard.calls,
        DIET_PORTABLE_FORBIDDEN_MARKER: guard.marker,
      },
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(true);
    const receipt = JSON.parse(result.stdout) as {
      filename: string;
      integrity: string;
      size: number;
      files: string[];
    };
    expect(result.stdout).toBe(`${JSON.stringify(receipt)}\n`);
    expect(receipt.filename).toBe(expectedFilename);
    expect(receipt.files).toEqual([...receipt.files].sort());
    expect(receipt.files).toEqual(expect.arrayContaining([...mandatoryFiles]));
    expect(receipt.files.some((path) => /(?:node_modules|tests?|\.sqlite|authority-secret|\.env|secret)/iu.test(path))).toBe(false);

    const artifact = join(output, receipt.filename);
    const bytes = readFileSync(artifact);
    expect(receipt.size).toBe(bytes.length);
    expect(receipt.integrity).toBe(`sha512-${createHash("sha512").update(bytes).digest("base64")}`);
    expect(readdirSync(output)).toEqual([expectedFilename]);
    expect(existsSync(guard.marker)).toBe(false);

    const consumer = makeTemp("diet-portable-types-consumer-");
    writeFileSync(join(consumer, "package.json"), `${JSON.stringify({
      name: "diet-portable-types-consumer",
      private: true,
      type: "module",
    })}\n`);
    const unpacked = join(consumer, "unpacked");
    mkdirSync(unpacked);
    extractPackedTarball(artifact, unpacked);
    mkdirSync(join(consumer, "node_modules"));
    renameSync(join(unpacked, "package"), join(consumer, "node_modules", "diet-manager-b"));
    writeFileSync(join(consumer, "consumer.ts"), `
import {
  AGENT_COMMAND_SCHEMA_VERSION,
  type AgentCommandV1,
  type DietManagerOutcome,
} from "diet-manager-b";
const command: AgentCommandV1 = {
  schema_version: AGENT_COMMAND_SCHEMA_VERSION,
  action: "query_meals",
  source_text: "查询今天的饮食记录",
};
declare const outcome: DietManagerOutcome;
void command;
void outcome;
`);
    const typecheck = spawnSync(process.execPath, [
      join(projectRoot, "node_modules", "typescript", "bin", "tsc"),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      join(consumer, "consumer.ts"),
    ], { cwd: consumer, encoding: "utf8", windowsHide: true });
    expect(typecheck.status, typecheck.stdout + typecheck.stderr).toBe(0);

    const installedPackage = JSON.parse(readFileSync(
      join(consumer, "node_modules", "diet-manager-b", "package.json"),
      "utf8",
    )) as { exports: Record<string, { types?: string }> };
    expect(installedPackage.exports["."]?.types).toBe("./dist/index.d.ts");
    expect(installedPackage.exports["./openclaw"]?.types).toBe("./dist/openclaw/index.d.ts");
    expect(existsSync(join(consumer, "node_modules", "diet-manager-b", "dist", "index.d.ts"))).toBe(true);
    expect(existsSync(join(
      consumer,
      "node_modules",
      "diet-manager-b",
      "dist",
      "openclaw",
      "index.d.ts",
    ))).toBe(true);

    const childCalls = readFileSync(guard.calls, "utf8")
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { file: string; args: string[]; offline?: string });
    const npmCalls = childCalls.filter((call) => resolve(call.file) === resolve(process.execPath)
      && call.args[0] === npmCli);
    expect(npmCalls[0]?.args.slice(1)).toEqual(["pack", "--json", "--dry-run"]);
    expect(npmCalls[1]?.args.slice(1, 4)).toEqual(["pack", "--json", "--pack-destination"]);
    const privateDestination = npmCalls[1]?.args[4];
    expect(privateDestination).toBeTypeOf("string");
    expect(resolve(privateDestination!)).not.toBe(resolve(output));
    expect(existsSync(privateDestination!)).toBe(false);
    expect(npmCalls.map((call) => call.offline)).toEqual(["true", "true"]);
  });

  it("never writes through an output directory replaced at the real-pack synchronization point", () => {
    const fixture = makeFixture();
    const output = emptyOutput(fixture.root, "final-output");
    const attacker = emptyOutput(fixture.root, "attacker-output");
    const competitor = join(attacker, expectedFilename);
    writeFileSync(competitor, "competitor-owned-bytes");
    const npmWrapper = join(fixture.root, "npm-cli.js");
    writeFileSync(npmWrapper, `
import { spawnSync } from "node:child_process";
import { rmdirSync, symlinkSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--pack-destination")) {
  rmdirSync(process.env.DIET_TEST_FINAL_OUTPUT);
  symlinkSync(
    process.env.DIET_TEST_ATTACKER_OUTPUT,
    process.env.DIET_TEST_FINAL_OUTPUT,
    process.platform === "win32" ? "junction" : "dir",
  );
}
const result = spawnSync(process.execPath, [process.env.DIET_TEST_REAL_NPM_CLI, ...args], {
  cwd: process.cwd(), encoding: "utf8", env: process.env, windowsHide: true,
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exitCode = result.status ?? 1;
`);
    const result = runBuilder(fixture.builder, output, {
      cwd: fixture.root,
      npmCli: npmWrapper,
      env: {
        DIET_TEST_REAL_NPM_CLI: currentNpmCli(),
        DIET_TEST_FINAL_OUTPUT: output,
        DIET_TEST_ATTACKER_OUTPUT: attacker,
      },
    });
    expect(result).toEqual({ code: 1, stdout: "", stderr: "DIET_PORTABLE_BUILD_OUTPUT_CHANGED\n" });
    expect(lstatSync(output).isSymbolicLink()).toBe(true);
    expect(readFileSync(competitor, "utf8")).toBe("competitor-owned-bytes");
    expect(readdirSync(attacker)).toEqual([expectedFilename]);
  });

  it("never overwrites a same-name file created at the real-pack synchronization point", () => {
    const fixture = makeFixture();
    const output = emptyOutput(fixture.root, "final-output");
    const competitor = join(output, expectedFilename);
    const npmWrapper = join(fixture.root, "npm-cli.js");
    writeFileSync(npmWrapper, `
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--pack-destination")) {
  writeFileSync(join(process.env.DIET_TEST_FINAL_OUTPUT, "${expectedFilename}"), "competitor-owned-bytes");
}
const result = spawnSync(process.execPath, [process.env.DIET_TEST_REAL_NPM_CLI, ...args], {
  cwd: process.cwd(), encoding: "utf8", env: process.env, windowsHide: true,
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exitCode = result.status ?? 1;
`);
    const result = runBuilder(fixture.builder, output, {
      cwd: fixture.root,
      npmCli: npmWrapper,
      env: {
        DIET_TEST_REAL_NPM_CLI: currentNpmCli(),
        DIET_TEST_FINAL_OUTPUT: output,
      },
    });
    expect(result).toEqual({ code: 1, stdout: "", stderr: "DIET_PORTABLE_BUILD_OUTPUT_EXISTS\n" });
    expect(readFileSync(competitor, "utf8")).toBe("competitor-owned-bytes");
    expect(readdirSync(output)).toEqual([expectedFilename]);
  });

  it("maps a post-publication cleanup failure and revokes its own artifact", () => {
    const fixture = makeFixture();
    const output = emptyOutput(fixture.root, "final-output");
    const artifact = join(output, expectedFilename);
    const hookRoot = makeTemp("diet-portable-cleanup-hook-");
    const fault = writeCleanupFailureHook(hookRoot);
    const result = runBuilder(fixture.builder, output, {
      cwd: fixture.root,
      env: {
        NODE_OPTIONS: `--require=${fault.hook}`,
        DIET_TEST_FINAL_ARTIFACT: artifact,
        DIET_TEST_PRIVATE_ROOT_LOG: fault.privateRootLog,
        DIET_TEST_REPLACE_PUBLISHED: "false",
      },
    });
    expect(result).toEqual({ code: 1, stdout: "", stderr: "DIET_PORTABLE_BUILD_CLEANUP_FAILED\n" });
    expect(readdirSync(output)).toEqual([]);
    const privateRoot = readFileSync(fault.privateRootLog, "utf8");
    expect(existsSync(privateRoot)).toBe(false);
    expect(result.stderr).not.toContain(privateRoot);
  });

  it("does not revoke a competitor replacement after post-publication cleanup failure", () => {
    const fixture = makeFixture();
    const output = emptyOutput(fixture.root, "final-output");
    const artifact = join(output, expectedFilename);
    const hookRoot = makeTemp("diet-portable-cleanup-hook-");
    const fault = writeCleanupFailureHook(hookRoot);
    const result = runBuilder(fixture.builder, output, {
      cwd: fixture.root,
      env: {
        NODE_OPTIONS: `--require=${fault.hook}`,
        DIET_TEST_FINAL_ARTIFACT: artifact,
        DIET_TEST_PRIVATE_ROOT_LOG: fault.privateRootLog,
        DIET_TEST_REPLACE_PUBLISHED: "true",
      },
    });
    expect(result).toEqual({ code: 1, stdout: "", stderr: "DIET_PORTABLE_BUILD_CLEANUP_FAILED\n" });
    expect(readFileSync(artifact, "utf8")).toBe("competitor-owned-after-publish");
    expect(readdirSync(output)).toEqual([expectedFilename]);
    const privateRoot = readFileSync(fault.privateRootLog, "utf8");
    expect(existsSync(privateRoot)).toBe(false);
  });

  it("fails closed on a version other than exactly 0.3.0", () => {
    const fixture = makeFixture({ version: "0.2.2" });
    const output = emptyOutput(fixture.root);
    const result = runBuilder(fixture.builder, output, { cwd: fixture.root });
    expect(result).toEqual({ code: 1, stdout: "", stderr: "DIET_PORTABLE_BUILD_VERSION_MISMATCH\n" });
    expect(readdirSync(output)).toEqual([]);
    expect(result.stderr).not.toContain(fixture.root);
  });

  it.each(mandatoryFiles)("fails closed before packing when the mandatory path %s is missing", (missingPath) => {
    const fixture = makeFixture({ omit: missingPath });
    const output = emptyOutput(fixture.root);
    const result = runBuilder(fixture.builder, output, { cwd: fixture.root });
    expect(result).toEqual({ code: 1, stdout: "", stderr: "DIET_PORTABLE_BUILD_REQUIRED_FILE_MISSING\n" });
    expect(readdirSync(output)).toEqual([]);
  });

  it("rejects a forbidden file reported by npm dry-run", () => {
    const fixture = makeFixture({ forbidden: "dist/authority-secret.js" });
    const output = emptyOutput(fixture.root);
    const result = runBuilder(fixture.builder, output, { cwd: fixture.root });
    expect(result).toEqual({ code: 1, stdout: "", stderr: "DIET_PORTABLE_BUILD_FORBIDDEN_FILE\n" });
    expect(readdirSync(output)).toEqual([]);
    expect(result.stderr).not.toContain("authority-secret");
  });

  it.each([
    "dist/node_modules/credential.js",
    "dist/tests/fixture.js",
    "dist/cache.sqlite3",
    "dist/.env.js",
    "dist/secret.js",
  ])("rejects the forbidden npm dry-run path %s", (forbiddenPath) => {
    const fixture = makeFixture();
    const output = emptyOutput(fixture.root);
    const npmWrapper = join(fixture.root, "npm-cli.js");
    writeFileSync(npmWrapper, `
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [process.env.DIET_TEST_REAL_NPM_CLI, ...args], {
  cwd: process.cwd(), encoding: "utf8", env: process.env, windowsHide: true,
});
if ((result.status ?? -1) !== 0) {
  process.stderr.write(result.stderr ?? "");
  process.exitCode = result.status ?? 1;
} else {
  const parsed = JSON.parse(result.stdout);
  if (args.includes("--dry-run")) parsed[0].files.push({ path: process.env.DIET_TEST_FORBIDDEN_PATH, size: 1, mode: 420 });
  process.stdout.write(JSON.stringify(parsed));
}
`);
    const result = runBuilder(fixture.builder, output, {
      cwd: fixture.root,
      npmCli: npmWrapper,
      env: {
        DIET_TEST_REAL_NPM_CLI: currentNpmCli(),
        DIET_TEST_FORBIDDEN_PATH: forbiddenPath,
      },
    });
    expect(result).toEqual({ code: 1, stdout: "", stderr: "DIET_PORTABLE_BUILD_FORBIDDEN_FILE\n" });
    expect(readdirSync(output)).toEqual([]);
    expect(result.stderr).not.toContain(forbiddenPath);
  });

  it("rejects a non-sensitive path outside the package whitelist", () => {
    const fixture = makeFixture();
    const output = emptyOutput(fixture.root);
    const npmWrapper = join(fixture.root, "npm-cli.js");
    writeFileSync(npmWrapper, `
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [process.env.DIET_TEST_REAL_NPM_CLI, ...args], {
  cwd: process.cwd(), encoding: "utf8", env: process.env, windowsHide: true,
});
if ((result.status ?? -1) !== 0) {
  process.stderr.write(result.stderr ?? "");
  process.exitCode = result.status ?? 1;
} else {
  const parsed = JSON.parse(result.stdout);
  if (args.includes("--dry-run")) parsed[0].files.push({ path: "docs/guide.md", size: 1, mode: 420 });
  process.stdout.write(JSON.stringify(parsed));
}
`);
    const result = runBuilder(fixture.builder, output, {
      cwd: fixture.root,
      npmCli: npmWrapper,
      env: { DIET_TEST_REAL_NPM_CLI: currentNpmCli() },
    });
    expect(result).toEqual({ code: 1, stdout: "", stderr: "DIET_PORTABLE_BUILD_FILE_NOT_ALLOWED\n" });
    expect(readdirSync(output)).toEqual([]);
  });

  it.each([
    ["case-fold", ["dist/A.js", "dist/a.js"]],
    ["Unicode NFC/NFD", ["dist/caf\u00e9.js", "dist/cafe\u0301.js"]],
    ["slash-normalized", ["dist\\A.js", "dist/A.js"]],
  ])("rejects %s-equivalent npm paths before real packing", (_label, equivalentPaths) => {
    const fixture = makeFixture();
    const output = emptyOutput(fixture.root);
    const npmWrapper = join(fixture.root, "npm-cli.js");
    writeFileSync(npmWrapper, `
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [process.env.DIET_TEST_REAL_NPM_CLI, ...args], {
  cwd: process.cwd(), encoding: "utf8", env: process.env, windowsHide: true,
});
if ((result.status ?? -1) !== 0) {
  process.stderr.write(result.stderr ?? "");
  process.exitCode = result.status ?? 1;
} else {
  const parsed = JSON.parse(result.stdout);
  if (args.includes("--dry-run")) {
    for (const path of JSON.parse(process.env.DIET_TEST_EQUIVALENT_PATHS)) {
      parsed[0].files.push({ path, size: 1, mode: 420 });
    }
  }
  process.stdout.write(JSON.stringify(parsed));
}
`);
    const result = runBuilder(fixture.builder, output, {
      cwd: fixture.root,
      npmCli: npmWrapper,
      env: {
        DIET_TEST_REAL_NPM_CLI: currentNpmCli(),
        DIET_TEST_EQUIVALENT_PATHS: JSON.stringify(equivalentPaths),
      },
    });
    expect(result).toEqual({ code: 1, stdout: "", stderr: "DIET_PORTABLE_BUILD_PATH_COLLISION\n" });
    expect(readdirSync(output)).toEqual([]);
    expect(equivalentPaths.every((path) => !result.stderr.includes(path))).toBe(true);
  });

  it("does not overwrite an existing destination artifact", () => {
    const fixture = makeFixture();
    const output = emptyOutput(fixture.root);
    const artifact = join(output, expectedFilename);
    writeFileSync(artifact, "original artifact bytes");
    const before = readFileSync(artifact);
    const result = runBuilder(fixture.builder, output, { cwd: fixture.root });
    expect(result).toEqual({ code: 1, stdout: "", stderr: "DIET_PORTABLE_BUILD_OUTPUT_EXISTS\n" });
    expect(readFileSync(artifact).equals(before)).toBe(true);
  });

  it("requires an ordinary empty output directory", () => {
    const fixture = makeFixture();
    const nonempty = emptyOutput(fixture.root, "nonempty");
    writeFileSync(join(nonempty, "keep.txt"), "keep");
    const nonemptyResult = runBuilder(fixture.builder, nonempty, { cwd: fixture.root });
    expect(nonemptyResult).toEqual({ code: 1, stdout: "", stderr: "DIET_PORTABLE_BUILD_OUTPUT_NOT_EMPTY\n" });
    expect(readFileSync(join(nonempty, "keep.txt"), "utf8")).toBe("keep");

    const target = emptyOutput(fixture.root, "real-output");
    const linked = join(fixture.root, "linked-output");
    symlinkSync(target, linked, process.platform === "win32" ? "junction" : "dir");
    const linkedResult = runBuilder(fixture.builder, linked, { cwd: fixture.root });
    expect(linkedResult).toEqual({ code: 1, stdout: "", stderr: "DIET_PORTABLE_BUILD_OUTPUT_NOT_ORDINARY\n" });
    expect(readdirSync(target)).toEqual([]);
  });

  it("removes the new artifact and fails if real npm files differ from dry-run", () => {
    const fixture = makeFixture();
    const output = emptyOutput(fixture.root);
    const npmWrapper = join(fixture.root, "npm-cli.js");
    writeFileSync(npmWrapper, `
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [process.env.DIET_TEST_REAL_NPM_CLI, ...args], {
  cwd: process.cwd(), encoding: "utf8", env: process.env, windowsHide: true,
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if ((result.status ?? -1) === 0 && args.includes("--dry-run")) {
  const changed = join(process.cwd(), "dist", "after-dry-run.js");
  mkdirSync(dirname(changed), { recursive: true });
  writeFileSync(changed, "export const changed = true;\\n");
}
process.exitCode = result.status ?? 1;
`);
    const result = runBuilder(fixture.builder, output, {
      cwd: fixture.root,
      npmCli: npmWrapper,
      env: { DIET_TEST_REAL_NPM_CLI: currentNpmCli() },
    });
    expect(result).toEqual({ code: 1, stdout: "", stderr: "DIET_PORTABLE_BUILD_FILE_LIST_MISMATCH\n" });
    expect(readdirSync(output)).toEqual([]);
  });
});
