import { expect, it } from "vitest";

import { parseCoreCommand } from "../../src/parser/parse-command.js";

const TARGET_EVENT_ID = "event-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

it("parses an explicit nutrition supplement target as a current-user correction", () => {
  const result = parseCoreCommand({
    source_text: `补充营养记录 ${TARGET_EVENT_ID}。`,
    received_at: "2026-08-14T12:00:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: "operation-nutrition-supplement-001",
    source_message_id: "message-nutrition-supplement-001",
    conversation_id: "conversation-nutrition-supplement-001",
    prior_context: [],
  });

  expect(result).toEqual({
    disposition: "candidate",
    command: {
      action: "correct_record",
      operation_id: "operation-nutrition-supplement-001",
      parser_version: "diet-manager/core-parser-v1",
      kind: "nutrition_supplement",
      target_record_id: TARGET_EVENT_ID,
      target_date_text: null,
      target_item_text: null,
      source_text: `补充营养记录 ${TARGET_EVENT_ID}。`,
      subject: {
        kind: "self",
        resolution_basis: "omitted_subject_default",
        subject_entity_created: false,
        matched_span: null,
        rule_version: "diet-manager/subject-v1",
      },
    },
  });
  expect(Object.isFrozen(result)).toBe(true);
  if (result.disposition === "candidate") {
    expect(Object.isFrozen(result.command)).toBe(true);
    expect(Object.isFrozen(result.command.subject)).toBe(true);
  }
});
