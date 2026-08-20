import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  handleCoreRequest,
  handleCoreRequestAsync,
} from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import type { SemanticMealCandidateV1 } from "../../src/semantic/candidate.js";
import { openDietDatabase } from "../../src/storage/database.js";

const ownedRoots = new Set<string>();
let sequence = 0;

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "diet-manager-semantic-application-"));
  ownedRoots.add(root);
  return root;
}

function removeRoot(root: string): void {
  if (!ownedRoots.delete(root)) throw new Error(`unregistered test root: ${root}`);
  rmSync(root, { recursive: true, force: false });
}

afterEach(() => {
  for (const root of [...ownedRoots]) removeRoot(root);
});

function semanticCandidate(
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
    time: { kind: "unspecified", evidence_span: null },
  };
}

function semanticRequest(
  sourceText: string,
  items: SemanticMealCandidateV1["items"],
) {
  sequence += 1;
  const operationId = `semantic-application-${sequence}`;
  return {
    action: "record_meal" as const,
    source_text: sourceText,
    received_at: "2026-08-20T12:30:00+08:00",
    timezone: "Asia/Shanghai" as const,
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: "conversation-semantic-application",
    prior_context: [],
    semantic_candidate: semanticCandidate(sourceText, items),
  };
}

function eventCount(root: string): number {
  const databaseRuntime = openDietDatabase({ privateRuntimeRoot: root });
  try {
    const row = databaseRuntime.database.prepare(
      "SELECT COUNT(*) AS count FROM event_records",
    ).get() as { count: number };
    return row.count;
  } finally {
    databaseRuntime.close();
  }
}

describe("semantic meal application requests", () => {
  it.each([
    ["中午扒了两碗米饭，这会儿还撑着", [{
      raw_name: "米饭",
      normalized_hint: "rice",
      amount: { kind: "exact" as const, value: 2, unit: "bowl", evidence_span: "两碗米饭" },
    }]],
    ["早上顺手吃了一个鸡蛋", [{
      raw_name: "鸡蛋",
      normalized_hint: "egg",
      amount: { kind: "exact" as const, value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
    }]],
    ["我出门前吃了两片面包和一个煮鸡蛋", [
      {
        raw_name: "面包",
        normalized_hint: "bread",
        amount: { kind: "exact" as const, value: 2, unit: "slice", evidence_span: "两片面包" },
      },
      {
        raw_name: "鸡蛋",
        normalized_hint: "egg",
        amount: { kind: "exact" as const, value: 1, unit: "piece", evidence_span: "一个煮鸡蛋" },
      },
    ]],
  ] satisfies ReadonlyArray<readonly [string, SemanticMealCandidateV1["items"]]>)
  ("commits a validated semantic meal: %s", (sourceText, items) => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-20T04:30:01.000Z",
    });
    try {
      const before = eventCount(root);
      const outcome = handleCoreRequest(runtime, semanticRequest(sourceText, items));

      expect(outcome).toMatchObject({ action: "record_meal", committed: true });
      expect(eventCount(root) - before).toBe(1);
    } finally {
      runtime.close();
    }
  });

  it("does not write an explicit-other meal when the candidate claims self", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-20T04:30:01.000Z",
    });
    try {
      const request = semanticRequest("我同事吃了一个鸡蛋", [{
        raw_name: "鸡蛋",
        normalized_hint: "egg",
        amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
      }]);
      const before = eventCount(root);

      expect(handleCoreRequest(runtime, request)).toEqual({
        action: "record_meal",
        status: "ignored",
        committed: false,
        operation_id: request.operation_id,
        reason_code: "non_self_subject",
      });
      expect(eventCount(root) - before).toBe(0);
    } finally {
      runtime.close();
    }
  });

  it("does not write a semantic meal with an unknown amount", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-20T04:30:01.000Z",
    });
    try {
      const request = semanticRequest("早上顺手吃了鸡蛋", [{
        raw_name: "鸡蛋",
        normalized_hint: "egg",
        amount: { kind: "unknown" },
      }]);
      const before = eventCount(root);

      expect(handleCoreRequest(runtime, request)).toMatchObject({
        action: "record_meal",
        status: "needs_clarification",
        committed: false,
        operation_id: request.operation_id,
        reason_code: "amount_ambiguous",
      });
      expect(eventCount(root) - before).toBe(0);
    } finally {
      runtime.close();
    }
  });

  it("rejects a candidate whose source differs from the request without writing", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-20T04:30:01.000Z",
    });
    try {
      const baseRequest = semanticRequest("早上顺手吃了一个鸡蛋", [{
        raw_name: "鸡蛋",
        normalized_hint: "egg",
        amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
      }]);
      const request = {
        ...baseRequest,
        semantic_candidate: {
          ...baseRequest.semantic_candidate,
          source_text: "早上顺手吃了一个苹果",
        },
      };
      const before = eventCount(root);

      expect(handleCoreRequest(runtime, request)).toEqual({
        action: "record_meal",
        status: "failed",
        committed: false,
        operation_id: request.operation_id,
        error_code: "SEMANTIC_SOURCE_MISMATCH",
      });
      expect(eventCount(root) - before).toBe(0);
    } finally {
      runtime.close();
    }
  });

  it("keeps the legacy source_text meal path compatible", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-20T04:30:01.000Z",
    });
    try {
      sequence += 1;
      const operationId = `legacy-application-${sequence}`;
      const before = eventCount(root);
      const outcome = handleCoreRequest(runtime, {
        action: "record_meal",
        source_text: "我吃了一个苹果。",
        received_at: "2026-08-20T12:30:00+08:00",
        timezone: "Asia/Shanghai",
        operation_id: operationId,
        source_message_id: `message-${operationId}`,
        conversation_id: "conversation-semantic-application",
        prior_context: [],
      });

      expect(outcome).toMatchObject({ action: "record_meal", committed: true });
      expect(eventCount(root) - before).toBe(1);
    } finally {
      runtime.close();
    }
  });

  it("keeps unrelated request extras invalid when a semantic candidate is present", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-20T04:30:01.000Z",
    });
    try {
      const request = {
        ...semanticRequest("早上顺手吃了一个鸡蛋", [{
          raw_name: "鸡蛋",
          normalized_hint: "egg",
          amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
        }]),
        extra: true,
      };
      const before = eventCount(root);

      expect(handleCoreRequest(runtime, request as never)).toMatchObject({
        status: "failed",
        committed: false,
        error_code: "INVALID_REQUEST",
      });
      expect(eventCount(root) - before).toBe(0);
    } finally {
      runtime.close();
    }
  });

  it("rejects a meal candidate on query actions consistently across sync and async entries", async () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-20T04:30:01.000Z",
    });
    try {
      const request = {
        ...semanticRequest("早上顺手吃了一个鸡蛋", [{
          raw_name: "鸡蛋",
          normalized_hint: "egg",
          amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
        }]),
        action: "query_daily_summary" as const,
      };
      const expected = {
        action: "query_daily_summary",
        status: "failed",
        committed: false,
        operation_id: request.operation_id,
        error_code: "SEMANTIC_ACTION_MISMATCH",
      };
      const before = eventCount(root);

      const syncOutcome = handleCoreRequest(runtime, request);
      const asyncOutcome = await handleCoreRequestAsync(runtime, request);

      expect(syncOutcome).toEqual(expected);
      expect(asyncOutcome).toEqual(expected);
      expect(eventCount(root) - before).toBe(0);
    } finally {
      runtime.close();
    }
  });
});
