import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../../src/authority/canonical-json.js";
import {
  createCoreRuntime,
  handleCoreRequest,
  type CoreRuntime,
} from "../../src/application/core-runtime.js";
import { assertDietManagerOutcome, type CoreApplicationRequest } from "../../src/contracts.js";
import { parseCoreCommand } from "../../src/parser/parse-command.js";
import { openDietDatabase } from "../../src/storage/database.js";

const RECEIVED_AT = "2026-08-11T08:30:00+08:00";

const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = join(tmpdir(), `diet-manager-pantry-multi-${randomUUID().replaceAll("-", "")}`);
  mkdirSync(root, { recursive: false });
  ownedRoots.add(root);
  return root;
}

afterEach(() => {
  for (const root of [...ownedRoots]) {
    ownedRoots.delete(root);
    rmSync(root, { recursive: true, force: false });
  }
});

function input(sourceText: string) {
  return {
    source_text: sourceText,
    received_at: RECEIVED_AT,
    timezone: "Asia/Shanghai" as const,
    operation_id: "operation-multi-purchase",
    source_message_id: "message-multi-purchase",
    conversation_id: "conversation-multi-purchase",
    prior_context: [],
  };
}

function parse(sourceText: string): Record<string, unknown> {
  return parseCoreCommand(input(sourceText)) as unknown as Record<string, unknown>;
}

function request(sourceText: string): CoreApplicationRequest {
  return {
    action: "add_inventory",
    ...input(sourceText),
  };
}

function tableSnapshot(database: DatabaseSync): string {
  const tables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;
  return canonicalJson(Object.fromEntries(tables.map(({ name }) => [
    name,
    database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ])));
}

describe("SEL-PANTRY-001 multi-item purchase grammar", () => {
  it("parses every complete item in source order", () => {
    expect(parse("买了2盒牛奶，每盒250ml、1盒鸡蛋，每盒12个和3袋苹果")).toMatchObject({
      disposition: "candidate",
      command: {
        action: "add_inventory",
        items: [
          { order: 0, normalized_name: "milk" },
          { order: 1, normalized_name: "egg" },
          { order: 2, normalized_name: "apple" },
        ],
      },
    });
  });

  it("recognizes 个 as an outer package unit inside a multi-item purchase", () => {
    expect(parse("买了2盒鸡蛋和1个苹果。")).toMatchObject({
      disposition: "candidate",
      command: {
        action: "add_inventory",
        items: [
          { order: 0, normalized_name: "egg", package_quantity: { outer_count: 2, outer_unit: "carton" } },
          { order: 1, normalized_name: "apple", package_quantity: { outer_count: 1, outer_unit: "piece" } },
        ],
      },
    });
  });

  it.each([
    ["盒", "carton"],
    ["袋", "bag"],
    ["箱", "box"],
    ["瓶", "bottle"],
    ["罐", "can"],
    ["包", "pack"],
    ["桶", "bucket"],
    ["个", "piece"],
    ["只", "piece"],
    ["颗", "piece"],
    ["枚", "piece"],
    ["片", "slice"],
    ["支", "stick"],
  ] as const)("recognizes %s as a package unit in a single-item purchase", (unit, outerUnit) => {
    expect(parse(`买了2${unit}苹果。`)).toMatchObject({
      disposition: "candidate",
      command: {
        action: "add_inventory",
        items: [
          { order: 0, normalized_name: "apple", package_quantity: { outer_count: 2, outer_unit: outerUnit } },
        ],
      },
    });
  });

  it("returns one concrete question and no candidate when two items are incomplete", () => {
    expect(parse("买了牛奶和鸡蛋")).toEqual({
      disposition: "needs_clarification",
      action: "add_inventory",
      reason_code: "amount_ambiguous",
      question: "还需要这些数量：牛奶买了几盒或几袋；鸡蛋买了几盒或几个。请一次回复完整。",
      missing_items: ["牛奶", "鸡蛋"],
    });
  });

  it("returns all-or-nothing clarification when any item in a list is incomplete", () => {
    expect(parse("买了2盒牛奶，每盒250ml、鸡蛋")).toEqual({
      disposition: "needs_clarification",
      action: "add_inventory",
      reason_code: "amount_ambiguous",
      question: "还需要这些数量：鸡蛋买了几盒或几个。请一次回复完整。",
      missing_items: ["鸡蛋"],
    });
  });
});

describe("SEL-PANTRY-001 multi-item purchase no-write authority", () => {
  it("performs no business writes when a multi-item purchase is incomplete", () => {
    const root = newRoot();
    const runtime: CoreRuntime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-11T08:30:01.000Z",
    });
    try {
      const before = openDietDatabase({ privateRuntimeRoot: root });
      let snapshot: string;
      try {
        snapshot = tableSnapshot(before.database);
      } finally {
        before.close();
      }

      const outcome = handleCoreRequest(runtime, request("买了牛奶和鸡蛋"));
      expect(outcome).toEqual({
        action: "add_inventory",
        status: "needs_clarification",
        committed: false,
        operation_id: "operation-multi-purchase",
        reason_code: "amount_ambiguous",
        question: "还需要这些数量：牛奶买了几盒或几袋；鸡蛋买了几盒或几个。请一次回复完整。",
        missing_items: ["牛奶", "鸡蛋"],
      });
      assertDietManagerOutcome(outcome);
      expect(Object.isFrozen(outcome)).toBe(true);

      const after = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(tableSnapshot(after.database)).toBe(snapshot);
      } finally {
        after.close();
      }
    } finally {
      runtime.close();
    }
  });
});
