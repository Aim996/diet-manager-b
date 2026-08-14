import { lstatSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

import {
  applyCorrectionEffects,
  applyMealEffects,
  applyPurchaseEffect,
  preflightMealOperation,
  prepareCorrectionOperation,
  prepareMealOperation,
  preparePurchaseOperation,
} from "../dist/domain/effect-bundle.js";
import { createDietDomainService } from "../dist/domain/service.js";
import { appendPreparedOperationFact } from "../dist/repository/fact-commit.js";
import {
  createContributionProgressReservation,
} from "../dist/repository/progress-reservation.js";
import { openDietDatabase } from "../dist/storage/database.js";

const CRASH_EXIT = 73;
const OWNER_FILE = ".b-slice-crash-owner.json";
const COMMITTED_AT = "2026-08-12T10:00:00.000Z";
const allowedModes = new Set([
  "after_fact_commit",
  "after_effect_bundle",
  "after_finalize_before_reply",
  "meal_after_fact",
  "meal_after_effect_before_seal",
  "meal_after_finalize_before_reply",
  "purchase_after_fact",
  "purchase_after_effect_before_seal",
  "purchase_after_finalize_before_reply",
  "correction_after_fact",
  "correction_after_effect_before_seal",
  "correction_after_finalize_before_reply",
  "mixed_after_seal_before_finalize",
  "mixed_after_finalize_before_reply",
]);
const secret = Buffer.from("B-SLICE-001 crash harness secret 0001", "utf8");

function fail(code) {
  throw new Error(`B_SLICE_CRASH_WORKER_INVALID:${code}`);
}

function ownedRoot(token) {
  const root = process.env.B_SLICE_CRASH_ROOT;
  if (typeof root !== "string" || root.length === 0) fail("root_missing");
  const resolved = resolve(root);
  const temporaryParent = resolve(tmpdir());
  if (dirname(resolved).toLowerCase() !== temporaryParent.toLowerCase()) fail("root_parent");
  if (!/^diet-manager-b-slice-crash-[a-f0-9-]+$/i.test(basename(resolved))) {
    fail("root_name");
  }
  if (lstatSync(resolved).isSymbolicLink()) fail("root_link");
  const owner = JSON.parse(readFileSync(resolve(resolved, OWNER_FILE), "utf8"));
  if (owner.owner !== "B-SLICE-001" || owner.token !== token) fail("root_owner");
  return resolved;
}

function mealEnvelope() {
  return Object.freeze({
    envelope_id: "envelope-crash-fact-commit-001",
    idempotency_key: "idem-crash-fact-commit-001",
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: "message-crash-fact-commit-001",
    conversation_id: "conversation-crash-001",
    received_at: "2026-08-12T08:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: Object.freeze([Object.freeze({
      kind: "record_meal",
      operation_id: "operation-crash-fact-commit-001",
      occurred_at: "2026-08-12T08:00:00.000Z",
      meal_slot: "breakfast",
      location: "outside",
      items: Object.freeze([Object.freeze({
        normalized_name: "crash harness pear",
        item_type: "food",
        amount: Object.freeze({
          unit: "piece",
          observed_microunits: 1_000_000,
          nutrition_adoption_microunits: 1_000_000,
          inventory_deduction_microunits: 1_000_000,
          template_reference_microunits: null,
          evidence: "explicit",
        }),
        nutrition_sources: Object.freeze([Object.freeze({
          source_type: "public_fixture",
          source_ref: "crash-harness-pear-v1",
          profile_version: 1,
          applicable_product_id: null,
          basis_kind: "per_item",
          basis_microunits: 1_000_000,
          basis_unit: "piece",
          nutrients: Object.freeze({
            energy_kcal_milli: 100_000,
            protein_mg: 1_000,
            fat_mg: 0,
            carbohydrate_mg: 25_000,
            fiber_mg: 5_000,
            water_ml_milli: null,
          }),
        })]),
      })]),
    })]),
  });
}

