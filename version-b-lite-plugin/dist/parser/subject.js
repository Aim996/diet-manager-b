export const SUBJECT_RULE_VERSION = "diet-manager/subject-v1";
const FRAME_EXPLICIT_SELF_MODIFIERS = /^(?:(?:刚才|刚刚|今天|昨天|前天|今早|昨晚|今晚|早上|上午|中午|下午|晚上|夜里|早餐|午餐|晚餐|在公司|然后|接着|后来|又|没|没有)\s*)*$/u;
const FRAME_APPROVED_OMITTED_PREFIX = /^(?:早餐|在公司|昨晚\s*\d{1,2}\s*点(?:\s*\d{1,2}\s*分)?|本来不想|后来还是|后来|没(?:有)?)?$/u;
const FRAME_OBJECT_FRONTED_COMPLETION = /^苹果\s*记不清\s*是\s*在\s*公司\s*还是\s*回家后$/u;
function frozenFrameRecord(entries) {
    return Object.freeze(Object.assign(Object.create(null), entries));
}
function frameMatchedEvidence(frame, ruleId, raw, relativeStart) {
    return frozenFrameRecord({
        rule_id: ruleId,
        raw,
        start: frame.subject_prefix_span.start + relativeStart,
        end: frame.subject_prefix_span.start + relativeStart + raw.length,
        rule_version: SUBJECT_RULE_VERSION,
    });
}
function resolvedFrameSubject(resolutionBasis, evidence, extras = {}) {
    return frozenFrameRecord({
        disposition: "resolved",
        subject: frozenFrameRecord({
            kind: "self",
            resolution_basis: resolutionBasis,
            subject_entity_created: false,
            ...extras,
            matched_span: evidence?.raw ?? null,
            matched_evidence: evidence,
            rule_version: SUBJECT_RULE_VERSION,
        }),
    });
}
/** Resolve only positively authorized current-user predicate-frame subjects. */
export function resolvePredicateFrameSubject(frame, inherited = null) {
    if (frame.coordination === "ambiguous") {
        return frozenFrameRecord({ disposition: "unresolved" });
    }
    if (frame.coordination === "inherit_previous") {
        return inherited ?? frozenFrameRecord({ disposition: "unresolved" });
    }
    const prefix = frame.subject_prefix_span.raw.trim();
    if (/^我\s*和\s*朋友\s*一人$/u.test(prefix)) {
        const relativeStart = frame.subject_prefix_span.raw.indexOf("我");
        return resolvedFrameSubject("explicit_self_share", frameMatchedEvidence(frame, "subject.explicit-self-share.friend", prefix, relativeStart), { excluded_non_self_share_count: 1 });
    }
    if (prefix === "我们") {
        const evidence = frameMatchedEvidence(frame, "subject.collective-self.we", "我们", frame.subject_prefix_span.raw.indexOf("我们"));
        return resolvedFrameSubject("collective_self_participation", evidence, { self_participated: true });
    }
    const explicitSelf = /^我/u.exec(prefix);
    if (explicitSelf !== null) {
        const afterSelf = prefix.slice(explicitSelf[0].length).trim();
        if (FRAME_EXPLICIT_SELF_MODIFIERS.test(afterSelf)) {
            const relativeStart = frame.subject_prefix_span.raw.indexOf("我");
            return resolvedFrameSubject("explicit_self", frameMatchedEvidence(frame, "subject.explicit-self.me", "我", relativeStart));
        }
    }
    if (FRAME_APPROVED_OMITTED_PREFIX.test(prefix) ||
        FRAME_OBJECT_FRONTED_COMPLETION.test(prefix)) {
        return resolvedFrameSubject("omitted_subject_default", null);
    }
    if (/^(?:但是|但|可是)\s*没(?:有)?$/u.test(prefix)) {
        return frozenFrameRecord({ disposition: "unresolved" });
    }
    return frozenFrameRecord({ disposition: "non_self" });
}
// These rules intentionally cover only the frozen PRODUCT-0.1 subject forms.
const EXPLICIT_NON_SELF_CHILD = Object.freeze({
    rule_id: "subject.explicit-non-self.child",
    pattern: /^\s*孩子(?=\s*(?:吃|喝))/u,
});
const EXPLICIT_NON_SELF_THIRD_PERSON = Object.freeze({
    rule_id: "subject.explicit-non-self.third-person",
    pattern: /^\s*(?:朋友|同事|家人|他们|他|她)(?=\s*(?:吃|喝))/u,
});
const EXPLICIT_SELF = Object.freeze({
    rule_id: "subject.explicit-self.me",
    pattern: /^\s*我(?=\s*(?:(?:刚才|刚刚|今天|昨天|前天|今早|昨晚|今晚|早上|上午|中午|下午|晚上|夜里|早餐|午餐|晚餐)\s*)*(?:吃|喝))/u,
});
const OMITTED_SUBJECT_GRAMMAR = Object.freeze([
    /^\s*(?:吃|喝)(?:了|过)?/u,
    /^\s*(?:(?:今天|昨天|前天|今早|昨晚|今晚|刚才|刚刚|早上|上午|中午|下午|晚上|夜里|其他时候|早餐|午餐|晚餐|早餐后|午餐后|晚餐后|回家后)\s*)+(?:\d{1,2}\s*点(?:\s*\d{1,2}\s*分)?\s*)?(?:吃|喝)(?:了|过)?/u,
    /^\s*(?:本来不想|后来还是)\s*(?:吃|喝)(?:了|过)?/u,
]);
const EXPLICIT_SELF_SHARE_FRIEND = Object.freeze({
    rule_id: "subject.explicit-self-share.friend",
    pattern: /我\s*和\s*朋友(?=\s*一人\s*一瓶)/u,
});
const EXPLICIT_SELF_SHARE_MILK_LINK = /我\s*和\s*朋友\s*一人\s*一\s*瓶\s*牛奶/u;
const COLLECTIVE_SELF = Object.freeze({
    rule_id: "subject.collective-self.we",
    pattern: /我们(?=\s*(?:吃|喝))/u,
});
const TWO_PLATES_GROUP_AMOUNT = Object.freeze({
    rule_id: "subject.group-amount.two-plates",
    pattern: /两\s*盘(?=\s*炒饭)/u,
});
const COLLECTIVE_TWO_PLATES_FRIED_RICE_LINK = /我们\s*吃(?:了)?\s*两\s*盘\s*炒饭/u;
function splitClauses(sourceText) {
    const clauses = [];
    const delimiter = /[，,。；;！？!?\r\n]+/gu;
    let clauseStart = 0;
    let match;
    while ((match = delimiter.exec(sourceText)) !== null) {
        const raw = sourceText.slice(clauseStart, match.index);
        if (raw.trim().length > 0)
            clauses.push({ raw, start: clauseStart });
        clauseStart = match.index + match[0].length;
    }
    const raw = sourceText.slice(clauseStart);
    if (raw.trim().length > 0)
        clauses.push({ raw, start: clauseStart });
    return Object.freeze(clauses.map((clause) => Object.freeze(clause)));
}
function clausesForItems(clauses, proposedItems) {
    if (proposedItems.length === 0)
        return clauses;
    const relevant = clauses.filter((clause) => proposedItems.some((item) => item.raw_text.length > 0 && clause.raw.includes(item.raw_text)));
    return relevant.length === 0 ? clauses : Object.freeze(relevant);
}
function matchEvidence(clause, rule) {
    const match = rule.pattern.exec(clause.raw);
    if (match === null || match.index < 0)
        return null;
    return Object.freeze({
        rule_id: rule.rule_id,
        raw: match[0],
        start: clause.start + match.index,
        end: clause.start + match.index + match[0].length,
        rule_version: SUBJECT_RULE_VERSION,
    });
}
function firstEvidence(clauses, rule) {
    for (const clause of clauses) {
        const evidence = matchEvidence(clause, rule);
        if (evidence !== null)
            return evidence;
    }
    return null;
}
function firstClauseEvidence(clauses, rule) {
    for (const clause of clauses) {
        const evidence = matchEvidence(clause, rule);
        if (evidence !== null)
            return { clause, evidence };
    }
    return null;
}
function isOmittedSubjectClause(clause) {
    return OMITTED_SUBJECT_GRAMMAR.some((pattern) => pattern.test(clause.raw));
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function isObjectFrontedCompletedClause(clause, proposedItems) {
    return proposedItems.some((item) => {
        if (item.raw_text.length === 0)
            return false;
        const itemPattern = escapeRegExp(item.raw_text);
        const pattern = new RegExp(`^\\s*${itemPattern}\\s*记不清\\s*是\\s*在\\s*公司\\s*还是\\s*回家后\\s*(?:吃|喝)的\\s*$`, "u");
        return pattern.test(clause.raw);
    });
}
function unknownClauseEvidence(clause) {
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
function unknownSubjectEvidence(clauses) {
    const pattern = /^[^\p{Script=Han}A-Za-z]*([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9·]{0,15}?)(?=\s*(?:吃|喝))/u;
    for (const clause of clauses) {
        const match = pattern.exec(clause.raw);
        const raw = match?.[1];
        if (match === null || raw === undefined)
            continue;
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
function cloneItem(item) {
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
const OMITTED_SUBJECT_ITEM_AMOUNTS = Object.freeze([
    Object.freeze({
        normalized_name: "egg",
        pattern: /两\s*个(?=\s*鸡蛋)/u,
        quantity: 2,
        unit: "piece",
    }),
]);
const EXPLICIT_SELF_SHARE_ITEM_AMOUNTS = Object.freeze([
    Object.freeze({
        normalized_name: "milk",
        pattern: /一\s*瓶(?=\s*牛奶)/u,
        quantity: 1,
        unit: "bottle",
    }),
]);
function resolveFrozenItemAmount(sourceText, item, rules) {
    for (const rule of rules) {
        if (rule.normalized_name !== item.normalized_name)
            continue;
        const match = rule.pattern.exec(sourceText);
        if (match === null)
            continue;
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
function resolveFrozenItemAmounts(clauses, proposedItems, rules) {
    return Object.freeze(proposedItems.map((item) => {
        const clause = clauses.find((candidate) => item.raw_text.length > 0 && candidate.raw.includes(item.raw_text));
        return clause === undefined
            ? cloneItem(item)
            : resolveFrozenItemAmount(clause.raw, item, rules);
    }));
}
function hasFrozenItemAmount(clause, item, rules) {
    if (item.raw_text.length === 0 || !clause.raw.includes(item.raw_text)) {
        return false;
    }
    return rules.some((rule) => rule.normalized_name === item.normalized_name &&
        rule.pattern.test(clause.raw));
}
function selfShareClause(clauses, proposedItems) {
    for (const clause of clauses) {
        const evidence = matchEvidence(clause, EXPLICIT_SELF_SHARE_FRIEND);
        if (evidence !== null &&
            EXPLICIT_SELF_SHARE_MILK_LINK.test(clause.raw) &&
            proposedItems.some((item) => hasFrozenItemAmount(clause, item, EXPLICIT_SELF_SHARE_ITEM_AMOUNTS))) {
            return { clause, evidence };
        }
    }
    return null;
}
export function resolveSubject(sourceText, proposedItems) {
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
            items: resolveFrozenItemAmounts([selfShare.clause], proposedItems, EXPLICIT_SELF_SHARE_ITEM_AMOUNTS),
        });
    }
    const collective = firstClauseEvidence(relevantClauses, COLLECTIVE_SELF);
    if (collective !== null) {
        const groupAmount = COLLECTIVE_TWO_PLATES_FRIED_RICE_LINK.test(collective.clause.raw)
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
            disposition: "resolved",
            subject: Object.freeze({
                kind: "self",
                resolution_basis: "collective_self_participation",
                subject_entity_created: false,
                self_participated: true,
                matched_span: collective.evidence.raw,
                matched_evidence: collective.evidence,
                rule_version: SUBJECT_RULE_VERSION,
            }),
            items,
        };
        if (groupAmount === null)
            return Object.freeze(base);
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
            items: resolveFrozenItemAmounts([explicitSelf.clause], proposedItems, OMITTED_SUBJECT_ITEM_AMOUNTS),
        });
    }
    const omittedSubjectClause = relevantClauses.find(isOmittedSubjectClause);
    const objectFrontedClause = relevantClauses.find((clause) => isObjectFrontedCompletedClause(clause, proposedItems));
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
            items: resolveFrozenItemAmounts([positiveOmittedClause], proposedItems, OMITTED_SUBJECT_ITEM_AMOUNTS),
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
