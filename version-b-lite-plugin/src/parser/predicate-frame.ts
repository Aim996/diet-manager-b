export interface PredicateSourceSpan {
  readonly raw: string;
  readonly start: number;
  readonly end: number;
}

export interface IngestionPredicateFrame {
  readonly predicate: "eat" | "drink";
  readonly coordination: "none" | "inherit_previous";
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
  const anchors = Array.from(
    sourceText.slice(clause.start, clause.end).matchAll(/[吃喝]/gu),
    (match) => frozenRecord({
      start: clause.start + match.index,
      end: clause.start + match.index + match[0].length,
      predicate: match[0] === "吃" ? "eat" as const : "drink" as const,
    }),
  );
  return Object.freeze(anchors);
}

function nextBoundary(
  sourceText: string,
  previous: PredicateAnchor,
  current: PredicateAnchor,
): FrameBoundary {
  const between = sourceText.slice(previous.end, current.start);
  let connectorIndex = -1;
  let connectorLength = 0;
  for (const match of between.matchAll(/然后|接着|后来|和|又/gu)) {
    connectorIndex = match.index;
    connectorLength = match[0].length;
  }
  if (connectorIndex < 0) {
    const explicitSelf = between.lastIndexOf("我");
    const frameStart = explicitSelf < 0
      ? current.start
      : previous.end + explicitSelf;
    return frozenRecord({
      frame_start: frameStart,
      previous_frame_end: frameStart,
      coordination: "none" as const,
    });
  }

  const connectorStart = previous.end + connectorIndex;
  const afterConnector = connectorStart + connectorLength;
  const hasSubjectPrefix = sourceText.slice(afterConnector, current.start).trim().length > 0;
  return frozenRecord({
    frame_start: hasSubjectPrefix ? afterConnector : connectorStart,
    previous_frame_end: connectorStart,
    coordination: hasSubjectPrefix ? "none" as const : "inherit_previous" as const,
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
