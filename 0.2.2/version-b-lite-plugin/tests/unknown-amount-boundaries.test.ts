import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalJson, canonicalSha256 } from "../src/authority/canonical-json.js";
import { createDietDomainService } from "../src/domain/service.js";
import type { DomainEnvelopeInput } from "../src/domain/types.js";
import { openDietDatabase } from "../src/storage/database.js";

const secret = Buffer.from("SEL-CORE-001 Task 8 nullable amount", "utf8");

function businessSnapshot(database: ReturnType<typeof openDietDatabase>["database"]): string {
  const tables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;
  return canonicalJson(Object.fromEntries(tables.map(({ name }) => [
    name,
    database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ])));
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

function unknownMealEnvelope(suffix: string, location: "home" | "outside" = "home"): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-task8-unknown-${suffix}`,
    idempotency_key: `idempotency-task8-unknown-${suffix}`,
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: `message-task8-unknown-${suffix}`,
    conversation_id: "conversation-task8-unknown",
    received_at: "2026-08-11T00:30:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "record_meal",
      operation_id: `operation-task8-unknown-${suffix}`,
      occurred_at: "2026-08-11T00:30:00.000Z",
      meal_slot: "unknown",
      location,
      items: [{
        normalized_name: "fried_rice",
        item_type: "food",
        amount: {
          unit: "unknown",
          observed_microunits: null,
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          template_reference_microunits: null,
          evidence: "unknown",
        },
        nutrition_sources: [],
      }],
    }],
  };
}

function correctionEnvelope(kind: "correct_record" | "undo_record", targetEventId: string): DomainEnvelopeInput {
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

describe("unknown amount operation boundaries", () => {
  it("rejects nullable add_inventory at its known-only boundary with getter trap-zero and no writes", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      let getterCount = 0;
      const envelope = purchaseEnvelope("null");
      const operation = envelope.operations[0];
      if (operation?.kind !== "add_inventory") throw new Error("expected purchase");
      const amount = {
        unit: "unknown", observed_microunits: null,
        nutrition_adoption_microunits: null, inventory_deduction_microunits: null,
        template_reference_microunits: null, evidence: "unknown",
      };
      (operation as unknown as { amount: unknown }).amount = amount;
      const service = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-11T00:30:01.000Z",
      });
      const before = businessSnapshot(runtime.database);
      expect(() => service.preview(envelope)).toThrow(
        "DIET_DOMAIN_REQUEST_INVALID:envelope.operations.0.amount.observed_microunits",
      );
      const accessorEnvelope = purchaseEnvelope("accessor");
      Object.defineProperty(accessorEnvelope.operations[0]!, "amount", {
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

  it("keeps known add_inventory preview canonical bytes unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
    const runtime = openDietDatabase({
      privateRuntimeRoot: root, now: () => "2026-08-11T00:30:00.000Z",
    });
    try {
      const service = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-11T00:30:01.000Z",
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
        const meal = unknownMealEnvelope(kind);
        const service = createDietDomainService({
          database: runtime.database, secret, now: () => "2026-08-11T00:30:01.000Z",
        });
        const mealPreview = service.preview(meal);
        service.execute({ envelope: meal, token: mealPreview.token,
          input_digest: mealPreview.input_digest, data_revision: mealPreview.data_revision });
        const event = runtime.database.prepare(
          "SELECT event_id FROM event_records WHERE event_type = 'diet_meal'",
        ).get() as { event_id: string };
        const envelope = correctionEnvelope(kind, event.event_id);
        const preview = service.preview(envelope);
        const beforeExecute = businessSnapshot(runtime.database);
        expect(() => service.execute({ envelope, token: preview.token,
          input_digest: preview.input_digest, data_revision: preview.data_revision }))
          .toThrow("DIET_DOMAIN_REQUEST_INVALID:unknown_target_amount");
        expect(businessSnapshot(runtime.database)).toBe(beforeExecute);
        expect(runtime.database.prepare(
          "SELECT COUNT(*) AS count FROM correction_events",
        ).get()).toEqual({ count: 0 });
        expect(runtime.database.prepare(
          "SELECT COUNT(*) AS count FROM event_records WHERE event_type = 'diet_correction'",
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

  it("recovers outside unknown effects with the exact amount-unknown terminal result", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = unknownMealEnvelope("outside", "outside");
      const faulting = createDietDomainService({ database: runtime.database, secret,
        now: () => "2026-08-11T00:30:01.000Z", fault: "after_finalization_row" });
      const preview = faulting.preview(envelope);
      const input = { envelope, token: preview.token, input_digest: preview.input_digest,
        data_revision: preview.data_revision };
      expect(() => faulting.execute(input)).toThrow(
        "ENVELOPE_FINALIZE_FAILED:after_finalization_row",
      );
      expect(runtime.database.prepare(
        "SELECT state FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({ state: "effects_stable" });
      const recovered = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-11T00:30:02.000Z",
      });
      const result = recovered.execute(input);
      expect(result).toMatchObject({ status: "committed_with_issues", items: [{
        inventory_match: "skipped_amount_unknown",
        issue_codes: ["inventory_amount_unknown"],
        meal_items: [{ observed_microunits: null, amount_evidence: "unknown",
          inventory_match: "skipped_amount_unknown",
          issue_codes: ["inventory_amount_unknown"] }],
      }] });
      const beforeReplay = businessSnapshot(runtime.database);
      expect(recovered.execute(input)).toEqual(result);
      expect(businessSnapshot(runtime.database)).toBe(beforeReplay);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });
});
