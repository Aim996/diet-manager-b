export const SUBJECT_RULE_VERSION = "diet-manager/subject-v1" as const;

export interface ProposedAmountEvidence {
  readonly raw_text: string | null;
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly estimated: boolean | null;
}

export interface ProposedSubjectItem {
  readonly normalized_name: string;
  readonly raw_text: string;
  readonly amount_evidence: Readonly<ProposedAmountEvidence>;
}

export interface SubjectMatchedEvidence {
  readonly rule_id:
    | "subject.explicit-non-self.child"
    | "subject.explicit-self-share.friend"
    | "subject.collective-self.we"
    | "subject.group-amount.two-plates";
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  readonly rule_version: typeof SUBJECT_RULE_VERSION;
}

interface ResolvedSubjectEvidence {
  readonly kind: "self";
  readonly resolution_basis:
    | "omitted_subject_default"
    | "explicit_self_share"
    | "collective_self_participation";
  readonly subject_entity_created: false;
  readonly excluded_non_self_share_count?: 1;
  readonly self_participated?: true;
  readonly matched_span: string | null;
  readonly matched_evidence: SubjectMatchedEvidence | null;
  readonly rule_version: typeof SUBJECT_RULE_VERSION;
}

interface SubjectGroupAmountEvidence {
  readonly quantity: 2;
  readonly unit: "plate";
  readonly assigned_to_self: false;
  readonly matched_span: string;
  readonly matched_evidence: SubjectMatchedEvidence;
  readonly rule_version: typeof SUBJECT_RULE_VERSION;
}

export type SubjectResolution =
  | Readonly<{
      disposition: "ignored";
      action: "record_meal";
      reason_code: "non_self_subject";
      matched_evidence: SubjectMatchedEvidence;
    }>
  | Readonly<{
      disposition: "resolved";
      subject: Readonly<ResolvedSubjectEvidence>;
      items: readonly Readonly<ProposedSubjectItem>[];
      group_amount_evidence?: Readonly<SubjectGroupAmountEvidence>;
    }>;

interface SubjectRule {
  readonly rule_id: SubjectMatchedEvidence["rule_id"];
  readonly pattern: RegExp;
}

// These rules intentionally cover only the frozen PRODUCT-0.1 subject forms.
const EXPLICIT_NON_SELF_CHILD = Object.freeze<SubjectRule>({
  rule_id: "subject.explicit-non-self.child",
  pattern: /孩子(?=\s*(?:吃|喝))/u,
});

const EXPLICIT_SELF_SHARE_FRIEND = Object.freeze<SubjectRule>({
  rule_id: "subject.explicit-self-share.friend",
  pattern: /我\s*和\s*朋友(?=\s*一人\s*一瓶)/u,
});

const COLLECTIVE_SELF = Object.freeze<SubjectRule>({
  rule_id: "subject.collective-self.we",
  pattern: /我们(?=\s*(?:吃|喝))/u,
});

const TWO_PLATES_GROUP_AMOUNT = Object.freeze<SubjectRule>({
  rule_id: "subject.group-amount.two-plates",
  pattern: /两\s*盘/u,
});

function matchEvidence(
  sourceText: string,
  rule: SubjectRule,
): SubjectMatchedEvidence | null {
  const match = rule.pattern.exec(sourceText);
  if (match === null || match.index < 0) return null;
  return Object.freeze({
    rule_id: rule.rule_id,
    raw: match[0],
    start: match.index,
    end: match.index + match[0].length,
    rule_version: SUBJECT_RULE_VERSION,
  });
}

function cloneItem(item: ProposedSubjectItem): Readonly<ProposedSubjectItem> {
  return Object.freeze({
    normalized_name: item.normalized_name,
    raw_text: item.raw_text,
    amount_evidence: Object.freeze({
      raw_text: item.amount_evidence.raw_text,
      quantity: item.amount_evidence.quantity,
      unit: item.amount_evidence.unit,
      estimated: item.amount_evidence.estimated,
    }),
  });
}

interface FrozenItemAmountRule {
  readonly normalized_name: string;
  readonly pattern: RegExp;
  readonly quantity: number;
  readonly unit: string;
}

const OMITTED_SUBJECT_ITEM_AMOUNTS = Object.freeze([
  Object.freeze<FrozenItemAmountRule>({
    normalized_name: "egg",
    pattern: /两\s*个(?=\s*鸡蛋)/u,
    quantity: 2,
    unit: "piece",
  }),
]);

