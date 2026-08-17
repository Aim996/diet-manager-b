import { describe, expect, it } from "vitest";

import { parseCoreCommand } from "../../src/parser/parse-command.js";
import type { CoreParseInput } from "../../src/parser/types.js";

function input(overrides: { source_text: string; operation_id?: string }): CoreParseInput {
  return {
    source_text: overrides.source_text,
    received_at: "2026-08-11T08:30:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: overrides.operation_id ?? "operation-undo-default",
    source_message_id: "message-undo-default",
    conversation_id: "conversation-undo-default",
    prior_context: [],
  };
}

describe("core correction parser", () => {
  it.each([
    ["撤销刚才那条饮食记录", { kind: "latest_meal_in_conversation" }],
    ["撤销记录 event-meal-001", { kind: "event_id", event_id: "event-meal-001" }],
  ])("parses undo target: %s", (source_text, target) => {
    expect(parseCoreCommand(input({ source_text, operation_id: "operation-undo-001" }))).toMatchObject({
      disposition: "candidate",
      command: {
        action: "undo_record",
        operation_id: "operation-undo-001",
        target,
      },
    });
  });

  it("asks one question when the target is not bounded", () => {
    expect(parseCoreCommand(input({ source_text: "撤销那条记录" }))).toEqual({
      disposition: "needs_clarification",
      action: "undo_record",
      reason_code: "target_ambiguous",
      question: "要撤销哪一条饮食记录？请说“刚才那条”或提供记录编号。",
    });
  });

  it.each([
    ["把刚才米饭改成2碗", "米饭", 2, "碗"],
    ["把刚才炒饭改成2盘", "炒饭", 2, "盘"],
    ["把刚才鸡胸肉改成2块", "鸡胸肉", 2, "块"],
    ["把刚才面包改成2片", "面包", 2, "片"],
    ["把刚才牛奶改成2瓶", "牛奶", 2, "瓶"],
    ["把刚才牛奶改成2盒", "牛奶", 2, "盒"],
    ["把刚才牛奶改成200mL", "牛奶", 200, "mL"],
    ["把刚才牛奶改成200ML", "牛奶", 200, "ML"],
    ["把刚才苹果改成200克", "苹果", 200, "克"],
  ])("parses meal-amount correction for the meal unit set: %s", (sourceText, itemText, quantity, unit) => {
    expect(parseCoreCommand(input({ source_text: sourceText, operation_id: "operation-correction-001" }))).toMatchObject({
      disposition: "candidate",
      command: {
        action: "correct_record",
        correction_kind: "meal_amount",
        target_item_text: itemText,
        replacement_quantity: quantity,
        replacement_unit: unit,
      },
    });
  });
});
