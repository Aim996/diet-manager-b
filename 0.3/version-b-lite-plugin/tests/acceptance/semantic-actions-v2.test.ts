import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCoreRuntime } from "../../src/application/runtime.js";
import { DIET_DATABASE_FILENAME } from "../../src/storage/database.js";
import { executeAgentCommand } from "../../src/public/execute.js";

const roots: string[] = [];

function runtime() {
  const root = mkdtempSync(join(tmpdir(), "diet-semantic-actions-v2-"));
  roots.push(root);
  return {
    root,
    runtime: createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-21T04:30:00.000Z",
    }),
  };
}

function context(id: string, conversationId = "semantic-actions-v2-conversation") {
  return {
    operation_id: `operation-${id}`,
    source_message_id: `message-${id}`,
    conversation_id: conversationId,
    received_at: "2026-08-21T12:30:00+08:00" as const,
    timezone: "Asia/Shanghai" as const,
  };
}

const defaultSelf = Object.freeze({
  kind: "self" as const,
  basis: "private_agent_default" as const,
  evidence_span: null,
  explicit_other_spans: Object.freeze([]),
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: false });
});

describe("Agent Command v2 semantic application", () => {
  it("commits an ordinary multi-item meal from the proposal without parser command phrasing", async () => {
    const opened = runtime();
    try {
      const sourceText = "午饭打卡：一碗米饭、两个鸡蛋、300毫升无糖豆浆。";
      const outcome = await executeAgentCommand(opened.runtime, {
        schema_version: "diet-manager/agent-command/v2",
        action: "record_meal",
        source_text: sourceText,
        semantic_proposal: {
          kind: "meal",
          subject: defaultSelf,
          occurrence: "completed",
          meal_slot: "lunch",
          items: [
            { raw_name: "米饭", normalized_hint: "rice", amount: {
              kind: "exact", value: 1, unit: "碗", evidence_span: "一碗米饭",
            } },
            { raw_name: "鸡蛋", normalized_hint: "egg", amount: {
              kind: "exact", value: 2, unit: "个", evidence_span: "两个鸡蛋",
            } },
            { raw_name: "无糖豆浆", normalized_hint: "unsweetened_soy_milk", amount: {
              kind: "exact", value: 300, unit: "ml", evidence_span: "300毫升无糖豆浆",
            } },
          ],
          occurred_at: { kind: "source_text", evidence_span: "午饭" },
        },
      }, context("multi-meal"));
      expect(outcome).toMatchObject({ committed: true, action: "record_meal" });

      const query = await executeAgentCommand(opened.runtime, {
        schema_version: "diet-manager/agent-command/v2",
        action: "query_meals",
        source_text: "查今天吃了什么",
      }, context("query-meals"));
      expect(query.meal_history?.meals).toHaveLength(1);
      expect(query.meal_history?.meals[0]?.items).toMatchObject([
        { name: "rice", quantity_microunits: 1_000_000, item_type: "food" },
        { name: "egg", quantity_microunits: 2_000_000, item_type: "food" },
        {
          name: "unsweetened_soy_milk",
          quantity_microunits: 300_000_000,
          item_type: "nutrition_drink",
        },
      ]);
    } finally {
      opened.runtime.close();
    }
  });

  it("writes only the explicit self share from a mixed-subject proposal", async () => {
    const opened = runtime();
    try {
      const sourceText = "我跟我老婆各吃了一个鸡蛋";
      const outcome = await executeAgentCommand(opened.runtime, {
        schema_version: "diet-manager/agent-command/v2",
        action: "record_meal",
        source_text: sourceText,
        semantic_proposal: {
          kind: "meal",
          subject: {
            kind: "self",
            basis: "explicit",
            evidence_span: "我",
            explicit_other_spans: ["我老婆"],
          },
          occurrence: "completed",
          meal_slot: "unknown",
          items: [{ raw_name: "鸡蛋", normalized_hint: "egg", amount: {
            kind: "exact", value: 1, unit: "个", evidence_span: "一个鸡蛋",
          } }],
          occurred_at: { kind: "unspecified", evidence_span: null },
        },
      }, context("mixed-subject"));
      expect(outcome).toMatchObject({ committed: true });
      expect(outcome.receipt?.items).toHaveLength(1);
      expect(outcome.receipt?.items[0]).toMatchObject({ name: "egg", quantity: 1 });
    } finally {
      opened.runtime.close();
    }
  });

  it("commits a plain-water proposal from ordinary wording the legacy parser need not understand", async () => {
    const opened = runtime();
    try {
      const outcome = await executeAgentCommand(opened.runtime, {
        schema_version: "diet-manager/agent-command/v2",
        action: "record_water",
        source_text: "刚才补了750毫升水",
        semantic_proposal: {
          kind: "water",
          subject: defaultSelf,
          amount: { kind: "exact", value: 750, unit: "ml", evidence_span: "750毫升" },
          occurred_at: { kind: "source_text", evidence_span: "刚才" },
        },
      }, context("plain-water"));
      expect(outcome).toMatchObject({
        action: "record_water",
        committed: true,
      });
    } finally {
      opened.runtime.close();
    }
  });

  it("keeps explicit inventory expiration and price bound to the committed batch", async () => {
    const opened = runtime();
    try {
      const sourceText = "刚买了两盒纯牛奶，每盒250毫升，保质期到下周五，放冰箱冷藏层，一共12块钱。";
      const outcome = await executeAgentCommand(opened.runtime, {
        schema_version: "diet-manager/agent-command/v2",
        action: "add_inventory",
        source_text: sourceText,
        semantic_proposal: {
          kind: "inventory",
          product: { raw_name: "纯牛奶", normalized_hint: "milk", evidence_span: "纯牛奶" },
          package_amount: { kind: "exact", value: 2, unit: "盒", evidence_span: "两盒" },
          per_package_content: {
            kind: "exact", value: 250, unit: "ml", evidence_span: "每盒250毫升",
          },
          location: { value: "冰箱冷藏层", evidence_span: "冰箱冷藏层" },
          expires_at: { kind: "source_text", evidence_span: "下周五" },
          price: { amount: 12, currency: "CNY", evidence_span: "一共12块钱" },
        },
      }, context("inventory-facts"));
      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        action: "add_inventory", committed: true,
      });

      const query = await executeAgentCommand(opened.runtime, {
        schema_version: "diet-manager/agent-command/v2",
        action: "query_inventory",
        source_text: "查库存",
      }, context("inventory-facts-query"));
      expect(query.inventory_view?.batches).toHaveLength(1);
      expect(query.inventory_view?.batches[0]).toMatchObject({
        expiration_at: "2026-08-28T08:00:00.000Z",
        location: "冰箱冷藏层",
        price: { amount: 12, currency: "CNY", evidence_span: "一共12块钱" },
      });
    } finally {
      opened.runtime.close();
    }
  });

  it.each([
    ["negative", "我没吃两个蛋糕", "蛋糕", 2, "两个蛋糕"],
    ["future", "明天准备吃一个苹果", "苹果", 1, "一个苹果"],
    ["hypothetical", "如果晚上吃两个鸡蛋会怎样", "鸡蛋", 2, "两个鸡蛋"],
    ["other", "我妈吃了两个鸡蛋", "鸡蛋", 2, "两个鸡蛋"],
  ] as const)("keeps %s intake at zero SQLite writes", async (id, sourceText, rawName, value, span) => {
    const opened = runtime();
    try {
      const outcome = await executeAgentCommand(opened.runtime, {
        schema_version: "diet-manager/agent-command/v2",
        action: "record_meal",
        source_text: sourceText,
        semantic_proposal: {
          kind: "meal",
          subject: defaultSelf,
          occurrence: "completed",
          meal_slot: "unknown",
          items: [{ raw_name: rawName, normalized_hint: rawName, amount: {
            kind: "exact", value, unit: "个", evidence_span: span,
          } }],
          occurred_at: { kind: "unspecified", evidence_span: null },
        },
      }, context(id));
      expect(outcome).toMatchObject({ committed: false, status: "ignored" });
      expect(existsSync(join(opened.root, DIET_DATABASE_FILENAME))).toBe(false);
    } finally {
      opened.runtime.close();
    }
  });

  it.each([
    ["entity", "SEMANTIC_ENTITY_MISMATCH", "苹果", 1],
    ["amount", "SEMANTIC_AMOUNT_MISMATCH", "鸡蛋", 2],
  ] as const)("rejects a proposal/source %s conflict before SQLite", async (id, code, rawName, value) => {
    const opened = runtime();
    try {
      const outcome = await executeAgentCommand(opened.runtime, {
        schema_version: "diet-manager/agent-command/v2",
        action: "record_meal",
        source_text: "我吃了一个鸡蛋",
        semantic_proposal: {
          kind: "meal",
          subject: {
            kind: "self", basis: "explicit", evidence_span: "我", explicit_other_spans: [],
          },
          occurrence: "completed",
          meal_slot: "unknown",
          items: [{ raw_name: rawName, normalized_hint: rawName, amount: {
            kind: "exact", value, unit: "个", evidence_span: "一个鸡蛋",
          } }],
          occurred_at: { kind: "unspecified", evidence_span: null },
        },
      }, context(`conflict-${id}`));
      expect(outcome).toMatchObject({ committed: false, status: "failed", error_code: code });
      expect(existsSync(join(opened.root, DIET_DATABASE_FILENAME))).toBe(false);
    } finally {
      opened.runtime.close();
    }
  });
});