function mixedEnvelope() {
  return Object.freeze({
    envelope_id: "envelope-crash-mixed-001",
    idempotency_key: "idem-crash-mixed-001",
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: "message-crash-mixed-001",
    conversation_id: "conversation-crash-001",
    received_at: "2026-08-12T09:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: Object.freeze([
      Object.freeze({
        kind: "add_inventory",
        operation_id: "operation-crash-purchase-001",
        product: Object.freeze({
          product_id: "product-crash-milk-001",
          normalized_name: "crash harness milk",
          product_type: "nutrition_drink",
        }),
        batch_id: "batch-crash-milk-001",
        amount: Object.freeze({
          unit: "carton",
          observed_microunits: 2_000_000,
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          template_reference_microunits: 1_000_000,
          evidence: "explicit",
        }),
        nutrition_sources: Object.freeze([Object.freeze({
          source_type: "product_label",
          source_ref: "crash-harness-milk-v1",
          profile_version: 1,
          applicable_product_id: "product-crash-milk-001",
          basis_kind: "per_package",
          basis_microunits: 1_000_000,
          basis_unit: "carton",
          nutrients: Object.freeze({
            energy_kcal_milli: 160_000,
            protein_mg: 8_000,
            fat_mg: 9_000,
            carbohydrate_mg: 12_000,
            fiber_mg: null,
            water_ml_milli: null,
          }),
        })]),
      }),
      Object.freeze({
        kind: "record_meal",
        operation_id: "operation-crash-meal-001",
        occurred_at: "2026-08-12T09:00:00.000Z",
        meal_slot: "lunch",
        location: "home",
        items: Object.freeze([Object.freeze({
          normalized_name: "crash harness milk",
          item_type: "food",
          amount: Object.freeze({
            unit: "carton",
            observed_microunits: 1_000_000,
            nutrition_adoption_microunits: 1_000_000,
            inventory_deduction_microunits: 1_000_000,
            template_reference_microunits: null,
            evidence: "explicit",
          }),
          nutrition_sources: Object.freeze([Object.freeze({
            source_type: "product_label",
            source_ref: "crash-harness-milk-v1",
            profile_version: 1,
            applicable_product_id: "product-crash-milk-001",
            basis_kind: "per_package",
            basis_microunits: 1_000_000,
            basis_unit: "carton",
            nutrients: Object.freeze({
              energy_kcal_milli: 160_000,
              protein_mg: 8_000,
              fat_mg: 9_000,
              carbohydrate_mg: 12_000,
              fiber_mg: null,
              water_ml_milli: null,
            }),
          })]),
        })]),
      }),
    ]),
  });
}

function purchaseEnvelope() {
  return Object.freeze({
    envelope_id: "envelope-crash-purchase-single-001",
    idempotency_key: "idem-crash-purchase-single-001",
    command_type: "add_inventory",
    subject_scope: "user:self",
    source_message_id: "message-crash-purchase-single-001",
    conversation_id: "conversation-crash-001",
    received_at: "2026-08-12T07:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: Object.freeze([Object.freeze({
      kind: "add_inventory",
      operation_id: "operation-crash-purchase-single-001",
      product: Object.freeze({
        product_id: "product-crash-purchase-single-001",
        normalized_name: "crash harness single milk",
        product_type: "nutrition_drink",
      }),
      batch_id: "batch-crash-purchase-single-001",
      amount: Object.freeze({
        unit: "carton",
        observed_microunits: 4_000_000,
        nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null,
        template_reference_microunits: 1_000_000,
        evidence: "explicit",
      }),
      nutrition_sources: Object.freeze([Object.freeze({
        source_type: "product_label",
        source_ref: "crash-harness-single-milk-v1",
        profile_version: 1,
        applicable_product_id: "product-crash-purchase-single-001",
        basis_kind: "per_package",
        basis_microunits: 1_000_000,
        basis_unit: "carton",
        nutrients: Object.freeze({
          energy_kcal_milli: 160_000,
          protein_mg: 8_000,
          fat_mg: 9_000,
          carbohydrate_mg: 12_000,
          fiber_mg: null,
          water_ml_milli: null,
        }),
      })]),
    })]),
  });
}

