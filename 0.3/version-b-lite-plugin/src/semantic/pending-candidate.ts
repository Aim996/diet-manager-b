import { dietManagerActions, type DietManagerAction } from "../contracts/actions.js";
import type { SemanticProposalV2 } from "../contracts/semantic-proposal-v2.js";
import { cloneSemanticProposalV2 } from "./candidate.js";
import { parseEvidenceNumberToken } from "./evidence.js";

export const PENDING_CANDIDATE_SCHEMA_VERSION = "diet-manager/pending-candidate/v1" as const;
export const PENDING_CANDIDATE_MAX_ROUNDS = 3 as const;

export type PendingMissingField =
  | "subject"
  | "water.amount"
  | `items.${number}.amount`
  | "profile.height_cm"
  | "profile.weight_kg";

export interface PendingCandidateDraft {
  readonly schema_version: typeof PENDING_CANDIDATE_SCHEMA_VERSION;
  readonly action: DietManagerAction;
  readonly source_text: string;
  readonly proposal: SemanticProposalV2;
  readonly missing_fields: readonly PendingMissingField[];
  readonly round: number;
  readonly created_at: string;
  readonly expires_at: string;
}

export interface CreatePendingCandidateDraftInput {
  readonly action: DietManagerAction;
  readonly source_text: string;
  readonly proposal: SemanticProposalV2;
  readonly missing_fields?: readonly PendingMissingField[];
  readonly created_at: string;
  readonly expires_at: string;
}

export type PendingCandidateMergeResult =
  | Readonly<{ readonly disposition: "completed"; readonly draft: Readonly<PendingCandidateDraft> }>
  | Readonly<{ readonly disposition: "still_missing"; readonly draft: Readonly<PendingCandidateDraft> }>
  | Readonly<{ readonly disposition: "cancelled"; readonly draft: Readonly<PendingCandidateDraft> }>
  | Readonly<{ readonly disposition: "expired"; readonly draft: Readonly<PendingCandidateDraft> }>
  | Readonly<{ readonly disposition: "exhausted"; readonly draft: Readonly<PendingCandidateDraft> }>;

function invalid(reason: string): never {
  throw new TypeError(`PENDING_CANDIDATE_INVALID:${reason}`);
}

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid(field);
  return new Date(value).toISOString();
}

function missingFields(proposal: SemanticProposalV2): readonly PendingMissingField[] {
  if (proposal.kind === "meal") {
    return Object.freeze(proposal.items.flatMap((item, index) =>
      item.amount.kind === "unknown" ? [`items.${index}.amount` as const] : []));
  }
  if (proposal.kind === "water") {
    return proposal.amount.kind === "unknown" ? Object.freeze(["water.amount" as const]) : Object.freeze([]);
  }
  if (proposal.kind === "profile" && proposal.operation === "update") {
    const fields: PendingMissingField[] = [];
    if (proposal.values.height_cm === undefined || proposal.values.height_cm === null) {
      fields.push("profile.height_cm");
    }
    if (proposal.values.weight_kg === undefined || proposal.values.weight_kg === null) {
      fields.push("profile.weight_kg");
    }
    return Object.freeze(fields);
  }
  return Object.freeze([]);
}

function validMissingField(field: unknown, proposal: SemanticProposalV2): field is PendingMissingField {
  if (field === "subject") return proposal.kind === "meal" || proposal.kind === "water";
  if (field === "water.amount") return proposal.kind === "water";
  if (field === "profile.height_cm" || field === "profile.weight_kg") return proposal.kind === "profile";
  const match = /^items\.(0|[1-9][0-9]*)\.amount$/u.exec(String(field));
  return proposal.kind === "meal" && match !== null && Number(match[1]) < proposal.items.length;
}

function buildDraft(
  input: CreatePendingCandidateDraftInput,
  round: number,
): Readonly<PendingCandidateDraft> {
  if (!Number.isSafeInteger(round) || round < 1 || round > PENDING_CANDIDATE_MAX_ROUNDS) invalid("round");
  if (!dietManagerActions.includes(input.action)) invalid("action");
  if (typeof input.source_text !== "string" || input.source_text.length < 1 || input.source_text.length > 4_096) {
    invalid("source_text");
  }
  const proposal = cloneSemanticProposalV2(input.proposal, input.action, input.source_text);
  const createdAt = timestamp(input.created_at, "created_at");
  const expiresAt = timestamp(input.expires_at, "expires_at");
  if (expiresAt <= createdAt) invalid("expires_at");
  const fields = input.missing_fields === undefined ? missingFields(proposal) : [...input.missing_fields];
  if (fields.length > 64 || fields.some((field) => !validMissingField(field, proposal)) ||
      new Set(fields).size !== fields.length) invalid("missing_fields");
  return frozen({
    schema_version: PENDING_CANDIDATE_SCHEMA_VERSION,
    action: input.action,
    source_text: input.source_text,
    proposal,
    missing_fields: Object.freeze(fields),
    round,
    created_at: createdAt,
    expires_at: expiresAt,
  });
}

