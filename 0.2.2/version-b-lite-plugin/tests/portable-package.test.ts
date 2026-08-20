import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productionBuilder = join(projectRoot, "scripts", "build-portable.mjs");
const expectedFilename = "diet-manager-b-0.2.2.tgz";
const mandatoryFiles = [
  "dist/index.js",
  "dist/cli/agent.js",
  "dist/openclaw/index.js",
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
    version: options.version ?? "0.2.2",
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

    const childCalls = readFileSync(guard.calls, "utf8")
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { file: string; args: string[]; offline?: string });
    const npmCalls = childCalls.filter((call) => resolve(call.file) === resolve(process.execPath)
      && call.args[0] === npmCli);
    expect(npmCalls.map((call) => call.args.slice(1))).toEqual([
      ["pack", "--json", "--dry-run"],
      ["pack", "--json", "--pack-destination", output],
    ]);
    expect(npmCalls.map((call) => call.offline)).toEqual(["true", "true"]);
  });

  it("fails closed on a version other than exactly 0.2.2", () => {
    const fixture = makeFixture({ version: "0.2.3" });
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
