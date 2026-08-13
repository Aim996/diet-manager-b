import { describe, expect, it } from "vitest";

import { dietManagerActions } from "../../src/contracts.js";
import { cloneCoreParseInput } from "../../src/parser/input-authority.js";
import type {
  CoreParseResult,
  OccurredTimeEvidence,
} from "../../src/parser/types.js";

function ordinaryInput() {
  return {
    source_text: "吃了一个苹果。",
    received_at: "2026-08-11T08:30:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: "operation-core-input-001",
    source_message_id: "message-core-input-001",
    conversation_id: "conversation-core-v1",
    prior_context: [
      {
        context_id: "context-core-input-v1",
        conversation_id: "conversation-core-v1",
        revision: 1,
        generated_at: "2026-08-11T08:20:00+08:00",
        valid_until: "2026-08-11T08:40:00+08:00",
        source_message_id: "message-core-input-prior",
        rule_version: "diet-manager/context-v1",
        scope: "meal",
        items: [
          {
            normalized_name: "egg",
            quantity: 1,
            unit: "piece",
          },
        ],
      },
    ],
  };
}

function expectInvalid(value: unknown, reason: string): void {
  expect(() => cloneCoreParseInput(value)).toThrowError(
    `CORE_INPUT_AUTHORITY_INVALID:${reason}`,
  );
}

const ambiguousOccurredTime = {
  raw_text: "凌晨1点补记昨天夜宵",
  resolved_start: null,
  resolved_end: null,
  precision: "unknown",
  timezone: "Asia/Shanghai",
  resolution_basis: "needs_clarification",
  resolution_anchor: "2026-08-11T01:00:00+08:00",
  resolver_version: "diet-manager/time-parser-v1",
} as const satisfies OccurredTimeEvidence;

const frozenParserResultExamples = [
  {
    disposition: "ignored",
    action: "health_advice",
    reason_code: "unsupported_health_advice",
  },
  {
    disposition: "needs_clarification",
    action: "record_meal",
    reason_code: "occurred_date_ambiguous",
    question: "这顿夜宵是指8月10日还是8月11日？",
    occurred_time: ambiguousOccurredTime,
  },
  {
    disposition: "ignored",
    action: "record_meal",
    reason_code: "not_occurred",
    context_id: "context-meal-016-v1",
  },
  {
    disposition: "candidate",
    command: {
      action: "record_meal",
      operation_id: "operation-core-types-001",
      source_text: "我们吃了两盘炒饭。",
      parser_version: "diet-manager/core-parser-v1",
      occurred_time: {
        ...ambiguousOccurredTime,
        raw_text: null,
        resolved_start: "2026-08-11T08:30:00+08:00",
        resolved_end: "2026-08-11T08:31:00+08:00",
        precision: "exact",
        resolution_basis: "default_received_at",
        resolution_anchor: "2026-08-11T08:30:00+08:00",
      },
      subject: {
        kind: "self",
        resolution_basis: "collective_self_participation",
        self_participated: true,
        matched_span: "我们",
        rule_version: "diet-manager/subject-v1",
      },
      items: [
        {
          order: 0,
          kind: "food",
          normalized_name: "fried_rice",
          quantity: null,
          unit: null,
          estimated: null,
        },
      ],
      excluded_items: [
        {
          normalized_name: "egg",
          reason_code: "item_scoped_negation",
          matched_span: "没吃鸡蛋",
          rule_version: "diet-manager/completion-v1",
        },
      ],
      group_amount_evidence: {
        quantity: 2,
        unit: "plate",
        assigned_to_self: false,
        matched_span: "两盘",
        rule_version: "diet-manager/subject-v1",
      },
      context: {
        scene: "unknown",
        expired_context_ids: ["context-meal-020-expired-v1"],
        inventory_read: true,
        accepted_context: {
          context_id: "context-meal-020-current-v2",
          conversation_id: "conversation-core-v1",
          revision: 2,
          generated_at: "2026-08-11T08:20:00+08:00",
          valid_until: "2026-08-11T08:40:00+08:00",
          source_message_id: "message-meal-020-current",
          rule_version: "diet-manager/context-v1",
          scope: "meal_date",
          scene: "unknown",
        },
        rule_version: "diet-manager/context-v1",
      },
    },
  },
] as const satisfies readonly CoreParseResult[];

