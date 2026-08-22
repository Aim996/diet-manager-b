import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createBAdapter } from "../adapters/b.ts";
import {
  createBSliceDriver,
  extractSingleReceiptProgress,
  G2_B_SLICE_CASE_IDS,
  type G2BSliceCaseId,
} from "../adapters/b-slice-driver.ts";
import type { CaseExecutionInput, JsonValue } from "../adapters/types.ts";
import type { BCaseDriver } from "../adapters/types.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const matrix = JSON.parse(readFileSync(resolve(root, "g2-b-slice-matrix.json"), "utf8")) as {
  matrix_id: string;
  case_ids: string[];
  expected_count: number;
  adapter_id: string;
  observation_keys: Record<string, string[]>;
};
const manifest = JSON.parse(readFileSync(resolve(root, "harness-manifest.json"), "utf8")) as {
  contracts: Array<{ contract_id: string; sha256: string }>;
};
const publicCases = JSON.parse(readFileSync(resolve(root, "cases.json"), "utf8")) as {
  cases: Array<{
    id: string;
    requirement_ids: string[];
    stage: string;
    source_text: string;
    setup: Record<string, JsonValue>;
  }>;
};
const publicFixtures = JSON.parse(readFileSync(resolve(root, "fixtures", "core-v1.json"), "utf8")) as {
  environments: Array<Record<string, JsonValue>>;
  goals: Array<Record<string, JsonValue>>;
  query_views: Array<Record<string, JsonValue>>;
  domain_scenarios: Array<Record<string, JsonValue>>;
  ops_security_scenarios: Array<Record<string, JsonValue>>;
};
const sliceInputs = JSON.parse(readFileSync(resolve(root, "b-slice-inputs.json"), "utf8")) as {
  input_catalog_id: string;
  version: string;
  cases: Array<{
    id: G2BSliceCaseId;
    requirement_ids: string[];
    stage: string;
    source_text: string;
    setup: Record<string, JsonValue> & { domain_scenario: Record<string, JsonValue> };
  }>;
};

