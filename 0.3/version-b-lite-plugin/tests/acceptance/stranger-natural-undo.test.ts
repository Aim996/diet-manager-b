import { describe, expect, it } from "vitest";

import { parseCoreCommand } from "../../src/parser/parse-command.js";

let sequence = 0;

function parse(sourceText: string) {
  sequence += 1;
  return parseCoreCommand({
    source_text: sourceText,
    received_at: "2026-08-20T15:48:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: `stranger-undo-operation-${sequence}`,
    source_message_id: `stranger-undo-message-${sequence}`,
    conversation_id: "stranger-natural-undo",
    prior_context: [],
  });
}

describe("first-time user natural undo", () => {
  it.each([
    ["刚才苹果那条先取消。", "苹果"],
    ["前面香蕉那次算错了，帮我去掉。", "香蕉"],
    ["刚才那碗米饭别算了。", "米饭"],
    ["下班路上那个苹果不记了。", "苹果"],
  ])("routes a named colloquial cancellation through the item target gate: %s", (sourceText, itemText) => {
    expect(parse(sourceText)).toMatchObject({
      disposition: "candidate",
      command: {
        action: "undo_record",
        source_text: sourceText,
        target: { kind: "active_meal_item_in_conversation", item_text: itemText },
      },
    });
  });

  it("keeps a generic colloquial cancellation behind the sole-active gate", () => {
    const sourceText = "早上那顿算了，别记了。";
    expect(parse(sourceText)).toMatchObject({
      disposition: "candidate",
      command: {
        action: "undo_record",
        source_text: sourceText,
        target: { kind: "sole_active_meal_in_conversation" },
      },
    });
  });
});
