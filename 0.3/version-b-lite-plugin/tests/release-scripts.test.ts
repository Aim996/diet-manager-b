// release-scripts.test.ts
// 饮食管家 B 不可变候选构建与校验工具（Task 17）的失败闭合测试。
//
// 用临时 Git 夹具验证 build-release.ps1 对脏树、版本不符、缺失验收资产、
// src/dist 模块不匹配、禁入文件（sqlite/secret/.env）、既有输出根全部失败闭合；
// 合法夹具必须产出按斜杠相对路径字典序排列且为大写 SHA-256 的产物，
// 且 ZIP 字节完全确定（两次构建一致）。validate-release.ps1 对候选
// 篡改（post-build mutation）必须闭合，对干净候选必须通过。

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(here, "..");
const buildRelease = join(projectDir, "scripts", "build-release.ps1");
const validateRelease = join(projectDir, "scripts", "validate-release.ps1");
const fakeOpenClaw = join(projectDir, "tests", "fixtures", "install", "fake-openclaw.ps1");
const nodePath = process.execPath;

function resolvePwsh(): string {
  const probe = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (probe.status === 0) return "pwsh";
  const candidates = [
    "C:/Users/10481/AppData/Local/Microsoft/WindowsApps/pwsh.exe",
    "C:/Program Files/PowerShell/7/pwsh.exe",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("pwsh not found");
}

function resolveGit(): string {
  const probe = spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
  if (probe.status === 0) return "git";
  const candidates = ["C:/Program Files/Git/cmd/git.exe", "C:/Program Files/Git/bin/git.exe"];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("git not found");
}

const pwsh = resolvePwsh();
const git = resolveGit();

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runScript(script: string, args: string[], cwd: string): RunResult {
  const result = spawnSync(pwsh, ["-NoProfile", "-NonInteractive", "-File", script, ...args], {
    encoding: "utf8",
    windowsHide: true,
    cwd,
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function runGit(args: string[], cwd: string): RunResult {
  const result = spawnSync(git, args, { encoding: "utf8", windowsHide: true, cwd });
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function sha256HexUpper(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex").toUpperCase();
}

// 与 build-release.ps1 内嵌 Node 助手完全一致的验收资产合成 SHA 算法。
function acceptanceCompositeSha(files: Array<{ path: string; sha256: string }>): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const obj = { schema_version: "diet-manager/release-inputs/v1", files: sorted };
  return sha256HexUpper(JSON.stringify(obj));
}

// 解析 ZIP 中央目录，按写入顺序返回条目名。
function zipEntryNames(buf: Buffer): string[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP EOCD not found");
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  let off = cdOffset;
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("bad central directory header");
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    names.push(buf.toString("utf8", off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

const v10DocContent = "# 开发约束与需求 v1.0\n测试夹具。\n";
const scenariosContent = JSON.stringify({
  schema_version: "diet-manager/real-acceptance-scenarios/v1",
  scenarios: [],
});
const evidenceSchemaContent = JSON.stringify({
  $id: "diet-manager/real-acceptance-evidence/v1",
  type: "object",
});
const runnerContent = "# run-real-acceptance.ps1 stub\n";
const packageJsonContent = (version: string): string =>
  `${JSON.stringify({ name: "diet-manager-b", version, type: "module" }, null, 2)}\n`;
const pluginJsonContent = (version: string): string =>
  `${JSON.stringify({ id: "diet-manager-b", name: "Diet Manager B", version }, null, 2)}\n`;
const pnpmLockContent = `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      typebox:
        specifier: ^1.3.3
        version: 1.3.11
    devDependencies:
      vitest:
        specifier: ^2.0.0
        version: 2.1.9

packages:
  typebox@1.3.11:
    resolution: {integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}
  vitest@2.1.9:
    resolution: {integrity: sha512-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB==}
`;
const srcIndex = "export {};\n";
const srcParser = "export const parseCommand = (s: string) => s;\n";
const distIndex = "export {};\n";
const distParser = "export const parseCommand = (s) => s;\n";
const skillContent = "# Diet Manager B\n";
const installScriptContent = "# install-diet-manager.ps1 stub\n";
const installModuleContent = "# DietManagerInstall.psm1 stub\n";
const releaseValidatorContent = "process.stdout.write('{}\\n');\n";
const pluginReadmeContent = "# diet-manager-b\n";

interface Fixture {
  base: string;
  repoRoot: string;
  productRoot: string;
  sourceCommit: string;
  cleanup: () => void;
}

interface FixtureOptions {
  packageVersion?: string;
  pluginVersion?: string;
  extraSrc?: string;
  omitAcceptanceAsset?: boolean;
  forbiddenFile?: string;
  uncommitted?: boolean;
}

function makeFixture(options: FixtureOptions = {}): Fixture {
  const base = mkdtempSync(join(tmpdir(), "diet-manager-release-"));
  const repoRoot = join(base, "repo");
  const productRoot = join(repoRoot, "version-b-lite-plugin");
  const acceptance = join(repoRoot, "shared", "real-acceptance");
  const srcDir = join(productRoot, "src", "parser");
  const distDir = join(productRoot, "dist", "parser");
  mkdirSync(acceptance, { recursive: true });
  mkdirSync(join(productRoot, "src"), { recursive: true });
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(join(productRoot, "dist"), { recursive: true });
  mkdirSync(distDir, { recursive: true });
  mkdirSync(join(productRoot, "skills", "diet-manager-b"), { recursive: true });
  mkdirSync(join(productRoot, "scripts", "modules"), { recursive: true });

  writeFileSync(join(repoRoot, "饮食管家-开发约束与需求-v1.0.md"), v10DocContent);
  writeFileSync(join(acceptance, "scenarios.json"), scenariosContent);
  writeFileSync(join(acceptance, "evidence.schema.json"), evidenceSchemaContent);
  writeFileSync(join(acceptance, "run-real-acceptance.ps1"), runnerContent);
  if (options.omitAcceptanceAsset) {
    rmSync(join(acceptance, "scenarios.json"));
  }

  writeFileSync(join(productRoot, "package.json"), packageJsonContent(options.packageVersion ?? "0.3.0"));
  writeFileSync(join(productRoot, "openclaw.plugin.json"), pluginJsonContent(options.pluginVersion ?? "0.3.0"));
  writeFileSync(join(productRoot, "pnpm-lock.yaml"), pnpmLockContent);
  writeFileSync(join(productRoot, "README.md"), pluginReadmeContent);
  writeFileSync(join(productRoot, "src", "index.ts"), srcIndex);
  writeFileSync(join(srcDir, "parse-command.ts"), srcParser);
  if (options.extraSrc) {
    writeFileSync(join(srcDir, options.extraSrc), "export const extra = 1;\n");
  }
  writeFileSync(join(productRoot, "dist", "index.js"), distIndex);
  writeFileSync(join(distDir, "parse-command.js"), distParser);
  writeFileSync(join(productRoot, "skills", "diet-manager-b", "SKILL.md"), skillContent);
  writeFileSync(join(productRoot, "scripts", "install-diet-manager.ps1"), installScriptContent);
  writeFileSync(join(productRoot, "scripts", "validate-0.3.mjs"), releaseValidatorContent);
  writeFileSync(join(productRoot, "scripts", "modules", "DietManagerInstall.psm1"), installModuleContent);
  // 复制真实模板文件，让夹具构建路径与生产完全一致。
  for (const name of ["release-manifest.template.json", "release-readme.template.md", "release-changelog.template.md"]) {
    writeFileSync(join(productRoot, name), readFileSync(join(projectDir, name)));
  }
  if (options.forbiddenFile) {
    writeFileSync(join(productRoot, options.forbiddenFile), "secret-bytes");
  }

  runGit(["init", "-b", "main"], repoRoot);
  runGit(["config", "user.email", "test@example.com"], repoRoot);
  runGit(["config", "user.name", "Test Fixture"], repoRoot);
  runGit(["config", "core.autocrlf", "false"], repoRoot);
  runGit(["add", "-A"], repoRoot);
  runGit(["commit", "-m", "fixture"], repoRoot);

  if (options.uncommitted) {
    writeFileSync(join(productRoot, "package.json"), packageJsonContent("0.3.0") + "// dirty\n");
  }

  const commit = runGit(["rev-parse", "HEAD"], repoRoot);
  expect(commit.code).toBe(0);

  return {
    base,
    repoRoot,
    productRoot,
    sourceCommit: commit.stdout.trim(),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

function buildArgs(repoRoot: string, productRoot: string, outputRoot: string, sourceCommit: string): string[] {
  return [
    "-CandidateNumber", "1",
    "-RepositoryRoot", repoRoot,
    "-ProductRoot", productRoot,
    "-OutputRoot", outputRoot,
    "-SourceCommit", sourceCommit,
    "-NodePath", nodePath,
    "-OpenClawPath", fakeOpenClaw,
    "-PnpmPath", "pnpm",
    "-GitPath", git,
    "-SkipBuildValidate",
  ];
}

const expectedSourceModules = ["src/index.ts", "src/parser/parse-command.ts"];
const expectedZipEntries = [
  "README.md",
  "dist/index.js",
  "dist/parser/parse-command.js",
  "openclaw.plugin.json",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/install-diet-manager.ps1",
  "scripts/modules/DietManagerInstall.psm1",
  "skills/diet-manager-b/SKILL.md",
];

test("build-release fails closed on a dirty working tree", () => {
  const fx = makeFixture({ uncommitted: true });
  try {
    const outputRoot = join(fx.base, "out");
    const r = runScript(buildRelease, buildArgs(fx.repoRoot, fx.productRoot, outputRoot, fx.sourceCommit), fx.repoRoot);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/BUILD_RELEASE\|FAIL\|BUILD_RELEASE_DIRTY_TREE/);
  } finally {
    fx.cleanup();
  }
});

test("build-release fails closed on a wrong package version", () => {
  const fx = makeFixture({ packageVersion: "0.1.0" });
  try {
    const outputRoot = join(fx.base, "out");
    const r = runScript(buildRelease, buildArgs(fx.repoRoot, fx.productRoot, outputRoot, fx.sourceCommit), fx.repoRoot);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/BUILD_RELEASE\|FAIL\|BUILD_RELEASE_VERSION_MISMATCH/);
  } finally {
    fx.cleanup();
  }
});

test("build-release fails closed when Task 16 acceptance assets are missing", () => {
  const fx = makeFixture({ omitAcceptanceAsset: true });
  try {
    const outputRoot = join(fx.base, "out");
    const r = runScript(buildRelease, buildArgs(fx.repoRoot, fx.productRoot, outputRoot, fx.sourceCommit), fx.repoRoot);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/BUILD_RELEASE\|FAIL\|BUILD_RELEASE_ACCEPTANCE_ASSETS_MISSING/);
  } finally {
    fx.cleanup();
  }
});

test("build-release fails closed on src/dist module mismatch", () => {
  const fx = makeFixture({ extraSrc: "orphan.ts" });
  try {
    const outputRoot = join(fx.base, "out");
    const r = runScript(buildRelease, buildArgs(fx.repoRoot, fx.productRoot, outputRoot, fx.sourceCommit), fx.repoRoot);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/BUILD_RELEASE\|FAIL\|BUILD_RELEASE_SRC_DIST_MISMATCH/);
  } finally {
    fx.cleanup();
  }
});

test("build-release fails closed on a forbidden sqlite/secret/.env file", () => {
  const fx = makeFixture({ forbiddenFile: "diet-manager-b.sqlite3" });
  try {
    const outputRoot = join(fx.base, "out");
    const r = runScript(buildRelease, buildArgs(fx.repoRoot, fx.productRoot, outputRoot, fx.sourceCommit), fx.repoRoot);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/BUILD_RELEASE\|FAIL\|BUILD_RELEASE_FORBIDDEN_FILE/);
  } finally {
    fx.cleanup();
  }
});

test("build-release refuses an existing candidate output root", () => {
  const fx = makeFixture();
  try {
    const outputRoot = join(fx.base, "out");
    const first = runScript(buildRelease, buildArgs(fx.repoRoot, fx.productRoot, outputRoot, fx.sourceCommit), fx.repoRoot);
    expect(first.code).toBe(0);
    const second = runScript(buildRelease, buildArgs(fx.repoRoot, fx.productRoot, outputRoot, fx.sourceCommit), fx.repoRoot);
    expect(second.code).not.toBe(0);
    expect(second.stderr).toMatch(/BUILD_RELEASE\|FAIL\|BUILD_RELEASE_OUTPUT_EXISTS/);
  } finally {
    fx.cleanup();
  }
});

test("a valid fixture produces lexically sorted paths, uppercase SHA-256 and a deterministic archive", () => {
  const fx = makeFixture();
  try {
    const outputRootA = join(fx.base, "out-a");
    const outputRootB = join(fx.base, "out-b");
    const a = runScript(buildRelease, buildArgs(fx.repoRoot, fx.productRoot, outputRootA, fx.sourceCommit), fx.repoRoot);
    const b = runScript(buildRelease, buildArgs(fx.repoRoot, fx.productRoot, outputRootB, fx.sourceCommit), fx.repoRoot);
    expect(a.stderr).toBe("");
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    expect(a.stdout).toMatch(/BUILD_RELEASE\|PASS\|candidate=candidate-001/);

    const candidate = join(outputRootA, "candidate-001");
    for (const name of ["MANIFEST.json", "FILES.SHA256", "SBOM.json", "README.md", "CHANGELOG.md"]) {
      expect(existsSync(join(candidate, name))).toBe(true);
    }
    const zipPath = join(candidate, "artifacts", "diet-manager-b-0.3.0.zip");
    expect(existsSync(zipPath)).toBe(true);

    // MANIFEST 字段逐项核对。
    const manifest = JSON.parse(readFileSync(join(candidate, "MANIFEST.json"), "utf8"));
    expect(manifest.schema_version).toBe("diet-manager/release-manifest/v1");
    expect(manifest.product_version).toBe("0.3.0");
    expect(manifest.plugin_version).toBe("0.3.0");
    expect(manifest.source_commit).toBe(fx.sourceCommit);
    expect(manifest.node_version).toBe(process.version);
    expect(manifest.openclaw_version).toBe("2026.7.1");
    expect(manifest.source_modules).toEqual(expectedSourceModules);

    // v1.0 文档 SHA 与验收资产合成 SHA 与测试端算法一致。
    expect(manifest.v1_0_document_sha256).toBe(sha256HexUpper(v10DocContent));
    const assetSha = acceptanceCompositeSha([
      { path: "shared/real-acceptance/scenarios.json", sha256: sha256HexUpper(scenariosContent) },
      { path: "shared/real-acceptance/evidence.schema.json", sha256: sha256HexUpper(evidenceSchemaContent) },
      { path: "shared/real-acceptance/run-real-acceptance.ps1", sha256: sha256HexUpper(runnerContent) },
    ]);
    expect(manifest.acceptance_assets_sha256).toBe(assetSha);

    // 归档哈希为大写 64 位十六进制，且与真实字节一致。
    const zipBytes = readFileSync(zipPath);
    expect(manifest.archive.sha256).toMatch(/^[A-F0-9]{64}$/);
    expect(manifest.archive.sha256).toBe(sha256HexUpper(zipBytes));
    expect(manifest.archive.bytes).toBe(zipBytes.length);

    // ZIP 条目按斜杠路径字典序，且两次构建字节完全一致（确定性）。
    expect(zipEntryNames(zipBytes)).toEqual(expectedZipEntries);
    const zipBytesB = readFileSync(join(outputRootB, "candidate-001", "artifacts", "diet-manager-b-0.3.0.zip"));
    expect(zipBytesB.equals(zipBytes)).toBe(true);

    // FILES.SHA256 覆盖除自身外的所有候选根文件，路径升序、大写 SHA。
    const lines = readFileSync(join(candidate, "FILES.SHA256"), "utf8").split(/\r?\n/).filter((l) => l.length > 0);
    const expectedPaths = [
      "CHANGELOG.md",
      "MANIFEST.json",
      "README.md",
      "SBOM.json",
      "artifacts/diet-manager-b-0.3.0.zip",
    ];
    expect(lines).toHaveLength(expectedPaths.length);
    const recorded = lines.map((l) => {
      const m = l.match(/^([A-F0-9]{64})  (.+)$/);
      expect(m).not.toBeNull();
      return { sha: m![1], path: m![2] };
    });
    expect(recorded.map((r) => r.path)).toEqual(expectedPaths);
    expect(recorded.every((r) => r.sha === sha256HexUpper(readFileSync(join(candidate, r.path))))).toBe(true);

    // SBOM 从锁文件解析出直接依赖 typebox / vitest。
    const sbom = JSON.parse(readFileSync(join(candidate, "SBOM.json"), "utf8"));
    expect(sbom.schema_version).toBe("diet-manager/sbom/v1");
    const byName = new Map(sbom.packages.map((p: { name: string }) => [p.name, p]));
    expect(byName.get("typebox")).toMatchObject({ version: "1.3.11", direct: true });
    expect(byName.get("vitest")).toMatchObject({ version: "2.1.9", direct: true });
    expect(byName.get("typebox").integrity).toMatch(/^sha512-/);
  } finally {
    fx.cleanup();
  }
});

test("validate-release detects post-build mutation and rejects a clean candidate passes", () => {
  const fx = makeFixture();
  try {
    const outputRoot = join(fx.base, "out");
    const build = runScript(buildRelease, buildArgs(fx.repoRoot, fx.productRoot, outputRoot, fx.sourceCommit), fx.repoRoot);
    expect(build.code).toBe(0);
    const candidate = join(outputRoot, "candidate-001");

    // 干净候选在跳过安装生命周期时通过。
    const clean = runScript(validateRelease, ["-CandidateRoot", candidate, "-NodePath", nodePath, "-OpenClawPath", fakeOpenClaw, "-PnpmPath", "pnpm", "-GitPath", git, "-SkipInstallLifecycle"], fx.repoRoot);
    expect(clean.code).toBe(0);
    expect(clean.stdout).toMatch(/VALIDATE_RELEASE\|PASS/);

    // 篡改候选根文件后必须闭合（post-build mutation）。
    const manifestPath = join(candidate, "MANIFEST.json");
    writeFileSync(manifestPath, readFileSync(manifestPath, "utf8") + "\n// tampered\n");
    const tampered = runScript(validateRelease, ["-CandidateRoot", candidate, "-NodePath", nodePath, "-OpenClawPath", fakeOpenClaw, "-PnpmPath", "pnpm", "-GitPath", git, "-SkipInstallLifecycle"], fx.repoRoot);
    expect(tampered.code).not.toBe(0);
    expect(tampered.stderr).toMatch(/VALIDATE_RELEASE\|FAIL\|VALIDATE_RELEASE_HASH_MISMATCH/);
  } finally {
    fx.cleanup();
  }
});