const EXPECTED: Readonly<Record<G2BSliceCaseId, JsonValue>> = Object.freeze({
  "CASE-MIXED-001": {
    mixed: [{ sequence: 0, status: "committed" }, { sequence: 1, status: "committed" }],
    inventory_sequence: [0, 24_000_000, 23_000_000],
    finalization: { count: 1, mixed_item_count: 2 },
  },
  "CASE-CORR-001": {
    fact_commit: { correction_events: 1, original_events_preserved: true },
    effect_bundle: { additional_egg_transactions: 1, remaining_microunits: 7_000_000 },
    finalization: { correction_status: "committed" },
    idempotency: { exact_replay: true, business_state_unchanged: true },
  },
  "CASE-QUERY-001": {
    query: {
      names: ["rice", "apple"],
      occurred_at: ["2026-08-11T23:30:00.000Z", "2026-08-12T00:10:00.000Z"],
      business_state_unchanged: true,
    },
  },
  "CASE-EFFECT-001": {
    failure: {
      expected_error_code: "nutrition_effect_write_failed",
      fact_commit_preserved: true,
      outbox_status: "retryable_failed",
      envelope_status: "effects_pending",
      effect_bundle_business_write_count: 0,
      success_receipt_visible: false,
      daily_progress_visible: false,
      terminal_idempotency_visible: false,
    },
    state_after_restart: {
      meal_fact_preserved: true,
      outbox_status: "retryable_failed",
      envelope_status: "effects_pending",
    },
    same_key_retry: {
      status: "committed",
      meal_fact_write_count: 0,
      nutrition_snapshot_write_count: 1,
      envelope_finalize_count: 1,
    },
  },
  "CASE-MEAL-006": {
    fact_commit: { status: "committed", item_count: 2 },
    nutrition: { snapshot_count: 2, estimated_fields: [], source_types: ["product_label", "product_label"] },
  },
  "CASE-NUTR-008": {
    nutrition: { adopted_microunits: 130_000_000, energy_kcal_milli: 130_000 },
    estimated_fields: ["nutrition_adoption_microunits"],
  },
  "CASE-MEAL-003": {
    fact_commit: { status: "committed" },
    nutrition: { adoption_microunits: 150_000_000, estimated_fields: ["nutrition_adoption_microunits"] },
    inventory: { deduction_microunits: 500_000, remaining_microunits: 2_500_000 },
  },
  "CASE-MEAL-004": {
    fact_commit: { status: "committed" },
    inventory: { match: "skipped_outside", quantity_before: 5_000_000, quantity_after: 5_000_000, transaction_delta: 0 },
  },
  "CASE-INVENTORY-003": {
    fact_commit: { status: "committed", event_count: 1 },
    effect_bundle: { inventory_match: "skipped_ambiguous", issue_codes: ["inventory_multiple_candidates"], quantity_unchanged: true },
  },
  "CASE-INVENTORY-004": {
    fact_commit: { status: "committed" },
    effect_bundle: { inventory_match: "skipped_insufficient", issue_codes: ["inventory_insufficient"], remaining_microunits: 2_000_000, negative_rows: 0 },
  },
  "CASE-NUTR-001": {
    effect_bundle: {
      profile: { source_type: "product_label", source_ref: "fixture-label-whole-milk-250-v1", profile_version: "1", coverage_status: "partial" },
      snapshot: { profile_version: "1", coverage_status: "partial" },
    },
  },
  "CASE-NUTR-002": {
    effect_bundle: { profile: { source_type: "public_fixture", source_ref: "fixture-public-pear-v1", coverage_status: "complete" }, snapshot_count: 1 },
  },
  "CASE-NUTR-005": {
    history: { versions: [1, 2], first_snapshot_unchanged: true },
    new_record: { profile_version: 2, profile_count: 2 },
  },
  "CASE-STORAGE-001": {
    idempotency: { exact_result: true, business_state_unchanged: true, meal_event_count: 1, finalization_count: 1 },
  },
  "CASE-RECEIPT-001": {
    receipt: { block_kinds: ["title", "item", "item", "item", "progress"], item_blocks: 3, progress_last: true, internal_id_visible: false },
  },
  "CASE-RECEIPT-003": {
    quick_options: {
      prompt_count: 1,
      option_ids: ["keep_original", "defer", "free_text"],
      free_text_sha256: "02D57A1894701705751DB5A81915D0272B2125F0ADD78BF3935CC06769CA2B39",
    },
  },
  "CASE-PROGRESS-010": {
    progress: {
      child_operation_count: 2,
      operation_contributions: [
        { sequence: 0, kind: "add_inventory", nutrients: null },
        {
          sequence: 1,
          kind: "record_meal",
          nutrients: {
            energy_kcal_milli: 200_000,
            protein_mg: 10_000,
            fat_mg: 4_000,
            carbohydrate_mg: 40_000,
            fiber_mg: 2_000,
            water_ml_milli: 140_000,
          },
        },
      ],
      snapshot_count: 1,
      finalization_count: 1,
      energy_kcal_milli: 200_000,
      receipt_progress: {
        energy_kcal_milli: 200_000,
        protein_mg: 10_000,
        fat_mg: 4_000,
        carbohydrate_mg: 40_000,
        fiber_mg: 2_000,
        water_ml_milli: 140_000,
      },
      finalized_progress: {
        energy_kcal_milli: 200_000,
        protein_mg: 10_000,
        fat_mg: 4_000,
        carbohydrate_mg: 40_000,
        fiber_mg: 2_000,
        water_ml_milli: 140_000,
      },
      progress_block_count: 1,
    },
  },
});

