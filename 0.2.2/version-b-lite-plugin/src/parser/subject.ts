import {
  parseIngestionPredicateFrames,
  type IngestionPredicateFrame,
} from "./predicate-frame.js";

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
    | "subject.explicit-non-self.third-person"
    | "subject.explicit-non-self.unknown-subject"
    | "subject.explicit-self.me"
    | "subject.explicit-self-share.friend"
    | "subject.collective-self.we"
    | "subject.group-amount.two-plates";
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  readonly rule_version: typeof SUBJECT_RULE_VERSION;
}

export interface ResolvedSubjectEvidence {
  readonly kind: "self";
  readonly resolution_basis:
    | "omitted_subject_default"
    | "explicit_self"
    | "explicit_self_share"
    | "collective_self_participation";
  readonly subject_entity_created: false;
  readonly excluded_non_self_share_count?: 1;
  readonly self_participated?: true;
  readonly matched_span: string | null;
  readonly matched_evidence: SubjectMatchedEvidence | null;
  readonly rule_version: typeof SUBJECT_RULE_VERSION;
}

export type PredicateFrameSubjectResolution =
  | Readonly<{
      disposition: "resolved";
      subject: Readonly<ResolvedSubjectEvidence>;
    }>
  | Readonly<{
      disposition: "non_self";
    }>
  | Readonly<{
      disposition: "unresolved";
    }>;

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

const FRAME_APPROVED_OMITTED_PREFIX = /^(?:早餐|午饭|晚饭|刚才|刚刚|刚|这会儿|在公司|昨晚\s*\d{1,2}\s*点(?:\s*\d{1,2}\s*分)?|本来不想|后来还是|后来|没(?:有)?)?$/u;
const FRAME_NATURAL_OMITTED_PREFIX = /^(?:顺手|随便|就|刚下班路上|下班路上)$/u;
const FRAME_OBJECT_FRONTED_COMPLETION = /^苹果\s*记不清\s*是\s*在\s*公司\s*还是\s*回家后$/u;
const FRAME_NATURAL_SELF_SUFFIX = /我(?:\s*(?:自己|本人))?(?:(?:刚才|刚刚|刚|这会儿|今天|昨天|前天|今早|昨晚|今晚|早上|上午|中午|下午|晚上|夜里|早餐|午餐|晚餐|午饭|晚饭|在公司|然后|接着|后来|又|随便|顺手|就|才|已经|没|没有)\s*)*$/u;
const EXPLICIT_OTHER_TERM = /我(?:妈妈|爸爸|对象|老公|老婆|孩子|儿子|女儿|妈|爸)|孩子|室友|朋友|同事|家人|他们|(?<!其)他(?!们)|她|妈妈|爸爸|小[\p{Script=Han}]{1,2}|老[\p{Script=Han}]{1,2}|[\p{Script=Han}]{1,4}(?:老师|阿姨|叔叔|同学)/gu;

function explicitOtherInSubjectPrefix(prefix: string): string | null {
  if (/^我\s*和\s*朋友\s*一人$/u.test(prefix.trim())) return null;
  const matches = [...prefix.matchAll(EXPLICIT_OTHER_TERM)];
  const matchedOther = matches.at(-1);
  if (matchedOther === undefined) return null;
  const explicitSelf = FRAME_NATURAL_SELF_SUFFIX.exec(prefix);
  if (explicitSelf !== null && explicitSelf.index > matchedOther.index) return null;
  return matchedOther[0];
}

export function detectExplicitOtherSubject(sourceText: string): string | null {
  const frames = parseIngestionPredicateFrames(sourceText);
  for (const frame of frames) {
    const matched = explicitOtherInSubjectPrefix(frame.subject_prefix_span.raw);
    if (matched !== null) return matched;
  }
  if (frames.length > 0) return null;

  let sawPredicate = false;
  for (const predicate of sourceText.matchAll(/[吃喝啃扒]/gu)) {
    sawPredicate = true;
    const before = sourceText.slice(0, predicate.index);
    const clauseStart = Math.max(
      before.lastIndexOf("，"), before.lastIndexOf(","),
      before.lastIndexOf("。"), before.lastIndexOf("；"),
      before.lastIndexOf(";"), before.lastIndexOf("！"),
      before.lastIndexOf("!"), before.lastIndexOf("？"),
      before.lastIndexOf("?"), before.lastIndexOf("\n"),
    ) + 1;
    const matched = explicitOtherInSubjectPrefix(
      sourceText.slice(clauseStart, predicate.index),
    );
    if (matched !== null) return matched;
  }
  return sawPredicate ? null : explicitOtherInSubjectPrefix(sourceText);
}

