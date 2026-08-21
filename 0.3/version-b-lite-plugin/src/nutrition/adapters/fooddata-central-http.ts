import { canonicalSha256 } from "../../authority/canonical-json.js";
import {
  freezeNutritionData,
  type ResolvedNutritionEvidence,
  type SourceRequest,
  type SourceResolution,
} from "../types.js";
import type { FoodDataCentralTransport } from "./fooddata-central.js";

const FDC_ORIGIN = "https://api.nal.usda.gov";
const FDC_SEARCH_URL = `${FDC_ORIGIN}/fdc/v1/foods/search`;
const FDC_PROBE_URL = `${FDC_ORIGIN}/fdc/v1/foods/list?pageSize=1&pageNumber=1`;
const MAX_RESPONSE_BYTES = 512 * 1024;

type FetchLike = typeof fetch;

type NutrientField = keyof ResolvedNutritionEvidence["nutrient_values"];

const NUTRIENTS: Readonly<Record<number, Readonly<{ field: NutrientField; unit: string }>>> = Object.freeze({
  1003: Object.freeze({ field: "protein_g", unit: "G" }),
  1004: Object.freeze({ field: "fat_g", unit: "G" }),
  1005: Object.freeze({ field: "carbohydrate_g", unit: "G" }),
  1008: Object.freeze({ field: "energy_kcal", unit: "KCAL" }),
  1051: Object.freeze({ field: "water_ml", unit: "G" }),
  1062: Object.freeze({ field: "energy_kj", unit: "KJ" }),
  1079: Object.freeze({ field: "fiber_g", unit: "G" }),
  1093: Object.freeze({ field: "sodium_mg", unit: "MG" }),
  1258: Object.freeze({ field: "saturated_fat_g", unit: "G" }),
  2000: Object.freeze({ field: "sugar_g", unit: "G" }),
});

function ordinaryRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
    ? value as Record<string, unknown>
    : undefined;
}

function decimal(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const plain = value.toString();
  if (!/[eE]/u.test(plain)) return plain;
  return value.toFixed(12).replace(/(?:\.0+|(?<fraction>\.[0-9]*?)0+)$/u, "$<fraction>");
}

