import { canonicalSha256 } from "../authority/canonical-json.js";
import {
  freezeNutritionData,
  type NutritionSourceAdapter,
  type ResolvedNutritionEvidence,
  type SourceCapability,
  type SourceContext,
  type SourceHealth,
  type SourceRequest,
  type SourceResolution,
} from "./types.js";

// DEC-032：把餐食词表 10 项在 USDA FoodData Central 的权威 SR Legacy 记录固化进
// skill。数据为美国政府公有领域作品（https://fdc.nal.usda.gov），构建期逐项转写，
// 运行时零网络、零 key、零代理。source_type = authoritative_public_database，
// source_ref 指向 FDC 页面，source_version 取 SR Legacy 发布日（2019-04-01）。

const BUNDLED_PUBLICATION_DATE = "2019-04-01";
const BUNDLED_BACKEND_VERSION = "sr-legacy-2019-04-01";

type NutrientField = keyof ResolvedNutritionEvidence["nutrient_values"];

interface BundledFoodRecord {
  readonly fdcId: number;
  readonly description: string;
  readonly dataType: "SR Legacy";
  readonly nutrient_values: Readonly<Record<NutrientField, string | null>>;
}

// 键名与 parser/meal.ts 的 LEXICON 严格同源（chicken 而非 chicken_breast）。
const BUNDLED_FOODS: Readonly<Record<string, Readonly<BundledFoodRecord>>> = freezeNutritionData({
  milk: {
    fdcId: 171265,
    description: "Milk, whole, 3.25% milkfat, with added vitamin D",
    dataType: "SR Legacy",
    nutrient_values: {
      energy_kcal: "61",
      energy_kj: "254",
      protein_g: "3.15",
      fat_g: "3.25",
      carbohydrate_g: "4.8",
      fiber_g: "0",
      sugar_g: "5.05",
      saturated_fat_g: "1.86",
      sodium_mg: "43",
      water_ml: "88.1",
    },
  },
  egg: {
    fdcId: 171287,
    description: "Egg, whole, raw, fresh",
    dataType: "SR Legacy",
    nutrient_values: {
      energy_kcal: "143",
      energy_kj: "599",
      protein_g: "12.6",
      fat_g: "9.51",
      carbohydrate_g: "0.72",
      fiber_g: "0",
      sugar_g: "0.37",
      saturated_fat_g: "3.13",
      sodium_mg: "142",
      water_ml: "76.2",
    },
  },
  apple: {
    fdcId: 171688,
    description: "Apples, raw, with skin (Includes foods for USDA's Food Distribution Program)",
    dataType: "SR Legacy",
    nutrient_values: {
      energy_kcal: "52",
      energy_kj: "218",
      protein_g: "0.26",
      fat_g: "0.17",
      carbohydrate_g: "13.8",
      fiber_g: "2.4",
      sugar_g: "10.4",
      saturated_fat_g: "0.028",
      sodium_mg: "1",
      water_ml: "85.6",
    },
  },
  banana: {
    fdcId: 173944,
    description: "Bananas, raw",
    dataType: "SR Legacy",
    nutrient_values: {
      energy_kcal: "89",
      energy_kj: "371",
      protein_g: "1.09",
      fat_g: "0.33",
      carbohydrate_g: "22.8",
      fiber_g: "2.6",
      sugar_g: "12.2",
      saturated_fat_g: "0.112",
      sodium_mg: "1",
      water_ml: "74.9",
    },
  },
  bread: {
    fdcId: 174924,
    description: "Bread, white, commercially prepared (includes soft bread crumbs)",
    dataType: "SR Legacy",
    nutrient_values: {
      energy_kcal: "266",
      energy_kj: "1110",
      protein_g: "8.85",
      fat_g: "3.33",
      carbohydrate_g: "49.4",
      fiber_g: "2.7",
      sugar_g: "5.67",
      saturated_fat_g: "0.698",
      sodium_mg: "490",
      water_ml: "36.4",
    },
  },
  rice: {
    fdcId: 168930,
    description: "Rice, white, medium-grain, cooked, unenriched",
    dataType: "SR Legacy",
    nutrient_values: {
      energy_kcal: "130",
      energy_kj: "544",
      protein_g: "2.38",
      fat_g: "0.21",
      carbohydrate_g: "28.6",
      fiber_g: null,
      sugar_g: null,
      saturated_fat_g: "0.057",
      sodium_mg: "0",
      water_ml: "68.6",
    },
  },
  chicken: {
    fdcId: 171477,
    description: "Chicken, broilers or fryers, breast, meat only, cooked, roasted",
    dataType: "SR Legacy",
    nutrient_values: {
      energy_kcal: "165",
      energy_kj: "690",
      protein_g: "31",
      fat_g: "3.57",
      carbohydrate_g: "0",
      fiber_g: "0",
      sugar_g: "0",
      saturated_fat_g: "1.01",
      sodium_mg: "74",
      water_ml: "65.3",
    },
  },
  coffee: {
    fdcId: 171890,
    description: "Beverages, coffee, brewed, prepared with tap water",
    dataType: "SR Legacy",
    nutrient_values: {
      energy_kcal: "1",
      energy_kj: "2",
      protein_g: "0.12",
      fat_g: "0.02",
      carbohydrate_g: "0",
      fiber_g: "0",
      sugar_g: "0",
      saturated_fat_g: "0.002",
      sodium_mg: "2",
      water_ml: "99.4",
    },
  },
  tea: {
    fdcId: 173227,
    description: "Beverages, tea, black, brewed, prepared with tap water",
    dataType: "SR Legacy",
    nutrient_values: {
      energy_kcal: "1",
      energy_kj: "4",
      protein_g: "0",
      fat_g: "0",
      carbohydrate_g: "0.3",
      fiber_g: "0",
      sugar_g: "0",
      saturated_fat_g: "0.002",
      sodium_mg: "3",
      water_ml: "99.7",
    },
  },
  soy_milk: {
    fdcId: 172446,
    description: "Soymilk, original and vanilla, unfortified",
    dataType: "SR Legacy",
    nutrient_values: {
      energy_kcal: "54",
      energy_kj: "226",
      protein_g: "3.27",
      fat_g: "1.75",
      carbohydrate_g: "6.28",
      fiber_g: "0.6",
      sugar_g: "3.99",
      saturated_fat_g: "0.205",
      sodium_mg: "51",
      water_ml: "88",
    },
  },
});