function frozenFrameRecord<T extends object>(entries: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), entries)) as Readonly<T>;
}

function frameMatchedEvidence(
  frame: IngestionPredicateFrame,
  ruleId: SubjectMatchedEvidence["rule_id"],
  raw: string,
  relativeStart: number,
): SubjectMatchedEvidence {
  return frozenFrameRecord({
    rule_id: ruleId,
    raw,
    start: frame.subject_prefix_span.start + relativeStart,
    end: frame.subject_prefix_span.start + relativeStart + raw.length,
    rule_version: SUBJECT_RULE_VERSION,
  });
}

function resolvedFrameSubject(
  resolutionBasis: ResolvedSubjectEvidence["resolution_basis"],
  evidence: SubjectMatchedEvidence | null,
  extras: Partial<Pick<
    ResolvedSubjectEvidence,
    "excluded_non_self_share_count" | "self_participated"
  >> = {},
): PredicateFrameSubjectResolution {
  return frozenFrameRecord({
    disposition: "resolved" as const,
    subject: frozenFrameRecord({
      kind: "self" as const,
      resolution_basis: resolutionBasis,
      subject_entity_created: false as const,
      ...extras,
      matched_span: evidence?.raw ?? null,
      matched_evidence: evidence,
      rule_version: SUBJECT_RULE_VERSION,
    }),
  });
}

/** Resolve only positively authorized current-user predicate-frame subjects. */
export function resolvePredicateFrameSubject(
  frame: Readonly<IngestionPredicateFrame>,
  inherited: PredicateFrameSubjectResolution | null = null,
): PredicateFrameSubjectResolution {
  if (frame.coordination === "ambiguous") {
    return frozenFrameRecord({ disposition: "unresolved" as const });
  }
  if (frame.coordination === "inherit_previous") {
    return inherited ?? frozenFrameRecord({ disposition: "unresolved" as const });
  }

  const prefix = frame.subject_prefix_span.raw.trim();
  if (/^我\s*和\s*朋友\s*一人$/u.test(prefix)) {
    const relativeStart = frame.subject_prefix_span.raw.indexOf("我");
    return resolvedFrameSubject(
      "explicit_self_share",
      frameMatchedEvidence(
        frame,
        "subject.explicit-self-share.friend",
        prefix,
        relativeStart,
      ),
      { excluded_non_self_share_count: 1 },
    );
  }
  if (prefix === "我们") {
    const evidence = frameMatchedEvidence(
      frame,
      "subject.collective-self.we",
      "我们",
      frame.subject_prefix_span.raw.indexOf("我们"),
    );
    return resolvedFrameSubject(
      "collective_self_participation",
      evidence,
      { self_participated: true },
    );
  }

  const explicitSelf = FRAME_NATURAL_SELF_SUFFIX.exec(prefix);
  if (explicitSelf !== null) {
    const relativeStart = frame.subject_prefix_span.raw.lastIndexOf("我");
    return resolvedFrameSubject(
      "explicit_self",
      frameMatchedEvidence(
        frame,
        "subject.explicit-self.me",
        "我",
        relativeStart,
      ),
    );
  }

  if (
    FRAME_APPROVED_OMITTED_PREFIX.test(prefix) ||
    FRAME_NATURAL_OMITTED_PREFIX.test(prefix) ||
    FRAME_OBJECT_FRONTED_COMPLETION.test(prefix)
  ) {
    return resolvedFrameSubject("omitted_subject_default", null);
  }

  if (/^(?:但是|但|可是)\s*没(?:有)?$/u.test(prefix)) {
    return frozenFrameRecord({ disposition: "unresolved" as const });
  }

  if (detectExplicitOtherSubject(prefix) !== null) {
    return frozenFrameRecord({ disposition: "non_self" as const });
  }

  return frozenFrameRecord({ disposition: "non_self" as const });
}