export function createPendingCandidateDraft(
  input: CreatePendingCandidateDraftInput,
): Readonly<PendingCandidateDraft> {
  return buildDraft(input, 1);
}

export function clonePendingCandidateDraft(value: unknown): Readonly<PendingCandidateDraft> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) invalid("shape");
  const source = value as Record<string, unknown>;
  const keys = [
    "schema_version", "action", "source_text", "proposal", "missing_fields", "round",
    "created_at", "expires_at",
  ];
  if (Object.keys(source).sort().join("\0") !== [...keys].sort().join("\0") ||
      source.schema_version !== PENDING_CANDIDATE_SCHEMA_VERSION ||
      typeof source.action !== "string" || !Array.isArray(source.missing_fields)) invalid("shape");
  return buildDraft({
    action: source.action as DietManagerAction,
    source_text: source.source_text as string,
    proposal: source.proposal as SemanticProposalV2,
    missing_fields: source.missing_fields as PendingMissingField[],
    created_at: source.created_at as string,
    expires_at: source.expires_at as string,
  }, source.round as number);
}

export function minimalClarificationQuestion(draft: Readonly<PendingCandidateDraft>): string {
  const field = draft.missing_fields[0];
  if (field === undefined) return "请确认是否提交这条记录？";
  if (field === "subject") return "请确认：这是你自己吃的吗？";
  if (field === "water.amount") return "一共喝了多少毫升？";
  if (field === "profile.height_cm") return "你的身高是多少厘米？";
  if (field === "profile.weight_kg") return "你的体重是多少公斤？";
  const index = Number(/^items\.(\d+)\.amount$/u.exec(field)?.[1]);
  if (draft.proposal.kind !== "meal" || !Number.isSafeInteger(index) || draft.proposal.items[index] === undefined) {
    return invalid("missing_fields");
  }
  return `${draft.proposal.items[index].raw_name}吃了多少？`;
}

const NUMBER_TOKEN = "(?:[0-9]+(?:\\.[0-9]+)?|[一二两俩三四五六七八九十]+)";
const UNIT_TOKEN = "(?:毫升|ml|mL|厘米|cm|公斤|千克|kg|克|g|升|L|个|只|枚|片|碗|大杯|小杯|杯|瓶|盒|袋)";
const AMOUNT_PATTERN = new RegExp(`(${NUMBER_TOKEN})\\s*(${UNIT_TOKEN})`, "gu");

function normalizedUnit(unit: string): string {
  const aliases: Readonly<Record<string, string>> = Object.freeze({
    毫升: "ml", mL: "ml", 厘米: "cm", 公斤: "kg", 千克: "kg", 克: "g", 升: "l", L: "l",
    大杯: "杯", 小杯: "杯",
    只: "个", 枚: "个",
  });
  return aliases[unit] ?? unit;
}

function amountFromReply(reply: string): Readonly<{
  readonly kind: "exact";
  readonly value: number;
  readonly unit: string;
  readonly evidence_span: string;
}> | null {
  const matches = [...reply.matchAll(AMOUNT_PATTERN)];
  if (matches.length === 0) return null;
  const preferred = [...matches].reverse().find((match) =>
    ["毫升", "ml", "mL", "厘米", "cm", "公斤", "千克", "kg", "克", "g", "升", "L"].includes(match[2]!)) ??
    matches.at(-1)!;
  const value = parseEvidenceNumberToken(preferred[1]!);
  if (value === null) return null;
  return frozen({
    kind: "exact" as const,
    value,
    unit: normalizedUnit(preferred[2]!),
    evidence_span: preferred[0],
  });
}

function selfEvidence(reply: string): Readonly<{
  readonly kind: "self";
  readonly basis: "explicit";
  readonly evidence_span: string;
  readonly explicit_other_spans: readonly [];
}> | null {
  const match = /我自己|本人|(?<![\p{Script=Han}])我(?![\p{Script=Han}])/u.exec(reply);
  return match === null ? null : frozen({
    kind: "self" as const,
    basis: "explicit" as const,
    evidence_span: match[0],
    explicit_other_spans: Object.freeze([]),
  });
}

function cancelledReply(reply: string): boolean {
  return /^(?:算了|取消|不用了|不记了|别记了|不是|没有|没吃|没喝)[。！!]?$/u.test(reply.trim());
}

