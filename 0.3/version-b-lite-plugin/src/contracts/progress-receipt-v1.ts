import { Type, type Static } from "typebox";

const decimalTextSchema = Type.String({ pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$" });

export const progressQuantityV1Schema = Type.Union([
  Type.Object({
    kind: Type.Literal("exact"),
    value: decimalTextSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("lower_bound"),
    value: decimalTextSchema,
  }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("unknown") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("none") }, { additionalProperties: false }),
]);

export const frozenProgressMetricV1Schema = Type.Object({
  key: Type.Union([
    Type.Literal("energy_kcal"),
    Type.Literal("protein_g"),
    Type.Literal("fat_g"),
    Type.Literal("carbohydrate_g"),
    Type.Literal("fiber_g"),
    Type.Literal("water_ml"),
  ]),
  display_name: Type.Union([
    Type.Literal("热量"),
    Type.Literal("蛋白"),
    Type.Literal("脂肪"),
    Type.Literal("碳水"),
    Type.Literal("纤维"),
    Type.Literal("饮水"),
  ]),
  unit: Type.Union([Type.Literal("kcal"), Type.Literal("g"), Type.Literal("ml")]),
  current: progressQuantityV1Schema,
  target: Type.Union([decimalTextSchema, Type.Null()]),
  delta: progressQuantityV1Schema,
  percent: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  filled_cells: Type.Union([Type.Integer({ minimum: 0, maximum: 10 }), Type.Null()]),
  bar_text: Type.Union([
    Type.String({ pattern: "^[█░]{10}$" }),
    Type.Null(),
  ]),
  increment_percent: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  increment_percent_text: Type.Union([
    Type.String({ pattern: "^\\+(?:<1|[0-9]+)%$" }),
    Type.Null(),
  ]),
  coverage_status: Type.Union([
    Type.Literal("known"),
    Type.Literal("known_min"),
    Type.Literal("unknown"),
  ]),
  unknown_sources: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
    maxItems: 64,
  }),
  unknown_source_count: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

export const frozenDateProgressV1Schema = Type.Object({
  schema_version: Type.Literal("diet-manager/frozen-date-progress/v1"),
  date: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  timezone: Type.Literal("Asia/Shanghai"),
  goal_version_id: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  goal_notice: Type.Union([
    Type.Literal("目标未配置，进度条不可用。"),
    Type.Null(),
  ]),
  metrics: Type.Array(frozenProgressMetricV1Schema, { minItems: 6, maxItems: 6 }),
  generated_at: Type.String({ minLength: 1, maxLength: 64 }),
  idempotency_key: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });

export const frozenReceiptV1Schema = Type.Object({
  schema_version: Type.Literal("diet-manager/frozen-receipt/v1"),
  summary: Type.String({ minLength: 1, maxLength: 1024 }),
  inventory_notes: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
    maxItems: 64,
  }),
  nutrition_notes: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
    maxItems: 64,
  }),
  issue_codes: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
    maxItems: 64,
  }),
}, { additionalProperties: false });

export type ProgressQuantityV1 = Readonly<Static<typeof progressQuantityV1Schema>>;
export type FrozenProgressMetricV1 = Readonly<Static<typeof frozenProgressMetricV1Schema>>;
export type FrozenDateProgressV1 = Readonly<Static<typeof frozenDateProgressV1Schema>>;
export type FrozenReceiptV1 = Readonly<Static<typeof frozenReceiptV1Schema>>;