// These rules intentionally cover only the frozen PRODUCT-0.1 subject forms.
const EXPLICIT_NON_SELF_CHILD = Object.freeze<SubjectRule>({
  rule_id: "subject.explicit-non-self.child",
  pattern: /^\s*孩子(?=\s*(?:吃|喝))/u,
});

const EXPLICIT_NON_SELF_THIRD_PERSON = Object.freeze<SubjectRule>({
  rule_id: "subject.explicit-non-self.third-person",
  pattern: /^\s*(?:朋友|同事|家人|他们|他|她)(?=\s*(?:吃|喝))/u,
});

const EXPLICIT_SELF = Object.freeze<SubjectRule>({
  rule_id: "subject.explicit-self.me",
  pattern: /^\s*(?:是\s*)?我(?:\s*(?:自己|本人))?(?=\s*(?:(?:刚才|刚刚|刚|这会儿|今天|昨天|前天|今早|昨晚|今晚|早上|上午|中午|下午|晚上|夜里|早餐|午餐|晚餐|午饭|晚饭)\s*)*(?:吃|喝))/u,
});

const OMITTED_SUBJECT_GRAMMAR = Object.freeze([
  /^\s*(?:吃|喝)(?:了|过)?/u,
  /^\s*(?:(?:今天|昨天|前天|今早|昨晚|今晚|刚才|刚刚|刚|这会儿|早上|上午|中午|下午|晚上|夜里|其他时候|早餐|午餐|晚餐|午饭|晚饭|早餐后|午餐后|晚餐后|回家后)\s*)+(?:\d{1,2}\s*点(?:\s*\d{1,2}\s*分)?\s*)?(?:吃|喝)(?:了|过)?/u,
  /^\s*(?:本来不想|后来还是)\s*(?:吃|喝)(?:了|过)?/u,
]);

const EXPLICIT_SELF_SHARE_FRIEND = Object.freeze<SubjectRule>({
  rule_id: "subject.explicit-self-share.friend",
  pattern: /我\s*和\s*朋友(?=\s*一人\s*一瓶)/u,
});

const EXPLICIT_SELF_SHARE_MILK_LINK = /我\s*和\s*朋友\s*一人\s*一\s*瓶\s*牛奶/u;

const COLLECTIVE_SELF = Object.freeze<SubjectRule>({
  rule_id: "subject.collective-self.we",
  pattern: /我们(?=\s*(?:吃|喝))/u,
});

const TWO_PLATES_GROUP_AMOUNT = Object.freeze<SubjectRule>({
  rule_id: "subject.group-amount.two-plates",
  pattern: /两\s*盘(?=\s*炒饭)/u,
});

const COLLECTIVE_TWO_PLATES_FRIED_RICE_LINK = /我们\s*吃(?:了)?\s*两\s*盘\s*炒饭/u;

interface SubjectClause {
  readonly raw: string;
  readonly start: number;
}

function splitClauses(sourceText: string): readonly SubjectClause[] {
  const clauses: SubjectClause[] = [];
  const delimiter = /[，,。；;！？!?\r\n]+/gu;
  let clauseStart = 0;
  let match: RegExpExecArray | null;
  while ((match = delimiter.exec(sourceText)) !== null) {
    const raw = sourceText.slice(clauseStart, match.index);
    if (raw.trim().length > 0) clauses.push({ raw, start: clauseStart });
    clauseStart = match.index + match[0].length;
  }
  const raw = sourceText.slice(clauseStart);
  if (raw.trim().length > 0) clauses.push({ raw, start: clauseStart });
  return Object.freeze(clauses.map((clause) => Object.freeze(clause)));
}

function clausesForItems(
  clauses: readonly SubjectClause[],
  proposedItems: readonly ProposedSubjectItem[],
): readonly SubjectClause[] {
  if (proposedItems.length === 0) return clauses;
  const relevant = clauses.filter((clause) =>
    proposedItems.some((item) =>
      item.raw_text.length > 0 && clause.raw.includes(item.raw_text)
    )
  );
  return relevant.length === 0 ? clauses : Object.freeze(relevant);
}

