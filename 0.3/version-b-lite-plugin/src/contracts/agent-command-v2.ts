import { isProxy } from "node:util/types";

import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

import { dietManagerActions } from "./actions.js";
import { dietManagerContract } from "./identity.js";
import {
  exactAmountEvidenceSchema,
  semanticProposalV2Schema,
  subjectEvidenceSchema,
} from "./semantic-proposal-v2.js";

export const AGENT_COMMAND_V2_SCHEMA_VERSION = "diet-manager/agent-command/v2" as const;
export const AGENT_COMMAND_V1_SCHEMA_VERSION = "diet-manager/agent-command/v1" as const;

export const dietManagerActionSchema = Type.Union([
  Type.Literal(dietManagerActions[0]),
  Type.Literal(dietManagerActions[1]),
  Type.Literal(dietManagerActions[2]),
  Type.Literal(dietManagerActions[3]),
  Type.Literal(dietManagerActions[4]),
  Type.Literal(dietManagerActions[5]),
  Type.Literal(dietManagerActions[6]),
  Type.Literal(dietManagerActions[7]),
  Type.Literal(dietManagerActions[8]),
  Type.Literal(dietManagerActions[9]),
  Type.Literal(dietManagerActions[10]),
]);

const semanticMealCandidateV1Schema = Type.Object({
  schema_version: Type.Literal("diet-manager/semantic-candidate/v1"),
  intent: Type.Literal("record_meal"),
  source_text: Type.String({ minLength: 1, maxLength: 4096 }),
  subject: subjectEvidenceSchema,
  items: Type.Array(Type.Object({
    raw_name: Type.String({ minLength: 1, maxLength: 256 }),
    normalized_hint: Type.String({ minLength: 1, maxLength: 256 }),
    amount: Type.Union([
      exactAmountEvidenceSchema,
      Type.Object({ kind: Type.Literal("unknown") }, { additionalProperties: false }),
    ]),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 64 }),
  time: Type.Object({
    kind: Type.Union([
      Type.Literal("source_text"),
      Type.Literal("unspecified"),
    ]),
    evidence_span: Type.Union([
      Type.String({ minLength: 1, maxLength: 256 }),
      Type.Null(),
    ]),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const agentCommandV1Schema = Type.Object({
  schema_version: Type.Literal(AGENT_COMMAND_V1_SCHEMA_VERSION),
  action: dietManagerActionSchema,
  source_text: Type.String({ minLength: 1, maxLength: 4096 }),
  semantic_candidate: Type.Optional(semanticMealCandidateV1Schema),
}, { additionalProperties: false });

export const agentCommandV2Schema = Type.Object({
  schema_version: Type.Literal(AGENT_COMMAND_V2_SCHEMA_VERSION),
  action: dietManagerActionSchema,
  source_text: Type.String({
    minLength: 1,
    maxLength: 4096,
    description: "Copy the user's current message verbatim; never normalize or invent facts.",
  }),
  semantic_proposal: Type.Optional(semanticProposalV2Schema),
}, { additionalProperties: false });

const legacyItemSchema = Type.Object({
  name: Type.String(),
  quantity: Type.Optional(Type.Number()),
  unit: Type.Optional(Type.String()),
  per_item_amount: Type.Optional(Type.Number()),
  per_item_unit: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const legacyOpenClawParametersSchema = Type.Object({
  action: dietManagerActionSchema,
  source_text: Type.Optional(Type.String({
    description: "Copy the user's current message verbatim; never normalize or invent facts.",
  })),
  occurred_at_text: Type.Optional(Type.String({
    description: "Legacy compatibility evidence; never substitutes for received_at.",
  })),
  items: Type.Optional(Type.Array(legacyItemSchema, {
    description: "Legacy compatibility evidence; the core parses source_text authoritatively.",
  })),
  semantic_candidate: Type.Optional(semanticMealCandidateV1Schema),
}, { additionalProperties: false });

export const agentCommandParametersSchema = Type.Union([
  legacyOpenClawParametersSchema,
  agentCommandV1Schema,
  agentCommandV2Schema,
], {
  "x-diet-manager-contract": dietManagerContract,
});

export type AgentCommandV1Schema = Readonly<Static<typeof agentCommandV1Schema>>;
export type AgentCommandV2 = Readonly<Static<typeof agentCommandV2Schema>>;

function invalid(reason: string): never {
  throw new TypeError(`DIET_AGENT_COMMAND_INVALID:${reason}`);
}

function clonePlainData(value: unknown, active = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return invalid("number");
    return value;
  }
  if (typeof value !== "object" || isProxy(value)) return invalid("shape");
  if (active.has(value)) return invalid("cycle");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return invalid("array_prototype");
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, "value") ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
          lengthDescriptor.value > 256) return invalid("array_length");
      const length = lengthDescriptor.value as number;
      const keys = Reflect.ownKeys(value);
      const expected = new Set<PropertyKey>([
        "length",
        ...Array.from({ length }, (_, index) => String(index)),
      ]);
      if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
        return invalid("array_keys");
      }
      const cloned: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value") ||
            descriptor.enumerable !== true) return invalid("array_descriptor");
        cloned.push(clonePlainData(descriptor.value, active));
      }
      return Object.freeze(cloned);
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) return invalid("prototype");
    const keys = Reflect.ownKeys(value);
    if (keys.length > 128 || keys.some((key) => typeof key !== "string")) {
      return invalid("keys");
    }
    const cloned: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value") ||
          descriptor.enumerable !== true) return invalid(`${key}:descriptor`);
      cloned[key] = clonePlainData(descriptor.value, active);
    }
    return Object.freeze(cloned);
  } finally {
    active.delete(value);
  }
}

function assertVerbatimEvidence(value: unknown, sourceText: string): void {
  if (Array.isArray(value)) {
    for (const item of value) assertVerbatimEvidence(item, sourceText);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === "evidence_span" && nested !== null) {
      if (typeof nested !== "string" || !sourceText.includes(nested)) invalid("evidence_span");
      continue;
    }
    if (key === "explicit_other_spans") {
      if (!Array.isArray(nested) || nested.some((span) =>
        typeof span !== "string" || !sourceText.includes(span))) invalid("evidence_span");
      continue;
    }
    assertVerbatimEvidence(nested, sourceText);
  }
}

export function cloneAgentCommandV2(value: unknown): Readonly<AgentCommandV2> {
  const cloned = clonePlainData(value);
  if (!Check(agentCommandV2Schema, cloned)) return invalid("schema");
  if (cloned.semantic_proposal !== undefined) {
    assertVerbatimEvidence(cloned.semantic_proposal, cloned.source_text);
  }
  return cloned as Readonly<AgentCommandV2>;
}