function amountOnlyReply(reply: string): boolean {
  if (amountFromReply(reply) === null) return false;
  const remainder = reply.replace(AMOUNT_PATTERN, "")
    .replace(/(?:半杯|大约|大概|差不多|总共|一共|左右|约|吧)/gu, "")
    .replace(/[\s，,。！!]/gu, "");
  return remainder.length === 0;
}

function selfOnlyReply(reply: string): boolean {
  return /^(?:是)?(?:我自己|本人)(?:(?:吃|喝)的?)?[。！!]?$/u.test(reply.trim());
}

export function isPendingReplyText(sourceText: string): boolean {
  const value = sourceText.trim();
  return value.length > 0 && value.length <= 64 && (
    cancelledReply(value) || amountOnlyReply(value) || selfOnlyReply(value) ||
    /^(?:还?是?不知道|不清楚|记不清)[。！!]?$/u.test(value)
  );
}

function nextDraft(
  draft: Readonly<PendingCandidateDraft>,
  sourceText: string,
  proposal: SemanticProposalV2,
  fields: readonly PendingMissingField[],
): Readonly<PendingCandidateDraft> {
  return buildDraft({
    action: draft.action,
    source_text: sourceText,
    proposal,
    missing_fields: fields,
    created_at: draft.created_at,
    expires_at: draft.expires_at,
  }, draft.round + 1);
}

export function mergePendingCandidateReply(
  draftValue: Readonly<PendingCandidateDraft>,
  replyText: string,
  nowValue: string,
): PendingCandidateMergeResult {
  const draft = clonePendingCandidateDraft(draftValue);
  const now = timestamp(nowValue, "now");
  if (now >= draft.expires_at) return frozen({ disposition: "expired" as const, draft });
  const reply = replyText.trim();
  if (cancelledReply(reply)) return frozen({ disposition: "cancelled" as const, draft });
  if (draft.round >= PENDING_CANDIDATE_MAX_ROUNDS) {
    return frozen({ disposition: "exhausted" as const, draft });
  }
  if (!isPendingReplyText(reply)) {
    const unchanged = nextDraft(draft, `${draft.source_text}；${reply}`, draft.proposal, draft.missing_fields);
    return frozen({
      disposition: unchanged.round >= PENDING_CANDIDATE_MAX_ROUNDS ? "exhausted" as const : "still_missing" as const,
      draft: unchanged,
    });
  }
  const field = draft.missing_fields[0];
  if (field === undefined) return frozen({ disposition: "completed" as const, draft });
  const combinedSource = `${draft.source_text}；${reply}`;
  let proposal: SemanticProposalV2 = draft.proposal;
  let filled = false;
  if (field === "subject" && (proposal.kind === "meal" || proposal.kind === "water")) {
    const subject = selfEvidence(reply);
    if (subject !== null) {
      proposal = frozen({ ...proposal, subject }) as unknown as SemanticProposalV2;
      filled = true;
    }
  } else if (field === "water.amount" && proposal.kind === "water") {
    const amount = amountFromReply(reply);
    if (amount !== null) {
      proposal = frozen({ ...proposal, amount });
      filled = true;
    }
  } else if ((field === "profile.height_cm" || field === "profile.weight_kg") &&
      proposal.kind === "profile") {
    const amount = amountFromReply(reply);
    const expectedUnit = field === "profile.height_cm" ? "cm" : "kg";
    if (amount !== null && amount.unit === expectedUnit) {
      const key = field === "profile.height_cm" ? "height_cm" : "weight_kg";
      const values = frozen({
        ...proposal.values,
        [key]: frozen({ value: amount.value, evidence_span: amount.evidence_span }),
      });
      proposal = frozen({ ...proposal, values }) as unknown as SemanticProposalV2;
      filled = true;
    }
  } else {
    const match = /^items\.(\d+)\.amount$/u.exec(field);
    const amount = amountFromReply(reply);
    if (match !== null && amount !== null && proposal.kind === "meal") {
      const index = Number(match[1]);
      const items = proposal.items.map((item, itemIndex) =>
        itemIndex === index ? frozen({ ...item, amount }) : item);
      proposal = frozen({ ...proposal, items: Object.freeze(items) }) as unknown as SemanticProposalV2;
      filled = true;
    }
  }
  const remaining = filled ? draft.missing_fields.slice(1) : draft.missing_fields;
  const updated = nextDraft(draft, combinedSource, proposal, remaining);
  if (remaining.length === 0) return frozen({ disposition: "completed" as const, draft: updated });
  return frozen({
    disposition: updated.round >= PENDING_CANDIDATE_MAX_ROUNDS ? "exhausted" as const : "still_missing" as const,
    draft: updated,
  });
}
