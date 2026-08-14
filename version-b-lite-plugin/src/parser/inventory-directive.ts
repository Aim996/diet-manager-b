import type { CoreInventoryDirectiveEvidence } from "./types.js";

const RULE_VERSION = "diet-manager/inventory-directive/v1" as const;
const EXPLICIT_SKIP = /只记录(?:\s*[，,]\s*别扣库存)?|别扣库存/u;

/** Resolve only an explicit, event-local inventory skip phrase. */
export function resolveInventoryDirective(
  sourceText: string,
): Readonly<CoreInventoryDirectiveEvidence> | undefined {
  const match = EXPLICIT_SKIP.exec(sourceText);
  if (match === null) return undefined;
  return Object.freeze(Object.assign(Object.create(null), {
    mode: "skip" as const,
    evidence_kind: "explicit" as const,
    matched_span: match[0],
    rule_version: RULE_VERSION,
  })) as Readonly<CoreInventoryDirectiveEvidence>;
}
