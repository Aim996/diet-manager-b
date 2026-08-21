import { Type, type Static } from "typebox";

const evidenceTextSchema = Type.String({ minLength: 1, maxLength: 256 });
const boundedNameSchema = Type.String({ minLength: 1, maxLength: 256 });
const boundedHintSchema = Type.String({ minLength: 1, maxLength: 256 });
const boundedUnitSchema = Type.String({ minLength: 1, maxLength: 64 });

export const subjectEvidenceSchema = Type.Object({
  kind: Type.Literal("self"),
  basis: Type.Union([
    Type.Literal("explicit"),
    Type.Literal("private_agent_default"),
  ]),
  evidence_span: Type.Union([evidenceTextSchema, Type.Null()]),
  explicit_other_spans: Type.Array(evidenceTextSchema, {
    minItems: 0,
    maxItems: 64,
  }),
}, { additionalProperties: false });

export const exactAmountEvidenceSchema = Type.Object({
  kind: Type.Literal("exact"),
  value: Type.Number({ exclusiveMinimum: 0 }),
  unit: boundedUnitSchema,
  evidence_span: evidenceTextSchema,
}, { additionalProperties: false });

export const unknownAmountSchema = Type.Object({
  kind: Type.Literal("unknown"),
}, { additionalProperties: false });

export const timeEvidenceSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("source_text"),
    evidence_span: evidenceTextSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("unspecified"),
    evidence_span: Type.Null(),
  }, { additionalProperties: false }),
]);

export const intakeItemEvidenceSchema = Type.Object({
  raw_name: boundedNameSchema,
  normalized_hint: boundedHintSchema,
  amount: Type.Union([exactAmountEvidenceSchema, unknownAmountSchema]),
}, { additionalProperties: false });

export const productEvidenceSchema = Type.Object({
  raw_name: boundedNameSchema,
  normalized_hint: boundedHintSchema,
  evidence_span: evidenceTextSchema,
}, { additionalProperties: false });

const stringEvidenceValueSchema = Type.Object({
  value: Type.String({ minLength: 1, maxLength: 128 }),
  evidence_span: evidenceTextSchema,
}, { additionalProperties: false });

const numberEvidenceValueSchema = Type.Object({
  value: Type.Number({ exclusiveMinimum: 0 }),
  evidence_span: evidenceTextSchema,
}, { additionalProperties: false });

export const priceEvidenceSchema = Type.Object({
  amount: Type.Number({ exclusiveMinimum: 0 }),
  currency: Type.Literal("CNY"),
  evidence_span: evidenceTextSchema,
}, { additionalProperties: false });

export const mealProposalV2Schema = Type.Object({
  kind: Type.Literal("meal"),
  subject: subjectEvidenceSchema,
  occurrence: Type.Literal("completed"),
  meal_slot: Type.Union([
    Type.Literal("breakfast"),
    Type.Literal("lunch"),
    Type.Literal("dinner"),
    Type.Literal("snack"),
    Type.Literal("unknown"),
  ]),
  items: Type.Array(intakeItemEvidenceSchema, { minItems: 1, maxItems: 64 }),
  occurred_at: timeEvidenceSchema,
}, { additionalProperties: false });

export const waterProposalV2Schema = Type.Object({
  kind: Type.Literal("water"),
  subject: subjectEvidenceSchema,
  amount: Type.Union([exactAmountEvidenceSchema, unknownAmountSchema]),
  occurred_at: timeEvidenceSchema,
}, { additionalProperties: false });

export const inventoryProposalV2Schema = Type.Object({
  kind: Type.Literal("inventory"),
  product: productEvidenceSchema,
  package_amount: exactAmountEvidenceSchema,
  per_package_content: Type.Union([exactAmountEvidenceSchema, Type.Null()]),
  location: Type.Union([stringEvidenceValueSchema, Type.Null()]),
  expires_at: Type.Union([timeEvidenceSchema, Type.Null()]),
  price: Type.Union([priceEvidenceSchema, Type.Null()]),
}, { additionalProperties: false });

