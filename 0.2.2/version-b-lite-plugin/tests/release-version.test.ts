import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function readManifestTemplate(): Record<string, unknown> {
  const rendered = readFileSync(join(projectRoot, "release-manifest.template.json"), "utf8")
    .replace("{{archive_bytes}}", "1")
    .replace("{{source_modules_json}}", "[]");
  return JSON.parse(rendered) as Record<string, unknown>;
}

describe("install-facing release metadata", () => {
  it("publishes the 0.2.2 candidate consistently to npm and OpenClaw", () => {
    const packageMetadata = readJson(join(projectRoot, "package.json"));
    const pluginMetadata = readJson(join(projectRoot, "openclaw.plugin.json"));

    expect(packageMetadata.version).toBe("0.2.2");
    expect(pluginMetadata.version).toBe(packageMetadata.version);
  });

  it("identifies the release as a universal Agent Skill with an optional OpenClaw adapter", () => {
    const readme = readFileSync(join(projectRoot, "release-readme.template.md"), "utf8");
    const manifest = readManifestTemplate();
    const pluginMetadata = readJson(join(projectRoot, "openclaw.plugin.json"));
    const configSchema = pluginMetadata.configSchema as Record<string, unknown>;

    expect(readme).toContain("通用 Agent Skill");
    expect(readme).toContain("可选 OpenClaw 适配器");
    expect(manifest).toMatchObject({
      schema_version: "diet-manager/release-manifest/v1",
      product_version: "{{product_version}}",
      plugin_version: "{{plugin_version}}",
      contract_version: "{{contract_version}}",
      distribution: {
        artifact_type: "universal-agent-skill",
        primary_transport: "diet-manager-json-cli",
        openclaw_adapter: "optional",
      },
    });
    expect(configSchema["x-diet-manager-contract"]).toEqual({
      id: "diet-manager/contract-v3",
      version: 3,
      sha256: "B4F475C389FA9A5EA5DD23F9E737A157B5B44B47311AB38AB16354F5C9556ADC",
    });
  });
});