const EXPLICIT_SELF_SHARE_ITEM_AMOUNTS = Object.freeze([
  Object.freeze<FrozenItemAmountRule>({
    normalized_name: "milk",
    pattern: /一\s*瓶(?=\s*牛奶)/u,
    quantity: 1,
    unit: "bottle",
  }),
]);

function resolveFrozenItemAmount(
  sourceText: string,
  item: ProposedSubjectItem,
  rules: readonly FrozenItemAmountRule[],
): Readonly<ProposedSubjectItem> {
  for (const rule of rules) {
    if (rule.normalized_name !== item.normalized_name) continue;
    const match = rule.pattern.exec(sourceText);
    if (match === null) continue;
    return Object.freeze({
      normalized_name: item.normalized_name,
      raw_text: item.raw_text,
      amount_evidence: Object.freeze({
        raw_text: match[0],
        quantity: rule.quantity,
        unit: rule.unit,
        estimated: false,
      }),
    });
  }
  return cloneItem(item);
}

function resolveFrozenItemAmounts(
  sourceText: string,
  proposedItems: readonly ProposedSubjectItem[],
  rules: readonly FrozenItemAmountRule[],
): readonly Readonly<ProposedSubjectItem>[] {
  return Object.freeze(
    proposedItems.map((item) =>
      resolveFrozenItemAmount(sourceText, item, rules)
    ),
  );
}

export function resolveSubject(
  sourceText: string,
  proposedItems: readonly ProposedSubjectItem[],
): SubjectResolution {
  const nonSelf = matchEvidence(sourceText, EXPLICIT_NON_SELF_CHILD);
  if (nonSelf !== null) {
    return Object.freeze({
      disposition: "ignored",
      action: "record_meal",
      reason_code: "non_self_subject",
      matched_evidence: nonSelf,
    });
  }

  const selfShare = matchEvidence(sourceText, EXPLICIT_SELF_SHARE_FRIEND);
  if (selfShare !== null) {
    return Object.freeze({
      disposition: "resolved",
      subject: Object.freeze({
        kind: "self",
        resolution_basis: "explicit_self_share",
        subject_entity_created: false,
        excluded_non_self_share_count: 1,
        matched_span: selfShare.raw,
        matched_evidence: selfShare,
        rule_version: SUBJECT_RULE_VERSION,
      }),
      items: resolveFrozenItemAmounts(
        sourceText,
        proposedItems,
        EXPLICIT_SELF_SHARE_ITEM_AMOUNTS,
      ),
    });
  }

  const collective = matchEvidence(sourceText, COLLECTIVE_SELF);
  if (collective !== null) {
    const groupAmount = matchEvidence(sourceText, TWO_PLATES_GROUP_AMOUNT);
    const items = Object.freeze(proposedItems.map((item) => Object.freeze({
      normalized_name: item.normalized_name,
      raw_text: item.raw_text,
      amount_evidence: Object.freeze({
        raw_text: null,
        quantity: null,
        unit: null,
        estimated: null,
      }),
    })));
    const base = {
      disposition: "resolved" as const,
      subject: Object.freeze({
        kind: "self" as const,
        resolution_basis: "collective_self_participation" as const,
        subject_entity_created: false as const,
        self_participated: true as const,
        matched_span: collective.raw,
        matched_evidence: collective,
        rule_version: SUBJECT_RULE_VERSION,
      }),
      items,
    };
    if (groupAmount === null) return Object.freeze(base);
    return Object.freeze({
      ...base,
      group_amount_evidence: Object.freeze({
        quantity: 2,
        unit: "plate",
        assigned_to_self: false,
        matched_span: groupAmount.raw,
        matched_evidence: groupAmount,
        rule_version: SUBJECT_RULE_VERSION,
      }),
    });
  }

  return Object.freeze({
    disposition: "resolved",
    subject: Object.freeze({
      kind: "self",
      resolution_basis: "omitted_subject_default",
      subject_entity_created: false,
      matched_span: null,
      matched_evidence: null,
      rule_version: SUBJECT_RULE_VERSION,
    }),
    items: resolveFrozenItemAmounts(
      sourceText,
      proposedItems,
      OMITTED_SUBJECT_ITEM_AMOUNTS,
    ),
  });
}
