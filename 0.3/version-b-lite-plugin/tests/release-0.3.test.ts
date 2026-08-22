import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const validator = join(projectRoot, "scripts", "validate-0.3.mjs");
const roots: string[] = [];
const references = [
  "agent-command-v2.md",
  "natural-language-boundaries.md",
  "receipt-and-progress.md",
  "inventory-and-nutrition.md",
  "correction-and-recovery.md",
] as const;

function fixture(options: {
  version?: string;
  omit?: string;
  contractText?: string;
  forbidden?: string;
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), "diet-manager-release-0.3-"));
  roots.push(root);
  const files = new Map<string, string>([
    ["package.json", JSON.stringify({ name: "diet-manager-b", version: options.version ?? "0.3.0" })],
    ["openclaw.plugin.json", JSON.stringify({ id: "diet-manager-b", version: options.version ?? "0.3.0" })],
    ["dist/index.js", "export const ready = true;\n"],
    ["dist/index.d.ts", "export declare const ready: true;\n"],
    ["dist/cli/agent.js", "export {};\n"],
    ["dist/openclaw/index.js", "export {};\n"],
    ["dist/openclaw/index.d.ts", "export {};\n"],
    ["dist/storage/migration-v1.js", "export {};\n"],
    ["dist/storage/migration-v2.js", "export {};\n"],
    ["src/storage/migration-v1.ts", "export {};\n"],
    ["src/storage/migration-v2.ts", "export {};\n"],
    ["src/contracts/agent-command-v2.ts", options.contractText ?? [
      "export const AGENT_COMMAND_V1_SCHEMA_VERSION = 'diet-manager/agent-command/v1';",
      "export const AGENT_COMMAND_V2_SCHEMA_VERSION = 'diet-manager/agent-command/v2';",
    ].join("\n")],
    ["skills/diet-manager-b/SKILL.md", "---\nname: diet-manager-b\ndescription: fixture\n---\n"],
    ["skills/diet-manager-b/agents/openai.yaml", "interface:\n  display_name: fixture\n"],
    ...references.map((name) => [`skills/diet-manager-b/references/${name}`, `# ${name}\n`] as const),
  ]);
  if (options.forbidden !== undefined) files.set(options.forbidden, "forbidden\n");
  for (const [relative, contents] of files) {
    if (relative === options.omit) continue;
    const path = join(root, ...relative.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return root;
}

function validate(root: string): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [validator, root], {
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("0.3 release candidate validator", () => {
  it("emits a deterministic hash manifest for the complete 0.3 package root", () => {
    const result = validate(fixture());
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const receipt = JSON.parse(result.stdout) as {
      schema_version: string;
      product_version: string;
      files: Array<{ path: string; sha256: string }>;
    };
    expect(receipt.schema_version).toBe("diet-manager/release-validation/v1");
    expect(receipt.product_version).toBe("0.3.0");
    expect(receipt.files.map((entry) => entry.path)).toEqual(
      [...receipt.files.map((entry) => entry.path)].sort(),
    );
    expect(receipt.files.every((entry) => /^[A-F0-9]{64}$/u.test(entry.sha256))).toBe(true);
    expect(receipt.files.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      "skills/diet-manager-b/SKILL.md",
      "src/contracts/agent-command-v2.ts",
      "src/storage/migration-v1.ts",
      "src/storage/migration-v2.ts",
    ]));
  });

  it.each([
    ["missing Skill reference", { omit: "skills/diet-manager-b/references/correction-and-recovery.md" }, "REQUIRED_FILE_MISSING"],
    ["version mismatch", { version: "0.2.2" }, "VERSION_MISMATCH"],
    ["missing v1 contract", { contractText: "export const AGENT_COMMAND_V2_SCHEMA_VERSION = 'diet-manager/agent-command/v2';\n" }, "V1_CONTRACT_MISSING"],
    ["missing migration", { omit: "src/storage/migration-v2.ts" }, "REQUIRED_FILE_MISSING"],
    ["forbidden database", { forbidden: "dist/runtime.sqlite3" }, "FORBIDDEN_FILE"],
  ])("fails closed on %s", (_label, options, code) => {
    const result = validate(fixture(options));
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(`DIET_RELEASE_0_3_${code}`);
  });
});
