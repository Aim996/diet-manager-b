import { describe, expect, it } from "vitest";

import { parseCoreCommand } from "../../src/parser/parse-command.js";
import type { CoreParseInput } from "../../src/parser/types.js";

function input(overrides: { source_text: string; operation_id?: string }): CoreParseInput {
  return {
    source_text: overrides.source_text,
    received_at: "2026-08-19T08:30:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: overrides.operation_id ?? "operation-profile-default",
    source_message_id: "message-profile-default",
    conversation_id: "conversation-profile-default",
    prior_context: [],
  };
}

describe("core profile parser", () => {
  it("parses the canonical profile phrase with sex, age and goal state", () => {
    expect(
      parseCoreCommand(input({ source_text: "身高180体重70公斤男30岁减脂", operation_id: "operation-profile-001" })),
    ).toEqual({
      disposition: "candidate",
      command: {
        action: "set_profile",
        operation_id: "operation-profile-001",
        source_text: "身高180体重70公斤男30岁减脂",
        parser_version: "diet-manager/core-parser-v1",
        height_cm: 180,
        weight_kg: 70,
        sex: "male",
        age: 30,
        goal_state: "cut",
      },
    });
  });

  it("maps 女/增肌 and 男/维持 to female/bulk and male/maintain", () => {
    expect(
      parseCoreCommand(input({ source_text: "身高165体重60公斤女28岁增肌" })),
    ).toMatchObject({
      disposition: "candidate",
      command: {
        action: "set_profile",
        height_cm: 165,
        weight_kg: 60,
        sex: "female",
        age: 28,
        goal_state: "bulk",
      },
    });
    expect(
      parseCoreCommand(input({ source_text: "身高175体重68公斤男维持" })),
    ).toMatchObject({
      disposition: "candidate",
      command: {
        action: "set_profile",
        height_cm: 175,
        weight_kg: 68,
        sex: "male",
        age: null,
        goal_state: "maintain",
      },
    });
  });

  it("defaults sex, age and goal state to null when omitted", () => {
    expect(
      parseCoreCommand(input({ source_text: "身高175体重68公斤" })),
    ).toMatchObject({
      disposition: "candidate",
      command: {
        action: "set_profile",
        height_cm: 175,
        weight_kg: 68,
        sex: null,
        age: null,
        goal_state: null,
      },
    });
  });

  it("accepts an optional height unit and flexible separators", () => {
    expect(
      parseCoreCommand(input({ source_text: "我身高170厘米，体重70公斤，男，30岁，维持" })),
    ).toMatchObject({
      disposition: "candidate",
      command: {
        action: "set_profile",
        height_cm: 170,
        weight_kg: 70,
        sex: "male",
        age: 30,
        goal_state: "maintain",
      },
    });
  });

  it.each([
    ["想开始减脂了，我28岁女生，175高，65公斤。", 175, 65],
    ["我的身高是175，体重差不多65公斤。", 175, 65],
  ])("parses bounded natural profile evidence: %s", (sourceText, height, weight) => {
    expect(parseCoreCommand(input({ source_text: sourceText }))).toMatchObject({
      disposition: "candidate",
      command: {
        action: "set_profile",
        height_cm: height,
        weight_kg: weight,
      },
    });
  });

  it.each(["175高。", "65公斤。"]) (
    "asks for the missing natural profile field: %s",
    (sourceText) => {
      expect(parseCoreCommand(input({ source_text: sourceText }))).toMatchObject({
        disposition: "needs_clarification",
        action: "set_profile",
        reason_code: "profile_incomplete",
      });
    },
  );

  it("asks for the missing field when only one of height or weight is present", () => {
    expect(parseCoreCommand(input({ source_text: "身高180" }))).toEqual({
      disposition: "needs_clarification",
      action: "set_profile",
      reason_code: "profile_incomplete",
      question: "请补充完整个人档案：身高（厘米）和体重（公斤）缺一不可。",
    });
    expect(parseCoreCommand(input({ source_text: "体重70公斤" }))).toEqual({
      disposition: "needs_clarification",
      action: "set_profile",
      reason_code: "profile_incomplete",
      question: "请补充完整个人档案：身高（厘米）和体重（公斤）缺一不可。",
    });
  });

  it("does not misclassify ordinary meal text as a profile", () => {
    expect(
      parseCoreCommand(input({ source_text: "吃了一个苹果" })),
    ).toMatchObject({
      disposition: "candidate",
      command: { action: "record_meal" },
    });
    expect(
      parseCoreCommand(input({ source_text: "吃了175克米饭和65克鸡蛋。" })),
    ).toMatchObject({
      disposition: "candidate",
      command: { action: "record_meal" },
    });
  });
});