function caseInput(caseId: G2BSliceCaseId): CaseExecutionInput {
  const publicCandidate = publicCases.cases.find((value) => value.id === caseId);
  if (publicCandidate !== undefined) return publicCaseInput(caseId);
  const authority = sliceInputs.cases.find((value) => value.id === caseId);
  assert.ok(authority, `B_SLICE_INPUT_MISSING:${caseId}`);
  return {
    case_id: caseId,
    requirement_ids: [...authority.requirement_ids],
    stage: authority.stage,
    source_text: authority.source_text,
    setup: {
      environment: publicFixture(publicFixtures.environments, authority.setup.environment_fixture),
      goals: publicFixture(publicFixtures.goals, authority.setup.goals_fixture),
      query_view: publicFixture(publicFixtures.query_views, authority.setup.query_view_fixture),
      domain_scenario: structuredClone(authority.setup.domain_scenario) as JsonValue,
      ops_security_scenario: null,
      prior_context: structuredClone(authority.setup.prior_context ?? []) as JsonValue,
    },
    contract_hashes: manifest.contracts.map(({ contract_id, sha256 }) => ({ contract_id, sha256 })),
  };
}

function publicFixture(
  values: Array<Record<string, JsonValue>>,
  fixtureId: JsonValue | undefined,
): JsonValue {
  if (fixtureId === null || fixtureId === undefined) return null;
  const matches = values.filter((value) => value.fixture_id === fixtureId);
  assert.equal(matches.length, 1, `PUBLIC_FIXTURE_MISSING:${String(fixtureId)}`);
  return structuredClone(matches[0]) as JsonValue;
}

function publicCaseInput(caseId: string): CaseExecutionInput {
  const candidate = publicCases.cases.find((value) => value.id === caseId);
  assert.ok(candidate, `PUBLIC_CASE_MISSING:${caseId}`);
  return {
    case_id: candidate.id,
    requirement_ids: [...candidate.requirement_ids],
    stage: candidate.stage,
    source_text: candidate.source_text,
    setup: {
      environment: publicFixture(publicFixtures.environments, candidate.setup.environment_fixture),
      goals: publicFixture(publicFixtures.goals, candidate.setup.goals_fixture),
      query_view: publicFixture(publicFixtures.query_views, candidate.setup.query_view_fixture),
      domain_scenario: publicFixture(publicFixtures.domain_scenarios, candidate.setup.domain_scenario_fixture),
      ops_security_scenario: publicFixture(
        publicFixtures.ops_security_scenarios,
        candidate.setup.ops_security_fixture,
      ),
      prior_context: structuredClone(candidate.setup.prior_context ?? []) as JsonValue,
    },
    contract_hashes: manifest.contracts.map(({ contract_id, sha256 }) => ({ contract_id, sha256 })),
  };
}

async function runBSliceCases(
  driver: BCaseDriver = createBSliceDriver(),
  caseIds: readonly G2BSliceCaseId[] = G2_B_SLICE_CASE_IDS,
) {
  const adapter = createBAdapter(driver);
  let matched = 0;
  let failed = 0;
  const observations: Partial<Record<G2BSliceCaseId, JsonValue>> = {};
  for (const caseId of caseIds) {
    try {
      const result = await adapter.execute(caseInput(caseId));
      assert.equal(result.execution_status, "executed");
      assert.equal(result.outcome_status, "succeeded");
      assert.deepEqual(Object.keys(result.observation as object), matrix.observation_keys[caseId]);
      assert.deepEqual(result.observation, EXPECTED[caseId]);
      observations[caseId] = result.observation;
      matched += 1;
    } catch (error) {
      failed += 1;
      throw error;
    }
  }
  return Object.freeze({
    case_ids: Object.freeze([...caseIds]),
    summary: Object.freeze({
      case_count: caseIds.length,
      executed: caseIds.length,
      matched,
      mismatched: caseIds.length - matched,
      failed,
    }),
    observations: Object.freeze(observations),
  });
}

test("freezes the exact G2 B slice matrix and ID order", () => {
  assert.equal(matrix.matrix_id, "diet-manager/g2-b-slice-matrix/v1");
  assert.equal(matrix.adapter_id, "diet-manager/b-slice-execution-adapter-v1");
  assert.equal(matrix.expected_count, 17);
  assert.deepEqual(matrix.case_ids, [...G2_B_SLICE_CASE_IDS]);
  assert.deepEqual(Object.keys(EXPECTED), [...G2_B_SLICE_CASE_IDS]);
  assert.equal(sliceInputs.input_catalog_id, "diet-manager/b-slice-case-inputs/v1");
  assert.equal(sliceInputs.version, "1.0.0");
  assert.equal(sliceInputs.cases.length, 9);
  assert.deepEqual(
    [...publicCases.cases.filter((value) => matrix.case_ids.includes(value.id)).map((value) => value.id),
      ...sliceInputs.cases.map((value) => value.id)].sort(),
    [...G2_B_SLICE_CASE_IDS].sort(),
  );
});

