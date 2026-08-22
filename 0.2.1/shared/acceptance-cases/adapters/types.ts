export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type RouteId = "A" | "B";
export type ExecutionStatus = "executed" | "not_executed";
export type OutcomeStatus = "not_applicable" | "succeeded" | "failed";

export interface ContractHash {
  readonly contract_id: string;
  readonly sha256: string;
}

export interface CaseExecutionInput {
  readonly case_id: string;
  readonly requirement_ids: readonly string[];
  readonly stage: string;
  readonly source_text: string;
  readonly setup: JsonValue;
  readonly contract_hashes: readonly ContractHash[];
}

export interface AdapterObservation {
  readonly case_id: string;
  readonly route: RouteId;
  readonly execution_status: ExecutionStatus;
  readonly outcome_status: OutcomeStatus;
  readonly reason_code: string | null;
  readonly business_writes: number;
  readonly observation: JsonValue;
}

export interface DriverObservation {
  readonly outcome_status: Exclude<OutcomeStatus, "not_applicable">;
  readonly reason_code: string | null;
  readonly business_writes: number;
  readonly observation: JsonValue;
}

export type BCaseDriver = (
  input: CaseExecutionInput,
) => DriverObservation | Promise<DriverObservation>;

export interface AcceptanceAdapter {
  readonly adapter_id: string;
  readonly route: RouteId;
  execute(input: CaseExecutionInput): Promise<AdapterObservation>;
}
