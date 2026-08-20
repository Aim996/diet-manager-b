import { describe, expect, it } from "vitest";

import { parseCoreCommand } from "../../src/parser/parse-command.js";

function parse(sourceText: string) {
  return parseCoreCommand({
    source_text: sourceText,
    received_at: "2026-08-20T12:00:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: `operation-${sourceText.length}`,
    source_message_id: `message-${sourceText.length}`,
    conversation_id: "conversation-natural-regressions-021",
    prior_context: [],
  });
}

function expectCandidate(sourceText: string, action: string) {
  expect(parse(sourceText)).toMatchObject({
    disposition: "candidate",
    command: { action, source_text: sourceText },
  });
}

describe("0.2.1 natural-language regressions from real gateways", () => {
  it.each([
    "想开始减脂了，我28岁女生，175高，65公斤。",
    "我的身高是175，体重差不多65公斤。",
  ])("routes a natural profile: %s", (sourceText) => {
    expectCandidate(sourceText, "set_profile");
  });

  it("routes a natural calorie goal", () => {
    expect(parse("以后每天热量按1900大卡算就行。")).toMatchObject({
      disposition: "candidate",
      command: { action: "set_goal", goals: { energy_kcal: 1900 } },
    });
  });

  it("routes a natural water goal", () => {
    expect(parse("每天喝水先按1200毫升算。")).toMatchObject({
      disposition: "candidate",
      command: { action: "set_goal", goals: { water_ml: 1200 } },
    });
  });

  it("routes a natural goal clear", () => {
    expect(parse("蛋白质这一栏暂时不用给我定。")).toMatchObject({
      disposition: "candidate",
      command: { action: "set_goal", goals: { protein_g: null } },
    });
  });

  it.each([
    ["这会儿喝了600毫升矿泉水。", "record_water"],
    ["刚才喝了250毫升牛奶。", "record_meal"],
    ["我这会儿喝了270毫升牛奶。", "record_meal"],
    ["是我自己喝的，250毫升牛奶。", "record_meal"],
  ])("keeps bounded self ingestion: %s", (sourceText, action) => {
    expectCandidate(sourceText, action);
  });

  it.each([
    "刚才鸡蛋那条先取消。",
    "前面鸡蛋那次算错了，帮我去掉。",
  ])("routes a natural undo: %s", (sourceText) => {
    expectCandidate(sourceText, "undo_record");
  });

  it("routes a natural inventory addition", () => {
    expectCandidate("今天带回来一盒鸡蛋，先放进库存。", "add_inventory");
  });

  it.each([
    "孩子刚才喝了250毫升牛奶。",
    "同事这会儿喝了600毫升矿泉水。",
  ])("continues rejecting explicit non-self ingestion: %s", (sourceText) => {
    expect(parse(sourceText)).toMatchObject({
      disposition: "ignored",
      reason_code: "non_self_subject",
    });
  });
});
