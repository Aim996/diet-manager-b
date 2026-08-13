import { describe, expect, it } from "vitest";

import { cloneCoreParseInput } from "../../src/parser/input-authority.js";

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

describe("core parser ordinary-input authority", () => {
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
});
