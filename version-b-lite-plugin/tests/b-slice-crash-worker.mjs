import { lstatSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

import {
  applyMealEffects,
  preflightMealOperation,
  prepareMealOperation,
} from "../dist/domain/effect-bundle.js";
import { createDietDomainService } from "../dist/domain/service.js";
import { appendPreparedOperationFact } from "../dist/repository/fact-commit.js";
import {
  createContributionProgressReservation,
} from "../dist/repository/progress-reservation.js";
import { openDietDatabase } from "../dist/storage/database.js";

const CRASH_EXIT = 73;
const OWNER_FILE = ".b-slice-crash-owner.json";
const allowedModes = new Set([
  "after_fact_commit",
  "after_effect_bundle",
  "after_finalize_before_reply",
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

const [mode, token, ...extra] = process.argv.slice(2);
if (extra.length !== 0 || !allowedModes.has(mode) || typeof token !== "string" || token.length < 16) {
  fail("arguments");
}
const root = ownedRoot(token);
const runtime = openDietDatabase({ privateRuntimeRoot: root });
const service = createDietDomainService({
  database: runtime.database,
  secret,
  now: () => "2026-08-12T10:00:00.000Z",
});

if (mode === "after_fact_commit") {
  const envelope = mealEnvelope();
  const input = execution(service, envelope);
  const operation = envelope.operations[0];
  if (operation.kind !== "record_meal") fail("meal_fixture");
  const progressReservation = createContributionProgressReservation(
    runtime.database,
    preflightMealOperation(runtime.database, operation),
  );
  const prepared = prepareMealOperation({
    database: runtime.database,
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
    committedAt: "2026-08-12T10:00:00.000Z",
    sequence: 0,
    operation,
    progressReservation,
  });
  appendPreparedOperationFact(prepared.fact);
  crash(mode, input);
}

const envelope = mixedEnvelope();
const input = execution(service, envelope);
const fault = mode === "after_effect_bundle"
  ? "after_mixed_seal"
  : "after_mixed_finalize_commit";
const faultingService = createDietDomainService({
  database: runtime.database,
  secret,
  now: () => "2026-08-12T10:00:00.000Z",
  fault,
});
try {
  faultingService.execute(input);
  fail("checkpoint_not_reached");
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  if (
    (mode === "after_effect_bundle" && message !== "DIET_DOMAIN_EXECUTION_FAILED:after_mixed_seal") ||
    (mode === "after_finalize_before_reply" &&
      message !== "ENVELOPE_FINALIZE_RESPONSE_LOST:after_commit_before_reply")
  ) throw error;
}
crash(mode, input);
