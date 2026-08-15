import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import casesCatalog from "../../../shared/acceptance-cases/cases.json";
import fixturesCatalog from "../../../shared/acceptance-cases/fixtures/core-v1.json";
import { handleCoreRequest } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { canonicalJson, canonicalSha256 } from "../../src/authority/canonical-json.js";
import { assertDietManagerOutcome, type CoreApplicationRequest, type DietManagerAction } from "../../src/contracts.js";
import { createDietDomainService } from "../../src/domain/service.js";
import { digestDomainEnvelope } from "../../src/domain/identity.js";
import type { DomainEnvelopeInput } from "../../src/domain/types.js";
import { parseCoreCommand } from "../../src/parser/parse-command.js";
import { listMealProjection } from "../../src/repository/query.js";
import {
  authenticateStoredPreviewAuthority,
  createServerPreview,
  reuseServerPreview,
  type ReuseServerPreviewInput,
} from "../../src/preview/store.js";
import {
  DIET_DATABASE_FILENAME,
  openDietDatabase,
} from "../../src/storage/database.js";

const nodeSecret = Buffer.from("SEL-CORE-001 Task 8 nullable amount", "utf8");
const APPLICATION_SECRET_FILENAME = ".diet-manager-b.authority-secret";

const POWERSHELL_EXE = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const ACL_AUDIT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath $env:DIET_SECRET_PATH
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
  [pscustomobject]@{ sid = $_.IdentityReference.Value; type = $_.AccessControlType.ToString(); rights = [int]$_.FileSystemRights; inherited = $_.IsInherited }
})
[pscustomobject]@{ owner = $owner; current = $current; protected = $acl.AreAccessRulesProtected; rules = $rules } | ConvertTo-Json -Compress -Depth 4
`;
const ACL_SET_EXACT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetOwner($current)
$acl.SetAccessRuleProtection($true, $false)
foreach ($value in @($current.Value, 'S-1-5-18', 'S-1-5-32-544')) {
  $sid = New-Object System.Security.Principal.SecurityIdentifier($value)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
  [void]$acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $env:DIET_SECRET_PATH -AclObject $acl
`;

function powershell(script: string, path: string): string {
  const result = spawnSync(POWERSHELL_EXE, ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, DIET_SECRET_PATH: path },
  });
  if (result.status !== 0) throw new Error(`PowerShell failed ${result.status}: ${result.stderr}`);
  return result.stdout.trim();
}

function auditAcl(path: string): {
  owner: string; current: string; protected: boolean;
  rules: Array<{ sid: string; type: string; rights: number; inherited: boolean }>;
} {
  return JSON.parse(powershell(ACL_AUDIT_SCRIPT, path));
}


function ordinaryClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function catalogInput(id: string) {
  const catalogCase = casesCatalog.cases.find((entry) => entry.id === id);
  if (catalogCase === undefined) throw new Error(`missing catalog case ${id}`);
  const environment = fixturesCatalog.environments.find(
    (entry) => entry.fixture_id === catalogCase.setup.environment_fixture,
  );
  if (environment === undefined) throw new Error(`missing environment for ${id}`);
  return {
    source_text: catalogCase.source_text,
    received_at: environment.clock,
    timezone: environment.timezone,
    operation_id: `operation-${id.toLowerCase()}`,
    source_message_id: `message-${id.toLowerCase()}`,
    conversation_id: "conversation-core-v1",
    prior_context: catalogCase.setup.prior_context,
  };
}

function catalogMealEnvelope(id: string): DomainEnvelopeInput {
  const input = catalogInput(id);
  const parsed = parseCoreCommand(input);
  if (
    parsed.disposition !== "candidate" ||
    parsed.command.action !== "record_meal" ||
    parsed.command.occurred_time.resolved_start === null
  ) throw new Error(`${id} did not parse as an executable meal`);
  const command = parsed.command;
  return {
    envelope_id: `envelope-${id.toLowerCase()}`,
    idempotency_key: `idempotency-${id.toLowerCase()}`,
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: input.source_message_id,
    conversation_id: input.conversation_id,
    received_at: new Date(input.received_at).toISOString(),
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "record_meal",
      operation_id: command.operation_id,
      occurred_at: new Date(command.occurred_time.resolved_start).toISOString(),
      meal_slot: "unknown",
      location: "home",
      items: command.items.map((item) => ({
        normalized_name: item.normalized_name,
        item_type: item.kind === "food" ? "food" : "nutrition_drink",
        amount: {
          unit: item.unit ?? "unknown",
          observed_microunits: item.quantity === null
            ? null
            : item.quantity * 1_000_000,
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          template_reference_microunits: null,
          evidence: item.quantity === null
            ? "unknown"
            : item.estimated === false
              ? "explicit"
              : "estimated_upper_bound",
        },
        nutrition_sources: [],
      })),
      source_text: command.source_text,
      occurred_time: ordinaryClone(command.occurred_time),
      subject: ordinaryClone(command.subject),
      ...(command.context === undefined
        ? {}
        : { context: ordinaryClone(command.context) }),
    }],
  } as unknown as DomainEnvelopeInput;
}

function businessSnapshot(database: ReturnType<typeof openDietDatabase>["database"]): string {
  const tables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;
  return canonicalJson(Object.fromEntries(tables.map(({ name }) => [
    name,
    database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ])));
}

function allNullNutrition() {
  return {
    energy_kcal_milli: null,
    protein_mg: null,
    fat_mg: null,
    carbohydrate_mg: null,
    fiber_mg: null,
    water_ml_milli: null,
  };
}

function applicationRequest(id: string, action: "record_meal" | "record_water" | "add_inventory") {
  return { action, ...catalogInput(id) };
}

function storedBusinessSnapshot(root: string): string {
  const runtime = openDietDatabase({ privateRuntimeRoot: root });
  try {
    return businessSnapshot(runtime.database);
  } finally {
    runtime.close();
  }
}

function catalogWaterEnvelope(id: string): DomainEnvelopeInput {
  const input = catalogInput(id);
  const parsed = parseCoreCommand(input);
  if (parsed.disposition !== "candidate" || parsed.command.action !== "record_water") {
    throw new Error(`${id} did not parse as executable water`);
  }
  return {
    envelope_id: `envelope-${id.toLowerCase()}`,
    idempotency_key: `idempotency-${id.toLowerCase()}`,
    command_type: "record_water",
    subject_scope: "user:self",
    source_message_id: input.source_message_id,
    conversation_id: input.conversation_id,
    received_at: new Date(input.received_at).toISOString(),
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "record_water",
      operation_id: parsed.command.operation_id,
      occurred_time: ordinaryClone(parsed.command.occurred_time),
      source_text: parsed.command.source_text,
      plain_water_ml_milli: parsed.command.plain_water_ml_milli,
      amount_evidence: ordinaryClone(parsed.command.amount_evidence),
    }],
  };
}

