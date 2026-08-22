import { describe, expect, it } from "vitest";

import {
  createPendingCandidateDraft,
  isPendingReplyText,
  mergePendingCandidateReply,
  minimalClarificationQuestion,
} from "../../src/semantic/pending-candidate.js";

const self = Object.freeze({
  kind: "self" as const,
  basis: "private_agent_default" as const,
  evidence_span: null,
  explicit_other_spans: Object.freeze([]),
});

describe("bounded pending semantic candidate", () => {
  it("keeps known meal slots and asks only for the one missing amount", () => {
    const draft = createPendingCandidateDraft({
      action: "record_meal",
      source_text: "早上吃了鸡蛋",
      proposal: {
        kind: "meal",
        subject: self,
        occurrence: "completed",
        meal_slot: "breakfast",
        items: [{ raw_name: "鸡蛋", normalized_hint: "egg", amount: { kind: "unknown" } }],
        occurred_at: { kind: "source_text", evidence_span: "早上" },
      },
      created_at: "2026-08-21T00:00:00.000Z",
      expires_at: "2026-08-21T00:05:00.000Z",
    });
    expect(draft).toMatchObject({
      missing_fields: ["items.0.amount"],
      round: 1,
      proposal: { meal_slot: "breakfast", items: [{ raw_name: "鸡蛋" }] },
    });
    expect(minimalClarificationQuestion(draft)).toBe("鸡蛋吃了多少？");
    expect(minimalClarificationQuestion(draft).match(/？/gu)).toHaveLength(1);

    const merged = mergePendingCandidateReply(
      draft,
      "两个",
      "2026-08-21T00:01:00.000Z",
    );
    expect(merged).toMatchObject({
      disposition: "completed",
      draft: {
        missing_fields: [],
        round: 2,
        proposal: {
          meal_slot: "breakfast",
          items: [{
            raw_name: "鸡蛋",
            amount: { kind: "exact", value: 2, unit: "个", evidence_span: "两个" },
          }],
        },
      },
    });
  });

  it("fills only subject when the stored candidate says subject is missing", () => {
    const draft = createPendingCandidateDraft({
      action: "record_meal",
      source_text: "有人吃了一个鸡蛋",
      proposal: {
        kind: "meal",
        subject: self,
        occurrence: "completed",
        meal_slot: "unknown",
        items: [{ raw_name: "鸡蛋", normalized_hint: "egg", amount: {
          kind: "exact", value: 1, unit: "个", evidence_span: "一个鸡蛋",
        } }],
        occurred_at: { kind: "unspecified", evidence_span: null },
      },
      missing_fields: ["subject"],
      created_at: "2026-08-21T00:00:00.000Z",
      expires_at: "2026-08-21T00:05:00.000Z",
    });
    expect(minimalClarificationQuestion(draft)).toBe("请确认：这是你自己吃的吗？");
    const merged = mergePendingCandidateReply(
      draft,
      "是我自己吃的",
      "2026-08-21T00:01:00.000Z",
    );
    expect(merged).toMatchObject({
      disposition: "completed",
      draft: {
        proposal: {
          subject: { basis: "explicit", evidence_span: "我自己" },
          items: [{ amount: { value: 1, unit: "个" } }],
        },
      },
    });
  });

  it("uses the precise capacity from a colloquial cup answer and preserves water context", () => {
    const draft = createPendingCandidateDraft({
      action: "record_water",
      source_text: "运动后喝了水",
      proposal: {
        kind: "water",
        subject: self,
        amount: { kind: "unknown" },
        occurred_at: { kind: "unspecified", evidence_span: null },
      },
      created_at: "2026-08-21T00:00:00.000Z",
      expires_at: "2026-08-21T00:05:00.000Z",
    });
    expect(minimalClarificationQuestion(draft)).toBe("一共喝了多少毫升？");
    expect(mergePendingCandidateReply(
      draft,
      "一杯大约 300 毫升",
      "2026-08-21T00:01:00.000Z",
    )).toMatchObject({
      disposition: "completed",
      draft: {
        proposal: { kind: "water", amount: { value: 300, unit: "ml", evidence_span: "300 毫升" } },
      },
    });
  });

  it("expires, cancels, and bounds an unrecognized reply at three rounds", () => {
    const draft = createPendingCandidateDraft({
      action: "record_meal",
      source_text: "吃了鸡蛋",
      proposal: {
        kind: "meal", subject: self, occurrence: "completed", meal_slot: "unknown",
        items: [{ raw_name: "鸡蛋", normalized_hint: "egg", amount: { kind: "unknown" } }],
        occurred_at: { kind: "unspecified", evidence_span: null },
      },
      created_at: "2026-08-21T00:00:00.000Z",
      expires_at: "2026-08-21T00:05:00.000Z",
    });
    expect(mergePendingCandidateReply(draft, "算了", "2026-08-21T00:01:00.000Z"))
      .toMatchObject({ disposition: "cancelled" });
    expect(mergePendingCandidateReply(draft, "两个", "2026-08-21T00:06:00.000Z"))
      .toMatchObject({ disposition: "expired" });

    const second = mergePendingCandidateReply(draft, "不知道", "2026-08-21T00:01:00.000Z");
    expect(second).toMatchObject({ disposition: "still_missing", draft: { round: 2 } });
    if (second.disposition !== "still_missing") throw new Error("expected still_missing");
    expect(mergePendingCandidateReply(second.draft, "还是不知道", "2026-08-21T00:02:00.000Z"))
      .toMatchObject({ disposition: "exhausted", draft: { round: 3 } });
  });

  it("recognizes only bounded reply-shaped text", () => {
    expect(isPendingReplyText("两个")).toBe(true);
    expect(isPendingReplyText("是我自己吃的")).toBe(true);
    expect(isPendingReplyText("算了")).toBe(true);
    expect(isPendingReplyText("我吃了一个鸡蛋")).toBe(false);
    expect(isPendingReplyText("刚才喝了300毫升水")).toBe(false);
    expect(isPendingReplyText("请查询今天的饮食记录并总结所有项目")).toBe(false);
  });
});
