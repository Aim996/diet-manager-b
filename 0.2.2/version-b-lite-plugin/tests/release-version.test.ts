import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("install-facing release metadata", () => {
  it("publishes the 0.2.2 candidate consistently to npm and OpenClaw", () => {
    const packageMetadata = readJson(join(projectRoot, "package.json"));
    const pluginMetadata = readJson(join(projectRoot, "openclaw.plugin.json"));

    expect(packageMetadata.version).toBe("0.2.2");
    expect(pluginMetadata.version).toBe(packageMetadata.version);
  });
});
