import { describe, expect, it } from "vitest";

import type { SemanticProposalV2 } from "../../src/contracts/semantic-proposal-v2.js";
import { validateSemanticProposalV2 } from "../../src/semantic/validate-proposal-v2.js";

const host = Object.freeze({
  received_at: "2026-08-21T12:30:00+08:00" as const,
  timezone: "Asia/Shanghai" as const,
  operation_id: "semantic-v2-operation",
  source_message_id: "semantic-v2-message",
  conversation_id: "semantic-v2-conversation",
});

function validate(
  action: Parameters<typeof validateSemanticProposalV2>[0]["action"],
  sourceText: string,
  proposal: SemanticProposalV2,
) {
  return validateSemanticProposalV2({
    action,
    source_text: sourceText,
    semantic_proposal: proposal,
    ...host,
  });
}

const self = Object.freeze({
  kind: "self" as const,
  basis: "private_agent_default" as const,
  evidence_span: null,
  explicit_other_spans: Object.freeze([]),
});

describe("SemanticProposalV2 validation", () => {
  it("maps an ordinary multi-item meal and preserves a nutritious drink", () => {
    const sourceText = "午饭打卡：一碗米饭、两个鸡蛋、300毫升无糖豆浆。";
    const result = validate("record_meal", sourceText, {
      kind: "meal",
      subject: self,
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
    });

    expect(result).toMatchObject({
      disposition: "candidate",
      command: {
        action: "record_meal",
        parser_version: "diet-manager/semantic-proposal/v2",
        semantic_meal_slot: "lunch",
        items: [
          { normalized_name: "rice", quantity: 1, unit: "碗", kind: "food" },
          { normalized_name: "egg", quantity: 2, unit: "个", kind: "food" },
          {
            normalized_name: "unsweetened_soy_milk",
            quantity: 300,
            unit: "ml",
            kind: "nutritious_drink",
          },
        ],
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.disposition === "candidate") {
      expect(Object.isFrozen(result.command)).toBe(true);
      expect(Object.isFrozen(result.command.items)).toBe(true);
    }
  });

  it("maps package count, per-package content, location, expiration, and price evidence", () => {
    const sourceText = "补货：2盒牛奶，每盒250毫升，保质期到下周五，放冰箱，一共30元。";
    const result = validate("add_inventory", sourceText, {
      kind: "inventory",
      product: { raw_name: "牛奶", normalized_hint: "milk", evidence_span: "牛奶" },
      package_amount: { kind: "exact", value: 2, unit: "盒", evidence_span: "2盒" },
      per_package_content: {
        kind: "exact", value: 250, unit: "ml", evidence_span: "每盒250毫升",
      },
      location: { value: "refrigerator", evidence_span: "冰箱" },
      expires_at: { kind: "source_text", evidence_span: "下周五" },
      price: { amount: 30, currency: "CNY", evidence_span: "30元" },
    });

    expect(result).toMatchObject({
      disposition: "candidate",
      command: {
        action: "add_inventory",
        parser_version: "diet-manager/semantic-proposal/v2",
        items: [{
          normalized_name: "milk",
          product_type: "nutrition_drink",
          package_quantity: {
            outer_count: 2,
            outer_unit: "盒",
            capacity_per_inner: 250,
            capacity_unit: "ml",
            total_capacity: 500,
          },
          location: { value: "refrigerator", evidence_kind: "explicit" },
          expiration: {
            reliability: "explicit",
            explicit_at: "2026-08-28T08:00:00.000Z",
            matched_span: "下周五",
          },
          price: { amount: 30, currency: "CNY", evidence_span: "30元" },
        }],
      },
    });
  });

  it("maps an evidence-backed plain-water amount without relying on command phrasing", () => {
    const result = validate("record_water", "刚才补了750毫升水", {
      kind: "water",
      subject: self,
      amount: { kind: "exact", value: 750, unit: "ml", evidence_span: "750毫升" },
      occurred_at: { kind: "source_text", evidence_span: "刚才" },
    });
    expect(result).toMatchObject({
      disposition: "candidate",
      command: {
        action: "record_water",
        parser_version: "diet-manager/semantic-proposal/v2",
        plain_water_ml_milli: 750_000,
      },
    });
  });

  it("maps profile and goal updates from evidence-backed values", () => {
    const profileSource = "资料更新：男，28岁，175厘米，78公斤，每周运动三次，想减脂。";
    const profile = validate("set_profile", profileSource, {
      kind: "profile",
      operation: "update",
      values: {
        sex: { value: "male", evidence_span: "男" },
        age_years: { value: 28, evidence_span: "28岁" },
        height_cm: { value: 175, evidence_span: "175厘米" },
        weight_kg: { value: 78, evidence_span: "78公斤" },
        activity_level: { value: "moderate", evidence_span: "每周运动三次" },
        goal_direction: { value: "cut", evidence_span: "减脂" },
      },
    });
    expect(profile).toMatchObject({
      disposition: "candidate",
      command: {
        action: "set_profile", height_cm: 175, weight_kg: 78,
        sex: "male", age: 28, goal_state: "cut",
      },
    });

    const goalSource = "以后每天热量1800千卡、蛋白质120克，纤维目标清空。";
    const goal = validate("set_goal", goalSource, {
      kind: "goal",
      operation: "update",
      values: {
        energy_kcal: { value: 1800, evidence_span: "热量1800千卡" },
        protein_g: { value: 120, evidence_span: "蛋白质120克" },
        fiber_g: null,
      },
    });
    expect(goal).toMatchObject({
      disposition: "candidate",
      command: {
        action: "set_goal",
        goals: { energy_kcal: 1800, protein_g: 120, fiber_g: null },
      },
    });
  });

  it.each([
    ["correct_record", "把刚才苹果改成200克", "correct"],
    ["undo_record", "撤销刚才那顿", "undo"],
    ["restore_record", "恢复刚才撤销的那顿", "restore"],
  ] as const)("accepts evidence-only record mutation %s without authority IDs", (action, sourceText, operation) => {
    const replacement = operation === "correct"
      ? { description: "200克", evidence_span: "200克" }
      : undefined;
    const result = validate(action, sourceText, {
      kind: "record_mutation",
      operation,
      target: { description: "刚才", evidence_span: "刚才" },
      ...(replacement === undefined ? {} : { replacement }),
    });
    expect(result.disposition).not.toBe("rejected");
  });

  it("does not broaden an unrecognized structured mutation target to the sole active meal", () => {
    const sourceText = "帮我撤掉昨天早餐的苹果";
    expect(validate("undo_record", sourceText, {
      kind: "record_mutation",
      operation: "undo",
      target: { description: "昨天早餐的苹果", evidence_span: "昨天早餐的苹果" },
    })).toEqual({
      disposition: "needs_clarification",
      action: "undo_record",
      reason_code: "target_ambiguous",
      question: "请补充要撤销的记录，或说明是最近哪一条。",
    });
  });

  it.each([
    ["我没吃两个蛋糕", "not_occurred"],
    ["明天准备吃一个苹果", "future_plan"],
    ["如果晚上吃两个鸡蛋会怎样", "future_plan"],
    ["我妈吃了两个鸡蛋", "non_self_subject"],
  ] as const)("keeps unsafe intake '%s' non-writing", (sourceText, reasonCode) => {
    const rawName = sourceText.includes("蛋糕") ? "蛋糕" : sourceText.includes("苹果") ? "苹果" : "鸡蛋";
    const amountSpan = sourceText.includes("一个") ? `一个${rawName}` : `两个${rawName}`;
    const result = validate("record_meal", sourceText, {
      kind: "meal",
      subject: self,
      occurrence: "completed",
      meal_slot: "unknown",
      items: [{ raw_name: rawName, normalized_hint: rawName, amount: {
        kind: "exact", value: sourceText.includes("一个") ? 1 : 2,
        unit: "个", evidence_span: amountSpan,
      } }],
      occurred_at: { kind: "unspecified", evidence_span: null },
    });
    expect(result).toMatchObject({ disposition: "ignored", reason_code: reasonCode });
  });

  it.each([
    ["action", "record_water", "SEMANTIC_ACTION_MISMATCH"],
    ["entity", "record_meal", "SEMANTIC_ENTITY_MISMATCH"],
    ["amount", "record_meal", "SEMANTIC_AMOUNT_MISMATCH"],
    ["subject", "record_meal", "SEMANTIC_SUBJECT_MISMATCH"],
  ] as const)("rejects %s conflicts with a stable code", (kind, action, errorCode) => {
    const sourceText = "我吃了一个鸡蛋";
    const proposal = {
      kind: "meal" as const,
      subject: kind === "subject"
        ? { kind: "self" as const, basis: "explicit" as const,
            evidence_span: "鸡蛋", explicit_other_spans: [] }
        : { kind: "self" as const, basis: "explicit" as const,
            evidence_span: "我", explicit_other_spans: [] },
      occurrence: "completed" as const,
      meal_slot: "unknown" as const,
      items: [{
        raw_name: kind === "entity" ? "苹果" : "鸡蛋",
        normalized_hint: kind === "entity" ? "apple" : "egg",
        amount: {
          kind: "exact" as const,
          value: kind === "amount" ? 2 : 1,
          unit: "个",
          evidence_span: "一个鸡蛋",
        },
      }],
      occurred_at: { kind: "unspecified" as const, evidence_span: null },
    };
    expect(validate(action, sourceText, proposal)).toEqual({
      disposition: "rejected",
      error_code: errorCode,
    });
  });

  it("rejects a record target that asks the Agent to select a database ID", () => {
    const sourceText = "撤销 event_id=01J5V8M7YJ8S2K9A1B2C3D4E5F";
    expect(validate("undo_record", sourceText, {
      kind: "record_mutation",
      operation: "undo",
      target: {
        description: "event_id=01J5V8M7YJ8S2K9A1B2C3D4E5F",
        evidence_span: "event_id=01J5V8M7YJ8S2K9A1B2C3D4E5F",
      },
    })).toEqual({
      disposition: "rejected",
      error_code: "SEMANTIC_AUTHORITY_REFERENCE",
    });
  });

  it.each([
    "conversation_id=semantic-v2-conversation",
    "source_message_id=semantic-v2-message",
  ])("rejects a record target containing host authority %s", (description) => {
    const sourceText = `撤销 ${description}`;
    expect(validate("undo_record", sourceText, {
      kind: "record_mutation",
      operation: "undo",
      target: { description, evidence_span: description },
    })).toEqual({
      disposition: "rejected",
      error_code: "SEMANTIC_AUTHORITY_REFERENCE",
    });
  });

  it("rejects a non-finite exact value before it can become application authority", () => {
    expect(validate("record_meal", "我吃了Infinity个鸡蛋", {
      kind: "meal",
      subject: { kind: "self", basis: "explicit", evidence_span: "我", explicit_other_spans: [] },
      occurrence: "completed",
      meal_slot: "unknown",
      items: [{
        raw_name: "鸡蛋",
        normalized_hint: "egg",
        amount: {
          kind: "exact",
          value: Number.POSITIVE_INFINITY,
          unit: "个",
          evidence_span: "Infinity个鸡蛋",
        },
      }],
      occurred_at: { kind: "unspecified", evidence_span: null },
    })).toEqual({
      disposition: "rejected",
      error_code: "SEMANTIC_PROPOSAL_INVALID",
    });
  });
});