function matchEvidence(
  clause: SubjectClause,
  rule: SubjectRule,
): SubjectMatchedEvidence | null {
  const match = rule.pattern.exec(clause.raw);
  if (match === null || match.index < 0) return null;
  return Object.freeze({
    rule_id: rule.rule_id,
    raw: match[0],
    start: clause.start + match.index,
    end: clause.start + match.index + match[0].length,
    rule_version: SUBJECT_RULE_VERSION,
  });
}

function firstEvidence(
  clauses: readonly SubjectClause[],
  rule: SubjectRule,
): SubjectMatchedEvidence | null {
  for (const clause of clauses) {
    const evidence = matchEvidence(clause, rule);
    if (evidence !== null) return evidence;
  }
  return null;
}

interface ClauseEvidence {
  readonly clause: SubjectClause;
  readonly evidence: SubjectMatchedEvidence;
}

function firstClauseEvidence(
  clauses: readonly SubjectClause[],
  rule: SubjectRule,
): ClauseEvidence | null {
  for (const clause of clauses) {
    const evidence = matchEvidence(clause, rule);
    if (evidence !== null) return { clause, evidence };
  }
  return null;
}

function isOmittedSubjectClause(clause: SubjectClause): boolean {
  return OMITTED_SUBJECT_GRAMMAR.some((pattern) => pattern.test(clause.raw));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isObjectFrontedCompletedClause(
  clause: SubjectClause,
  proposedItems: readonly ProposedSubjectItem[],
): boolean {
  return proposedItems.some((item) => {
    if (item.raw_text.length === 0) return false;
    const itemPattern = escapeRegExp(item.raw_text);
    const pattern = new RegExp(
      `^\\s*${itemPattern}\\s*记不清\\s*是\\s*在\\s*公司\\s*还是\\s*回家后\\s*(?:吃|喝)的\\s*$`,
      "u",
    );
    return pattern.test(clause.raw);
  });
}

function unknownClauseEvidence(clause: SubjectClause): SubjectMatchedEvidence {
  const leadingWhitespace = /^\s*/u.exec(clause.raw)?.[0].length ?? 0;
  const raw = clause.raw.slice(leadingWhitespace);
  return Object.freeze({
    rule_id: "subject.explicit-non-self.unknown-subject",
    raw,
    start: clause.start + leadingWhitespace,
    end: clause.start + leadingWhitespace + raw.length,
    rule_version: SUBJECT_RULE_VERSION,
  });
}

function unknownSubjectEvidence(
  clauses: readonly SubjectClause[],
): SubjectMatchedEvidence | null {
  const pattern = /^[^\p{Script=Han}A-Za-z]*([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9·]{0,15}?)(?=\s*(?:吃|喝))/u;
  for (const clause of clauses) {
    const match = pattern.exec(clause.raw);
    const raw = match?.[1];
    if (match === null || raw === undefined) continue;
    const relativeStart = match[0].lastIndexOf(raw);
    return Object.freeze({
      rule_id: "subject.explicit-non-self.unknown-subject",
      raw,
      start: clause.start + relativeStart,
      end: clause.start + relativeStart + raw.length,
      rule_version: SUBJECT_RULE_VERSION,
    });
  }
  return null;
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
  clauses: readonly SubjectClause[],
  proposedItems: readonly ProposedSubjectItem[],
  rules: readonly FrozenItemAmountRule[],
): readonly Readonly<ProposedSubjectItem>[] {
  return Object.freeze(
    proposedItems.map((item) => {
      const clause = clauses.find((candidate) =>
        item.raw_text.length > 0 && candidate.raw.includes(item.raw_text)
      );
      return clause === undefined
        ? cloneItem(item)
        : resolveFrozenItemAmount(clause.raw, item, rules);
    }),
  );
}

function hasFrozenItemAmount(
  clause: SubjectClause,
  item: ProposedSubjectItem,
  rules: readonly FrozenItemAmountRule[],
): boolean {
  if (item.raw_text.length === 0 || !clause.raw.includes(item.raw_text)) {
    return false;
  }
  return rules.some((rule) =>
    rule.normalized_name === item.normalized_name &&
    rule.pattern.test(clause.raw)
  );
}

function selfShareClause(
  clauses: readonly SubjectClause[],
  proposedItems: readonly ProposedSubjectItem[],
): ClauseEvidence | null {
  for (const clause of clauses) {
    const evidence = matchEvidence(clause, EXPLICIT_SELF_SHARE_FRIEND);
    if (
      evidence !== null &&
      EXPLICIT_SELF_SHARE_MILK_LINK.test(clause.raw) &&
      proposedItems.some((item) =>
        hasFrozenItemAmount(
          clause,
          item,
          EXPLICIT_SELF_SHARE_ITEM_AMOUNTS,
        )
      )
    ) {
      return { clause, evidence };
    }
  }
  return null;
}

export function resolveSubject(
  sourceText: string,
  proposedItems: readonly ProposedSubjectItem[],
): SubjectResolution {
  const clauses = splitClauses(sourceText);
  const relevantClauses = clausesForItems(clauses, proposedItems);
  const nonSelf = firstEvidence(relevantClauses, EXPLICIT_NON_SELF_CHILD) ??
    firstEvidence(relevantClauses, EXPLICIT_NON_SELF_THIRD_PERSON);
  if (nonSelf !== null) {
    return Object.freeze({
      disposition: "ignored",
      action: "record_meal",
      reason_code: "non_self_subject",
      matched_evidence: nonSelf,
    });
  }

  const selfShare = selfShareClause(relevantClauses, proposedItems);
  if (selfShare !== null) {
    return Object.freeze({
      disposition: "resolved",
      subject: Object.freeze({
        kind: "self",
        resolution_basis: "explicit_self_share",
        subject_entity_created: false,
        excluded_non_self_share_count: 1,
        matched_span: selfShare.evidence.raw,
        matched_evidence: selfShare.evidence,
        rule_version: SUBJECT_RULE_VERSION,
      }),
      items: resolveFrozenItemAmounts(
        [selfShare.clause],
        proposedItems,
        EXPLICIT_SELF_SHARE_ITEM_AMOUNTS,
      ),
    });
  }

  const collective = firstClauseEvidence(relevantClauses, COLLECTIVE_SELF);
  if (collective !== null) {
    const groupAmount = COLLECTIVE_TWO_PLATES_FRIED_RICE_LINK.test(
      collective.clause.raw,
    )
      ? matchEvidence(collective.clause, TWO_PLATES_GROUP_AMOUNT)
      : null;
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
        matched_span: collective.evidence.raw,
        matched_evidence: collective.evidence,
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

  const explicitSelf = firstClauseEvidence(relevantClauses, EXPLICIT_SELF);
  if (explicitSelf !== null) {
    return Object.freeze({
      disposition: "resolved",
      subject: Object.freeze({
        kind: "self",
        resolution_basis: "explicit_self",
        subject_entity_created: false,
        matched_span: explicitSelf.evidence.raw,
        matched_evidence: explicitSelf.evidence,
        rule_version: SUBJECT_RULE_VERSION,
      }),
      items: resolveFrozenItemAmounts(
        [explicitSelf.clause],
        proposedItems,
        OMITTED_SUBJECT_ITEM_AMOUNTS,
      ),
    });
  }

  const omittedSubjectClause = relevantClauses.find(isOmittedSubjectClause);
  const objectFrontedClause = relevantClauses.find((clause) =>
    isObjectFrontedCompletedClause(clause, proposedItems)
  );
  const positiveOmittedClause = omittedSubjectClause ?? objectFrontedClause;
  if (positiveOmittedClause !== undefined) {
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
        [positiveOmittedClause],
        proposedItems,
        OMITTED_SUBJECT_ITEM_AMOUNTS,
      ),
    });
  }

  const unknownSubject = unknownSubjectEvidence(relevantClauses) ??
    (relevantClauses[0] === undefined
      ? null
      : unknownClauseEvidence(relevantClauses[0]));
  if (unknownSubject !== null) {
    return Object.freeze({
      disposition: "ignored",
      action: "record_meal",
      reason_code: "non_self_subject",
      matched_evidence: unknownSubject,
    });
  }

  return Object.freeze({
    disposition: "ignored",
    action: "record_meal",
    reason_code: "non_self_subject",
    matched_evidence: Object.freeze({
      rule_id: "subject.explicit-non-self.unknown-subject",
      raw: sourceText,
      start: 0,
      end: sourceText.length,
      rule_version: SUBJECT_RULE_VERSION,
    }),
  });
}
