import type { DatabaseSync } from "node:sqlite";

import type { DietDomainService } from "../domain/service.js";
import type { DomainEnvelopeInput, DomainOperation } from "../domain/types.js";
import type { CoreRuntime } from "./runtime.js";

interface Session {
  readonly database: DatabaseSync;
  readonly service: DietDomainService;
}

interface TerminalExecution {
  readonly status: "committed" | "committed_with_issues";
  readonly operation_id: string;
  readonly record_id: string;
}

const providers = new WeakMap<CoreRuntime, () => Session>();

export function registerCoreRuntime(runtime: CoreRuntime, provider: () => Session): void {
  if (providers.has(runtime)) throw new Error("CORE_RUNTIME_INVALID:registered");
  providers.set(runtime, provider);
}

function recordId(database: DatabaseSync, envelope: DomainEnvelopeInput, operation: DomainOperation): string {
  const rows = database.prepare(
    `SELECT event_id, event_type, fact_kind, operation_id
     FROM event_records WHERE envelope_id = ? AND operation_id = ?`,
  ).all(envelope.envelope_id, operation.operation_id) as Array<{
    event_id: string; event_type: string; fact_kind: string; operation_id: string;
  }>;
  const expected = operation.kind === "record_water"
    ? { event_type: "diet_water", fact_kind: "water" }
    : { event_type: "diet_meal", fact_kind: "meal" };
  if (
    rows.length !== 1 || rows[0]?.operation_id !== operation.operation_id ||
    rows[0]?.event_type !== expected.event_type || rows[0]?.fact_kind !== expected.fact_kind
  ) throw new Error("CORE_APPLICATION_RESULT_INVALID:event_identity");
  return rows[0].event_id;
}

export function executeCoreEnvelope(
  runtime: CoreRuntime,
  envelope: Readonly<DomainEnvelopeInput>,
): Readonly<TerminalExecution> {
  const provider = providers.get(runtime);
  if (provider === undefined) throw new Error("CORE_RUNTIME_INVALID:runtime");
  const session = provider();
  const preview = session.service.preview(envelope);
  const result = session.service.execute({ envelope, token: preview.token,
    input_digest: preview.input_digest, data_revision: preview.data_revision });
  const operation = envelope.operations[0];
  if (
    operation === undefined || result.items.length !== 1 ||
    result.items[0]?.operation_id !== operation.operation_id ||
    (result.items[0]?.status !== "committed" &&
      result.items[0]?.status !== "committed_with_issues")
  ) throw new Error("CORE_APPLICATION_RESULT_INVALID:terminal");
  return Object.freeze({ status: result.items[0].status,
    operation_id: operation.operation_id,
    record_id: recordId(session.database, envelope, operation) });
}