const CAPABILITY: Readonly<SourceCapability> = freezeNutritionData({
  source_id: "public.usda_fooddata_central_bundled",
  tier: "authoritative_public_database",
  rank: 4,
  backend_id: "fooddata-central-bundled",
  backend_version: BUNDLED_BACKEND_VERSION,
  network: false,
  request_fields: ["normalized_food_name", "minimum_food_category", "locale"],
});

const COMPLETE_FIELDS = ["energy_kcal", "protein_g", "fat_g", "carbohydrate_g", "fiber_g"] as const;

export class OfflineUsdaAdapter implements NutritionSourceAdapter {
  describe(): Readonly<SourceCapability> {
    return CAPABILITY;
  }

  async probe(_context: Readonly<SourceContext>): Promise<Readonly<SourceHealth>> {
    return freezeNutritionData({ source_id: CAPABILITY.source_id, status: "ok", reason: null });
  }

  async resolve(
    request: Readonly<SourceRequest>,
    _context: Readonly<SourceContext>,
  ): Promise<Readonly<SourceResolution>> {
    const record = BUNDLED_FOODS[request.normalized_food_name];
    if (record === undefined) {
      return freezeNutritionData({
        status: "no_results",
        source_id: CAPABILITY.source_id,
        tier: CAPABILITY.tier,
        source_record_id: null,
        source_version: null,
        retained_fields_sha256: null,
        evidence: null,
        reason: "no_match",
      });
    }
    const complete = COMPLETE_FIELDS.every((field) => record.nutrient_values[field] !== null);
    const retained = {
      data_type: record.dataType,
      description: record.description,
      fdc_id: record.fdcId,
      nutrient_values: record.nutrient_values,
      publication_date: BUNDLED_PUBLICATION_DATE,
    };
    const evidence: ResolvedNutritionEvidence = {
      source_id: CAPABILITY.source_id,
      source_type: "authoritative_public_database",
      source_ref: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${record.fdcId}/nutrients`,
      source_version: BUNDLED_PUBLICATION_DATE,
      basis_kind: "per_100g",
      basis_amount: "100",
      basis_unit: "g",
      nutrient_values: record.nutrient_values,
      field_evidence: [],
      coverage_status: complete ? "complete" : "partial",
      adopted_amount: null,
      adopted_unit: null,
      amount_range: null,
      formula: "profile_value * consumed_amount / basis_amount",
    };
    return freezeNutritionData({
      status: complete ? "ok" : "partial",
      source_id: CAPABILITY.source_id,
      tier: CAPABILITY.tier,
      source_record_id: `fdc:${record.fdcId}`,
      source_version: BUNDLED_PUBLICATION_DATE,
      retained_fields_sha256: canonicalSha256(retained),
      evidence,
      reason: null,
    });
  }
}
