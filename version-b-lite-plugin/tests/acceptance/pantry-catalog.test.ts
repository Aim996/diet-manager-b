import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const expectedIdsFromBrief = [
  "CASE-PURCHASE-001", "CASE-PURCHASE-003", "CASE-PURCHASE-007",
  "CASE-INVENTORY-001", "CASE-INVENTORY-002", "CASE-INVENTORY-003",
  "CASE-INVENTORY-005", "CASE-INVENTORY-004", "CASE-INVENTORY-009",
  "CASE-MEAL-004", "CASE-MEAL-005", "CASE-PURCHASE-002",
  "CASE-PURCHASE-005", "CASE-PURCHASE-006", "CASE-PURCHASE-008",
  "CASE-PURCHASE-009", "CASE-PURCHASE-010",
] as const;

type CatalogCase = { id: string; stage: string; [key: string]: unknown };

function testIdentity(file: string): string {
  const stats = lstatSync(file, { bigint: true });
  return `${stats.dev}:${stats.ino}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function loadSelectedPantryCatalog(): readonly CatalogCase[] {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const catalog = JSON.parse(readFileSync(join(root, "shared", "acceptance-cases", "cases.json"), "utf8")) as { cases: CatalogCase[] };
  const byId = new Map(catalog.cases.map((entry) => [entry.id, entry]));
  const selected = expectedIdsFromBrief.map((id) => byId.get(id));
  if (selected.some((entry) => entry === undefined)) throw new Error("selected pantry catalog is incomplete");
  return deepFreeze(JSON.parse(JSON.stringify(selected)) as CatalogCase[]);
}

describe("SEL-PANTRY-001 catalog authority", () => {
  it("selects the brief-owned 17 cases in brief order", () => {
    const selected = loadSelectedPantryCatalog();

    expect(selected.map(({ id }) => id)).toEqual(expectedIdsFromBrief);
    expect(selected).toHaveLength(17);
    expect(selected.every((entry) => entry.stage === "PRODUCT-0.1")).toBe(true);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(selected.every((entry) => Object.isFrozen(entry))).toBe(true);
  });
});

describe("SEL-PANTRY-001 verification-root authority", () => {
  it("accepts only the brief-pinned roots and leaves no isolated child", () => {
    const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const nodeExe = "C:\\Users\\10481\\AppData\\Local\\Temp\\diet-manager-validation-node-24.15.0\\node-v24.15.0-win-x64\\node.exe";
    const officialRoot = join(projectRoot, ".tmp", "official-manifest-sentinel", "SEL-PANTRY-001");
    const isolatedRoot = join(projectRoot, ".tmp", "isolated-test-roots", "SEL-PANTRY-001");
    const validator = join(projectRoot, "shared", "tests", "validate-sel-pantry-roots.mjs");

    mkdirSync(officialRoot, { recursive: true });
    mkdirSync(isolatedRoot, { recursive: true });
    expect(readdirSync(isolatedRoot)).toEqual([]);

    const output = execFileSync(nodeExe, [validator, "--official-manifest-root", officialRoot, "--isolated-root-base", isolatedRoot], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    expect(output.trim()).toBe("SEL_PANTRY_ROOTS|PASS|official_delta=0|isolated_removed=true");
    const selfTestOutput = execFileSync(nodeExe, [validator, "--official-manifest-root", officialRoot, "--isolated-root-base", isolatedRoot, "--self-test"], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    expect(selfTestOutput.trim()).toBe("SEL_PANTRY_ROOTS|SELF_TEST|PASS|mutations=17|controls=1");
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("preserves an externally replaced UUID child and its canary", async () => {
    const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const officialRoot = join(projectRoot, ".tmp", "official-manifest-sentinel", "SEL-PANTRY-001");
    const isolatedRoot = join(projectRoot, ".tmp", "isolated-test-roots", "SEL-PANTRY-001");
    const validator = join(projectRoot, "shared", "tests", "validate-sel-pantry-roots.mjs");
    const { validateRoots } = await import(pathToFileURL(validator).href) as {
      validateRoots: (options: { officialRoot: string; isolatedBase: string }, hooks: { afterMarker: (paths: { child: string }) => void }) => void;
    };
    const displaced = join(isolatedRoot, "test-displaced-owned-child");
    let replacement = "";
    let replacementIdentity = "";
    let displacedIdentity = "";
    let displacedMarker = "";
    let markerIdentity = "";
    let canaryIdentity = "";

    mkdirSync(officialRoot, { recursive: true });
    mkdirSync(isolatedRoot, { recursive: true });
    expect(readdirSync(isolatedRoot)).toEqual([]);

    try {
      expect(() => validateRoots({ officialRoot, isolatedBase: isolatedRoot }, {
        afterMarker: ({ child, marker }: { child: string; marker: string }) => {
          displacedIdentity = testIdentity(child);
          displacedMarker = join(displaced, ".sel-pantry-root-marker");
          markerIdentity = testIdentity(marker);
          renameSync(child, displaced);
          mkdirSync(child);
          writeFileSync(join(child, "foreign-canary"), "foreign-owned");
          replacement = child;
          replacementIdentity = testIdentity(child);
          canaryIdentity = testIdentity(join(child, "foreign-canary"));
        },
      })).toThrow("SEL_PANTRY_ROOT_ISOLATED_CHILD_REPLACED");
      expect(readFileSync(join(replacement, "foreign-canary"), "utf8")).toBe("foreign-owned");
    } finally {
      if (replacement) {
        const canary = join(replacement, "foreign-canary");
        if (testIdentity(canary) !== canaryIdentity || testIdentity(replacement) !== replacementIdentity) throw new Error("foreign replacement preserved");
        unlinkSync(canary);
        rmdirSync(replacement);
      }
      if (displacedMarker) {
        if (testIdentity(displacedMarker) !== markerIdentity || testIdentity(displaced) !== displacedIdentity) throw new Error("displaced owned child preserved");
        unlinkSync(displacedMarker);
        rmdirSync(displaced);
      }
      expect(readdirSync(isolatedRoot)).toEqual([]);
    }
  });

  it("rejects an external path that only impersonates the required suffix", async () => {
    const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const isolatedRoot = join(projectRoot, ".tmp", "isolated-test-roots", "SEL-PANTRY-001");
    const validator = join(projectRoot, "shared", "tests", "validate-sel-pantry-roots.mjs");
    const { validateRoots } = await import(pathToFileURL(validator).href) as {
      validateRoots: (options: { officialRoot: string; isolatedBase: string }) => void;
    };

    expect(() => validateRoots({
      officialRoot: "E:\\external\\official-manifest-sentinel\\SEL-PANTRY-001",
      isolatedBase: isolatedRoot,
    })).toThrow("SEL_PANTRY_ROOT_OFFICIAL_BINDING");
  });

  it("rejects an isolated-base replacement before writing into the foreign root", async () => {
    const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const officialRoot = join(projectRoot, ".tmp", "official-manifest-sentinel", "SEL-PANTRY-001");
    const isolatedRoot = join(projectRoot, ".tmp", "isolated-test-roots", "SEL-PANTRY-001");
    const validator = join(projectRoot, "shared", "tests", "validate-sel-pantry-roots.mjs");
    const { validateRoots } = await import(pathToFileURL(validator).href) as {
      validateRoots: (options: { officialRoot: string; isolatedBase: string }, hooks: { afterSnapshot: () => void }) => void;
    };
    const displaced = join(dirname(isolatedRoot), `.test-displaced-${randomUUID()}`);
    const canary = join(isolatedRoot, `foreign-canary-${randomUUID()}`);
    let foreignRootIdentity = "";

    mkdirSync(officialRoot, { recursive: true });
    mkdirSync(isolatedRoot, { recursive: true });
    expect(readdirSync(isolatedRoot)).toEqual([]);
    try {
      expect(() => validateRoots({ officialRoot, isolatedBase: isolatedRoot }, {
        afterSnapshot: () => {
          renameSync(isolatedRoot, displaced);
          mkdirSync(isolatedRoot);
          foreignRootIdentity = testIdentity(isolatedRoot);
          writeFileSync(canary, "foreign-owned", { flag: "wx" });
        },
      })).toThrow("SEL_PANTRY_ROOT_ISOLATED_PATH_REPLACED");
      expect(readFileSync(canary, "utf8")).toBe("foreign-owned");
    } finally {
      if (testIdentity(canary) === "") throw new Error("foreign canary preserved");
      unlinkSync(canary);
      if (testIdentity(isolatedRoot) !== foreignRootIdentity) throw new Error("foreign isolated replacement preserved");
      rmdirSync(isolatedRoot);
      renameSync(displaced, isolatedRoot);
    }
  });
});