function credentialText(value: Uint8Array): string {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(value);
  if (decoded.length === 0 || decoded.length > 128 || /[^A-Za-z0-9_-]/u.test(decoded)) {
    throw new TypeError("NUTRITION_SOURCE_AUTH_FAILED");
  }
  return decoded;
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new TypeError("NUTRITION_SOURCE_INVALID:content_type");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    throw new TypeError("NUTRITION_SOURCE_INVALID:response_size");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new TypeError("NUTRITION_SOURCE_INVALID:response_size");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function emptyResolution(status: SourceResolution["status"], reason: string): Readonly<SourceResolution> {
  return freezeNutritionData({
    status,
    source_id: "public.usda_fooddata_central",
    tier: "authoritative_public_database",
    source_record_id: null,
    source_version: null,
    retained_fields_sha256: null,
    evidence: null,
    reason,
  });
}

function parseFood(value: unknown): Readonly<SourceResolution> {
  const root = ordinaryRecord(value);
  const foods = root?.foods;
  if (!Array.isArray(foods) || foods.length === 0) return emptyResolution("no_results", "no_match");
  const food = ordinaryRecord(foods[0]);
  if (food === undefined || !Number.isSafeInteger(food.fdcId) || Number(food.fdcId) <= 0 ||
      typeof food.description !== "string" || food.description.length === 0 || food.description.length > 512 ||
      typeof food.dataType !== "string" || food.dataType.length === 0 || food.dataType.length > 64 ||
      !Array.isArray(food.foodNutrients)) {
    throw new TypeError("NUTRITION_SOURCE_INVALID:food");
  }
  const nutrientValues: Record<NutrientField, string | null> = {
    energy_kcal: null,
    protein_g: null,
    fat_g: null,
    carbohydrate_g: null,
    fiber_g: null,
    energy_kj: null,
    sodium_mg: null,
    sugar_g: null,
    saturated_fat_g: null,
    water_ml: null,
  };
  for (const candidate of food.foodNutrients) {
    const nutrient = ordinaryRecord(candidate);
    if (nutrient === undefined || !Number.isSafeInteger(nutrient.nutrientId) ||
        typeof nutrient.unitName !== "string") continue;
    const binding = NUTRIENTS[Number(nutrient.nutrientId)];
    if (binding === undefined || nutrient.unitName.toUpperCase() !== binding.unit ||
        nutrientValues[binding.field] !== null) continue;
    nutrientValues[binding.field] = decimal(nutrient.value);
  }
  if (Object.values(nutrientValues).every((item) => item === null)) {
    return emptyResolution("no_results", "nutrients_unavailable");
  }
  const fdcId = Number(food.fdcId);
  const publicationDate = typeof food.publicationDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(food.publicationDate)
    ? food.publicationDate
    : "fdc-api-v1";
  const retained = {
    data_type: food.dataType,
    description: food.description,
    fdc_id: fdcId,
    nutrient_values: nutrientValues,
    publication_date: publicationDate,
  };
  const complete = ["energy_kcal", "protein_g", "fat_g", "carbohydrate_g", "fiber_g"]
    .every((field) => nutrientValues[field as NutrientField] !== null);
  const evidence: ResolvedNutritionEvidence = {
    source_id: "public.usda_fooddata_central",
    source_type: "authoritative_public_database",
    source_ref: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${fdcId}/nutrients`,
    source_version: publicationDate,
    basis_kind: "per_100g",
    basis_amount: "100",
    basis_unit: "g",
    nutrient_values: nutrientValues,
    field_evidence: [],
    coverage_status: complete ? "complete" : "partial",
    adopted_amount: null,
    adopted_unit: null,
    amount_range: null,
    formula: "profile_value * consumed_amount / basis_amount",
  };
  return freezeNutritionData({
    status: complete ? "ok" : "partial",
    source_id: "public.usda_fooddata_central",
    tier: "authoritative_public_database",
    source_record_id: `fdc:${fdcId}`,
    source_version: publicationDate,
    retained_fields_sha256: canonicalSha256(retained),
    evidence,
    reason: null,
  });
}

export class FoodDataCentralHttpTransport implements FoodDataCentralTransport {
  readonly #fetch: FetchLike;

  constructor(fetchImplementation: FetchLike = fetch) {
    if (typeof fetchImplementation !== "function") throw new TypeError("NUTRITION_TRANSPORT_INVALID:fetch");
    this.#fetch = fetchImplementation;
  }

  async probe(input: Readonly<{ signal: AbortSignal; credential: Uint8Array }>): Promise<boolean> {
    const response = await this.#fetch(FDC_PROBE_URL, {
      method: "GET",
      redirect: "error",
      signal: input.signal,
      headers: { Accept: "application/json", "X-Api-Key": credentialText(input.credential) },
    });
    if (!response.ok) return false;
    await boundedJson(response);
    return true;
  }

  async resolve(input: Readonly<{
    request: Readonly<SourceRequest>;
    signal: AbortSignal;
    credential: Uint8Array;
  }>): Promise<Readonly<SourceResolution>> {
    const query = input.request.normalized_food_name.trim();
    if (query.length === 0 || query.length > 256 || /[\u0000-\u001F\u007F]/u.test(query)) {
      return emptyResolution("no_results", "invalid_query");
    }
    const response = await this.#fetch(FDC_SEARCH_URL, {
      method: "POST",
      redirect: "error",
      signal: input.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Api-Key": credentialText(input.credential),
      },
      body: JSON.stringify({
        query,
        dataType: ["Foundation", "Survey (FNDDS)", "SR Legacy"],
        pageSize: 1,
        pageNumber: 1,
      }),
    });
    if (response.status === 401 || response.status === 403) {
      return emptyResolution("auth_failed", "credential_rejected");
    }
    if (!response.ok) return emptyResolution("error", "source_unavailable");
    return parseFood(await boundedJson(response));
  }
}
