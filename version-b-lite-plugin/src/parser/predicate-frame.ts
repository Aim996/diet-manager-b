export interface PredicateSourceSpan {
  readonly raw: string;
  readonly start: number;
  readonly end: number;
}

export interface IngestionPredicateFrame {
  readonly event_index: number;
  readonly event_id: string;
  readonly predicate: "eat" | "drink";
  readonly coordination: "none" | "inherit_previous" | "ambiguous";
  readonly clause_span: Readonly<PredicateSourceSpan>;
  readonly frame_span: Readonly<PredicateSourceSpan>;
  readonly subject_prefix_span: Readonly<PredicateSourceSpan>;
  readonly predicate_span: Readonly<PredicateSourceSpan>;
  readonly object_span: Readonly<PredicateSourceSpan>;
}

interface ClauseSpan {
  readonly start: number;
  readonly end: number;
}

interface PredicateAnchor {
  readonly start: number;
  readonly end: number;
  readonly predicate: "eat" | "drink";
}

const EAT_OBJECT_START = /^(?:了|过|完|的|[0-9]|一|两|二|三|四|五|六|七|八|九|十|鸡胸肉|鸡蛋|豆浆|炒饭|香蕉|面包|咖啡|苹果|牛奶|米饭|汤|茶|面)/u;
const DRINK_OBJECT_START = /^(?:了|过|完|的|[0-9]|一|两|二|三|四|五|六|七|八|九|十|白水|水|牛奶|豆浆|汤|咖啡|茶)/u;
const OWNED_OBJECT_PREFIX = /^\s*(?:了|过|完)?\s*(?:(?:两个?|二个)\s*鸡蛋|鸡蛋|两片\s*面包|面包|(?:[0-9]+\s*ml|一瓶)\s*牛奶|牛奶|一个\s*苹果|苹果|香蕉|米饭|一碗\s*面|一块\s*鸡胸肉|鸡胸肉|两盘\s*炒饭|炒饭|汤|豆浆|咖啡|茶|[0-9]+\s*ml\s*(?:白水|水))/u;
const LEADING_CONNECTOR = /^(然后|接着|后来|和|又)/u;

interface FrameBoundary {
  readonly frame_start: number;
  readonly previous_frame_end: number;
  readonly coordination: IngestionPredicateFrame["coordination"];
}

function frozenRecord<T extends object>(entries: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), entries)) as Readonly<T>;
}

function sourceSpan(
  sourceText: string,
  start: number,
  end: number,
): Readonly<PredicateSourceSpan> {
  return frozenRecord({ raw: sourceText.slice(start, end), start, end });
}

function trimmedBounds(
  sourceText: string,
  start: number,
  end: number,
): ClauseSpan | null {
  let boundedStart = start;
  let boundedEnd = end;
  while (boundedStart < boundedEnd && /\s/u.test(sourceText[boundedStart] ?? "")) {
    boundedStart += 1;
  }
  while (boundedEnd > boundedStart && /\s/u.test(sourceText[boundedEnd - 1] ?? "")) {
    boundedEnd -= 1;
  }
  return boundedStart === boundedEnd
    ? null
    : frozenRecord({ start: boundedStart, end: boundedEnd });
}

function splitClauses(sourceText: string): readonly ClauseSpan[] {
  const clauses: ClauseSpan[] = [];
  const delimiter = /[，,。；;！？!?\r\n]+/gu;
  let start = 0;
  for (const match of sourceText.matchAll(delimiter)) {
    const clause = trimmedBounds(sourceText, start, match.index);
    if (clause !== null) clauses.push(clause);
    start = match.index + match[0].length;
  }
  const finalClause = trimmedBounds(sourceText, start, sourceText.length);
  if (finalClause !== null) clauses.push(finalClause);
  return Object.freeze(clauses);
}

function predicateAnchors(
  sourceText: string,
  clause: ClauseSpan,
): readonly PredicateAnchor[] {
  const anchors: PredicateAnchor[] = [];
  for (const match of sourceText.slice(clause.start, clause.end).matchAll(/[吃喝]/gu)) {
    const start = clause.start + match.index;
    const remainder = sourceText.slice(
      start + 1,
      Math.min(clause.end, start + 17),
    ).trimStart();
    const positiveStart = match[0] === "吃" ? EAT_OBJECT_START : DRINK_OBJECT_START;
    if (remainder.length > 0 && !positiveStart.test(remainder)) continue;
    anchors.push(frozenRecord({
      start,
      end: start + match[0].length,
      predicate: match[0] === "吃" ? "eat" as const : "drink" as const,
    }));
  }
  return Object.freeze(anchors);
}