test("rejects tampered B-slice authority before opening a runtime", async () => {
  let runtimeStarts = 0;
  const adapter = createBAdapter(createBSliceDriver(() => {
    runtimeStarts += 1;
    throw new Error("B_SLICE_RUNTIME_STARTED");
  }));
  const valid = caseInput("CASE-MIXED-001");
  const invalidInputs: CaseExecutionInput[] = [
    { ...valid, requirement_ids: ["REQ-WRONG-001"] },
    { ...valid, stage: "WRONG-STAGE" },
    { ...valid, source_text: "wrong-source" },
    {
      ...valid,
      setup: {
        ...(valid.setup as Record<string, JsonValue>),
        prior_context: ["tampered"],
      },
    },
    { ...valid, contract_hashes: [] },
    {
      ...valid,
      contract_hashes: valid.contract_hashes.map((entry, index) => index === 0
        ? { ...entry, sha256: "0".repeat(64) }
        : entry),
    },
  ];
  for (const invalid of invalidInputs) {
    await assert.rejects(adapter.execute(invalid), /B_SLICE_INPUT_AUTHORITY_INVALID/);
  }
  assert.equal(runtimeStarts, 0);
});

test("binds a public case requirement and resolved fixture before opening a runtime", async () => {
  let runtimeStarts = 0;
  const adapter = createBAdapter(createBSliceDriver(() => {
    runtimeStarts += 1;
    throw new Error("B_SLICE_RUNTIME_STARTED");
  }));
  const valid = publicCaseInput("CASE-EFFECT-001");
  assert.deepEqual(valid.requirement_ids, ["REQ-SAFE-002"]);
  assert.equal(
    (valid.setup as { domain_scenario: { fixture_id: string } }).domain_scenario.fixture_id,
    "domain-effect-nutrition-failure-v1",
  );
  await assert.rejects(adapter.execute(valid), /B_SLICE_RUNTIME_STARTED/);
  assert.equal(runtimeStarts, 1);

  await assert.rejects(
    adapter.execute({ ...valid, requirement_ids: ["REQ-SAFE-002", "REQ-WRONG-001"] }),
    /B_SLICE_INPUT_AUTHORITY_INVALID/,
  );
  const changedSetup = structuredClone(valid.setup) as {
    domain_scenario: { fixture_id: string };
  };
  changedSetup.domain_scenario.fixture_id = "domain-finalizer-failure-concurrent-v1";
  await assert.rejects(
    adapter.execute({ ...valid, setup: changedSetup }),
    /B_SLICE_INPUT_AUTHORITY_INVALID/,
  );
  assert.equal(runtimeStarts, 1);
});

test("executes exactly the G2 B-only responsibility set", async () => {
  const report = await runBSliceCases();
  assert.deepEqual(report.case_ids, G2_B_SLICE_CASE_IDS);
  assert.deepEqual(report.summary, {
    case_count: 17,
    executed: 17,
    matched: 17,
    mismatched: 0,
    failed: 0,
  });
});

test("CASE-PROGRESS-010 observes two child contributions but freezes one envelope aggregate", async () => {
  const report = await runBSliceCases(createBSliceDriver(), ["CASE-PROGRESS-010"]);
  assert.deepEqual(report.observations["CASE-PROGRESS-010"], EXPECTED["CASE-PROGRESS-010"]);
});

