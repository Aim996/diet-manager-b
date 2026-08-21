import { Type, type Static } from "typebox";

import {
  frozenDateProgressV1Schema,
  frozenReceiptV1Schema,
} from "./progress-receipt-v1.js";

export const frozenIngestionOutcomeV2Schema = Type.Object({
  status: Type.Union([
    Type.Literal("committed"),
    Type.Literal("committed_with_issues"),
  ]),
  committed: Type.Literal(true),
  operation_id: Type.String({ minLength: 1, maxLength: 128 }),
  record_ids: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
    minItems: 1,
    maxItems: 64,
  }),
  receipt: frozenReceiptV1Schema,
  progress: Type.Array(frozenDateProgressV1Schema, { minItems: 1, maxItems: 32 }),
}, { additionalProperties: false });

export type FrozenIngestionOutcomeV2 = Readonly<Static<typeof frozenIngestionOutcomeV2Schema>>;
