import { describe, expect, it } from "vitest";

import {
  cloneSemanticCandidate,
  type SemanticMealCandidateV1,
} from "../../src/semantic/candidate.js";
import { validateSemanticMealCandidate } from "../../src/semantic/validate-candidate.js";

function candidate(
  sourceText: string,
  items: SemanticMealCandidateV1["items"],
): SemanticMealCandidateV1 {
  return {
    schema_version: "diet-manager/semantic-candidate/v1",
    intent: "record_meal",
    source_text: sourceText,
    subject: {
      kind: "self",
      basis: "private_agent_default",
      evidence_span: null,
      explicit_other_spans: [],
    },
    items,
    time: { kind: "source_text", evidence_span: "中午" },
  };
}

function validate(
  value: SemanticMealCandidateV1,
  sourceText = value.source_text,
  action: "record_meal" | "record_water" = "record_meal",
) {
  return validateSemanticMealCandidate({
    candidate: value,
    action,
    source_text: sourceText,
    received_at: "2026-08-20T12:30:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: "semantic-test-001",
  });
}

describe("semantic meal candidate validation", () => {
  it("accepts private-agent default self when evidence is complete", () => {
    const sourceText = "中午扒了两碗米饭，这会儿还撑着";
    const result = validateSemanticMealCandidate({
      candidate: candidate(sourceText, [{
        raw_name: "米饭",
        normalized_hint: "rice",
        amount: { kind: "exact", value: 2, unit: "bowl", evidence_span: "两碗米饭" },
      }]),
      action: "record_meal",
      source_text: sourceText,
      received_at: "2026-08-20T12:30:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "semantic-rice-001",
    });
    expect(result).toMatchObject({
      disposition: "candidate",
      command: {
        action: "record_meal",
        parser_version: "diet-manager/semantic-candidate-v1",
        subject: { kind: "self", resolution_basis: "omitted_subject_default" },
        items: [{ normalized_name: "rice", quantity: 2, unit: "bowl", estimated: false }],
      },
    });
  });

  it("lets explicit-other evidence override a false self claim", () => {
    const sourceText = "我同事吃了一个鸡蛋";
    expect(validateSemanticMealCandidate({
      candidate: candidate(sourceText, [{
        raw_name: "鸡蛋",
        normalized_hint: "egg",
        amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
      }]),
      action: "record_meal",
      source_text: sourceText,
      received_at: "2026-08-20T08:00:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "semantic-other-002",
    })).toEqual({ disposition: "ignored", action: "record_meal", reason_code: "non_self_subject" });
  });

  it("does not mistake a food source for the eater", () => {
    const sourceText = "中午我吃了妈妈做的一个苹果";
    const value = candidate(sourceText, [{
      raw_name: "苹果",
      normalized_hint: "apple",
      amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个苹果" },
    }]);
    expect(validate(value)).toMatchObject({
      disposition: "candidate",
      command: {
        subject: { kind: "self", resolution_basis: "omitted_subject_default" },
        items: [{ normalized_name: "apple", quantity: 1, unit: "piece" }],
      },
    });
  });

  it.each([
    [
      "negated ingestion",
      "我没吃一个鸡蛋",
      { disposition: "ignored", action: "record_meal", reason_code: "not_occurred" },
    ],
    [
      "future plan",
      "我明天准备吃一个鸡蛋",
      { disposition: "ignored", action: "record_meal", reason_code: "future_plan" },
    ],
    [
      "stated plan",
      "我打算明天吃一个鸡蛋",
      { disposition: "ignored", action: "record_meal", reason_code: "future_plan" },
    ],
    [
      "direct refusal",
      "我不吃一个鸡蛋",
      { disposition: "ignored", action: "record_meal", reason_code: "not_occurred" },
    ],
    [
      "hypothetical ingestion",
      "如果我吃一个鸡蛋",
      {
        disposition: "needs_clarification",
        action: "record_meal",
        reason_code: "unsupported_command",
        question: "这是条件描述，还是要记录已经发生的饮食？",
      },
    ],
    [
      "interrogative ingestion",
      "我吃一个鸡蛋吗",
      {
        disposition: "needs_clarification",
        action: "record_meal",
        reason_code: "unsupported_command",
        question: "这是在询问，还是要记录已经发生的饮食？",
      },
    ],
  ])("never turns %s into a recordable command", (_label, sourceText, expected) => {
    const value = {
      ...candidate(sourceText, [{
        raw_name: "鸡蛋",
        normalized_hint: "egg",
        amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
      }]),
      time: { kind: "unspecified" as const, evidence_span: null },
    };
    expect(validate(value)).toEqual(expected);
  });

  it.each([
    "我妈妈也吃了一个鸡蛋",
    "我同事在公司吃了一个鸡蛋",
  ])("ignores an explicit other eater across ordinary modifiers: %s", (sourceText) => {
    const value = {
      ...candidate(sourceText, [{
        raw_name: "鸡蛋",
        normalized_hint: "egg",
        amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
      }]),
      time: { kind: "unspecified" as const, evidence_span: null },
    };
    expect(validate(value)).toEqual({
      disposition: "ignored",
      action: "record_meal",
      reason_code: "non_self_subject",
    });
  });

  it.each([
    [9, "bowl"],
    [2, "g"],
  ])("rejects amount %s %s when present evidence says two bowls", (amount, unit) => {
    const sourceText = "中午吃了两碗米饭";
    const value = candidate(sourceText, [{
      raw_name: "米饭",
      normalized_hint: "rice",
      amount: { kind: "exact", value: amount, unit, evidence_span: "两碗米饭" },
    }]);
    expect(validate(value)).toEqual({
      disposition: "rejected",
      error_code: "SEMANTIC_EVIDENCE_INVALID",
    });
  });

  it("rejects an item name masquerading as explicit-self evidence", () => {
    const sourceText = "中午我吃了一个鸡蛋";
    const base = candidate(sourceText, [{
      raw_name: "鸡蛋",
      normalized_hint: "egg",
      amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
    }]);
    const value = {
      ...base,
      subject: {
        kind: "self" as const,
        basis: "explicit" as const,
        evidence_span: "鸡蛋",
        explicit_other_spans: [],
      },
    };
    expect(validate(value)).toEqual({
      disposition: "rejected",
      error_code: "SEMANTIC_EVIDENCE_INVALID",
    });
  });

  it("accepts deterministic explicit-self evidence", () => {
    const sourceText = "中午我吃了一个鸡蛋";
    const base = candidate(sourceText, [{
      raw_name: "鸡蛋",
      normalized_hint: "egg",
      amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
    }]);
    const value = {
      ...base,
      subject: {
        kind: "self" as const,
        basis: "explicit" as const,
        evidence_span: "我",
        explicit_other_spans: [],
      },
    };
    expect(validate(value)).toMatchObject({
      disposition: "candidate",
      command: {
        subject: {
          kind: "self",
          resolution_basis: "explicit_self",
          matched_span: "我",
        },
      },
    });
  });

  it("rejects an item name masquerading as time evidence", () => {
    const sourceText = "中午吃了一个鸡蛋";
    const value = {
      ...candidate(sourceText, [{
        raw_name: "鸡蛋",
        normalized_hint: "egg",
        amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
      }]),
      time: { kind: "source_text" as const, evidence_span: "鸡蛋" },
    };
    expect(validate(value)).toEqual({
      disposition: "rejected",
      error_code: "SEMANTIC_EVIDENCE_INVALID",
    });
  });

  it("asks only for a missing amount", () => {
    const sourceText = "早上顺手吃了鸡蛋";
    const value = candidate(sourceText, [{
      raw_name: "鸡蛋",
      normalized_hint: "egg",
      amount: { kind: "unknown" },
    }]);
    expect(validateSemanticMealCandidate({
      candidate: value,
      action: "record_meal",
      source_text: sourceText,
      received_at: "2026-08-20T08:00:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "semantic-amount-003",
    })).toEqual({
      disposition: "needs_clarification",
      action: "record_meal",
      reason_code: "amount_ambiguous",
      question: "鸡蛋吃了多少个？",
      missing_items: ["鸡蛋"],
    });
  });

  it("rejects a candidate copied from different source text", () => {
    const value = candidate("中午吃了两碗米饭", [{
      raw_name: "米饭",
      normalized_hint: "rice",
      amount: { kind: "exact", value: 2, unit: "bowl", evidence_span: "两碗米饭" },
    }]);
    expect(validate(value, "中午吃了一个鸡蛋")).toEqual({
      disposition: "rejected",
      error_code: "SEMANTIC_SOURCE_MISMATCH",
    });
  });

  it("rejects an intent that disagrees with the requested action", () => {
    const value = candidate("中午吃了两碗米饭", [{
      raw_name: "米饭",
      normalized_hint: "rice",
      amount: { kind: "exact", value: 2, unit: "bowl", evidence_span: "两碗米饭" },
    }]);
    expect(validate(value, value.source_text, "record_water")).toEqual({
      disposition: "rejected",
      error_code: "SEMANTIC_ACTION_MISMATCH",
    });
  });

  it.each([
    ["unknown raw name", "包子", "rice"],
    ["wrong normalized hint", "米饭", "egg"],
  ])("rejects an item with %s", (_label, rawName, normalizedHint) => {
    const sourceText = `中午吃了一个${rawName}`;
    const value = candidate(sourceText, [{
      raw_name: rawName,
      normalized_hint: normalizedHint,
      amount: { kind: "exact", value: 1, unit: "piece", evidence_span: `一个${rawName}` },
    }]);
    expect(validate(value)).toEqual({
      disposition: "rejected",
      error_code: "SEMANTIC_ITEM_MISMATCH",
    });
  });

  it.each([
    ["subject", {
      subject: {
        kind: "self",
        basis: "explicit",
        evidence_span: "我本人",
        explicit_other_spans: [],
      },
    }],
    ["amount", {
      items: [{
        raw_name: "米饭",
        normalized_hint: "rice",
        amount: { kind: "exact", value: 2, unit: "bowl", evidence_span: "三碗米饭" },
      }],
    }],
    ["time", { time: { kind: "source_text", evidence_span: "昨晚" } }],
  ])("rejects a missing %s evidence span", (_label, replacement) => {
    const sourceText = "中午我吃了两碗米饭";
    const base = candidate(sourceText, [{
      raw_name: "米饭",
      normalized_hint: "rice",
      amount: { kind: "exact", value: 2, unit: "bowl", evidence_span: "两碗米饭" },
    }]);
    const value = { ...base, ...replacement } as SemanticMealCandidateV1;
    expect(validate(value)).toEqual({
      disposition: "rejected",
      error_code: "SEMANTIC_EVIDENCE_INVALID",
    });
  });

  it.each([
    [0, "bowl"],
    [-1, "bowl"],
    [Number.NaN, "bowl"],
    [1, "piece"],
  ])("rejects invalid rice amount %s %s", (amount, unit) => {
    const sourceText = "中午吃了两碗米饭";
    const value = candidate(sourceText, [{
      raw_name: "米饭",
      normalized_hint: "rice",
      amount: { kind: "exact", value: amount, unit, evidence_span: "两碗米饭" },
    }]);
    expect(validate(value)).toEqual({
      disposition: "rejected",
      error_code: "SEMANTIC_CANDIDATE_INVALID",
    });
  });

  it("rejects extra keys at nested levels", () => {
    const sourceText = "中午吃了两碗米饭";
    const base = candidate(sourceText, [{
      raw_name: "米饭",
      normalized_hint: "rice",
      amount: { kind: "exact", value: 2, unit: "bowl", evidence_span: "两碗米饭" },
    }]);
    const value = {
      ...base,
      items: [{ ...base.items[0], amount: { ...base.items[0]?.amount, confidence: 1 } }],
    } as unknown as SemanticMealCandidateV1;
    expect(validate(value)).toEqual({
      disposition: "rejected",
      error_code: "SEMANTIC_CANDIDATE_INVALID",
    });
  });

  it("rejects accessors without executing their getters", () => {
    let getterCalls = 0;
    const sourceText = "中午吃了两碗米饭";
    const base = candidate(sourceText, [{
      raw_name: "米饭",
      normalized_hint: "rice",
      amount: { kind: "exact", value: 2, unit: "bowl", evidence_span: "两碗米饭" },
    }]);
    const subject = { ...base.subject };
    Object.defineProperty(subject, "evidence_span", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return null;
      },
    });
    const value = { ...base, subject } as SemanticMealCandidateV1;
    expect(validate(value)).toEqual({
      disposition: "rejected",
      error_code: "SEMANTIC_CANDIDATE_INVALID",
    });
    expect(getterCalls).toBe(0);
  });

  it("rejects nested proxies without executing their traps", () => {
    let trapCalls = 0;
    const sourceText = "中午吃了两碗米饭";
    const base = candidate(sourceText, [{
      raw_name: "米饭",
      normalized_hint: "rice",
      amount: { kind: "exact", value: 2, unit: "bowl", evidence_span: "两碗米饭" },
    }]);
    const amount = new Proxy(base.items[0]!.amount, {
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        return undefined;
      },
      ownKeys() {
        trapCalls += 1;
        return [];
      },
      get() {
        trapCalls += 1;
        return undefined;
      },
    });
    const value = {
      ...base,
      items: [{ ...base.items[0], amount }],
    } as SemanticMealCandidateV1;
    expect(validate(value)).toEqual({
      disposition: "rejected",
      error_code: "SEMANTIC_CANDIDATE_INVALID",
    });
    expect(trapCalls).toBe(0);
  });

  it("returns a detached deeply frozen clone", () => {
    const sourceText = "中午吃了两碗米饭";
    const value = candidate(sourceText, [{
      raw_name: "米饭",
      normalized_hint: "rice",
      amount: { kind: "exact", value: 2, unit: "bowl", evidence_span: "两碗米饭" },
    }]);
    const cloned = cloneSemanticCandidate(value);
    expect(cloned).not.toBe(value);
    expect(cloned.items).not.toBe(value.items);
    expect(Object.isFrozen(cloned)).toBe(true);
    expect(Object.isFrozen(cloned.subject)).toBe(true);
    expect(Object.isFrozen(cloned.items)).toBe(true);
    expect(Object.isFrozen(cloned.items[0])).toBe(true);
    expect(Object.isFrozen(cloned.items[0]!.amount)).toBe(true);
    expect(Object.isFrozen(cloned.time)).toBe(true);
  });
});
