import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testsDirectory, "..");
const repositoryRoot = resolve(packageRoot, "..");
const manifestPath = resolve(
  repositoryRoot,
  "delivery",
  "openclaw-development-handoff.json",
);
const validatorPath = resolve(
  repositoryRoot,
  "scripts",
  "validate-openclaw-development-handoff.mjs",
);
const packagePath = resolve(packageRoot, "package.json");
const workspacePath = resolve(packageRoot, "pnpm-workspace.yaml");
const readmePath = resolve(repositoryRoot, "README.md");
const startHerePath = resolve(repositoryRoot, "START-HERE.md");
const handoffDocumentPath = resolve(
  repositoryRoot,
  "docs",
  "OPENCLAW-DEVELOPMENT-HANDOFF.md",
);
const progressPath = resolve(repositoryRoot, "docs", "开发进度.md");
const contributingPath = resolve(repositoryRoot, "CONTRIBUTING.md");
const securityPath = resolve(repositoryRoot, "SECURITY.md");
const pullRequestTemplatePath = resolve(
  repositoryRoot,
  ".github",
  "pull_request_template.md",
);

describe("GitHub and OpenClaw development handoff", () => {
  test("publishes the machine handoff and read-only validator", () => {
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(validatorPath)).toBe(true);
    if (!existsSync(manifestPath) || !existsSync(validatorPath)) return;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      schema_version?: unknown;
      product_status?: unknown;
      repository?: Record<string, unknown>;
      publication?: Record<string, unknown>;
      package_root?: unknown;
      runtime?: Record<string, unknown>;
      commands?: Record<string, unknown>;
      safety?: Record<string, unknown>;
    };

    expect(Object.keys(manifest).sort()).toEqual([
      "commands",
      "package_root",
      "product_status",
      "publication",
      "repository",
      "runtime",
      "safety",
      "schema_version",
    ]);
    expect(manifest.schema_version).toBe(
      "diet-manager-openclaw-development-handoff/v1",
    );
    expect(manifest.product_status).toBe("foundation_development_only");
    expect(manifest.repository).toEqual({
      url: "https://github.com/Aim996/diet-manager-b.git",
      default_branch: "main",
      private: true,
    });
    expect(manifest.publication).toEqual({
      current_visibility: "private",
      future_open_source: true,
      license_status: "user_selection_required",
    });
    expect(manifest.package_root).toBe("version-b-lite-plugin");
    expect(manifest.runtime).toEqual({
      node: ">=24.15.0 <25",
      pnpm: ">=11 <12",
      openclaw: ">=2026.5.17",
    });
    expect(manifest.commands).toEqual({
      install_dependencies: "pnpm install --frozen-lockfile",
      test: "pnpm test",
      build: "pnpm build",
      validate_handoff: "pnpm handoff:validate",
      validate_plugin: "pnpm plugin:validate",
      install_plugin: "openclaw plugins install ./version-b-lite-plugin",
      install_skill:
        "openclaw skills install ./version-b-lite-plugin/skills/diet-manager-b --as diet-manager-b",
    });
    expect(manifest.safety).toEqual({
      production_ready: false,
      writes_business_data: false,
      expected_write_status: "foundation_not_implemented",
      expected_committed: false,
    });
  });

  test("pins a supported runtime and auditable dependency build allowlist", () => {
    const packageManifest = JSON.parse(readFileSync(packagePath, "utf8")) as {
      engines?: Record<string, unknown>;
      scripts?: Record<string, unknown>;
    };

    expect(packageManifest.engines?.node).toBe(">=24.15.0 <25");
    expect(packageManifest.scripts?.["handoff:validate"]).toBe(
      "node ../scripts/validate-openclaw-development-handoff.mjs",
    );
    expect(existsSync(workspacePath)).toBe(true);
    if (!existsSync(workspacePath)) return;
    expect(readFileSync(workspacePath, "utf8").replaceAll("\r\n", "\n")).toBe(
      [
        "allowBuilds:",
        "  '@google/genai': true",
        "  esbuild: true",
        "  openclaw: true",
        "  protobufjs: true",
        "  tree-sitter-bash: true",
        "",
      ].join("\n"),
    );
  });

  test("publishes one consistent human and GitHub contribution entry", () => {
    for (const path of [
      readmePath,
      startHerePath,
      handoffDocumentPath,
      progressPath,
      contributingPath,
      securityPath,
      pullRequestTemplatePath,
    ]) {
      expect(existsSync(path), path).toBe(true);
    }
    if (!existsSync(handoffDocumentPath)) return;

    const readme = readFileSync(readmePath, "utf8");
    const startHere = readFileSync(startHerePath, "utf8");
    const handoff = readFileSync(handoffDocumentPath, "utf8");
    const progress = readFileSync(progressPath, "utf8");
    const contributing = readFileSync(contributingPath, "utf8");
    const security = readFileSync(securityPath, "utf8");
    const pullRequestTemplate = readFileSync(pullRequestTemplatePath, "utf8");

    for (const anchor of [
      "foundation_development_only",
      "pnpm handoff:validate",
      "foundation_not_implemented",
      "committed=false",
    ]) {
      expect(readme).toContain(anchor);
      expect(handoff).toContain(anchor);
    }
    expect(startHere).toContain("B 是唯一产品主线");
    expect(startHere).not.toContain("三版本");
    expect(handoff).toContain("OpenClaw 02");
    expect(handoff).toContain("OpenClaw 03");
    expect(handoff).toContain("OpenClaw 04");
    expect(handoff).toContain("openclaw plugins install ./version-b-lite-plugin");
    expect(handoff).toContain(
      "openclaw skills install ./version-b-lite-plugin/skills/diet-manager-b --as diet-manager-b",
    );
    expect(handoff).toContain("openclaw plugins uninstall --dry-run diet-manager-b");
    expect(handoff).toContain("license_status=user_selection_required");

    const requiredProgressHeadings = [
      "## 当前结论",
      "## 已开发",
      "## 正在开发",
      "## 待开发",
      "## 本轮新增开发内容",
      "## 发现问题",
      "## 待优化",
      "## 后续可增加的优化",
      "## 验证与 GitHub 状态",
    ];
    for (const heading of requiredProgressHeadings) {
      expect(progress.split(heading)).toHaveLength(2);
    }
    expect(progress).toContain("SH-HANDOFF-001");
    expect(progress).toContain("SH-CASE-003");

    expect(contributing).toContain("feature branch");
    expect(contributing).toContain("pull request");
    expect(contributing).toContain("不得提交真实饮食数据");
    expect(security).toContain("GitHub Security Advisory");
    expect(security).toContain("当前没有正式受支持的 PRODUCT 版本");
    expect(pullRequestTemplate).toContain("pnpm handoff:validate");
    expect(pullRequestTemplate).toContain("业务数据新增为 0");
  });
});
