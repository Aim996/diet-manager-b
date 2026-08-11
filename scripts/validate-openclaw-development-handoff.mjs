import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const packageRoot = resolve(repositoryRoot, "version-b-lite-plugin");
const manifestPath = resolve(
  repositoryRoot,
  "delivery",
  "openclaw-development-handoff.json",
);
const packagePath = resolve(packageRoot, "package.json");
const workspacePath = resolve(packageRoot, "pnpm-workspace.yaml");

const expectedManifest = {
  schema_version: "diet-manager-openclaw-development-handoff/v1",
  product_status: "foundation_development_only",
  repository: {
    url: "https://github.com/Aim996/diet-manager-b.git",
    default_branch: "main",
    private: true,
  },
  package_root: "version-b-lite-plugin",
  runtime: {
    node: ">=24.15.0 <25",
    pnpm: ">=11 <12",
    openclaw: ">=2026.5.17",
  },
  commands: {
    install_dependencies: "pnpm install --frozen-lockfile",
    test: "pnpm test",
    build: "pnpm build",
    validate_handoff: "pnpm handoff:validate",
    validate_plugin: "pnpm plugin:validate",
    install_plugin: "openclaw plugins install ./version-b-lite-plugin",
    install_skill:
      "openclaw skills install ./version-b-lite-plugin/skills/diet-manager-b --as diet-manager-b",
  },
  safety: {
    production_ready: false,
    writes_business_data: false,
    expected_write_status: "foundation_not_implemented",
    expected_committed: false,
  },
};

const expectedAllowBuilds = [
  "allowBuilds:",
  "  '@google/genai': true",
  "  esbuild: true",
  "  openclaw: true",
  "  protobufjs: true",
  "  tree-sitter-bash: true",
  "",
].join("\n");

const requiredRelativePaths = [
  "README.md",
  "START-HERE.md",
  "总功能开发计划0.3.md",
  "version-b-lite-plugin/package.json",
  "version-b-lite-plugin/pnpm-lock.yaml",
  "version-b-lite-plugin/pnpm-workspace.yaml",
  "version-b-lite-plugin/openclaw.plugin.json",
  "version-b-lite-plugin/dist/index.js",
  "version-b-lite-plugin/src/index.ts",
  "version-b-lite-plugin/skills/diet-manager-b/SKILL.md",
  "version-b-lite-plugin/skills/diet-manager-b/agents/openai.yaml",
];

const protectedLeasePaths = new Set([
  "shared/contracts/data-model.md",
  "shared/schemas/domain.schema.json",
  "shared/schemas/fixtures/domain-cases.json",
  "shared/tests/validate-domain-schema.mjs",
  "shared/tests/validate-domain-schema.ps1",
]);

function fail(code, detail) {
  const suffix = detail ? `|detail=${String(detail).replaceAll("|", "/")}` : "";
  throw new Error(`${code}${suffix}`);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label}_INVALID`, error instanceof Error ? error.message : error);
  }
}

function assertJsonEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label}_MISMATCH`);
  }
}

function assertSupportedNode() {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(process.versions.node);
  if (!match) fail("NODE_VERSION_INVALID", process.versions.node);
  const [, majorText, minorText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  if (major !== 24 || minor < 15) {
    fail("NODE_VERSION_UNSUPPORTED", process.versions.node);
  }
}

function assertRequiredPaths() {
  for (const relativePath of requiredRelativePaths) {
    if (!existsSync(resolve(repositoryRoot, relativePath))) {
      fail("REQUIRED_PATH_MISSING", relativePath);
    }
  }
}

function trackedPaths() {
  try {
    return execFileSync("git", ["-C", repositoryRoot, "ls-files", "-z"], {
      encoding: "utf8",
      windowsHide: true,
    })
      .split("\0")
      .filter(Boolean)
      .map((value) => value.replaceAll("\\", "/"));
  } catch (error) {
    fail("GIT_TRACKED_PATHS_UNAVAILABLE", error instanceof Error ? error.message : error);
  }
}

function assertTrackedScope(paths) {
  for (const path of paths) {
    const lower = path.toLowerCase();
    if (protectedLeasePaths.has(path)) fail("PROTECTED_LEASE_TRACKED", path);
    if (lower.startsWith("version-a-skill-only/")) fail("STOPPED_ROUTE_TRACKED", path);
    if (lower.startsWith("version-c-strict-plugin/")) fail("STOPPED_ROUTE_TRACKED", path);
    if (lower.includes("/node_modules/")) fail("DEPENDENCY_DIRECTORY_TRACKED", path);
    if (/(^|\/)\.env($|\.)/.test(lower) && !lower.endsWith(".example") && !lower.endsWith(".sample")) {
      fail("ENVIRONMENT_FILE_TRACKED", path);
    }
    if (/(\.sqlite3?|\.db|\.jsonl)(\.|$)/.test(lower)) {
      fail("BUSINESS_DATA_TRACKED", path);
    }
  }
}

function validate() {
  assertSupportedNode();
  assertRequiredPaths();

  const manifest = readJson(manifestPath, "HANDOFF_MANIFEST");
  assertJsonEqual(manifest, expectedManifest, "HANDOFF_MANIFEST");

  const packageManifest = readJson(packagePath, "PACKAGE_MANIFEST");
  if (packageManifest.engines?.node !== expectedManifest.runtime.node) {
    fail("PACKAGE_NODE_ENGINE_MISMATCH", packageManifest.engines?.node);
  }
  if (packageManifest.peerDependencies?.openclaw !== expectedManifest.runtime.openclaw) {
    fail("PACKAGE_OPENCLAW_PEER_MISMATCH", packageManifest.peerDependencies?.openclaw);
  }
  if (
    packageManifest.scripts?.["handoff:validate"] !==
    "node ../scripts/validate-openclaw-development-handoff.mjs"
  ) {
    fail("PACKAGE_HANDOFF_SCRIPT_MISMATCH");
  }
  assertJsonEqual(packageManifest.openclaw?.extensions, ["./dist/index.js"], "PACKAGE_EXTENSION");

  const allowBuilds = readFileSync(workspacePath, "utf8").replaceAll("\r\n", "\n");
  if (allowBuilds !== expectedAllowBuilds) fail("PNPM_BUILD_ALLOWLIST_MISMATCH");

  assertTrackedScope(trackedPaths());
}

try {
  validate();
  process.stdout.write(
    "HANDOFF|PASS|status=foundation_development_only|business_writes=false\n",
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`HANDOFF|FAIL|${message}\n`);
  process.exitCode = 1;
}
