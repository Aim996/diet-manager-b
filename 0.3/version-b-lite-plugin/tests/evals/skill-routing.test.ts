import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createCoreRuntime } from "../../src/application/runtime.js";
import { cloneAgentCommandV2 } from "../../src/public/agent-command.js";
import { executeAgentCommand } from "../../src/public/execute.js";

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const skillRoot = join(projectRoot, "skills", "diet-manager-b");
const referencesRoot = join(skillRoot, "references");
const skillPath = join(skillRoot, "SKILL.md");
const openAiPath = join(skillRoot, "agents", "openai.yaml");
const baselinePath = join(projectRoot, "tests", "evals", "skill-routing-baseline.json");
const greenPath = join(projectRoot, "tests", "evals", "skill-routing-green.json");
const strongPrompt = "晚饭我刚吃完两片全麦面包和一个苹果，帮我记下。";
const weakPrompt = "中午吃了点鸡胸肉和一碗饭。";
const noToolPrompt = "我刚喝了500毫升白水，帮我记下。";
const temporaryRoots: string[] = [];

const requiredReferenceNames = [
  "agent-command-v2.md",
  "natural-language-boundaries.md",
  "receipt-and-progress.md",
  "inventory-and-nutrition.md",
  "correction-and-recovery.md",
] as const;

function markdownLinks(markdown: string): readonly string[] {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/gu)].map((match) => match[1]!);
}

function jsonBlocks(markdown: string): readonly unknown[] {
  return [...markdown.matchAll(/```json\s*\n([\s\S]*?)\n```/gu)].map((match) =>
    JSON.parse(match[1]!) as unknown
  );
}

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "diet-manager-skill-eval-"));
  temporaryRoots.push(root);
  return root;
}

type CapturedCall = {
  readonly tool?: string;
  readonly tool_name?: string;
  readonly arguments: unknown;
};