export const profileProposalV2Schema = Type.Object({
  kind: Type.Literal("profile"),
  operation: Type.Union([Type.Literal("update"), Type.Literal("clear")]),
  values: Type.Object({
    sex: Type.Optional(Type.Union([
      Type.Object({
        value: Type.Union([Type.Literal("female"), Type.Literal("male")]),
        evidence_span: evidenceTextSchema,
      }, { additionalProperties: false }),
      Type.Null(),
    ])),
    age_years: Type.Optional(Type.Union([numberEvidenceValueSchema, Type.Null()])),
    height_cm: Type.Optional(Type.Union([numberEvidenceValueSchema, Type.Null()])),
    weight_kg: Type.Optional(Type.Union([numberEvidenceValueSchema, Type.Null()])),
    activity_level: Type.Optional(Type.Union([stringEvidenceValueSchema, Type.Null()])),
    goal_direction: Type.Optional(Type.Union([stringEvidenceValueSchema, Type.Null()])),
  }, { additionalProperties: false, minProperties: 1 }),
}, { additionalProperties: false });

export const goalFields = [
  "energy_kcal",
  "protein_g",
  "fat_g",
  "carbohydrate_g",
  "fiber_g",
  "water_ml",
] as const;

export type GoalField = (typeof goalFields)[number];

export const goalProposalV2Schema = Type.Object({
  kind: Type.Literal("goal"),
  operation: Type.Union([
    Type.Literal("confirm"),
    Type.Literal("update"),
    Type.Literal("clear"),
  ]),
  values: Type.Object({
    energy_kcal: Type.Optional(Type.Union([numberEvidenceValueSchema, Type.Null()])),
    protein_g: Type.Optional(Type.Union([numberEvidenceValueSchema, Type.Null()])),
    fat_g: Type.Optional(Type.Union([numberEvidenceValueSchema, Type.Null()])),
    carbohydrate_g: Type.Optional(Type.Union([numberEvidenceValueSchema, Type.Null()])),
    fiber_g: Type.Optional(Type.Union([numberEvidenceValueSchema, Type.Null()])),
    water_ml: Type.Optional(Type.Union([numberEvidenceValueSchema, Type.Null()])),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const recordMutationProposalV2Schema = Type.Object({
  kind: Type.Literal("record_mutation"),
  operation: Type.Union([
    Type.Literal("correct"),
    Type.Literal("undo"),
    Type.Literal("restore"),
  ]),
  target: Type.Object({
    description: Type.String({ minLength: 1, maxLength: 512 }),
    evidence_span: evidenceTextSchema,
  }, { additionalProperties: false }),
  replacement: Type.Optional(Type.Object({
    description: Type.String({ minLength: 1, maxLength: 512 }),
    evidence_span: evidenceTextSchema,
  }, { additionalProperties: false })),
}, { additionalProperties: false });

export const semanticProposalV2Schema = Type.Union([
  mealProposalV2Schema,
  waterProposalV2Schema,
  inventoryProposalV2Schema,
  profileProposalV2Schema,
  goalProposalV2Schema,
  recordMutationProposalV2Schema,
]);

export type SubjectEvidence = Readonly<Static<typeof subjectEvidenceSchema>>;
export type ExactAmountEvidence = Readonly<Static<typeof exactAmountEvidenceSchema>>;
export type UnknownAmount = Readonly<Static<typeof unknownAmountSchema>>;
export type TimeEvidence = Readonly<Static<typeof timeEvidenceSchema>>;
export type IntakeItemEvidence = Readonly<Static<typeof intakeItemEvidenceSchema>>;
export type ProductEvidence = Readonly<Static<typeof productEvidenceSchema>>;
export type PriceEvidence = Readonly<Static<typeof priceEvidenceSchema>>;
export type MealProposalV2 = Readonly<Static<typeof mealProposalV2Schema>>;
export type WaterProposalV2 = Readonly<Static<typeof waterProposalV2Schema>>;
export type InventoryProposalV2 = Readonly<Static<typeof inventoryProposalV2Schema>>;
export type ProfileProposalV2 = Readonly<Static<typeof profileProposalV2Schema>>;
export type GoalProposalV2 = Readonly<Static<typeof goalProposalV2Schema>>;
export type RecordMutationProposalV2 = Readonly<Static<typeof recordMutationProposalV2Schema>>;
export type SemanticProposalV2 = Readonly<Static<typeof semanticProposalV2Schema>>;
