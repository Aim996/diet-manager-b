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

describe("GitHub and OpenClaw development handoff", () => {
  test("publishes the machine handoff and read-only validator", () => {
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(validatorPath)).toBe(true);
    if (!existsSync(manifestPath) || !existsSync(validatorPath)) return;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      schema_version?: unknown;
      product_status?: unknown;
      repository?: Record<string, unknown>;
      package_root?: unknown;
      runtime?: Record<string, unknown>;
      commands?: Record<string, unknown>;
      safety?: Record<string, unknown>;
    };

    expect(Object.keys(manifest).sort()).toEqual([
      "commands",
      "package_root",
      "product_status",
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
});
