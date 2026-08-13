import {
  cloneCaseExecutionInput,
  cloneDriverObservation,
} from "./runtime.ts";
import type { AcceptanceAdapter, BCaseDriver } from "./types.ts";

export function mapSharedKindToBStorage(kind: string): string {
  return kind === "nutritious_drink" ? "nutrition_drink" : kind;
}

export function createBAdapter(driver?: BCaseDriver): AcceptanceAdapter {
  return Object.freeze({
    adapter_id: "diet-manager/b-execution-adapter-v1",
    route: "B",
    async execute(input) {
      const frozenInput = cloneCaseExecutionInput(input);
      if (driver === undefined) {
        return Object.freeze({
          case_id: frozenInput.case_id,
          route: "B",
          execution_status: "not_executed",
          outcome_status: "not_applicable",
          reason_code: "backend_pending",
          business_writes: 0,
          observation: null,
        });
      }
      const driverObservation = cloneDriverObservation(await driver(frozenInput));
      return Object.freeze({
        case_id: frozenInput.case_id,
        route: "B",
        execution_status: "executed",
        outcome_status: driverObservation.outcome_status,
        reason_code: driverObservation.reason_code,
        business_writes: driverObservation.business_writes,
        observation: driverObservation.observation,
      });
    },
  });
}