describe("core parser ordinary-input authority", () => {
  it("represents the frozen parser-only outcomes without expanding public actions", () => {
    expect(frozenParserResultExamples.map((result) => result.disposition)).toEqual([
      "ignored",
      "needs_clarification",
      "ignored",
      "candidate",
    ]);
    expect(dietManagerActions).not.toContain("health_advice");
  });

  it("clones an ordinary input, freezes every nested value, and detaches it from later mutations", () => {
    const source = ordinaryInput();

    const cloned = cloneCoreParseInput(source);
    source.source_text = "后来改写了原输入";
    source.prior_context[0].items[0].quantity = 99;
    source.prior_context.push({
      ...source.prior_context[0],
      context_id: "context-added-after-clone",
      items: [],
    });

    expect(cloned).toEqual(ordinaryInput());
    expect(cloned).not.toBe(source);
    expect(cloned.prior_context).not.toBe(source.prior_context);
    expect(cloned.prior_context[0]).not.toBe(source.prior_context[0]);
    expect(Object.isFrozen(cloned)).toBe(true);
    expect(Object.isFrozen(cloned.prior_context)).toBe(true);
    expect(Object.isFrozen(cloned.prior_context[0])).toBe(true);
    expect(Object.isFrozen(cloned.prior_context[0].items)).toBe(true);
    expect(Object.isFrozen(cloned.prior_context[0].items?.[0])).toBe(true);
  });

  it("rejects an accessor without executing its getter", () => {
    const input = ordinaryInput();
    let getterExecutions = 0;
    Object.defineProperty(input, "source_text", {
      configurable: true,
      enumerable: true,
      get() {
        getterExecutions += 1;
        return "不得读取";
      },
    });

    expectInvalid(input, "input.source_text:descriptor");
    expect(getterExecutions).toBe(0);
  });

  it("rejects a custom array iterator without executing it", () => {
    const input = ordinaryInput();
    let iteratorExecutions = 0;
    Object.defineProperty(input.prior_context, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      value() {
        iteratorExecutions += 1;
        return [][Symbol.iterator]();
      },
    });

    expectInvalid(input, "input.prior_context:array_keys");
    expect(iteratorExecutions).toBe(0);
  });

  it("rejects a proxy before executing any reflection trap", () => {
    let trapExecutions = 0;
    const input = new Proxy(ordinaryInput(), {
      getPrototypeOf() {
        trapExecutions += 1;
        throw new Error("reflection trap executed");
      },
      ownKeys() {
        trapExecutions += 1;
        throw new Error("reflection trap executed");
      },
      getOwnPropertyDescriptor() {
        trapExecutions += 1;
        throw new Error("reflection trap executed");
      },
    });

    expectInvalid(input, "input:proxy");
    expect(trapExecutions).toBe(0);
  });

  it("rejects a revoked object proxy with a stable authority error", () => {
    let trapExecutions = 0;
    const revocable = Proxy.revocable(ordinaryInput(), {
      getPrototypeOf() {
        trapExecutions += 1;
        throw new Error("reflection trap executed");
      },
      ownKeys() {
        trapExecutions += 1;
        throw new Error("reflection trap executed");
      },
      getOwnPropertyDescriptor() {
        trapExecutions += 1;
        throw new Error("reflection trap executed");
      },
    });
    revocable.revoke();

    expectInvalid(revocable.proxy, "input:proxy");
    expect(trapExecutions).toBe(0);
  });

  it("rejects a revoked array proxy with a stable authority error", () => {
    const input = ordinaryInput();
    let trapExecutions = 0;
    const revocable = Proxy.revocable(input.prior_context, {
      getPrototypeOf() {
        trapExecutions += 1;
        throw new Error("reflection trap executed");
      },
      ownKeys() {
        trapExecutions += 1;
        throw new Error("reflection trap executed");
      },
      getOwnPropertyDescriptor() {
        trapExecutions += 1;
        throw new Error("reflection trap executed");
      },
    });
    input.prior_context = revocable.proxy;
    revocable.revoke();

    expectInvalid(input, "input.prior_context:proxy");
    expect(trapExecutions).toBe(0);
  });

  it("rejects symbol keys", () => {
    const input = ordinaryInput() as ReturnType<typeof ordinaryInput> & {
      [key: symbol]: string;
    };
    input[Symbol("hidden")] = "value";

    expectInvalid(input, "input:keys");
  });

  it("rejects a non-enumerable property", () => {
    const input = ordinaryInput();
    Object.defineProperty(input, "source_text", {
      configurable: true,
      enumerable: false,
      value: input.source_text,
      writable: true,
    });

    expectInvalid(input, "input.source_text:descriptor");
  });

  it("rejects sparse arrays", () => {
    const input = ordinaryInput();
    input.prior_context = new Array(1) as ReturnType<typeof ordinaryInput>["prior_context"];

    expectInvalid(input, "input.prior_context:array_keys");
  });

  it("rejects custom array properties", () => {
    const input = ordinaryInput();
    Object.defineProperty(input.prior_context, "note", {
      configurable: true,
      enumerable: true,
      value: "not JSON array data",
      writable: true,
    });

    expectInvalid(input, "input.prior_context:array_keys");
  });

  it("rejects an attacker-sized sparse array before length-sized work", () => {
    const input = ordinaryInput();
    const attackerSized = [] as unknown[];
    attackerSized.length = 0xffff_ffff;
    let iteratorExecutions = 0;
    Object.defineProperty(attackerSized, Symbol.iterator, {
      configurable: true,
      value() {
        iteratorExecutions += 1;
        throw new Error("unexpected attacker array iteration");
      },
    });
    input.prior_context = attackerSized as ReturnType<typeof ordinaryInput>["prior_context"];
    const originalOwnKeys = Reflect.ownKeys;
    const originalArrayFrom = Array.from;
    let attackerOwnKeysCalls = 0;
    let arrayFromCalls = 0;
    let thrown: unknown;

    try {
      Reflect.ownKeys = ((target: object) => {
        if (target === attackerSized) {
          attackerOwnKeysCalls += 1;
          throw new Error("unexpected attacker array ownKeys");
        }
        return originalOwnKeys(target);
      }) as typeof Reflect.ownKeys;
      Array.from = ((..._args: unknown[]) => {
        arrayFromCalls += 1;
        throw new Error("unexpected Array.from");
      }) as typeof Array.from;
      try {
        cloneCoreParseInput(input);
      } catch (error) {
        thrown = error;
      }
    } finally {
      Reflect.ownKeys = originalOwnKeys;
      Array.from = originalArrayFrom;
    }

    expect(thrown).toMatchObject({
      message: "CORE_INPUT_AUTHORITY_INVALID:input.prior_context:array_length",
    });
    expect(attackerOwnKeysCalls).toBe(0);
    expect(arrayFromCalls).toBe(0);
    expect(iteratorExecutions).toBe(0);
  });

  it("does not consume optional descriptors injected through Object.prototype", () => {
    const input = ordinaryInput();
    const context = input.prior_context[0] as typeof input.prior_context[0] &
      Record<string, unknown>;
    Reflect.deleteProperty(context, "items");
    const itemsBefore = Object.getOwnPropertyDescriptor(Object.prototype, "items");
    const sceneBefore = Object.getOwnPropertyDescriptor(Object.prototype, "scene");

    try {
      Object.defineProperty(Object.prototype, "items", {
        configurable: true,
        value: { value: [], enumerable: true },
      });
      Object.defineProperty(Object.prototype, "scene", {
        configurable: true,
        value: { value: "company", enumerable: true },
      });

      const clonedContext = cloneCoreParseInput(input).prior_context[0];
      expect(Object.hasOwn(clonedContext, "items")).toBe(false);
      expect(Object.hasOwn(clonedContext, "scene")).toBe(false);
      expect(clonedContext.items).toBeUndefined();
      expect(clonedContext.scene).toBeUndefined();

      const inputWithOptionals = ordinaryInput();
      Object.defineProperty(inputWithOptionals.prior_context[0], "scene", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: "home",
      });
      const clonedWithOptionals = cloneCoreParseInput(inputWithOptionals)
        .prior_context[0];
      expect(clonedWithOptionals.items?.[0]).toMatchObject({
        normalized_name: "egg",
        quantity: 1,
        unit: "piece",
      });
      expect(clonedWithOptionals.scene).toBe("home");
    } finally {
      if (itemsBefore === undefined) {
        delete (Object.prototype as Record<string, unknown>).items;
      } else {
        Object.defineProperty(Object.prototype, "items", itemsBefore);
      }
      if (sceneBefore === undefined) {
        delete (Object.prototype as Record<string, unknown>).scene;
      } else {
        Object.defineProperty(Object.prototype, "scene", sceneBefore);
      }
    }
  });

  it("returns frozen null-prototype records at every cloned object level", () => {
    const cloned = cloneCoreParseInput(ordinaryInput());

    expect(Object.getPrototypeOf(cloned)).toBeNull();
    expect(Object.getPrototypeOf(cloned.prior_context[0])).toBeNull();
    expect(Object.getPrototypeOf(cloned.prior_context[0].items?.[0])).toBeNull();
    expect(Object.isFrozen(cloned)).toBe(true);
    expect(Object.isFrozen(cloned.prior_context[0])).toBe(true);
    expect(Object.isFrozen(cloned.prior_context[0].items?.[0])).toBe(true);
  });

  it("rejects custom prototypes", () => {
    const input = ordinaryInput();
    Object.setPrototypeOf(input, { inherited: true });

    expectInvalid(input, "input:prototype");
  });

  it.each([
    [Number.MAX_SAFE_INTEGER + 1, "unsafe integer"],
    [Number.NaN, "NaN"],
    [Number.POSITIVE_INFINITY, "positive infinity"],
    [Number.NEGATIVE_INFINITY, "negative infinity"],
  ])("rejects an unsafe numeric quantity (%s: %s)", (quantity) => {
    const input = ordinaryInput();
    input.prior_context[0].items[0].quantity = quantity as number;

    expectInvalid(
      input,
      "input.prior_context[0].items[0].quantity:number",
    );
  });

  it("rejects unexpected object keys", () => {
    const input = {
      ...ordinaryInput(),
      official_data_root: "C:\\must-not-be-model-controlled",
    };

    expectInvalid(input, "input:keys");
  });

  it.each([
    ["source_text", "", "input.source_text:length"],
    ["source_text", " ".repeat(4_097), "input.source_text:length"],
    ["operation_id", "", "input.operation_id:length"],
    ["source_message_id", "x".repeat(257), "input.source_message_id:length"],
    ["conversation_id", "   ", "input.conversation_id:length"],
    ["received_at", "not-iso", "input.received_at:iso_timestamp"],
  ])("rejects invalid bounded scalar %s", (key, value, reason) => {
    const input = ordinaryInput() as ReturnType<typeof ordinaryInput> &
      Record<string, unknown>;
    input[key] = value;
    expectInvalid(input, reason);
  });

  it.each([
    ["context_id", "", "input.prior_context[0].context_id:length"],
    ["context_id", "x".repeat(257), "input.prior_context[0].context_id:length"],
    ["generated_at", "not-iso", "input.prior_context[0].generated_at:iso_timestamp"],
    ["valid_until", "2026-02-30T08:30:00+08:00", "input.prior_context[0].valid_until:iso_timestamp"],
  ])("rejects invalid bounded context scalar %s", (key, value, reason) => {
    const input = ordinaryInput();
    (input.prior_context[0] as Record<string, unknown>)[key] = value;
    expectInvalid(input, reason);
  });
});
