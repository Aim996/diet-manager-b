import { describe, expect, it } from "vitest";

import {
  computeGoalProgressBars,
  goalProgressBar,
  type ConfiguredGoals,
} from "../src/domain/goal-derivation.js";

// DEC-030 §17.6 进度条渲染规则（唯一权威）：percentage = round_half_up(current/target×100)、
// filled_cells = clamp(round_half_up(current/target×10), 0, 10)、bar_text = █×filled + ░×(10−filled)、
// 超出目标显示真实百分比（可 >100），进度条满格。
describe("DEC-030 §17.6 goal progress bar", () => {
  it("renders a half bar at 50%", () => {
    expect(goalProgressBar(500, 1000)).toEqual({
      current: 500,
      target: 1000,
      percentage: 50,
      filled_cells: 5,
      bar_text: "█████░░░░░",
    });
  });

  it("renders a full bar at 100%", () => {
    expect(goalProgressBar(1000, 1000)).toEqual({
      current: 1000,
      target: 1000,
      percentage: 100,
      filled_cells: 10,
      bar_text: "██████████",
    });
  });

  it("renders a full bar with a truthful percentage over 100%", () => {
    expect(goalProgressBar(1500, 1000)).toEqual({
      current: 1500,
      target: 1000,
      percentage: 150,
      filled_cells: 10,
      bar_text: "██████████",
    });
  });

  it("renders an empty bar at zero current", () => {
    expect(goalProgressBar(0, 1000)).toEqual({
      current: 0,
      target: 1000,
      percentage: 0,
      filled_cells: 0,
      bar_text: "░░░░░░░░░░",
    });
  });

  it("rounds a fractional ratio half-up to 15% and 2 cells", () => {
    expect(goalProgressBar(300, 2000)).toEqual({
      current: 300,
      target: 2000,
      percentage: 15,
      filled_cells: 2,
      bar_text: "██░░░░░░░░",
    });
  });

  it("rejects a negative or non-finite current and a non-positive target", () => {
    expect(() => goalProgressBar(-1, 1000)).toThrow("GOAL_DERIVATION_INVALID:progress_current");
    expect(() => goalProgressBar(Number.NaN, 1000)).toThrow("GOAL_DERIVATION_INVALID:progress_current");
    expect(() => goalProgressBar(100, 0)).toThrow("GOAL_DERIVATION_INVALID:progress_target");
    expect(() => goalProgressBar(100, -5)).toThrow("GOAL_DERIVATION_INVALID:progress_target");
  });
});

describe("DEC-030 §17.6 goal progress aggregation", () => {
  it("emits a bar only for configured dimensions", () => {
    const configured: ConfiguredGoals = {
      energy_kcal: 2000,
      protein_g: null,
      fat_g: null,
      carbohydrate_g: null,
      fiber_g: null,
      water_ml: 1000,
    };
    expect(computeGoalProgressBars(configured, {
      energy_kcal: 300,
      protein_g: 0,
      fat_g: 0,
      carbohydrate_g: 0,
      fiber_g: 0,
      water_ml: 500,
    })).toEqual({
      energy_kcal: { current: 300, target: 2000, percentage: 15, filled_cells: 2, bar_text: "██░░░░░░░░" },
      water_ml: { current: 500, target: 1000, percentage: 50, filled_cells: 5, bar_text: "█████░░░░░" },
    });
  });

  it("emits no bars when nothing is configured", () => {
    const configured: ConfiguredGoals = {
      energy_kcal: null,
      protein_g: null,
      fat_g: null,
      carbohydrate_g: null,
      fiber_g: null,
      water_ml: null,
    };
    expect(computeGoalProgressBars(configured, {
      energy_kcal: 300,
      protein_g: 0,
      fat_g: 0,
      carbohydrate_g: 0,
      fiber_g: 0,
      water_ml: 500,
    })).toEqual({});
  });
});
