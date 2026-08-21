import { describe, expect, it } from "vitest";

import { deriveGoalRecommendation } from "../../src/domain/goal-recommendation.js";

describe("Task 8 goal recommendations", () => {
  it("creates six pending recommendations from a complete profile", () => {
    expect(deriveGoalRecommendation({
      height_cm: 180,
      weight_kg: 70,
      sex: "male",
      age: 30,
      goal_state: "cut",
    })).toEqual({
      status: "pending",
      goals: {
        energy_kcal: 1714,
        protein_g: 140,
        fat_g: 70,
        carbohydrate_g: 131,
        fiber_g: 24,
        water_ml: 2450,
      },
      basis: {
        authority_kind: "diet-manager/goal-recommendation-basis/v1",
        formula_version: "diet-manager/goal-recommendation-v1",
        profile: {
          height_cm: 180,
          weight_kg: 70,
          sex: "male",
          age: 30,
          goal_state: "cut",
        },
        unavailable_reasons: {},
      },
    });
  });

  it("keeps the five required slots and explains unavailable values without inventing defaults", () => {
    const recommendation = deriveGoalRecommendation({
      height_cm: 175,
      weight_kg: 68,
      sex: null,
      age: null,
      goal_state: null,
    });

    expect(Object.keys(recommendation.goals)).toEqual([
      "energy_kcal",
      "protein_g",
      "fat_g",
      "carbohydrate_g",
      "fiber_g",
    ]);
    expect(recommendation.goals).toEqual({
      energy_kcal: null,
      protein_g: null,
      fat_g: 68,
      carbohydrate_g: null,
      fiber_g: null,
    });
    expect(recommendation.basis.unavailable_reasons).toEqual({
      energy_kcal: "missing_age_sex_goal_state",
      protein_g: "missing_goal_state",
      carbohydrate_g: "energy_recommendation_unavailable",
      fiber_g: "energy_recommendation_unavailable",
      water_ml: "profile_information_insufficient",
    });
    expect(recommendation.goals).not.toHaveProperty("water_ml");
  });
});
