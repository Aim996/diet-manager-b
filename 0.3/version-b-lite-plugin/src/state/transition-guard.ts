export const envelopeStates = [
  "received",
  "facts_committed",
  "effects_pending",
  "effects_stable",
  "finalized",
] as const;

export type EnvelopeState = (typeof envelopeStates)[number];

export const effectStates = [
  "pending",
  "processing",
  "succeeded",
  "retryable_failed",
  "permanent_business_skip",
] as const;

export type EffectState = (typeof effectStates)[number];

const envelopeEdges = new Set([
  "received\u0000facts_committed",
  "facts_committed\u0000effects_pending",
  "effects_pending\u0000effects_stable",
  "effects_stable\u0000finalized",
]);

const effectEdges = new Set([
  "pending\u0000processing",
  "processing\u0000succeeded",
  "processing\u0000retryable_failed",
  "processing\u0000permanent_business_skip",
  "retryable_failed\u0000processing",
]);

function assertTransition(
  kind: "envelope" | "effect",
  previous: string,
  next: string,
  edges: ReadonlySet<string>,
): void {
  if (!edges.has(`${previous}\u0000${next}`)) {
    throw new Error(`ILLEGAL_STATE_TRANSITION:${kind}:${previous}:${next}`);
  }
}

export function assertEnvelopeTransition(
  previous: EnvelopeState,
  next: EnvelopeState,
): void {
  assertTransition("envelope", String(previous), String(next), envelopeEdges);
}

export function assertEffectTransition(
  previous: EffectState,
  next: EffectState,
): void {
  assertTransition("effect", String(previous), String(next), effectEdges);
}