function objectPrefixEnd(
  sourceText: string,
  previous: PredicateAnchor,
  current: PredicateAnchor,
): number | null {
  const between = sourceText.slice(previous.end, current.start);
  const match = OWNED_OBJECT_PREFIX.exec(between);
  if (match === null) return null;
  return previous.end + match[0].length;
}

function nextBoundary(
  sourceText: string,
  previous: PredicateAnchor,
  current: PredicateAnchor,
): FrameBoundary {
  const between = sourceText.slice(previous.end, current.start);
  const ownedEnd = objectPrefixEnd(sourceText, previous, current);
  if (ownedEnd === null) {
    return frozenRecord({
      frame_start: previous.end,
      previous_frame_end: previous.end,
      coordination: "ambiguous" as const,
    });
  }
  let nextStart = ownedEnd;
  while (nextStart < current.start && /\s/u.test(sourceText[nextStart] ?? "")) {
    nextStart += 1;
  }
  const residual = sourceText.slice(nextStart, current.start);
  const connector = LEADING_CONNECTOR.exec(residual);
  if (connector !== null) {
    const afterConnector = nextStart + connector[0].length;
    const hasSubject = sourceText.slice(afterConnector, current.start).trim().length > 0;
    return frozenRecord({
      frame_start: hasSubject ? afterConnector : nextStart,
      previous_frame_end: nextStart,
      coordination: hasSubject ? "none" as const : "inherit_previous" as const,
    });
  }
  return frozenRecord({
    frame_start: nextStart,
    previous_frame_end: nextStart,
    coordination: "none" as const,
  });
}

/**
 * Split bounded Chinese ingestion syntax into immutable predicate-local spans.
 * This is a lexical frame pass only; subject authority is resolved separately.
 */
export function parseIngestionPredicateFrames(
  sourceText: string,
): readonly Readonly<IngestionPredicateFrame>[] {
  const frames: IngestionPredicateFrame[] = [];
  for (const clause of splitClauses(sourceText)) {
    const anchors = predicateAnchors(sourceText, clause);
    if (anchors.length === 0) continue;
    const starts: number[] = [clause.start];
    const ends: number[] = [];
    const firstPrefix = sourceText.slice(clause.start, anchors[0]?.start ?? clause.start).trim();
    const previousFrame = frames.at(-1);
    const coordinations: IngestionPredicateFrame["coordination"][] = [
      firstPrefix === "又" && previousFrame?.predicate === anchors[0]?.predicate
        ? "inherit_previous"
        : "none",
    ];
    for (let index = 1; index < anchors.length; index += 1) {
      const previous = anchors[index - 1];
      const current = anchors[index];
      if (previous === undefined || current === undefined) continue;
      const boundary = nextBoundary(sourceText, previous, current);
      ends[index - 1] = boundary.previous_frame_end;
      starts[index] = boundary.frame_start;
      coordinations[index] = boundary.coordination;
    }
    ends[anchors.length - 1] = clause.end;

    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      const frameStart = starts[index];
      const frameEnd = ends[index];
      if (anchor === undefined || frameStart === undefined || frameEnd === undefined) continue;
      frames.push(frozenRecord({
        event_index: frames.length,
        event_id: `predicate:${frames.length}:${anchor.start}-${anchor.end}`,
        predicate: anchor.predicate,
        coordination: coordinations[index] ?? "none",
        clause_span: sourceSpan(sourceText, clause.start, clause.end),
        frame_span: sourceSpan(sourceText, frameStart, frameEnd),
        subject_prefix_span: sourceSpan(sourceText, frameStart, anchor.start),
        predicate_span: sourceSpan(sourceText, anchor.start, anchor.end),
        object_span: sourceSpan(sourceText, anchor.end, frameEnd),
      }));
    }
  }
  return Object.freeze(frames);
}