function correctionSeedPurchaseEnvelope() {
  return Object.freeze({
    ...purchaseEnvelope(),
    envelope_id: "envelope-crash-correction-stock-001",
    idempotency_key: "idem-crash-correction-stock-001",
    source_message_id: "message-crash-correction-stock-001",
    operations: Object.freeze([Object.freeze({
      ...purchaseEnvelope().operations[0],
      operation_id: "operation-crash-correction-stock-001",
      product: Object.freeze({
        product_id: "product-crash-correction-eggs-001",
        normalized_name: "crash harness correction eggs",
        product_type: "food",
      }),
      batch_id: "batch-crash-correction-eggs-001",
      amount: Object.freeze({
        ...purchaseEnvelope().operations[0].amount,
        unit: "piece",
        observed_microunits: 10_000_000,
        template_reference_microunits: null,
      }),
      nutrition_sources: Object.freeze([Object.freeze({
        ...purchaseEnvelope().operations[0].nutrition_sources[0],
        source_ref: "crash-harness-correction-eggs-v1",
        applicable_product_id: "product-crash-correction-eggs-001",
        basis_kind: "per_item",
        basis_unit: "piece",
      })]),
    })]),
  });
}

function correctionSeedMealEnvelope() {
  const envelope = mealEnvelope();
  return Object.freeze({
    ...envelope,
    envelope_id: "envelope-crash-correction-target-001",
    idempotency_key: "idem-crash-correction-target-001",
    source_message_id: "message-crash-correction-target-001",
    operations: Object.freeze([Object.freeze({
      ...envelope.operations[0],
      operation_id: "operation-crash-correction-target-001",
      location: "home",
      items: Object.freeze([Object.freeze({
        ...envelope.operations[0].items[0],
        normalized_name: "crash harness correction eggs",
        amount: Object.freeze({
          ...envelope.operations[0].items[0].amount,
          unit: "piece",
          observed_microunits: 2_000_000,
          nutrition_adoption_microunits: 2_000_000,
          inventory_deduction_microunits: 2_000_000,
        }),
        nutrition_sources: correctionSeedPurchaseEnvelope().operations[0].nutrition_sources,
      })]),
    })]),
  });
}

function correctionEnvelope(targetEventId) {
  return Object.freeze({
    envelope_id: "envelope-crash-correction-single-001",
    idempotency_key: "idem-crash-correction-single-001",
    command_type: "correct_record",
    subject_scope: "user:self",
    source_message_id: "message-crash-correction-single-001",
    conversation_id: "conversation-crash-001",
    received_at: "2026-08-12T09:30:00.000Z",
    timezone: "Asia/Shanghai",
    operations: Object.freeze([Object.freeze({
      kind: "correct_record",
      operation_id: "operation-crash-correction-single-001",
      target_event_id: targetEventId,
      base_revision: 1,
      item_order: 0,
      replacement_amount: Object.freeze({
        unit: "piece",
        observed_microunits: 3_000_000,
        nutrition_adoption_microunits: 3_000_000,
        inventory_deduction_microunits: 3_000_000,
        template_reference_microunits: null,
        evidence: "explicit",
      }),
    })]),
  });
}

function execution(service, envelope) {
  const preview = service.preview(envelope);
  return Object.freeze({
    envelope,
    token: preview.token,
    input_digest: preview.input_digest,
    data_revision: preview.data_revision,
  });
}

function crash(mode, input) {
  process.stdout.write(`${JSON.stringify({ mode, input })}\n`);
  process.exit(CRASH_EXIT);
}

function executeEnvelope(service, envelope) {
  const input = execution(service, envelope);
  service.execute(input);
  return input;
}

function fixtureFor(kind, service, database) {
  if (kind === "meal") return mealEnvelope();
  if (kind === "purchase") return purchaseEnvelope();
  if (kind === "mixed") return mixedEnvelope();
  executeEnvelope(service, correctionSeedPurchaseEnvelope());
  executeEnvelope(service, correctionSeedMealEnvelope());
  const target = database.prepare(
    "SELECT event_id FROM event_records WHERE envelope_id = ?",
  ).get("envelope-crash-correction-target-001");
  if (!target || typeof target.event_id !== "string") fail("correction_target");
  return correctionEnvelope(target.event_id);
}

