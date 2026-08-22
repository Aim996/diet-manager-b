import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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

interface RegisteredParityTool {
  execute(toolCallId: string, params: unknown): Promise<{
    readonly content: readonly Readonly<{ type: "text"; text: string }>[];
    readonly details: Record<string, unknown>;
    readonly render_model: Record<string, unknown>;
  }>;
}

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

function registerParityPlugin(root: string): {
  readonly tool: RegisteredParityTool;
  readonly cleanup: () => void | Promise<void>;
} {
  const tools: RegisteredParityTool[] = [];
  let cleanup: (() => void | Promise<void>) | undefined;
  openClawEntry.register({
    pluginConfig: { official_data_root: root },
    registerTool(
      tool: RegisteredParityTool | ((context: { sessionKey?: string }) => RegisteredParityTool),
    ): void {
      tools.push(typeof tool === "function"
        ? tool({ sessionKey: "task-12-adapter-parity" })
        : tool);
    },
    lifecycle: {
      registerRuntimeLifecycle(value: { cleanup(): void | Promise<void> }): void {
        cleanup = () => value.cleanup();
      },
    },
  } as never);
  const tool = tools[0];
  if (tool === undefined) throw new Error("diet_manager was not registered");
  return { tool, cleanup: () => cleanup?.() };
}

function normalizeDynamicBusinessValues(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeDynamicBusinessValues(entry));
  }
  if (typeof value !== "object" || value === null) {
    if (/(?:^|_)(?:id|ids)$/u.test(key)) return `<${key}>`;
    if (/(?:^|_)(?:at|date)$/u.test(key)) return `<${key}>`;
    if (key === "idempotency_key") return "<idempotency_key>";
    return value;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([nestedKey, nestedValue]) => [
      nestedKey,
      normalizeDynamicBusinessValues(nestedValue, nestedKey),
    ]));
}

function completeBusinessResult(value: {
  readonly details?: Record<string, unknown>;
  readonly render_model?: Record<string, unknown>;
} & Record<string, unknown>): unknown {
  const details = value.details ?? value;
  const { render_model: _nestedRenderModel, ...businessDetails } = details;
  return normalizeDynamicBusinessValues({
    ...businessDetails,
    render_model: value.render_model ?? details.render_model,
  });
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
    expect(portable).toHaveProperty("agentCommandV2Schema");
    expect(portable).toHaveProperty("semanticProposalV2Schema");
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

  it("ships the lightweight skill and all five Task 12 references", () => {
    const skillRoot = join(projectRoot, "skills", "diet-manager-b");
    const referenceRoot = join(skillRoot, "references");

    expect(existsSync(join(skillRoot, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillRoot, "agents", "openai.yaml"))).toBe(true);
    for (const name of [
      "agent-command-v2.md",
      "natural-language-boundaries.md",
      "receipt-and-progress.md",
      "inventory-and-nutrition.md",
      "correction-and-recovery.md",
    ]) {
      expect(existsSync(join(referenceRoot, name)), name).toBe(true);
    }
    expect(existsSync(join(referenceRoot, "agent-command-v1.md"))).toBe(false);
  });

  it("returns the same business status and structured render result through public, CLI, and OpenClaw entries", async () => {
    const sourceText = "我喝了500毫升白水";
    const command = {
      schema_version: "diet-manager/agent-command/v2" as const,
      action: "record_water" as const,
      source_text: sourceText,
      semantic_proposal: {
        kind: "water" as const,
        subject: {
          kind: "self" as const,
          basis: "explicit" as const,
          evidence_span: "我",
          explicit_other_spans: [] as const,
        },
        amount: {
          kind: "exact" as const,
          value: 500,
          unit: "ml",
          evidence_span: "500毫升",
        },
        occurred_at: { kind: "unspecified" as const, evidence_span: null },
      },
    };

    const publicRoot = temporaryDirectory("diet-manager-public-parity-");
    const runtime = portable.createCoreRuntime({
      officialDataRoot: publicRoot,
      now: () => new Date().toISOString(),
    });
    let publicResult: ReturnType<typeof portable.buildPublicAdapterResult>;
    try {
      const outcome = await portable.executeAgentCommand(runtime, command, {
        received_at: new Date().toISOString(),
        timezone: "Asia/Shanghai",
        operation_id: "task-12-public-operation",
        source_message_id: "task-12-public-message",
        conversation_id: "task-12-public-conversation",
      });
      publicResult = portable.buildPublicAdapterResult(outcome);
    } finally {
      runtime.close();
    }

    const cliRoot = temporaryDirectory("diet-manager-cli-parity-");
    const cli = spawnSync(process.execPath, [join(projectRoot, "dist", "cli", "agent.js"), "execute"], {
      input: JSON.stringify(command),
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        DIET_MANAGER_DATA_ROOT: cliRoot,
        DIET_MANAGER_CONVERSATION_ID: "task-12-cli-conversation",
      },
    });
    expect(cli.status, cli.stderr).toBe(0);
    const cliResult = JSON.parse(cli.stdout) as Record<string, unknown>;

    const openClawRoot = temporaryDirectory("diet-manager-openclaw-parity-");
    const registered = registerParityPlugin(openClawRoot);
    let openClawResult: Awaited<ReturnType<RegisteredParityTool["execute"]>>;
    try {
      openClawResult = await registered.tool.execute("task-12-openclaw-call", command);
    } finally {
      await registered.cleanup();
    }

    expect(completeBusinessResult(cliResult)).toEqual(completeBusinessResult(publicResult));
    expect(completeBusinessResult(openClawResult)).toEqual(completeBusinessResult(publicResult));
    expect(openClawResult.content[0]?.text).toBe(publicResult.render_model.text);
  }, 60_000);

  it("emits separate portable-root and OpenClaw declaration entries", () => {
    const rootDeclaration = join(projectRoot, "dist", "index.d.ts");
    const openClawDeclaration = join(projectRoot, "dist", "openclaw", "index.d.ts");

    expect(existsSync(rootDeclaration)).toBe(true);
    expect(existsSync(openClawDeclaration)).toBe(true);
    expect(readFileSync(rootDeclaration, "utf8")).not.toContain("openclaw");
    expect(readFileSync(openClawDeclaration, "utf8")).toContain("./plugin.js");
  });

  it("imports the compiled root with its declared TypeBox dependency and without OpenClaw", () => {
    const root = temporaryDirectory("diet-manager-portable-root-");
    expect(nodeModulesAncestor(root)).toBeUndefined();

    const isolatedDist = join(root, "dist");
    cpSync(join(projectRoot, "dist"), isolatedDist, { recursive: true });
    const isolatedTypeBox = join(root, "node_modules", "typebox");
    cpSync(realpathSync(join(projectRoot, "node_modules", "typebox")), isolatedTypeBox, {
      recursive: true,
    });
    const entryUrl = pathToFileURL(join(isolatedDist, "index.js")).href;
    const child = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      [
        "const entry = await import(process.argv[1]);",
        "if (typeof entry.executeAgentCommand !== 'function') throw new Error('missing executeAgentCommand');",
        "if (typeof entry.createCoreRuntime !== 'function') throw new Error('missing createCoreRuntime');",
        "if (entry.agentCommandV2Schema?.properties?.schema_version?.const !== 'diet-manager/agent-command/v2') throw new Error('missing v2 schema');",
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
