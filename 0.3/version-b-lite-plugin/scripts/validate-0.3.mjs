import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_VERSION = "0.3.0";
const REQUIRED_FILES = Object.freeze([
  "package.json",
  "openclaw.plugin.json",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/cli/agent.js",
  "dist/openclaw/index.js",
  "dist/openclaw/index.d.ts",
  "dist/storage/migration-v1.js",
  "dist/storage/migration-v2.js",
  "src/contracts/agent-command-v2.ts",
  "src/storage/migration-v1.ts",
  "src/storage/migration-v2.ts",
  "skills/diet-manager-b/SKILL.md",
  "skills/diet-manager-b/agents/openai.yaml",
  "skills/diet-manager-b/references/agent-command-v2.md",
  "skills/diet-manager-b/references/natural-language-boundaries.md",
  "skills/diet-manager-b/references/receipt-and-progress.md",
  "skills/diet-manager-b/references/inventory-and-nutrition.md",
  "skills/diet-manager-b/references/correction-and-recovery.md",
]);
const FORBIDDEN_PATH = /(?:^|\/)(?:node_modules|tests?|__tests__)(?:\/|$)|(?:^|\/)\.env(?:[./]|$)|\.sqlite(?:3)?(?:[./-]|$)|authority[-_]?secret|(?:^|\/)secret(?:\/|$)/iu;

class ReleaseValidationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ReleaseValidationError(`DIET_RELEASE_0_3_${code}`);
}

function slash(path) {
  return path.split(sep).join("/");
}

function ordinaryRoot(value) {
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value)) {
    fail("ROOT_INVALID");
  }
  const root = resolve(value);
  let stats;
  try {
    stats = lstatSync(root);
  } catch {
    fail("ROOT_INVALID");
  }
  if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync.native(root) !== root) {
    fail("ROOT_INVALID");
  }
  return root;
}

function ordinaryFile(root, relativePath) {
  const path = join(root, ...relativePath.split("/"));
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    fail("REQUIRED_FILE_MISSING");
  }
  if (!stats.isFile() || stats.isSymbolicLink() || realpathSync.native(path) !== path) {
    fail("REQUIRED_FILE_MISSING");
  }
  return path;
}

function jsonFile(root, relativePath) {
  try {
    const value = JSON.parse(readFileSync(ordinaryFile(root, relativePath), "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail("METADATA_INVALID");
    return value;
  } catch (error) {
    if (error instanceof ReleaseValidationError) throw error;
    fail("METADATA_INVALID");
  }
}

function listOrdinaryFiles(root, relativeDirectory) {
  const directory = join(root, ...relativeDirectory.split("/"));
  let rootStats;
  try {
    rootStats = lstatSync(directory);
  } catch {
    fail("REQUIRED_FILE_MISSING");
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) fail("REQUIRED_FILE_MISSING");
  const files = [];
  const visit = (current) => {
    const names = readdirSync(current).sort();
    for (const name of names) {
      const path = join(current, name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) fail("FORBIDDEN_FILE");
      if (stats.isDirectory()) visit(path);
      else if (stats.isFile()) files.push(slash(relative(root, path)));
      else fail("FORBIDDEN_FILE");
    }
  };
  visit(directory);
  return files;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}

export function validateRelease03(rootValue) {
  const root = ordinaryRoot(rootValue);
  for (const relativePath of REQUIRED_FILES) ordinaryFile(root, relativePath);
  const pkg = jsonFile(root, "package.json");
  const plugin = jsonFile(root, "openclaw.plugin.json");
  if (pkg.name !== "diet-manager-b" || plugin.id !== "diet-manager-b" ||
      pkg.version !== EXPECTED_VERSION || plugin.version !== EXPECTED_VERSION) {
    fail("VERSION_MISMATCH");
  }

  const contract = readFileSync(ordinaryFile(root, "src/contracts/agent-command-v2.ts"), "utf8");
  if (!contract.includes("AGENT_COMMAND_V1_SCHEMA_VERSION") ||
      !contract.includes("diet-manager/agent-command/v1")) fail("V1_CONTRACT_MISSING");
  if (!contract.includes("AGENT_COMMAND_V2_SCHEMA_VERSION") ||
      !contract.includes("diet-manager/agent-command/v2")) fail("V2_CONTRACT_MISSING");

  const packageFiles = [
    "package.json",
    "openclaw.plugin.json",
    ...listOrdinaryFiles(root, "dist"),
    ...listOrdinaryFiles(root, "skills"),
  ];
  for (const path of packageFiles) {
    if (FORBIDDEN_PATH.test(path)) fail("FORBIDDEN_FILE");
  }
  const manifestPaths = [...new Set([
    ...packageFiles,
    "src/contracts/agent-command-v2.ts",
    "src/storage/migration-v1.ts",
    "src/storage/migration-v2.ts",
  ])].sort();
  return Object.freeze({
    schema_version: "diet-manager/release-validation/v1",
    product_version: EXPECTED_VERSION,
    files: Object.freeze(manifestPaths.map((path) => Object.freeze({
      path,
      sha256: sha256(ordinaryFile(root, path)),
    }))),
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length !== 3) fail("ARGUMENTS_INVALID");
    process.stdout.write(`${JSON.stringify(validateRelease03(process.argv[2]))}\n`);
  } catch (error) {
    const code = error instanceof ReleaseValidationError ? error.code : "DIET_RELEASE_0_3_UNAVAILABLE";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
