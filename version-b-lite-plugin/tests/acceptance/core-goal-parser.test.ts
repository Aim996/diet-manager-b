import { describe, expect, it } from "vitest";

import { parseCoreCommand } from "../../src/parser/parse-command.js";
import type { CoreParseInput } from "../../src/parser/types.js";

function input(overrides: { source_text: string; operation_id?: string }): CoreParseInput {
  return {
    source_text: overrides.source_text,
    received_at: "2026-08-19T08:30:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: overrides.operation_id ?? "operation-goal-default",
    source_message_id: "message-goal-default",
    conversation_id: "conversation-goal-default",
    prior_context: [],
  };
}

describe("core goal parser", () => {
  it("parses a numeric single-dimension override", () => {
    expect(
      parseCoreCommand(input({ source_text: "热量目标1800千卡", operation_id: "operation-goal-001" })),
    ).toEqual({
      disposition: "candidate",
      command: {
        action: "set_goal",
        operation_id: "operation-goal-001",
        source_text: "热量目标1800千卡",
        parser_version: "diet-manager/core-parser-v1",
        goals: { energy_kcal: 1800 },
      },
    });
  });

  it("maps a clear marker to a null override for the named dimension", () => {
    expect(
      parseCoreCommand(input({ source_text: "清除蛋白质目标" })),
    ).toMatchObject({
      disposition: "candidate",
      command: {
        action: "set_goal",
        goals: { protein_g: null },
      },
    });
  });

  it("parses multiple dimensions in one message, mixing set and clear", () => {
    expect(
      parseCoreCommand(input({ source_text: "热量目标1800蛋白质目标清除" })),
    ).toMatchObject({
      disposition: "candidate",
      command: {
        action: "set_goal",
        goals: { energy_kcal: 1800, protein_g: null },
      },
    });
  });

  it("accepts a decimal value within two fractional digits", () => {
    expect(
      parseCoreCommand(input({ source_text: "脂肪目标60.5" })),
    ).toMatchObject({
      disposition: "candidate",
      command: {
        action: "set_goal",
        goals: { fat_g: 60.5 },
      },
    });
  });

  it("recognises the clear-after form as a clear", () => {
    expect(
      parseCoreCommand(input({ source_text: "蛋白质目标清除" })),
    ).toMatchObject({
      disposition: "candidate",
      command: {
        action: "set_goal",
        goals: { protein_g: null },
      },
    });
  });

  it("asks for the value when a goal dimension is named without a number or clear", () => {
    expect(parseCoreCommand(input({ source_text: "热量目标" }))).toEqual({
      disposition: "needs_clarification",
      action: "set_goal",
      reason_code: "goal_incomplete",
      question: "请说明要设置或清除的目标维度和数值。",
    });
  });

  it("does not hijack ordinary meal text when no goal dimension is named", () => {
    expect(
      parseCoreCommand(input({ source_text: "吃了一个苹果" })),
    ).toMatchObject({
      disposition: "candidate",
      command: { action: "record_meal" },
    });
  });
});