type RawAgentOutput = {
  readonly loaded_files: readonly string[];
  readonly user_prompt: string;
  readonly calls: readonly CapturedCall[];
  readonly tool_results: readonly unknown[];
  readonly final_user_reply: string;
  readonly evaluation_notes: Readonly<Record<string, unknown>>;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Diet Manager agent skill routing", () => {
  it("records a five-repetition no-new-guidance control before changing the skill", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
      control: string;
      repetitions: Array<{
        session_id: string;
        raw_model_output: {
          calls: CapturedCall[];
          rationale: string;
        };
      }>;
      false_success_probe: {
        session_id: string;
        loaded_source: { commit: string; path: string };
        user_prompt: string;
        calls: CapturedCall[];
        tool_results: unknown[];
        final_user_reply: string;
        evaluation_notes: Record<string, unknown>;
      };
      observed_gap: Record<string, number>;
    };

    expect(baseline.control).toBe("existing-skill-before-task-12");
    expect(baseline.repetitions).toHaveLength(5);
    expect(new Set(baseline.repetitions.map((sample) => sample.session_id)).size).toBe(5);
    for (const sample of baseline.repetitions) {
      expect(sample.raw_model_output.calls).toHaveLength(1);
      expect(sample.raw_model_output.calls[0]).toMatchObject({
        tool: "diet-manager execute",
        arguments: {
          schema_version: "diet-manager/agent-command/v1",
          action: "record_meal",
          source_text: strongPrompt,
        },
      });
      expect(sample.raw_model_output.calls[0]?.arguments).not.toHaveProperty("semantic_proposal");
      expect(sample.raw_model_output.rationale.length).toBeGreaterThan(0);
    }
    expect(baseline.false_success_probe).toMatchObject({
      session_id: "task12_baseline_false_success_probe",
      loaded_source: {
        commit: "84f320b",
        path: "0.3/version-b-lite-plugin/skills/diet-manager-b/SKILL.md",
      },
      user_prompt: noToolPrompt,
      calls: [],
      tool_results: [],
      evaluation_notes: {
        explicitly_not_saved: true,
        claimed_success: false,
        alternative_storage: false,
      },
    });
    expect(baseline.false_success_probe.final_user_reply).toMatch(/未记录/u);
    expect(baseline.observed_gap).toEqual({
      missing_v2_semantic_proposal: 5,
      missed_call: 0,
      duplicate_call: 0,
      false_success_observed: 0,
    });
  });

  it("replays five independently captured v2 GREEN calls through the real runtime", async () => {
    const green = JSON.parse(readFileSync(greenPath, "utf8")) as {
      route_repetitions: Array<{
        session_id: string;
        raw_model_output: RawAgentOutput;
      }>;
    };

    expect(green.route_repetitions).toHaveLength(5);
    expect(new Set(green.route_repetitions.map((sample) => sample.session_id)).size).toBe(5);

    for (const [index, sample] of green.route_repetitions.entries()) {
      const raw = sample.raw_model_output;
      expect(raw.loaded_files.some((path) => path.endsWith("skills\\diet-manager-b\\SKILL.md"))).toBe(true);
      expect(raw.loaded_files.some((path) => path.endsWith("references\\agent-command-v2.md"))).toBe(true);
      expect(raw.user_prompt).toBe(strongPrompt);
      expect(raw.calls).toHaveLength(1);
      expect(raw.calls[0]?.tool_name).toBe("diet_manager");
      expect(raw.tool_results).toHaveLength(1);
      expect(raw.final_user_reply.length).toBeGreaterThan(0);

      const command = cloneAgentCommandV2(raw.calls[0]?.arguments);
      const runtime = createCoreRuntime({
        officialDataRoot: makeRoot(),
        now: () => "2026-08-22T10:00:01.000Z",
      });
      try {
        const outcome = await executeAgentCommand(runtime, command, {
          received_at: "2026-08-22T18:00:00+08:00",
          timezone: "Asia/Shanghai",
          operation_id: `skill-eval-strong-operation-${index + 1}`,
          source_message_id: `skill-eval-strong-message-${index + 1}`,
          conversation_id: `skill-eval-strong-conversation-${index + 1}`,
        });
        expect(outcome).toMatchObject({
          action: "record_meal",
          committed: true,
        });
        expect(["committed", "committed_with_issues"]).toContain(outcome.status);
        expect(outcome.receipt?.items.map((item) => item.name)).toEqual(["bread", "apple"]);
      } finally {
        runtime.close();
      }
    }
  });

  it("replays the captured weak-model call and preserves uncertainty without false success", async () => {
    const green = JSON.parse(readFileSync(greenPath, "utf8")) as {
      weak_model: { session_id: string; raw_model_output: RawAgentOutput };
    };
    const raw = green.weak_model.raw_model_output;

    expect(green.weak_model.session_id.length).toBeGreaterThan(0);
    expect(raw.user_prompt).toBe(weakPrompt);
    expect(raw.calls).toHaveLength(1);
    expect(raw.calls[0]?.tool_name).toBe("diet_manager");
    expect(raw.tool_results).toHaveLength(1);
    expect(raw.final_user_reply).toMatch(/尚未记录/u);
    const command = cloneAgentCommandV2(raw.calls[0]?.arguments);
    expect(command.semantic_proposal?.kind).toBe("meal");
    if (command.semantic_proposal?.kind !== "meal") throw new Error("expected meal proposal");
    expect(command.semantic_proposal.items.map((item) => item.amount.kind)).toEqual(["unknown", "exact"]);

    const runtime = createCoreRuntime({
      officialDataRoot: makeRoot(),
      now: () => "2026-08-22T04:00:01.000Z",
    });
    try {
      const outcome = await executeAgentCommand(runtime, command, {
        received_at: "2026-08-22T12:00:00+08:00",
        timezone: "Asia/Shanghai",
        operation_id: "skill-eval-weak-operation-1",
        source_message_id: "skill-eval-weak-message-1",
        conversation_id: "skill-eval-weak-conversation-1",
      });
      expect(outcome).toMatchObject({
        action: "record_meal",
        status: "needs_clarification",
        committed: false,
        reason_code: "amount_ambiguous",
      });
    } finally {
      runtime.close();
    }
  });

  it("retains a raw no-tool transcript that explicitly says the event was not saved", () => {
    const green = JSON.parse(readFileSync(greenPath, "utf8")) as {
      no_tool: { session_id: string; raw_model_output: RawAgentOutput };
    };
    const raw = green.no_tool.raw_model_output;

    expect(green.no_tool.session_id.length).toBeGreaterThan(0);
    expect(raw.user_prompt).toBe(noToolPrompt);
    expect(raw.calls).toEqual([]);
    expect(raw.tool_results).toEqual([]);
    expect(raw.final_user_reply).toMatch(/未保存/u);
    expect(raw.evaluation_notes).toMatchObject({
      explicitly_not_saved: true,
      used_alternative_storage: false,
      claimed_success: false,
    });
  });

  it("keeps SKILL.md as the six-part lightweight routing entry", () => {
    const skill = readFileSync(skillPath, "utf8");
    const sectionNames = [...skill.matchAll(/^## (.+)$/gmu)].map((match) => match[1]);

    expect(sectionNames).toEqual([
      "触发范围",
      "主体与非事件边界",
      "动作选择",
      "一次业务调用",
      "结果状态处理",
      "按需读取 references",
    ]);
    expect(skill).not.toContain("agent-command-v1.md");
    expect(skill).not.toMatch(/```(?:json|ts|typescript)/u);
    expect(skill).not.toContain("official_data_root");
  });

  it("routes directly to exactly the five planned references without deeper markdown chains", () => {
    const skill = readFileSync(skillPath, "utf8");
    expect(markdownLinks(skill).sort()).toEqual(
      requiredReferenceNames.map((name) => `references/${name}`).sort(),
    );
    expect(readdirSync(referencesRoot).filter((name) => name.endsWith(".md")).sort()).toEqual(
      [...requiredReferenceNames].sort(),
    );

    for (const name of requiredReferenceNames) {
      const reference = readFileSync(join(referencesRoot, name), "utf8");
      expect(reference).toMatch(/^# /u);
      expect(reference).toContain("## 何时读取");
      expect(markdownLinks(reference), `${name} must remain one reference layer deep`).toEqual([]);
    }
  });

  it("keeps every JSON example in the command reference valid against the v2 machine contract", () => {
    const commandReference = readFileSync(join(referencesRoot, "agent-command-v2.md"), "utf8");
    const examples = jsonBlocks(commandReference);

    expect(examples.length).toBeGreaterThanOrEqual(3);
    for (const example of examples) {
      expect(() => cloneAgentCommandV2(example)).not.toThrow();
    }
  });

  it("documents UTF-8-safe one-shot commands for the three supported shell families", () => {
    const commandReference = readFileSync(join(referencesRoot, "agent-command-v2.md"), "utf8");

    expect(commandReference).toContain("## PowerShell 7+");
    expect(commandReference).toContain("StandardInputEncoding");
    expect(commandReference).toContain("## Windows PowerShell 5.1");
    expect(commandReference).toContain("StandardInput.BaseStream.Write");
    expect(commandReference).toContain("## POSIX shell");
    expect(commandReference).toContain("printf '%s\\n'");
    expect(commandReference).not.toMatch(/\$command\s*\|\s*&/u);
  });

  it("documents a schema-valid unknown-amount proposal for the weakest safe route", () => {
    const boundaryReference = readFileSync(
      join(referencesRoot, "natural-language-boundaries.md"),
      "utf8",
    );
    const [example] = jsonBlocks(boundaryReference) as Array<{
      semantic_proposal?: {
        kind?: string;
        items?: Array<{ amount?: { kind?: string } }>;
      };
    }>;

    expect(example).toBeDefined();
    expect(() => cloneAgentCommandV2(example)).not.toThrow();
    expect(example?.semantic_proposal?.kind).toBe("meal");
    expect(example?.semantic_proposal?.items?.map((item) => item.amount?.kind)).toEqual([
      "unknown",
      "exact",
    ]);
  });

  it("documents a schema-valid record mutation without an authority-shaped id", () => {
    const correctionReference = readFileSync(
      join(referencesRoot, "correction-and-recovery.md"),
      "utf8",
    );
    const [example] = jsonBlocks(correctionReference) as Array<{
      semantic_proposal?: { kind?: string; target?: { description?: string } };
    }>;

    expect(example).toBeDefined();
    expect(() => cloneAgentCommandV2(example)).not.toThrow();
    expect(example?.semantic_proposal?.kind).toBe("record_mutation");
    expect(example?.semantic_proposal?.target?.description).not.toMatch(/[_-]id\b/iu);
  });

  it("keeps OpenAI discovery metadata concise and tied to this skill", () => {
    const openAi = readFileSync(openAiPath, "utf8");

    expect(openAi).toMatch(/^interface:\r?$/mu);
    expect(openAi).toMatch(/^  display_name: "饮食管家"\r?$/mu);
    expect(openAi).toMatch(/^  short_description: "[^"]{25,64}"\r?$/mu);
    expect(openAi).toMatch(/^  default_prompt: "[^"]*\$diet-manager-b[^"]*"\r?$/mu);
    expect(openAi).toMatch(/^policy:\r?\n  allow_implicit_invocation: true\r?$/mu);
    expect(openAi).not.toMatch(/record_meal|semantic_proposal|committed_with_issues/u);
  });
});
