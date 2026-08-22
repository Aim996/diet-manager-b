import { describe, expect, it } from "vitest";

import * as contracts from "../../src/contracts.js";
import {
  cloneAgentCommandV1,
} from "../../src/public/agent-command.js";

type CloneAgentCommandV2 = (value: unknown) => Readonly<Record<string, unknown>>;

const subject = {
  kind: "self",
  basis: "explicit",
  evidence_span: "我",
  explicit_other_spans: [],
} as const;

const unspecifiedTime = {
  kind: "unspecified",
  evidence_span: null,
} as const;

function cloneV2(value: unknown): Readonly<Record<string, unknown>> {
  const clone = Reflect.get(contracts, "cloneAgentCommandV2") as
    | CloneAgentCommandV2
    | undefined;
  expect(clone, "the shared v2 contract must expose its hardened clone boundary")
    .toBeTypeOf("function");
  return clone!(value);
}

function mealCommand() {
  return {
    schema_version: "diet-manager/agent-command/v2",
    action: "record_meal",
    source_text: "我午饭吃了两个鸡蛋",
    semantic_proposal: {
      kind: "meal",
      subject,
      occurrence: "completed",
      meal_slot: "lunch",
      items: [{
        raw_name: "鸡蛋",
        normalized_hint: "egg",
        amount: {
          kind: "exact",
          value: 2,
          unit: "piece",
          evidence_span: "两个鸡蛋",
        },
      }],
      occurred_at: { kind: "source_text", evidence_span: "午饭" },
    },
  } as const;
}

function waterCommand() {
  return {
    schema_version: "diet-manager/agent-command/v2",
    action: "record_water",
    source_text: "我喝了500毫升白水",
    semantic_proposal: {
      kind: "water",
      subject,
      amount: {
        kind: "exact",
        value: 500,
        unit: "ml",
        evidence_span: "500毫升",
      },
      occurred_at: unspecifiedTime,
    },
  } as const;
}

function inventoryCommand() {
  return {
    schema_version: "diet-manager/agent-command/v2",
    action: "add_inventory",
    source_text: "我买了2盒牛奶，每盒250毫升，放冰箱，一共30元",
    semantic_proposal: {
      kind: "inventory",
      product: {
        raw_name: "牛奶",
        normalized_hint: "milk",
        evidence_span: "牛奶",
      },
      package_amount: {
        kind: "exact",
        value: 2,
        unit: "package",
        evidence_span: "2盒",
      },
      per_package_content: {
        kind: "exact",
        value: 250,
        unit: "ml",
        evidence_span: "每盒250毫升",
      },
      location: { value: "fridge", evidence_span: "冰箱" },
      expires_at: null,
      price: { amount: 30, currency: "CNY", evidence_span: "30元" },
    },
  } as const;
}

function goalCommand() {
  return {
    schema_version: "diet-manager/agent-command/v2",
    action: "set_goal",
    source_text: "把热量目标改为1800千卡",
    semantic_proposal: {
      kind: "goal",
      operation: "update",
      values: {
        energy_kcal: { value: 1800, evidence_span: "1800千卡" },
      },
    },
  } as const;
}

