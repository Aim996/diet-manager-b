import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import * as portable from "../src/index.js";
import openClawEntry from "../src/openclaw/index.js";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packagePath = join(projectRoot, "package.json");
const temporaryRoots: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

function nodeModulesAncestor(start: string): string | undefined {
  let current = start;
  const root = parse(current).root;
  while (true) {
    const candidate = join(current, "node_modules");
    if (existsSync(candidate)) return candidate;
    if (current === root) return undefined;
    current = dirname(current);
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: false });
  }
});

describe("public package boundary", () => {
  it("keeps the root import portable and gives OpenClaw a separate entry", () => {
    expect(portable).toHaveProperty("executeAgentCommand");
    expect(portable).toHaveProperty("createCoreRuntime");
    expect(portable).not.toHaveProperty("default");
    expect(openClawEntry).toHaveProperty("register");
  });

  it("declares portable bin/exports/files and an optional OpenClaw peer", () => {
    const pkg = JSON.parse(readFileSync(packagePath, "utf8"));

    expect(pkg.bin).toEqual({ "diet-manager": "./dist/cli/agent.js" });
    expect(pkg.exports).toEqual({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./openclaw": {
        types: "./dist/openclaw/index.d.ts",
        import: "./dist/openclaw/index.js",
      },
    });
    expect(pkg.files).toEqual(["dist", "skills", "openclaw.plugin.json"]);
    expect(pkg.scripts["pack:portable"]).toBe(
      "npm run build && node ./scripts/build-portable.mjs",
    );
    expect(pkg.peerDependencies.openclaw).toBe(">=2026.5.17");
    expect(pkg.peerDependenciesMeta.openclaw.optional).toBe(true);
    expect(pkg.openclaw.extensions).toEqual(["./dist/openclaw/index.js"]);
  });

  it("emits separate portable-root and OpenClaw declaration entries", () => {
    const rootDeclaration = join(projectRoot, "dist", "index.d.ts");
    const openClawDeclaration = join(projectRoot, "dist", "openclaw", "index.d.ts");

    expect(existsSync(rootDeclaration)).toBe(true);
    expect(existsSync(openClawDeclaration)).toBe(true);
    expect(readFileSync(rootDeclaration, "utf8")).not.toContain("openclaw");
    expect(readFileSync(openClawDeclaration, "utf8")).toContain("./plugin.js");
  });

  it("imports the compiled root without resolving OpenClaw or typebox", () => {
    const root = temporaryDirectory("diet-manager-portable-root-");
    expect(nodeModulesAncestor(root)).toBeUndefined();

    const isolatedDist = join(root, "dist");
    cpSync(join(projectRoot, "dist"), isolatedDist, { recursive: true });
    const entryUrl = pathToFileURL(join(isolatedDist, "index.js")).href;
    const child = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      [
        "const entry = await import(process.argv[1]);",
        "if (typeof entry.executeAgentCommand !== 'function') throw new Error('missing executeAgentCommand');",
        "if (typeof entry.createCoreRuntime !== 'function') throw new Error('missing createCoreRuntime');",
        "if (Object.hasOwn(entry, 'default')) throw new Error('unexpected default export');",
      ].join("\n"),
      entryUrl,
    ], {
      encoding: "utf8",
      windowsHide: true,
    });

    expect(child.status, child.stderr).toBe(0);
    expect(child.stderr).toBe("");
  });
});
