import { describe, expect, it } from "vitest";

import {
  canonicalDecimalFromNumber,
  canonicalDecimalFromScaledInteger,
  roundHalfAwayFromZeroRatio,
} from "../../src/domain/decimal.js";
import {
  addProgressMetricStates,
  emptyProgressMetricState,
  freezeDateProgress,
  progressStateFromNutrients,
  ratioProgress,
} from "../../src/domain/progress.js";

const GOALS = {
  energy_kcal: 100,
  protein_g: 100,
  fat_g: 100,
  carbohydrate_g: 100,
  fiber_g: 100,
  water_ml: 100,
};

describe("Task 9 deterministic progress arithmetic", () => {
  it.each([
    [0n, 2n, 0],
    [1n, 2n, 1],
    [-1n, 2n, -1],
    [3n, 2n, 2],
    [-3n, 2n, -2],
    [5n, 2n, 3],
    [-5n, 2n, -3],
  ])("rounds %s/%s half away from zero", (numerator, denominator, expected) => {
    expect(roundHalfAwayFromZeroRatio(numerator, denominator)).toBe(expected);
  });

  it.each([
    ["0", "100", 0, 0, "░░░░░░░░░░"],
    ["5", "100", 5, 1, "█░░░░░░░░░"],
    ["100", "100", 100, 10, "██████████"],
    ["105", "100", 105, 10, "██████████"],
    ["0.5", "100", 1, 0, "░░░░░░░░░░"],
  ])("freezes %s/%s without binary floating-point rounding", (
    current,
    target,
    percentage,
    filledCells,
    barText,
  ) => {
    expect(ratioProgress(current, target)).toEqual({
      percentage,
      filled_cells: filledCells,
      bar_text: barText,
    });
  });

  it("rejects negative current and zero target", () => {
    expect(() => ratioProgress("-0.001", "100")).toThrow("PROGRESS_INVALID:current");
    expect(() => ratioProgress("1", "0")).toThrow("PROGRESS_INVALID:target");
  });

  it("converts canonical storage integers to natural units exactly", () => {
    expect(canonicalDecimalFromScaledInteger(5, 1_000)).toBe("0.005");
    expect(canonicalDecimalFromScaledInteger(1_050, 1_000)).toBe("1.05");
    expect(canonicalDecimalFromScaledInteger(2_500_000, 1_000)).toBe("2500");
  });

  it("expands every finite Number exponent form into the canonical decimal domain", () => {
    expect(canonicalDecimalFromNumber(1e-7)).toBe("0.0000001");
    expect(canonicalDecimalFromNumber(1e21)).toBe("1000000000000000000000");
    expect(canonicalDecimalFromNumber(1e308)).toBe(`1${"0".repeat(308)}`);
    expect(ratioProgress("1", canonicalDecimalFromNumber(1e308))).toMatchObject({
      percentage: 0,
      filled_cells: 0,
    });
  });

  it("freezes six ordered metrics, unknown values, lower bounds and sub-one-percent increments", () => {
    const current = emptyProgressMetricState();
    current.energy_kcal = { known_milli: 105_000, unknown_sources: [] };
    current.fiber_g = { known_milli: 0, unknown_sources: ["nutrition:item:fiber"] };
    current.water_ml = { known_milli: 20_000, unknown_sources: ["nutrition:drink:water"] };
    const increment = emptyProgressMetricState();
    increment.energy_kcal = { known_milli: 500, unknown_sources: [] };
    increment.water_ml = { known_milli: 5_000, unknown_sources: ["nutrition:drink:water"] };

    const frozen = freezeDateProgress({
      date: "2026-08-21",
      timezone: "Asia/Shanghai",
      goal_version_id: "goal-version-1",
      goals: GOALS,
      current,
      increment,
      generated_at: "2026-08-21T04:00:00.000Z",
      idempotency_key: "idempotency-progress-1",
    });

    expect(frozen.metrics.map((metric) => [metric.key, metric.display_name])).toEqual([
      ["energy_kcal", "热量"],
      ["protein_g", "蛋白"],
      ["fat_g", "脂肪"],
      ["carbohydrate_g", "碳水"],
      ["fiber_g", "纤维"],
      ["water_ml", "饮水"],
    ]);
    expect(frozen.metrics[0]).toMatchObject({
      current: { kind: "exact", value: "105" },
      percent: 105,
      filled_cells: 10,
      bar_text: "██████████",
      delta: { kind: "exact", value: "0.5" },
      increment_percent: 1,
      coverage_status: "known",
    });
    expect(frozen.metrics[4]).toMatchObject({
      current: { kind: "unknown" },
      percent: null,
      filled_cells: null,
      bar_text: null,
      coverage_status: "unknown",
    });
    expect(frozen.metrics[5]).toMatchObject({
      current: { kind: "lower_bound", value: "20" },
      percent: 20,
      filled_cells: 2,
      bar_text: "██░░░░░░░░",
      delta: { kind: "lower_bound", value: "5" },
      increment_percent: 5,
      coverage_status: "known_min",
    });

    increment.energy_kcal = { known_milli: 499, unknown_sources: [] };
    const subOnePercent = freezeDateProgress({
      date: "2026-08-21",
      timezone: "Asia/Shanghai",
      goal_version_id: "goal-version-1",
      goals: GOALS,
      current,
      increment,
      generated_at: "2026-08-21T04:00:00.001Z",
      idempotency_key: "idempotency-progress-sub-one-2",
    });
    expect(subOnePercent.metrics[0]).toMatchObject({
      delta: { kind: "exact", value: "0.499" },
      increment_percent: 0,
      increment_percent_text: "+<1%",
    });
  });

  it.each([
    [999, 1, "+<1%"],
    [1_000, 1, "+1%"],
    [1_001, 1, "+1%"],
  ])("freezes the authoritative increment display token for %s milli", (
    knownMilli,
    incrementPercent,
    incrementPercentText,
  ) => {
    const increment = emptyProgressMetricState();
    increment.energy_kcal = { known_milli: knownMilli, unknown_sources: [] };
    const frozen = freezeDateProgress({
      date: "2026-08-21",
      timezone: "Asia/Shanghai",
      goal_version_id: "goal-version-1",
      goals: GOALS,
      current: increment,
      increment,
      generated_at: "2026-08-21T04:00:00.002Z",
      idempotency_key: `idempotency-progress-increment-${knownMilli}`,
    });
    expect(frozen.metrics[0]).toMatchObject({
      increment_percent: incrementPercent,
      increment_percent_text: incrementPercentText,
    });
  });

  it("keeps an exact unknown count while bounding the public source diagnostics", () => {
    let state = emptyProgressMetricState();
    for (let index = 0; index < 65; index += 1) {
      state = addProgressMetricStates(state, progressStateFromNutrients({
        energy_kcal_milli: null,
        protein_mg: 0,
        fat_mg: 0,
        carbohydrate_mg: 0,
        fiber_mg: 0,
        water_ml_milli: 0,
      }, `unknown-item-${index}`));
    }
    const frozen = freezeDateProgress({
      date: "2026-08-21",
      timezone: "Asia/Shanghai",
      goal_version_id: "goal-version-1",
      goals: GOALS,
      current: state,
      increment: state,
      generated_at: "2026-08-21T04:00:00.003Z",
      idempotency_key: "idempotency-progress-unknown-65",
    });
    expect(frozen.metrics[0]).toMatchObject({
      current: { kind: "unknown" },
      unknown_source_count: 65,
    });
    expect(frozen.metrics[0].unknown_sources).toHaveLength(64);
  });
});