function prepareFact(database, input) {
  const envelope = input.envelope;
  const operation = envelope.operations[0];
  const common = {
    database,
    secret,
    token: input.token,
    inputDigest: input.input_digest,
    dataRevision: input.data_revision,
    subjectScope: envelope.subject_scope,
    commandType: envelope.command_type,
    idempotencyKey: envelope.idempotency_key,
    sourceMessageId: envelope.source_message_id,
    conversationId: envelope.conversation_id,
    receivedAt: envelope.received_at,
    committedAt: COMMITTED_AT,
    sequence: 0,
    operation,
  };
  if (operation.kind === "record_meal") {
    const progressReservation = createContributionProgressReservation(
      database,
      preflightMealOperation(database, secret, operation),
    );
    return prepareMealOperation({ ...common, progressReservation });
  }
  if (operation.kind === "add_inventory") return preparePurchaseOperation(common);
  if (operation.kind === "correct_record" || operation.kind === "undo_record") {
    return prepareCorrectionOperation(common);
  }
  fail("operation_kind");
}

function applyDurableEffect(database, input, prepared) {
  const envelope = input.envelope;
  const operation = envelope.operations[0];
  if (operation.kind === "record_meal") {
    applyMealEffects({
      database,
      authoritySecret: secret,
      envelopeId: envelope.envelope_id,
      operationId: operation.operation_id,
      operationSequence: 0,
      idempotencyKey: envelope.idempotency_key,
      now: COMMITTED_AT,
      location: operation.location,
    });
  } else if (operation.kind === "add_inventory") {
    applyPurchaseEffect(database, prepared.outbox_id, COMMITTED_AT);
  } else if (operation.kind === "correct_record" || operation.kind === "undo_record") {
    applyCorrectionEffects({
      database,
      envelopeId: envelope.envelope_id,
      operationId: operation.operation_id,
      operationSequence: 0,
      idempotencyKey: envelope.idempotency_key,
      now: COMMITTED_AT,
    });
  } else {
    fail("operation_kind");
  }
}

const [mode, token, ...extra] = process.argv.slice(2);
if (extra.length !== 0 || !allowedModes.has(mode) || typeof token !== "string" || token.length < 16) {
  fail("arguments");
}
const root = ownedRoot(token);
const runtime = openDietDatabase({ privateRuntimeRoot: root });
const service = createDietDomainService({
  database: runtime.database,
  secret,
  now: () => COMMITTED_AT,
});

const normalizedMode = mode === "after_fact_commit"
  ? "meal_after_fact"
  : mode === "after_effect_bundle"
    ? "mixed_after_seal_before_finalize"
    : mode === "after_finalize_before_reply"
      ? "mixed_after_finalize_before_reply"
      : mode;
const [kind, ...boundaryParts] = normalizedMode.split("_");
const boundary = boundaryParts.join("_");

if (boundary === "after_fact") {
  const envelope = fixtureFor(kind, service, runtime.database);
  const input = execution(service, envelope);
  const prepared = prepareFact(runtime.database, input);
  appendPreparedOperationFact(prepared.fact);
  crash(mode, input);
}

const envelope = fixtureFor(kind, service, runtime.database);
const input = execution(service, envelope);
if (boundary === "after_effect_before_seal" && kind !== "mixed") {
  const prepared = prepareFact(runtime.database, input);
  appendPreparedOperationFact(prepared.fact);
  applyDurableEffect(runtime.database, input, prepared);
  crash(mode, input);
}
if (boundary === "after_finalize_before_reply" && kind !== "mixed") {
  service.execute(input);
  crash(mode, input);
}
const fault = boundary === "after_seal_before_finalize"
  ? "after_mixed_seal"
  : boundary === "after_finalize_before_reply"
    ? "after_mixed_finalize_commit"
    : fail("boundary");
const faultingService = createDietDomainService({
  database: runtime.database,
  secret,
  now: () => COMMITTED_AT,
  fault,
});
try {
  faultingService.execute(input);
  fail("checkpoint_not_reached");
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  if (
    (boundary === "after_seal_before_finalize" &&
      message !== "DIET_DOMAIN_EXECUTION_FAILED:after_mixed_seal") ||
    (boundary === "after_finalize_before_reply" &&
      message !== "ENVELOPE_FINALIZE_RESPONSE_LOST:after_commit_before_reply")
  ) throw error;
}
crash(mode, input);
