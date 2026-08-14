import type {
  CoreContextEntry,
  CoreContextEvidence,
  CoreParseInput,
  OccurredTimeEvidence,
  OffsetIsoTimestamp,
} from "./types.js";

export const CONTEXT_RULE_VERSION = "diet-manager/context-v1" as const;

export interface MealContextResolutionInput {
  readonly source_text: CoreParseInput["source_text"];
  readonly received_at: CoreParseInput["received_at"];
  readonly conversation_id: CoreParseInput["conversation_id"];
  readonly source_message_id: CoreParseInput["source_message_id"];
  readonly prior_context: CoreParseInput["prior_context"];
  readonly occurred_time?: OccurredTimeEvidence;
}

const OFFSET_ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u;
const EXPLICIT_CORRECTION_PATTERNS = Object.freeze([
  /^\s*(?:更正|纠正)(?:一下)?(?=$|[\s，。；：！？、,:;.!?])/u,
  /^\s*不对(?=$|[\s，。；：！？、,:;.!?])/u,
  /^\s*(?:改成|改为)/u,
]);
const INVENTORY_DISAMBIGUATION_PATTERN = /(?:公司[^。！？!?]*(?:还是|或者|或)[^。！？!?]*回家|回家[^。！？!?]*(?:还是|或者|或)[^。！？!?]*公司)/u;
const EXPLICIT_COMPANY_PATTERN = /(?:^|[，,。；;！？!?\s])在公司(?=吃|喝)/u;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

function offsetMinutes(zone: string): number | null {
  if (zone === "Z") return 0;
  const hour = Number(zone.slice(1, 3));
  const minute = Number(zone.slice(4, 6));
  if (hour > 14 || minute > 59 || (hour === 14 && minute !== 0)) return null;
  return (zone[0] === "+" ? 1 : -1) * (hour * 60 + minute);
}

function timestampEpoch(value: string): number | null {
  const match = OFFSET_ISO_PATTERN.exec(value);
  if (match === null) return null;
  const parts = match.slice(1, 7).map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const millisecond = Number((match[7] ?? "0").padEnd(3, "0"));
  const offset = offsetMinutes(match[8]);
  if (
    year < 1_000 || month < 1 || month > 12 || day < 1 || day > 31 ||
    hour > 23 || minute > 59 || second > 59 || offset === null
  ) return null;
  const localEpoch = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const check = new Date(localEpoch);
  if (
    check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day || check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second ||
    check.getUTCMilliseconds() !== millisecond
  ) return null;
  return localEpoch - offset * 60_000;
}

