import { cloneCaseExecutionInput } from "./runtime.ts";
import type { AcceptanceAdapter } from "./types.ts";

export const aAdapter: AcceptanceAdapter = Object.freeze({
  adapter_id: "diet-manager/a-read-only-degradation-v1",
  route: "A",
  async execute(input) {
    const frozenInput = cloneCaseExecutionInput(input);
    return Object.freeze({
      case_id: frozenInput.case_id,
      route: "A",
      execution_status: "not_executed",
      outcome_status: "not_applicable",
      reason_code: "read_only_no_plugin",
      business_writes: 0,
      observation: null,
    });
  },
});