describe("diet-manager/agent-command/v2", () => {
  it.each([
    ["meal", mealCommand()],
    ["water", waterCommand()],
    ["inventory", inventoryCommand()],
    ["goal", goalCommand()],
  ])("accepts and freezes a valid %s semantic proposal", (_kind, command) => {
    const cloned = cloneV2(command);

    expect(cloned).toEqual(command);
    expect(cloned).not.toBe(command);
    expect(Object.isFrozen(cloned)).toBe(true);
    expect(Object.isFrozen(cloned.semantic_proposal)).toBe(true);
  });

  it("rejects unknown fields at the command and nested proposal levels", () => {
    expect(() => cloneV2({ ...mealCommand(), extra: true }))
      .toThrow("DIET_AGENT_COMMAND_INVALID");
    expect(() => cloneV2({
      ...mealCommand(),
      semantic_proposal: { ...mealCommand().semantic_proposal, extra: true },
    })).toThrow("DIET_AGENT_COMMAND_INVALID");
    expect(() => cloneV2({
      ...mealCommand(),
      semantic_proposal: {
        ...mealCommand().semantic_proposal,
        items: [{ ...mealCommand().semantic_proposal.items[0], database_id: "forged" }],
      },
    })).toThrow("DIET_AGENT_COMMAND_INVALID");
  });

  it.each([
    "official_data_root",
    "database_path",
    "received_at",
    "timezone",
    "operation_id",
    "source_message_id",
    "conversation_id",
    "prior_context",
  ])("rejects model-supplied host authority field %s", (field) => {
    expect(() => cloneV2({ ...waterCommand(), [field]: "forged" }))
      .toThrow("DIET_AGENT_COMMAND_INVALID");
  });

  it("rejects custom prototypes at every level", () => {
    const command = mealCommand();
    const hostileRoot = Object.assign(Object.create({ inherited: true }), command);
    const hostileProposal = Object.assign(
      Object.create({ inherited: true }),
      command.semantic_proposal,
    );
    const hostileItems = [...command.semantic_proposal.items];
    Object.setPrototypeOf(hostileItems, Object.create(Array.prototype));

    expect(() => cloneV2(hostileRoot)).toThrow("DIET_AGENT_COMMAND_INVALID");
    expect(() => cloneV2({ ...command, semantic_proposal: hostileProposal }))
      .toThrow("DIET_AGENT_COMMAND_INVALID");
    expect(() => cloneV2({
      ...command,
      semantic_proposal: { ...command.semantic_proposal, items: hostileItems },
    })).toThrow("DIET_AGENT_COMMAND_INVALID");
  });

  it("rejects accessors without executing getters", () => {
    let rootGetterCalls = 0;
    const root = { ...waterCommand() } as Record<string, unknown>;
    Object.defineProperty(root, "source_text", {
      enumerable: true,
      get(): never {
        rootGetterCalls += 1;
        throw new Error("root getter executed");
      },
    });

    let nestedGetterCalls = 0;
    const nested = { ...mealCommand().semantic_proposal } as Record<string, unknown>;
    Object.defineProperty(nested, "items", {
      enumerable: true,
      get(): never {
        nestedGetterCalls += 1;
        throw new Error("nested getter executed");
      },
    });

    expect(() => cloneV2(root)).toThrow("DIET_AGENT_COMMAND_INVALID");
    expect(() => cloneV2({ ...mealCommand(), semantic_proposal: nested }))
      .toThrow("DIET_AGENT_COMMAND_INVALID");
    expect(rootGetterCalls).toBe(0);
    expect(nestedGetterCalls).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite evidence number %s",
    (value) => {
      const command = waterCommand();
      expect(() => cloneV2({
        ...command,
        semantic_proposal: {
          ...command.semantic_proposal,
          amount: { ...command.semantic_proposal.amount, value },
        },
      })).toThrow("DIET_AGENT_COMMAND_INVALID");
    },
  );

  it("rejects empty and oversized proposal arrays", () => {
    const command = mealCommand();
    expect(() => cloneV2({
      ...command,
      semantic_proposal: { ...command.semantic_proposal, items: [] },
    })).toThrow("DIET_AGENT_COMMAND_INVALID");
    expect(() => cloneV2({
      ...command,
      semantic_proposal: {
        ...command.semantic_proposal,
        items: Array.from({ length: 65 }, () => command.semantic_proposal.items[0]),
      },
    })).toThrow("DIET_AGENT_COMMAND_INVALID");
  });

  it("rejects empty or oversized source text", () => {
    expect(() => cloneV2({ ...waterCommand(), source_text: "" }))
      .toThrow("DIET_AGENT_COMMAND_INVALID");
    expect(() => cloneV2({ ...waterCommand(), source_text: "a".repeat(4097) }))
      .toThrow("DIET_AGENT_COMMAND_INVALID");
  });

  it("rejects proposal evidence that is not a verbatim source substring", () => {
    const command = waterCommand();
    expect(() => cloneV2({
      ...command,
      semantic_proposal: {
        ...command.semantic_proposal,
        amount: { ...command.semantic_proposal.amount, evidence_span: "600毫升" },
      },
    })).toThrow("DIET_AGENT_COMMAND_INVALID:evidence_span");
  });

  it("keeps v1 readable and does not let v1 carry an undeclared v2 proposal", () => {
    const v1 = {
      schema_version: "diet-manager/agent-command/v1",
      action: "record_water",
      source_text: "我喝了500毫升白水",
    } as const;
    expect(cloneAgentCommandV1(v1)).toEqual(v1);
    expect(() => cloneAgentCommandV1({
      ...v1,
      semantic_proposal: waterCommand().semantic_proposal,
    })).toThrow("DIET_AGENT_COMMAND_INVALID:keys");
  });
});