function storedPreviewMaterial(
  database: ReturnType<typeof openDietDatabase>["database"],
  envelope: DomainEnvelopeInput,
): unknown {
  const row = database.prepare(
    "SELECT payload_json FROM command_envelopes WHERE envelope_id = ?",
  ).get(envelope.envelope_id) as { payload_json: string };
  const stored = authenticateStoredPreviewAuthority(row.payload_json, nodeSecret);
  if (stored.preview_authority_kind === "diet-manager/server-preview/v1") {
    return { authority_kind: "diet-manager/domain-preview/v1", envelope };
  }
  if (stored.preview_authority_kind === "diet-manager/server-preview/v2") {
    return {
      authority_kind: "diet-manager/domain-preview/v2",
      input_digest: stored.meal_fact_preview_material!.input_digest,
      meal_fact_identities: stored.meal_fact_preview_material!.meal_fact_identities,
    };
  }
  return {
    authority_kind: "diet-manager/domain-preview/v3",
    input_digest: stored.water_fact_preview_material!.input_digest,
    meal_fact_identities: stored.water_fact_preview_material!.meal_fact_identities,
    water_fact_identities: stored.water_fact_preview_material!.water_fact_identities,
  };
}

function reuseInput(
  database: ReturnType<typeof openDietDatabase>["database"],
  envelope: DomainEnvelopeInput,
): ReuseServerPreviewInput {
  return {
    database,
    secret: nodeSecret,
    previewId: envelope.envelope_id,
    idempotencyKey: envelope.idempotency_key,
    inputDigest: digestDomainEnvelope(envelope),
    subjectScope: envelope.subject_scope,
    commandType: envelope.command_type,
    sourceMessageId: envelope.source_message_id,
    conversationId: envelope.conversation_id,
    previewMaterial: storedPreviewMaterial(database, envelope),
  };
}

