import { describe, expect, it } from "vitest";

import { parseCoreCommand } from "../../src/parser/parse-command.js";

let sequence = 0;

function parse(sourceText: string) {
  sequence += 1;
  return parseCoreCommand({
    source_text: sourceText,
    received_at: "2026-08-20T15:38:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: `stranger-natural-operation-${sequence}`,
    source_message_id: `stranger-natural-message-${sequence}`,
    conversation_id: "stranger-natural-subject",
    prior_context: [],
  });
}

describe("first-time user subject defaults", () => {
  it.each([
    "我刚才随便吃了一个苹果。",
    "下午有点饿，顺手吃了一个香蕉。",
    "晚饭我吃了两碗米饭。",
    "刚下班路上啃了个苹果。",
    "早上赶时间，就吃了两片面包和一个鸡蛋。",
  ])("defaults a natural first-person account to the current user: %s", (sourceText) => {
    expect(parse(sourceText)).toMatchObject({
      disposition: "candidate",
      command: {
        action: "record_meal",
        source_text: sourceText,
        subject: { kind: "self" },
      },
    });
  });

  it("treats the colloquial bare classifier in '啃了个苹果' as one apple", () => {
    expect(parse("刚下班路上啃了个苹果。")).toMatchObject({
      disposition: "candidate",
      command: {
        action: "record_meal",
        items: [{
          normalized_name: "apple",
          quantity: 1,
          unit: "piece",
          estimated: false,
        }],
      },
    });
  });

  it.each([
    "同事顺手吃了个香蕉。",
    "我妈刚才吃了两个鸡蛋。",
    "小王下午吃了碗米饭。",
  ])("still rejects an explicitly different eater: %s", (sourceText) => {
    expect(parse(sourceText)).toMatchObject({
      disposition: "ignored",
      action: "record_meal",
      reason_code: "non_self_subject",
    });
  });
});