test("reads the unique real receipt progress block instead of top-level progress", () => {
  const topLevel = {
    energy_kcal_milli: 100_000,
    protein_mg: 5_000,
    fat_mg: 2_000,
    carbohydrate_mg: 20_000,
    fiber_mg: 1_000,
    water_ml_milli: 70_000,
  };
  const receiptBlock = {
    energy_kcal_milli: 200_000,
    protein_mg: 10_000,
    fat_mg: 4_000,
    carbohydrate_mg: 40_000,
    fiber_mg: 2_000,
    water_ml_milli: 140_000,
  };
  assert.deepEqual(extractSingleReceiptProgress({
    daily_progress: { nutrients: topLevel },
    receipt_data: {
      authority_kind: "diet-manager/receipt-data/v1",
      status: "success",
      blocks: [
        { kind: "title" },
        { kind: "progress", daily_progress: {
          date: "2026-08-12",
          timezone: "Asia/Shanghai",
          coverage_status: "complete",
          nutrients: receiptBlock,
        } },
      ],
    },
  }), receiptBlock);
  assert.throws(() => extractSingleReceiptProgress({
    daily_progress: { nutrients: topLevel },
    receipt_data: {
      authority_kind: "diet-manager/receipt-data/v1",
      status: "success",
      blocks: [{ kind: "title" }],
    },
  }), /B_SLICE_RECEIPT_PROGRESS_INVALID:count/);
  assert.throws(() => extractSingleReceiptProgress({
    daily_progress: { nutrients: topLevel },
    receipt_data: {
      authority_kind: "diet-manager/receipt-data/v1",
      status: "success",
      blocks: [
        { kind: "progress", daily_progress: {
          date: "2026-08-12", timezone: "Asia/Shanghai", coverage_status: "complete",
          nutrients: receiptBlock,
        } },
        { kind: "progress", daily_progress: {
          date: "2026-08-12", timezone: "Asia/Shanghai", coverage_status: "complete",
          nutrients: receiptBlock,
        } },
      ],
    },
  }), /B_SLICE_RECEIPT_PROGRESS_INVALID:count/);
});

test("the independent expectations reject mutations at the real observation boundary", async () => {
  const mutations: ReadonlyArray<readonly [G2BSliceCaseId, (value: Record<string, unknown>) => void]> = [
    ["CASE-MIXED-001", (value) => {
      (value.mixed as unknown[]).reverse();
    }],
    ["CASE-MEAL-003", (value) => {
      (value.inventory as { deduction_microunits: number }).deduction_microunits = 150_000_000;
    }],
    ["CASE-MEAL-004", (value) => {
      (value.inventory as { transaction_delta: number }).transaction_delta = 1;
    }],
    ["CASE-INVENTORY-003", (value) => {
      (value.effect_bundle as { inventory_match: string }).inventory_match = "matched";
    }],
    ["CASE-NUTR-001", (value) => {
      ((value.effect_bundle as { snapshot: { coverage_status: string } }).snapshot).coverage_status = "complete";
    }],
    ["CASE-NUTR-005", (value) => {
      (value.history as { versions: number[] }).versions[0] = 2;
    }],
    ["CASE-CORR-001", (value) => {
      (value.fact_commit as { original_events_preserved: boolean }).original_events_preserved = false;
    }],
    ["CASE-STORAGE-001", (value) => {
      (value.idempotency as { business_state_unchanged: boolean }).business_state_unchanged = false;
    }],
    ["CASE-PROGRESS-010", (value) => {
      (value.progress as { receipt_progress: { energy_kcal_milli: number } })
        .receipt_progress.energy_kcal_milli = 300_000;
    }],
    ["CASE-EFFECT-001", (value) => {
      (value.failure as { success_receipt_visible: boolean }).success_receipt_visible = true;
    }],
  ];
  for (const [caseId, mutate] of mutations) {
    const realDriver = createBSliceDriver();
    const mutantDriver: BCaseDriver = async (input) => {
      const actual = await realDriver(input);
      const observation = structuredClone(actual.observation) as Record<string, unknown>;
      mutate(observation);
      return Object.freeze({ ...actual, observation: observation as JsonValue });
    };
    await assert.rejects(
      runBSliceCases(mutantDriver, [caseId]),
      assert.AssertionError,
      `MUTATION_WAS_NOT_CAUGHT:${caseId}`,
    );
  }
});