function purchaseEnvelope(suffix: string): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-task8-purchase-${suffix}`,
    idempotency_key: `idempotency-task8-purchase-${suffix}`,
    command_type: "add_inventory",
    subject_scope: "user:self",
    source_message_id: `message-task8-purchase-${suffix}`,
    conversation_id: "conversation-task8-purchase",
    received_at: "2026-08-11T00:30:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "add_inventory",
      operation_id: `operation-task8-purchase-${suffix}`,
      product: {
        product_id: "product-task8-milk",
        normalized_name: "milk",
        product_type: "nutrition_drink",
      },
      batch_id: `batch-task8-purchase-${suffix}`,
      amount: {
        unit: "carton",
        observed_microunits: 24_000_000,
        nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null,
        template_reference_microunits: 12_000_000,
        evidence: "explicit",
      },
      nutrition_sources: [],
    }],
  };
}

function correctionForUnknown(
  kind: "correct_record" | "undo_record",
  targetEventId: string,
): DomainEnvelopeInput {
  const common = {
    operation_id: `operation-task8-${kind}`,
    target_event_id: targetEventId,
    base_revision: 1,
  };
  return {
    envelope_id: `envelope-task8-${kind}`,
    idempotency_key: `idempotency-task8-${kind}`,
    command_type: kind,
    subject_scope: "user:self",
    source_message_id: `message-task8-${kind}`,
    conversation_id: "conversation-task8-correction",
    received_at: "2026-08-11T00:31:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [kind === "correct_record" ? {
      kind,
      ...common,
      item_order: 0,
      replacement_amount: {
        unit: "plate",
        observed_microunits: 1_000_000,
        nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null,
        template_reference_microunits: null,
        evidence: "explicit",
      },
    } : { kind, ...common }],
  };
}

describe("SEL-CORE Task 8 nullable meal authority", () => {
  it("commits the actual CASE-MEAL-019 parser fact without inventing an amount", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = catalogMealEnvelope("CASE-MEAL-019");
      const service = createDietDomainService({
        database: runtime.database,
        secret: nodeSecret,
        now: () => "2026-08-11T00:30:01.000Z",
      });

      const preview = service.preview(envelope);
      const result = service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });

      expect(result.status).toBe("committed_with_issues");
      expect(runtime.database.prepare(
        "SELECT payload_json FROM meal_items ORDER BY item_order",
      ).all()).toEqual([{
        payload_json: expect.stringContaining('"observed_microunits":null'),
      }]);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it.each([
    ["CASE-MEAL-019", 1],
    ["CASE-MEAL-020", 1],
    ["CASE-WATER-004", 4],
  ] as const)(
    "preserves every actual %s unknown amount through fact, effects, receipt, replay and query",
    (id, itemCount) => {
      const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
      const runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const envelope = catalogMealEnvelope(id);
        const operation = envelope.operations[0];
        if (operation?.kind !== "record_meal") throw new Error("expected meal operation");
        const service = createDietDomainService({
          database: runtime.database,
          secret: nodeSecret,
          now: () => "2026-08-11T00:30:01.000Z",
        });
        const preview = service.preview(envelope);
        const input = {
          envelope,
          token: preview.token,
          input_digest: preview.input_digest,
          data_revision: preview.data_revision,
        };
        const first = service.execute(input);

        expect(first.status).toBe("committed_with_issues");
        expect(first.items).toEqual([expect.objectContaining({
          status: "committed_with_issues",
          meal_items: operation.items.map((item, item_order) => expect.objectContaining({
            item_order,
            normalized_name: item.normalized_name,
            unit: "unknown",
            observed_microunits: null,
            amount_evidence: "unknown",
            nutrition_adoption_microunits: null,
            inventory_deduction_microunits: null,
            inventory_match: "skipped_amount_unknown",
            issue_codes: ["inventory_amount_unknown"],
            nutrients: allNullNutrition(),
          })),
          daily_progress: expect.objectContaining({
            coverage_status: "partial",
            nutrients: allNullNutrition(),
          }),
        })]);
        const itemRows = runtime.database.prepare(
          "SELECT item_order, payload_json FROM meal_items ORDER BY item_order",
        ).all() as Array<{ item_order: number; payload_json: string }>;
        expect(itemRows).toHaveLength(itemCount);
        expect(itemRows.map(({ payload_json }) => JSON.parse(payload_json))).toEqual(
          operation.items.map((item) => ({
            amount: {
              evidence: "unknown",
              inventory_deduction_microunits: null,
              nutrition_adoption_microunits: null,
              observed_microunits: null,
              template_reference_microunits: null,
              unit: "unknown",
            },
            authority_kind: "diet-manager/meal-item/v1",
            nutrition_sources: [],
          })),
        );
        const eventPayload = JSON.parse((runtime.database.prepare(
          "SELECT payload_json FROM event_records",
        ).get() as { payload_json: string }).payload_json);
        expect(eventPayload).toMatchObject({
          authority_kind: "diet-manager/meal-fact/v1",
          source_text: operation.source_text,
          occurred_time: operation.occurred_time,
          subject: operation.subject,
          location: "home",
          timezone: "Asia/Shanghai",
        });
        if (operation.context !== undefined) {
          expect(eventPayload.context).toEqual(operation.context);
        }
        expect(runtime.database.prepare(
          "SELECT issue_code FROM issues ORDER BY issue_id",
        ).all()).toEqual(Array.from({ length: itemCount }, () => ({
          issue_code: "inventory_amount_unknown",
        })));
        expect(runtime.database.prepare(
          "SELECT COUNT(*) AS count FROM inventory_transactions",
        ).get()).toEqual({ count: 0 });
        expect(JSON.parse((runtime.database.prepare(
          "SELECT payload_json FROM daily_progress_snapshots",
        ).get() as { payload_json: string }).payload_json)).toMatchObject({
          coverage_status: "partial",
          nutrients: allNullNutrition(),
        });
        const receipt = (first.payload as { receipt_data: { blocks: unknown[] } }).receipt_data;
        expect(receipt.blocks.filter((block): block is {
          kind: string;
          amount: unknown;
        } => typeof block === "object" && block !== null &&
          (block as { kind?: unknown }).kind === "item").map((block) => block.amount))
          .toEqual(Array.from({ length: itemCount }, () => ({
            evidence: "unknown",
            observed_microunits: null,
            unit: "unknown",
          })));

        const beforeReplay = businessSnapshot(runtime.database);
        const replay = service.execute(input);
        expect(replay).toEqual(first);
        expect(businessSnapshot(runtime.database)).toBe(beforeReplay);

        const date = operation.occurred_at.slice(0, 10);
        const query = listMealProjection({
          database: runtime.database,
          authoritySecret: nodeSecret,
          date,
          timezone: "Asia/Shanghai",
        });
        expect(query).toEqual([expect.objectContaining({
          occurred_at: operation.occurred_at,
          items: operation.items.map((item, item_order) => ({
            item_order,
            item_type: item.item_type,
            normalized_name: item.normalized_name,
            amount: item.amount,
          })),
        })]);
        expect(businessSnapshot(runtime.database)).toBe(beforeReplay);
      } finally {
        runtime.close();
        rmSync(root, { recursive: true, force: false });
      }
    },
  );

  it("keeps the known CASE-MEAL-021 preview, fact and result canonical bytes frozen", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
    const runtime = openDietDatabase({
      privateRuntimeRoot: root,
      now: () => "2026-08-11T00:30:00.000Z",
    });
    try {
      const envelope = catalogMealEnvelope("CASE-MEAL-021");
      const service = createDietDomainService({
        database: runtime.database,
        secret: nodeSecret,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      const preview = service.preview(envelope);
      const result = service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      const factBytes = (runtime.database.prepare(
        `SELECT e.payload_json AS event_payload_json, i.payload_json AS item_payload_json
         FROM event_records e JOIN meal_items i ON i.event_id = e.event_id`,
      ).get() as { event_payload_json: string; item_payload_json: string });

      expect({
        preview: canonicalSha256(preview),
        fact: canonicalSha256(factBytes),
        result: canonicalSha256(result),
      }).toEqual({
        preview: "B5B05B42125FBA459BD65DD0B830FC0C2E85CAFDE6DFB7640EDC0C0384FAC6D6",
        fact: "97B92A38E73341B82E51726BF82E3AC40670DEB02C0EB4A56ABD87652B3396A3",
        result: "26DDFD7260A4D89FCEC971F3B1124E9DB656910B70DE37EE5F9DF28BCE574330",
      });
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it.each([
    [{
      observed_microunits: null,
      nutrition_adoption_microunits: 1,
      inventory_deduction_microunits: null,
      template_reference_microunits: null,
      evidence: "unknown",
    }, "nutrition_adoption_microunits"],
    [{
      observed_microunits: null,
      nutrition_adoption_microunits: null,
      inventory_deduction_microunits: null,
      template_reference_microunits: null,
      evidence: "explicit",
    }, "evidence"],
    [{
      observed_microunits: 1,
      nutrition_adoption_microunits: null,
      inventory_deduction_microunits: null,
      template_reference_microunits: null,
      evidence: "unknown",
    }, "evidence"],
  ] as const)("rejects injected invalid nullable amount %s before business writes", (amount, field) => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = ordinaryClone(catalogMealEnvelope("CASE-MEAL-019"));
      const operation = envelope.operations[0];
      if (operation?.kind !== "record_meal") throw new Error("expected meal operation");
      Object.assign(operation.items[0]!.amount, amount);
      const service = createDietDomainService({
        database: runtime.database,
        secret: nodeSecret,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      expect(() => service.preview(envelope)).toThrow(
        `DIET_DOMAIN_REQUEST_INVALID:envelope.operations.0.items.0.amount.${field}`,
      );
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM command_envelopes",
      ).get()).toEqual({ count: 0 });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM event_records",
      ).get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("keeps correction replacement amounts known-only before business writes", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = ordinaryClone(catalogMealEnvelope("CASE-MEAL-019"));
      envelope.command_type = "correct_record";
      envelope.operations = [{
        kind: "correct_record",
        operation_id: "operation-null-correction",
        target_event_id: "event-null-correction-target",
        base_revision: 0,
        item_order: 0,
        replacement_amount: {
          unit: "unknown",
          observed_microunits: null,
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          template_reference_microunits: null,
          evidence: "unknown",
        },
      } as never];
      const service = createDietDomainService({
        database: runtime.database,
        secret: nodeSecret,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      expect(() => service.preview(envelope)).toThrow(
        "DIET_DOMAIN_REQUEST_INVALID:envelope.operations.0.replacement_amount.observed_microunits",
      );
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM command_envelopes",
      ).get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });
});

describe("SEL-CORE Task 8 unknown-operation boundaries", () => {
  it("rejects a nullable add_inventory amount at the known-only boundary with trap-zero and zero writes", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      let getterCount = 0;
      const envelope = purchaseEnvelope("null");
      const operation = envelope.operations[0];
      if (operation?.kind !== "add_inventory") throw new Error("expected purchase");
      const amount = {
        unit: "unknown",
        observed_microunits: null,
        nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null,
        template_reference_microunits: null,
        evidence: "unknown",
      };
      (operation as unknown as { amount: unknown }).amount = amount;
      const service = createDietDomainService({
        database: runtime.database,
        secret: nodeSecret,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      const before = businessSnapshot(runtime.database);
      expect(() => service.preview(envelope)).toThrow(
        "DIET_DOMAIN_REQUEST_INVALID:envelope.operations.0.amount.observed_microunits",
      );
      const accessorEnvelope = purchaseEnvelope("accessor");
      const accessorOperation = accessorEnvelope.operations[0] as unknown as Record<string, unknown>;
      Object.defineProperty(accessorOperation, "amount", {
        enumerable: true,
        get() { getterCount += 1; return amount; },
      });
      expect(() => service.preview(accessorEnvelope)).toThrow(
        "DIET_DOMAIN_REQUEST_INVALID:envelope_operations_0_descriptor",
      );
      expect(getterCount).toBe(0);
      expect(businessSnapshot(runtime.database)).toBe(before);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("keeps the known add_inventory preview canonical bytes unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
    const runtime = openDietDatabase({
      privateRuntimeRoot: root,
      now: () => "2026-08-11T00:30:00.000Z",
    });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret: nodeSecret,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      expect(canonicalSha256(service.preview(purchaseEnvelope("known")))).toBe(
        "F3758F415EA788C0E5B48B4E20346F324CC7C73B953D1FD7AF946EFCEA6E7F1B",
      );
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it.each(["correct_record", "undo_record"] as const)(
    "defers %s of an unknown meal before correction facts or effects",
    (kind) => {
      const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
      const runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const mealEnvelope = catalogMealEnvelope("CASE-MEAL-019");
        const service = createDietDomainService({
          database: runtime.database,
          secret: nodeSecret,
          now: () => "2026-08-11T00:30:01.000Z",
        });
        const mealPreview = service.preview(mealEnvelope);
        service.execute({
          envelope: mealEnvelope,
          token: mealPreview.token,
          input_digest: mealPreview.input_digest,
          data_revision: mealPreview.data_revision,
        });
        const event = runtime.database.prepare(
          "SELECT event_id FROM event_records WHERE event_type = 'diet_meal'",
        ).get() as { event_id: string };
        const envelope = correctionForUnknown(kind, event.event_id);
        const preview = service.preview(envelope);
        const beforeExecute = businessSnapshot(runtime.database);
        expect(() => service.execute({
          envelope,
          token: preview.token,
          input_digest: preview.input_digest,
          data_revision: preview.data_revision,
        })).toThrow("DIET_DOMAIN_REQUEST_INVALID:unknown_target_amount");
        expect(businessSnapshot(runtime.database)).toBe(beforeExecute);
        expect(runtime.database.prepare(
          "SELECT COUNT(*) AS count FROM correction_events",
        ).get()).toEqual({ count: 0 });
        expect(runtime.database.prepare(
          "SELECT COUNT(*) AS count FROM event_records WHERE event_type IN ('diet_correction', 'diet_undo')",
        ).get()).toEqual({ count: 0 });
        expect(runtime.database.prepare(
          "SELECT COUNT(*) AS count FROM effect_bundle_commits WHERE operation_id = ?",
        ).get(envelope.operations[0]!.operation_id)).toEqual({ count: 0 });
      } finally {
        runtime.close();
        rmSync(root, { recursive: true, force: false });
      }
    },
  );

  it("recovers an effects-stable outside unknown meal with the exact initial amount-unknown result", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = ordinaryClone(catalogMealEnvelope("CASE-MEAL-019"));
      const operation = envelope.operations[0];
      if (operation?.kind !== "record_meal") throw new Error("expected meal");
      operation.location = "outside";
      const faulting = createDietDomainService({
        database: runtime.database,
        secret: nodeSecret,
        now: () => "2026-08-11T00:30:01.000Z",
        fault: "after_finalization_row",
      });
      const preview = faulting.preview(envelope);
      const input = {
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      };
      expect(() => faulting.execute(input)).toThrow(
        "ENVELOPE_FINALIZE_FAILED:after_finalization_row",
      );
      expect(runtime.database.prepare(
        "SELECT state FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({ state: "effects_stable" });

      const recovered = createDietDomainService({
        database: runtime.database,
        secret: nodeSecret,
        now: () => "2026-08-11T00:30:02.000Z",
      });
      const result = recovered.execute(input);
      expect(result).toMatchObject({
        status: "committed_with_issues",
        items: [{
          status: "committed_with_issues",
          inventory_match: "skipped_amount_unknown",
          issue_codes: ["inventory_amount_unknown"],
          meal_items: [{
            observed_microunits: null,
            amount_evidence: "unknown",
            inventory_match: "skipped_amount_unknown",
            issue_codes: ["inventory_amount_unknown"],
          }],
        }],
      });
      const beforeReplay = businessSnapshot(runtime.database);
      expect(recovered.execute(input)).toEqual(result);
      expect(businessSnapshot(runtime.database)).toBe(beforeReplay);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });
});

describe("SEL-CORE Task 8 runtime root and secret authority", () => {
  it("proves the fixed PowerShell and .NET exact secret ACL contract is feasible", () => {
    if (process.platform !== "win32") return;
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-acl-${randomUUID()}-`));
    try {
      const path = join(root, "probe");
      writeFileSync(path, Buffer.alloc(32), { flag: "wx", mode: 0o600 });
      powershell(ACL_SET_EXACT_SCRIPT, path);
      const audit = auditAcl(path);
      expect(audit.owner).toBe(audit.current);
      expect(audit.protected).toBe(true);
      expect(audit.rules.map((rule) => ({ ...rule })).sort((a, b) => a.sid.localeCompare(b.sid)))
        .toEqual([audit.current, "S-1-5-18", "S-1-5-32-544"].sort().map((sid) => ({
          sid, type: "Allow", rights: 2_032_127, inherited: false,
        })));
    } finally {
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("creates a final secret with the exact protected Windows ACL", () => {
    if (process.platform !== "win32") return;
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-acl-${randomUUID()}-`));
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    try {
      expect(handleCoreRequest(runtime,
        applicationRequest("CASE-MEAL-021", "record_meal")).committed).toBe(true);
      const audit = auditAcl(join(root, APPLICATION_SECRET_FILENAME));
      expect(audit.owner).toBe(audit.current);
      expect(audit.protected).toBe(true);
      expect(audit.rules.map(({ sid, type, rights, inherited }) => ({ sid, type, rights, inherited }))
        .sort((a, b) => a.sid.localeCompare(b.sid))).toEqual(
          [audit.current, "S-1-5-18", "S-1-5-32-544"].sort().map((sid) => ({
            sid, type: "Allow", rights: 2_032_127, inherited: false,
          })),
        );
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("rejects an existing Windows secret granting Everyone read before database use", () => {
    if (process.platform !== "win32") return;
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-acl-${randomUUID()}-`));
    try {
      const path = join(root, APPLICATION_SECRET_FILENAME);
      writeFileSync(path, Buffer.alloc(32), { flag: "wx", mode: 0o600 });
      powershell(String.raw`
$ErrorActionPreference = 'Stop'
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetOwner($current)
$acl.SetAccessRuleProtection($true, $false)
foreach ($spec in @(@($current.Value, 'FullControl'), @('S-1-5-18', 'FullControl'), @('S-1-5-32-544', 'FullControl'), @('S-1-1-0', 'Read'))) {
  $sid = New-Object System.Security.Principal.SecurityIdentifier($spec[0])
  $rights = [System.Security.AccessControl.FileSystemRights]::$($spec[1])
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, $rights, [System.Security.AccessControl.AccessControlType]::Allow)
  [void]$acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $env:DIET_SECRET_PATH -AclObject $acl
`, path);
      const runtime = createCoreRuntime({ officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z" });
      try {
        expect(handleCoreRequest(runtime,
          applicationRequest("CASE-MEAL-021", "record_meal"))).toMatchObject({
            status: "failed", committed: false, error_code: "CORE_RUNTIME_SECRET_INVALID",
          });
        expect(existsSync(join(root, DIET_DATABASE_FILENAME))).toBe(false);
      } finally {
        runtime.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: false });
    }
  });

  it.each([
    ["v1", () => purchaseEnvelope("finalized-preview-v1")],
    ["v2", () => catalogMealEnvelope("CASE-MEAL-021")],
    ["v3", () => catalogWaterEnvelope("CASE-WATER-001")],
  ] as const)("reuses the exact finalized %s service preview without weakening repository authority", (_kind, envelopeFactory) => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-runtime-${randomUUID()}-`));
    const databaseRuntime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = envelopeFactory();
      const service = createDietDomainService({
        database: databaseRuntime.database,
        secret: nodeSecret,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      const preview = service.preview(envelope);
      expect(service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      }).status).toMatch(/^committed(?:_with_issues)?$/);
      const before = businessSnapshot(databaseRuntime.database);

      expect(service.preview(envelope)).toEqual({ ...preview, reused: true });
      const retryInput = reuseInput(databaseRuntime.database, envelope);
      expect(createServerPreview({
        ...retryInput,
        dataRevision: preview.data_revision,
        now: "2026-08-11T00:30:02.000Z",
      })).toMatchObject({ reused: true, token: preview.token });
      expect(businessSnapshot(databaseRuntime.database)).toBe(before);
    } finally {
      databaseRuntime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it.each([
    ["preview_id", (input: ReuseServerPreviewInput) => ({ ...input, previewId: "envelope-changed" }), "IDEMPOTENCY_CONFLICT:preview_id"],
    ["source_message_id", (input: ReuseServerPreviewInput) => ({ ...input, sourceMessageId: "message-changed" }), "IDEMPOTENCY_CONFLICT:source_message_id"],
    ["conversation_id", (input: ReuseServerPreviewInput) => ({ ...input, conversationId: "conversation-changed" }), "IDEMPOTENCY_CONFLICT:conversation_id"],
    ["input_digest", (input: ReuseServerPreviewInput) => ({
      ...input,
      inputDigest: "C".repeat(64),
      previewMaterial: {
        ...(input.previewMaterial as Record<string, unknown>),
        input_digest: "C".repeat(64),
      },
    }), "IDEMPOTENCY_CONFLICT:input_digest"],
    ["subject_scope", (input: ReuseServerPreviewInput) => ({ ...input, subjectScope: "user:changed" }), "IDEMPOTENCY_CONFLICT:subject_scope"],
    ["command_type", (input: ReuseServerPreviewInput) => ({ ...input, commandType: "record_water" as const }), "IDEMPOTENCY_CONFLICT:command_type"],
    ["preview_hash", (input: ReuseServerPreviewInput) => ({ ...input, previewMaterial: { changed: true } }), "PREVIEW_CONFLICT:preview_hash"],
  ] as const)("rejects finalized changed %s with zero writes", (_field, mutate, expected) => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-runtime-${randomUUID()}-`));
    const databaseRuntime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = catalogMealEnvelope("CASE-MEAL-021");
      const service = createDietDomainService({
        database: databaseRuntime.database,
        secret: nodeSecret,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      const preview = service.preview(envelope);
      service.execute({ envelope, token: preview.token, input_digest: preview.input_digest,
        data_revision: preview.data_revision });
      const input = reuseInput(databaseRuntime.database, envelope);
      const before = businessSnapshot(databaseRuntime.database);

      expect(() => reuseServerPreview(mutate(input))).toThrow(expected);
      expect(businessSnapshot(databaseRuntime.database)).toBe(before);
    } finally {
      databaseRuntime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("fails closed on malformed finalized preview authority with zero further writes", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-runtime-${randomUUID()}-`));
    const databaseRuntime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = catalogMealEnvelope("CASE-MEAL-021");
      const service = createDietDomainService({ database: databaseRuntime.database, secret: nodeSecret,
        now: () => "2026-08-11T00:30:01.000Z" });
      const preview = service.preview(envelope);
      service.execute({ envelope, token: preview.token, input_digest: preview.input_digest,
        data_revision: preview.data_revision });
      databaseRuntime.database.prepare(
        "UPDATE command_envelopes SET payload_json = ? WHERE envelope_id = ?",
      ).run(canonicalJson({ malformed: true }), envelope.envelope_id);
      const before = businessSnapshot(databaseRuntime.database);

      expect(() => service.preview(envelope)).toThrow("PREVIEW_AUTHORITY_INVALID:binding");
      expect(businessSnapshot(databaseRuntime.database)).toBe(before);
    } finally {
      databaseRuntime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("keeps parser rejection, ignored facts and clarification completely storage-lazy", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-runtime-${randomUUID()}-`));
    try {
      const runtime = createCoreRuntime({
        officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      expect(handleCoreRequest(runtime, {
        ...applicationRequest("CASE-MEAL-021", "record_meal"),
        source_text: "",
      })).toMatchObject({ status: "failed", committed: false });
      expect(handleCoreRequest(
        runtime,
        applicationRequest("CASE-MEAL-011", "record_meal"),
      )).toEqual({
        action: "record_meal",
        status: "ignored",
        committed: false,
        operation_id: "operation-case-meal-011",
        reason_code: "non_self_subject",
      });
      expect(handleCoreRequest(
        runtime,
        applicationRequest("CASE-MEAL-015", "record_meal"),
      )).toMatchObject({
        status: "ignored",
        committed: false,
        reason_code: "future_plan",
      });
      expect(handleCoreRequest(
        runtime,
        applicationRequest("CASE-MEAL-013", "record_meal"),
      )).toMatchObject({
        status: "needs_clarification",
        committed: false,
        reason_code: "occurred_date_ambiguous",
      });
      expect(readdirSync(root)).toEqual([]);
      runtime.close();
      runtime.close();
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("returns the parser's concrete clarification question without opening storage", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-runtime-${randomUUID()}-`));
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-15T02:15:00.000Z",
    });
    try {
      const base = catalogInput("CASE-MEAL-021");
      const purchase = handleCoreRequest(runtime, {
        ...base,
        action: "add_inventory",
        source_text: "我买了牛奶。",
        operation_id: "operation-purchase-question",
      });
      expect(purchase).toEqual({
        action: "add_inventory",
        status: "needs_clarification",
        committed: false,
        operation_id: "operation-purchase-question",
        reason_code: "unsupported_command",
        question: "还没有记录。请说明购买数量和包装规格，例如几盒、每盒多少毫升。",
      });
      expect(assertDietManagerOutcome(purchase)).toBe(purchase);

      const water = handleCoreRequest(runtime, {
        ...base,
        action: "record_water",
        source_text: "刚喝了一瓶水。",
        operation_id: "operation-water-question",
      });
      expect(water).toEqual({
        action: "record_water",
        status: "needs_clarification",
        committed: false,
        operation_id: "operation-water-question",
        reason_code: "amount_ambiguous",
        question: "请说明实际喝了多少毫升白水。",
      });
      expect(assertDietManagerOutcome(water)).toBe(water);
      expect(readdirSync(root)).toEqual([]);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("creates only the fixed database and private secret for the first valid candidate", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-runtime-${randomUUID()}-`));
    let activeRuntime: ReturnType<typeof createCoreRuntime> | undefined;
    try {
      const runtime = createCoreRuntime({
        officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      activeRuntime = runtime;
      expect(readdirSync(root)).toEqual([]);
      const request = applicationRequest("CASE-MEAL-021", "record_meal");
      const first = handleCoreRequest(runtime, request);
      if (first.status === "failed") throw new Error(`TEST_OUTCOME:${first.error_code}`);
      expect(first).toMatchObject({
        action: "record_meal",
        status: "committed_with_issues",
        committed: true,
        operation_id: request.operation_id,
        record_id: expect.stringMatching(/^event-[a-f0-9]{32}$/),
      });
      expect(readdirSync(root)).toEqual(expect.arrayContaining([
        APPLICATION_SECRET_FILENAME,
        DIET_DATABASE_FILENAME,
      ]));
      const secretPath = join(root, APPLICATION_SECRET_FILENAME);
      const firstSecret = readFileSync(secretPath);
      const stat = lstatSync(secretPath);
      expect(firstSecret).toHaveLength(32);
      expect(stat.isFile()).toBe(true);
      expect(stat.isSymbolicLink()).toBe(false);
      expect(stat.nlink).toBe(1);
      if (process.platform !== "win32") expect(stat.mode & 0o777).toBe(0o600);

      expect(handleCoreRequest(runtime, request)).toEqual(first);

      expect(createCoreRuntime({
        officialDataRoot: root,
        now: () => "2026-08-11T00:30:02.000Z",
      })).toBe(runtime);
      runtime.close();
      activeRuntime = undefined;
      runtime.close();

      const reopened = createCoreRuntime({
        officialDataRoot: root,
        now: () => "2026-08-11T00:30:03.000Z",
      });
      activeRuntime = reopened;
      expect(reopened).not.toBe(runtime);
      try {
        const replay = handleCoreRequest(reopened, request);
        expect(replay).toEqual(first);
        expect(readFileSync(secretPath)).toEqual(firstSecret);
      } finally {
        reopened.close();
        activeRuntime = undefined;
      }
    } finally {
      activeRuntime?.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("connects the legacy inventory candidate without expanding the public outcome", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-runtime-${randomUUID()}-`));
    try {
      const runtime = createCoreRuntime({
        officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      try {
        const outcome = handleCoreRequest(
          runtime,
          applicationRequest("CASE-PURCHASE-004", "add_inventory"),
        );
        expect(outcome).toMatchObject({
          action: "add_inventory",
          status: "committed",
          committed: true,
          operation_id: "operation-case-purchase-004",
          record_id: expect.stringMatching(/^event-[a-f0-9]{32}$/u),
        });
        expect(outcome).not.toHaveProperty("record_ids");
        expect(readdirSync(root).sort()).toEqual([
          APPLICATION_SECRET_FILENAME,
          "diet-manager-b.sqlite3",
          "diet-manager-b.sqlite3-shm",
          "diet-manager-b.sqlite3-wal",
        ].sort());
      } finally {
        runtime.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("validates runtime options without invoking accessors or accepting shape expansion", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-runtime-${randomUUID()}-`));
    try {
      let getterCount = 0;
      const accessor = { now: () => "2026-08-11T00:30:01.000Z" } as Record<string, unknown>;
      Object.defineProperty(accessor, "officialDataRoot", {
        enumerable: true,
        get() { getterCount += 1; return root; },
      });
      expect(() => createCoreRuntime(accessor as never)).toThrow("CORE_RUNTIME_INVALID");
      expect(getterCount).toBe(0);
      expect(() => createCoreRuntime(new Proxy({
        officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z",
      }, {}))).toThrow("CORE_RUNTIME_INVALID");
      expect(() => createCoreRuntime(Object.assign(Object.create(null), {
        officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z",
      }))).toThrow("CORE_RUNTIME_INVALID");
      expect(() => createCoreRuntime({
        officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z",
        extra: true,
      } as never)).toThrow("CORE_RUNTIME_INVALID");
      const symbolOptions = {
        officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z",
        [Symbol("hidden")]: true,
      };
      expect(() => createCoreRuntime(symbolOptions)).toThrow("CORE_RUNTIME_INVALID");
      expect(() => createCoreRuntime({
        officialDataRoot: root,
        now: () => "not-an-iso-clock",
      })).toThrow("CORE_RUNTIME_INVALID:clock");
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("rejects hostile application request shapes with getter-zero and zero files", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-runtime-${randomUUID()}-`));
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    try {
      const ordinary = applicationRequest("CASE-MEAL-021", "record_meal");
      let getterCount = 0;
      const accessor = { ...ordinary } as Record<string, unknown>;
      Object.defineProperty(accessor, "action", { enumerable: true, get() {
        getterCount += 1; return "record_meal";
      } });
      const revoked = Proxy.revocable(ordinary, {});
      revoked.revoke();
      const hostile = [
        accessor,
        new Proxy(ordinary, { get() { throw new Error("trap"); } }),
        revoked.proxy,
        Object.assign(Object.create(null), ordinary),
        { ...ordinary, extra: true },
        { ...ordinary, [Symbol("hidden")]: true },
        { ...ordinary, prior_context: new Proxy(ordinary.prior_context, {}) },
        { ...ordinary, prior_context: (() => {
          const sparse = [...ordinary.prior_context]; sparse.length += 1; return sparse;
        })() },
      ];
      for (const value of hostile) {
        const outcome = handleCoreRequest(runtime, value as CoreApplicationRequest);
        expect(outcome).toMatchObject({ status: "failed", committed: false,
          error_code: "INVALID_REQUEST" });
        expect(Object.isFrozen(outcome)).toBe(true);
      }
      expect(getterCount).toBe(0);
      expect(readdirSync(root)).toEqual([]);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("rejects root reparses before any database or secret use", () => {
    const owner = mkdtempSync(join(tmpdir(), `diet-manager-task8-owner-${randomUUID()}-`));
    const target = mkdtempSync(join(tmpdir(), `diet-manager-task8-target-${randomUUID()}-`));
    const rootLink = join(owner, "root-link");
    try {
      symlinkSync(target, rootLink, process.platform === "win32" ? "junction" : "dir");
      expect(() => createCoreRuntime({
        officialDataRoot: rootLink,
        now: () => "2026-08-11T00:30:01.000Z",
      })).toThrow("STORAGE_PATH_INVALID:root_reparse");
      expect(readdirSync(target)).toEqual([]);
    } finally {
      rmSync(owner, { recursive: true, force: false });
      rmSync(target, { recursive: true, force: false });
    }
  });

  it("rejects physical root identity drift before lazy initialization", () => {
    const owner = mkdtempSync(join(tmpdir(), `diet-manager-task8-owner-${randomUUID()}-`));
    const root = join(owner, "runtime");
    const displaced = join(owner, "runtime-displaced");
    mkdirSync(root);
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    try {
      renameSync(root, displaced);
      mkdirSync(root);
      expect(() => createCoreRuntime({ officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z" })).toThrow(
        "STORAGE_PATH_INVALID:root_identity",
      );
      const outcome = handleCoreRequest(runtime,
        applicationRequest("CASE-MEAL-021", "record_meal"));
      expect(outcome).toEqual({ action: "record_meal", status: "failed", committed: false,
        operation_id: "operation-case-meal-021", error_code: "STORAGE_PATH_INVALID" });
      expect(readdirSync(root)).toEqual([]);
      expect(readdirSync(displaced)).toEqual([]);
    } finally {
      runtime.close();
      rmSync(owner, { recursive: true, force: false });
    }
  });

  it("rejects ancestor identity drift before lazy session initialization", () => {
    const grandparent = mkdtempSync(join(tmpdir(), `diet-manager-task8-ancestor-${randomUUID()}-`));
    const parent = join(grandparent, "parent");
    const root = join(parent, "runtime");
    const displacedParent = join(grandparent, "parent-displaced");
    mkdirSync(parent);
    mkdirSync(root);
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    try {
      renameSync(parent, displacedParent);
      symlinkSync(displacedParent, parent, process.platform === "win32" ? "junction" : "dir");

      const request = applicationRequest("CASE-MEAL-021", "record_meal");
      expect(handleCoreRequest(runtime, request)).toEqual({
        action: "record_meal", status: "failed", committed: false,
        operation_id: request.operation_id, error_code: "STORAGE_PATH_INVALID",
      });
      expect(readdirSync(join(displacedParent, "runtime"))).toEqual([]);
    } finally {
      runtime.close();
      rmSync(grandparent, { recursive: true, force: false });
    }
  });

  it("caches one runtime by the exact physical root identity", () => {
    if (process.platform !== "win32") return;
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-runtime-${randomUUID()}-`));
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    try {
      expect(createCoreRuntime({ officialDataRoot: root.toUpperCase(),
        now: () => "2026-08-11T00:30:02.000Z" })).toBe(runtime);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("rejects a secret reparse before database creation", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-runtime-${randomUUID()}-`));
    const target = mkdtempSync(join(tmpdir(), `diet-manager-task8-secret-target-${randomUUID()}-`));
    try {
      symlinkSync(target, join(root, APPLICATION_SECRET_FILENAME),
        process.platform === "win32" ? "junction" : "dir");
      const runtime = createCoreRuntime({ officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z" });
      try {
        const outcome = handleCoreRequest(runtime,
          applicationRequest("CASE-MEAL-021", "record_meal"));
        expect(outcome).toMatchObject({ status: "failed", committed: false,
          error_code: "CORE_RUNTIME_SECRET_INVALID" });
        expect(existsSync(join(root, DIET_DATABASE_FILENAME))).toBe(false);
      } finally {
        runtime.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: false });
      rmSync(target, { recursive: true, force: false });
    }
  });

  it.each([
    ["wrong length", (root: string) => writeFileSync(
      join(root, APPLICATION_SECRET_FILENAME),
      Buffer.alloc(31),
      { flag: "wx", mode: 0o600 },
    )],
    ["directory", (root: string) => mkdirSync(join(root, APPLICATION_SECRET_FILENAME))],
    ["hard link", (root: string) => {
      const external = join(root, "external-secret");
      writeFileSync(external, Buffer.alloc(32, 7), { flag: "wx", mode: 0o600 });
      linkSync(external, join(root, APPLICATION_SECRET_FILENAME));
    }],
    ["broad permissions", (root: string) => {
      const path = join(root, APPLICATION_SECRET_FILENAME);
      writeFileSync(path, Buffer.alloc(32, 8), { flag: "wx", mode: 0o600 });
      if (process.platform !== "win32") chmodSync(path, 0o644);
    }],
  ] as const)("fails closed on a preexisting %s secret and never exposes its bytes", (_name, arrange) => {
    if (_name === "broad permissions" && process.platform === "win32") return;
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-runtime-${randomUUID()}-`));
    try {
      arrange(root);
      const secretPath = join(root, APPLICATION_SECRET_FILENAME);
      const secretBytes = lstatSync(secretPath).isFile() ? readFileSync(secretPath) : Buffer.alloc(0);
      const runtime = createCoreRuntime({
        officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      try {
        const outcome = handleCoreRequest(
          runtime,
          applicationRequest("CASE-MEAL-021", "record_meal"),
        );
        expect(outcome).toMatchObject({
          action: "record_meal",
          status: "failed",
          committed: false,
        });
        if (secretBytes.length > 0) {
          expect(JSON.stringify(outcome)).not.toContain(secretBytes.toString("hex"));
        }
        expect(Object.hasOwn(outcome, "record_id")).toBe(false);
        expect(existsSync(join(root, DIET_DATABASE_FILENAME))).toBe(false);
      } finally {
        runtime.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: false });
    }
  });
});

describe("SEL-CORE Task 8 truthful public application outcomes", () => {
  it("preserves parser-authoritative offset received_at bytes and conflicts on changed representation", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-offset-${randomUUID()}-`));
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    try {
      const request = {
        ...applicationRequest("CASE-MEAL-021", "record_meal"),
        received_at: "2026-08-11T08:30:00.1+08:00",
      };
      const first = handleCoreRequest(runtime, request);
      expect(first.committed).toBe(true);
      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(inspection.database.prepare(
          "SELECT received_at FROM event_records",
        ).get()).toEqual({ received_at: request.received_at });
      } finally {
        inspection.close();
      }
      const before = storedBusinessSnapshot(root);
      expect(handleCoreRequest(runtime, request)).toEqual(first);
      expect(handleCoreRequest(runtime, {
        ...request,
        received_at: "2026-08-11T08:30:00.100+08:00",
      })).toMatchObject({ status: "failed", committed: false,
        error_code: "idempotency_conflict" });
      expect(storedBusinessSnapshot(root)).toBe(before);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("does not expose a raw database, service, token or revision session by deep import", async () => {
    const runtimeModule = await import("../../src/application/runtime.js") as Record<string, unknown>;
    expect(Object.hasOwn(runtimeModule, "acquireCoreRuntimeSession")).toBe(false);
    expect(Object.keys(runtimeModule).sort()).toEqual([
      "CORE_RUNTIME_SECRET_FILENAME",
      "createCoreRuntime",
    ]);
  });

  it.each([
    ["CASE-MEAL-021", "record_meal"],
    ["CASE-MEAL-019", "record_meal"],
    ["CASE-MEAL-020", "record_meal"],
    ["CASE-WATER-004", "record_meal"],
    ["CASE-WATER-001", "record_water"],
  ] as const)("commits actual catalog %s through the public runtime", (id, action) => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-app-${randomUUID()}-`));
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    try {
      const request = applicationRequest(id, action);
      const outcome = handleCoreRequest(runtime, request);
      expect(outcome).toMatchObject({ action, committed: true,
        operation_id: request.operation_id,
        record_id: expect.stringMatching(/^event-[a-f0-9]{32}$/) });
      expect(Object.isFrozen(outcome)).toBe(true);
      if (!outcome.committed) throw new Error("expected committed outcome");
      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(inspection.database.prepare(
          "SELECT event_id, operation_id, event_type, fact_kind, received_at FROM event_records",
        ).all()).toEqual([{
          event_id: outcome.record_id,
          operation_id: request.operation_id,
          event_type: action === "record_water" ? "diet_water" : "diet_meal",
          fact_kind: action === "record_water" ? "water" : "meal",
          received_at: request.received_at,
        }]);
        const envelope = inspection.database.prepare(
          "SELECT envelope_id, idempotency_key, source_message_id, conversation_id FROM command_envelopes",
        ).get() as Record<string, unknown>;
        expect(envelope).toMatchObject({
          envelope_id: expect.stringMatching(/^envelope-[a-f0-9]{32}$/),
          idempotency_key: expect.stringMatching(/^core-[A-F0-9]{64}$/),
          source_message_id: request.source_message_id,
          conversation_id: request.conversation_id,
        });
      } finally {
        inspection.close();
      }
      const before = storedBusinessSnapshot(root);
      expect(handleCoreRequest(runtime, request)).toEqual(outcome);
      expect(storedBusinessSnapshot(root)).toBe(before);
      const publicBytes = JSON.stringify(outcome);
      expect(publicBytes).not.toContain(root);
      expect(publicBytes).not.toContain(request.source_text);
      expect(publicBytes).not.toContain("data_revision");
      expect(publicBytes).not.toContain("token");
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("persists the full production meal mapping from exact parser output", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-map-${randomUUID()}-`));
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    try {
      const request = applicationRequest("CASE-MEAL-001", "record_meal");
      expect(handleCoreRequest(runtime, request).committed).toBe(true);
      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const event = inspection.database.prepare(
          "SELECT meal_slot, payload_json FROM event_records",
        ).get() as { meal_slot: string; payload_json: string };
        const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
        expect(event.meal_slot).toBe("早餐");
        expect(payload).toMatchObject({
          authority_kind: "diet-manager/meal-fact/v1",
          location: "home",
          source_text: request.source_text,
          timezone: "Asia/Shanghai",
        });
        expect(inspection.database.prepare(
          "SELECT item_order, item_type, normalized_name, payload_json FROM meal_items ORDER BY item_order",
        ).all()).toEqual([
          expect.objectContaining({ item_order: 0, item_type: "food", normalized_name: "egg",
            payload_json: expect.stringContaining('"observed_microunits":2000000') }),
          expect.objectContaining({ item_order: 1, item_type: "food", normalized_name: "bread",
            payload_json: expect.stringContaining('"unit":"slice"') }),
          expect.objectContaining({ item_order: 2, item_type: "nutrition_drink", normalized_name: "milk",
            payload_json: expect.stringContaining('"observed_microunits":250000000') }),
        ]);
      } finally {
        inspection.close();
      }
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("maps same identity with changed candidate input to conflict and zero writes", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-app-${randomUUID()}-`));
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    try {
      const request = applicationRequest("CASE-MEAL-021", "record_meal");
      expect(handleCoreRequest(runtime, request).committed).toBe(true);
      const before = storedBusinessSnapshot(root);
      const changed = { ...request, source_text: catalogInput("CASE-MEAL-019").source_text };
      expect(handleCoreRequest(runtime, changed)).toEqual({
        action: "record_meal", status: "failed", committed: false,
        operation_id: request.operation_id, error_code: "idempotency_conflict",
      });
      expect(storedBusinessSnapshot(root)).toBe(before);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("returns a six-area daily progress view without writing", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-progress-${randomUUID()}-`));
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    try {
      const mealRequest = applicationRequest("CASE-MEAL-021", "record_meal");
      expect(handleCoreRequest(runtime, mealRequest).committed).toBe(true);
      const before = storedBusinessSnapshot(root);
      const query = { ...mealRequest, action: "query_daily_summary" as const,
        operation_id: "operation-progress-001" };
      const outcome = handleCoreRequest(runtime, query);
      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        action: "query_daily_summary",
        status: "ignored",
        committed: false,
        operation_id: "operation-progress-001",
        reason_code: "read_only_result",
        daily_progress: {
          date: "2026-08-11",
          timezone: "Asia/Shanghai",
          meals: { count: 1 },
          water: { count: 0, plain_water_ml_milli: 0 },
          nutrition: { coverage_status: "partial", nutrients: allNullNutrition() },
          inventory: { deduction_count: 0 },
          purchases: { count: 0 },
          corrections: { count: 0 },
        },
      });
      expect(assertDietManagerOutcome(outcome)).toBe(outcome);
      expect(Object.isFrozen(outcome.daily_progress?.nutrition.nutrients)).toBe(true);
      expect(storedBusinessSnapshot(root)).toBe(before);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("returns authenticated meal history and inventory views without writing", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-read-views-${randomUUID()}-`));
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    try {
      const mealRequest = applicationRequest("CASE-MEAL-001", "record_meal");
      const purchaseRequest = applicationRequest("CASE-PURCHASE-001", "add_inventory");
      expect(handleCoreRequest(runtime, mealRequest).committed).toBe(true);
      expect(handleCoreRequest(runtime, purchaseRequest).committed).toBe(true);
      const before = storedBusinessSnapshot(root);

      const meals = handleCoreRequest(runtime, {
        ...mealRequest,
        action: "query_meals",
        operation_id: "operation-query-meals-001",
      });
      expect(meals).toMatchObject({
        action: "query_meals",
        status: "ignored",
        committed: false,
        reason_code: "read_only_result",
        meal_history: {
          date: "2026-08-11",
          timezone: "Asia/Shanghai",
          meals: [{
            meal_slot: "早餐",
            location: "home",
            items: [
              { item_order: 0, name: "egg", quantity_microunits: 2_000_000, unit: "piece", quantity_evidence: "explicit" },
              { item_order: 1, name: "bread", quantity_microunits: 2_000_000, unit: "slice", quantity_evidence: "explicit" },
              { item_order: 2, name: "milk", quantity_microunits: 250_000_000, unit: "ml", quantity_evidence: "explicit" },
            ],
          }],
        },
      });
      const inventory = handleCoreRequest(runtime, {
        ...purchaseRequest,
        action: "query_inventory",
        operation_id: "operation-query-inventory-001",
      });
      expect(inventory).toMatchObject({
        action: "query_inventory",
        status: "ignored",
        committed: false,
        reason_code: "read_only_result",
        inventory_view: { batches: [{
          name: "milk",
          quantity_microunits: 24_000_000,
          unit: "carton",
          quantity_status: "available",
          effective_status: "active",
        }] },
      });
      expect(assertDietManagerOutcome(meals)).toBe(meals);
      expect(assertDietManagerOutcome(inventory)).toBe(inventory);
      expect(Object.isFrozen(meals.meal_history?.meals[0]?.items)).toBe(true);
      expect(Object.isFrozen(inventory.inventory_view?.batches[0])).toBe(true);
      expect(storedBusinessSnapshot(root)).toBe(before);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("returns frozen no-write not-implemented for undo_record", () => {
      const action: DietManagerAction = "undo_record";
      const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-app-${randomUUID()}-`));
      const runtime = createCoreRuntime({ officialDataRoot: root,
        now: () => "2026-08-11T00:30:01.000Z" });
      try {
        const request = { ...applicationRequest("CASE-MEAL-021", "record_meal"), action };
        const outcome = handleCoreRequest(runtime, request);
        expect(outcome).toEqual({ action, status: "failed", committed: false,
          operation_id: request.operation_id, error_code: "ACTION_NOT_IMPLEMENTED" });
        expect(Object.isFrozen(outcome)).toBe(true);
        expect(readdirSync(root)).toEqual([]);
      } finally {
        runtime.close();
        rmSync(root, { recursive: true, force: false });
      }
  });

  it("rejects a correction action whose source parses as a meal without writing", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-app-${randomUUID()}-`));
    const runtime = createCoreRuntime({ officialDataRoot: root,
      now: () => "2026-08-11T00:30:01.000Z" });
    try {
      const request = { ...applicationRequest("CASE-MEAL-021", "record_meal"), action: "correct_record" as const };
      const outcome = handleCoreRequest(runtime, request);
      expect(outcome).toEqual({ action: "correct_record", status: "failed", committed: false,
        operation_id: request.operation_id, error_code: "ACTION_CONFLICT" });
      expect(Object.isFrozen(outcome)).toBe(true);
      expect(readdirSync(root)).toEqual([]);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });
});