function shanghaiDate(epochMs: number): string {
  const date = new Date(epochMs + SHANGHAI_OFFSET_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function copyContext(entry: CoreContextEntry): Readonly<CoreContextEntry> {
  const items = entry.items === undefined
    ? undefined
    : Object.freeze(entry.items.map((item) => Object.freeze({
        normalized_name: item.normalized_name,
        quantity: item.quantity,
        unit: item.unit,
      })));
  const copied = {
    context_id: entry.context_id,
    conversation_id: entry.conversation_id,
    revision: entry.revision,
    generated_at: entry.generated_at,
    valid_until: entry.valid_until,
    source_message_id: entry.source_message_id,
    rule_version: entry.rule_version,
    scope: entry.scope,
    ...(items === undefined ? {} : { items }),
    ...(entry.scene === undefined ? {} : { scene: entry.scene }),
  } satisfies CoreContextEntry;
  return Object.freeze(copied);
}

function hasRevisionIdentity(
  entry: CoreContextEntry,
  input: MealContextResolutionInput,
): boolean {
  return entry.conversation_id === input.conversation_id &&
    entry.source_message_id !== input.source_message_id &&
    entry.source_message_id.length > 0 &&
    Number.isSafeInteger(entry.revision) && entry.revision >= 1;
}

function structurallyRelevant(
  entry: CoreContextEntry,
  input: MealContextResolutionInput,
): boolean {
  return hasRevisionIdentity(entry, input) &&
    entry.rule_version === CONTEXT_RULE_VERSION &&
    timestampEpoch(entry.generated_at) !== null &&
    timestampEpoch(entry.valid_until) !== null;
}

function targetOccurrenceEpoch(input: MealContextResolutionInput, receivedEpoch: number): number {
  const resolvedStart = input.occurred_time?.resolved_start;
  return resolvedStart === null || resolvedStart === undefined
    ? receivedEpoch
    : timestampEpoch(resolvedStart) ?? receivedEpoch;
}

function isExplicitCorrection(sourceText: string): boolean {
  return EXPLICIT_CORRECTION_PATTERNS.some((pattern) => pattern.test(sourceText));
}

function compareUtf16CodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Resolve short-lived context without creating persistent chat state. */
export function resolveMealContext(
  input: MealContextResolutionInput,
): CoreContextEvidence {
  const receivedEpoch = timestampEpoch(input.received_at);
  if (receivedEpoch === null) throw new Error("CORE_CONTEXT_INVALID:received_at");
  const inventoryRead = INVENTORY_DISAMBIGUATION_PATTERN.test(input.source_text);
  const explicitScene = EXPLICIT_COMPANY_PATTERN.test(input.source_text)
    ? "company" as const
    : null;
  const corrected = isExplicitCorrection(input.source_text);

  const latestRevisionBySource = new Map<string, number>();
  for (const entry of input.prior_context) {
    if (!hasRevisionIdentity(entry, input)) continue;
    latestRevisionBySource.set(
      entry.source_message_id,
      Math.max(latestRevisionBySource.get(entry.source_message_id) ?? 0, entry.revision),
    );
  }

  const blockedLatestSources = new Set<string>();
  const latestEntryCountBySource = new Map<string, number>();
  for (const entry of input.prior_context) {
    if (!hasRevisionIdentity(entry, input)) continue;
    if (entry.revision !== latestRevisionBySource.get(entry.source_message_id)) continue;
    latestEntryCountBySource.set(
      entry.source_message_id,
      (latestEntryCountBySource.get(entry.source_message_id) ?? 0) + 1,
    );
    if (!structurallyRelevant(entry, input)) {
      blockedLatestSources.add(entry.source_message_id);
    }
  }
  for (const [sourceMessageId, count] of latestEntryCountBySource) {
    if (count !== 1) blockedLatestSources.add(sourceMessageId);
  }

  const occurrenceEpoch = targetOccurrenceEpoch(input, receivedEpoch);
  const expiredContextIds: string[] = [];
  const candidates: Array<{ readonly entry: CoreContextEntry; readonly generated: number }> = [];
  for (const entry of input.prior_context) {
    if (!hasRevisionIdentity(entry, input)) continue;
    if (entry.revision !== latestRevisionBySource.get(entry.source_message_id)) continue;
    if (blockedLatestSources.has(entry.source_message_id)) continue;
    if (!structurallyRelevant(entry, input)) continue;
    const generated = timestampEpoch(entry.generated_at);
    const validUntil = timestampEpoch(entry.valid_until);
    if (generated === null || validUntil === null) continue;
    const crossesMealDate = shanghaiDate(generated) !== shanghaiDate(occurrenceEpoch);
    if (receivedEpoch >= validUntil || crossesMealDate) {
      expiredContextIds.push(entry.context_id);
      continue;
    }
    if (corrected || generated > receivedEpoch || generated >= validUntil) continue;
    candidates.push({ entry, generated });
  }

  candidates.sort((left, right) =>
    right.generated - left.generated ||
    right.entry.revision - left.entry.revision ||
    compareUtf16CodeUnits(right.entry.context_id, left.entry.context_id)
  );
  const accepted = candidates[0]?.entry;
  const copied = accepted === undefined ? null : copyContext(accepted);
  return Object.freeze({
    scene: explicitScene ?? copied?.scene ?? "unknown",
    expired_context_ids: Object.freeze([...new Set(expiredContextIds)]),
    inventory_read: inventoryRead,
    accepted_context: copied,
    rule_version: CONTEXT_RULE_VERSION,
  });
}
