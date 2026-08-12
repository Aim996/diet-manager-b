import type {
  DomainEnvelopeInput,
  InventoryMatchInput,
  NutritionSourceCandidate,
} from "../../src/domain/types.js";

export function sampleEnvelope(): DomainEnvelopeInput {
  return {
    envelope_id: "envelope-001",
    idempotency_key: "idem-001",
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: "message-001",
    conversation_id: "conversation-001",
    received_at: "2026-08-12T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [],
  };
}

export function homeRiceMatch(): InventoryMatchInput {
  return {
    location: "home",
    requested_unit: "bowl",
    observed_microunits: 1_000_000,
    nutrition_adoption_microunits: 150_000_000,
    inventory_deduction_microunits: 1_000_000,
    template_reference_microunits: null,
    candidates: [
      {
        batch_id: "batch-rice-001",
        product_id: "product-rice-001",
        available_microunits: 3_000_000,
        unit: "bowl",
      },
    ],
  };
}

export function outsideAppleMatch(): InventoryMatchInput {
  return {
    location: "outside",
    requested_unit: "piece",
    observed_microunits: 1_000_000,
    nutrition_adoption_microunits: 1_000_000,
    inventory_deduction_microunits: 1_000_000,
    template_reference_microunits: null,
    candidates: [],
  };
}

export function ambiguousMilkMatch(): InventoryMatchInput {
  return {
    location: "home",
    requested_unit: "carton",
    observed_microunits: 1_000_000,
    nutrition_adoption_microunits: 250_000_000,
    inventory_deduction_microunits: 1_000_000,
    template_reference_microunits: null,
    candidates: [
      {
        batch_id: "batch-milk-a",
        product_id: "product-milk-a",
        available_microunits: 6_000_000,
        unit: "carton",
      },
      {
        batch_id: "batch-milk-b",
        product_id: "product-milk-b",
        available_microunits: 8_000_000,
        unit: "carton",
      },
    ],
  };
}

export function insufficientEggMatch(): InventoryMatchInput {
  return {
    location: "home",
    requested_unit: "piece",
    observed_microunits: 3_000_000,
    nutrition_adoption_microunits: 3_000_000,
    inventory_deduction_microunits: 3_000_000,
    template_reference_microunits: null,
    candidates: [
      {
        batch_id: "batch-eggs-001",
        product_id: "product-eggs-001",
        available_microunits: 2_000_000,
        unit: "piece",
      },
    ],
  };
}

export function labelAndPublicNutrition(): readonly NutritionSourceCandidate[] {
  return [
    {
      source_type: "public_fixture",
      source_ref: "cn-food-rice-v1",
      profile_version: 1,
      applicable_product_id: null,
      nutrients: {
        energy_kcal_milli: 130_000,
        protein_mg: 2_700,
        fat_mg: 300,
        carbohydrate_mg: 28_000,
        fiber_mg: 400,
        water_ml_milli: 68_000,
      },
    },
    {
      source_type: "product_label",
      source_ref: "label-whole-milk-250-v1",
      profile_version: 1,
      applicable_product_id: "product-milk-001",
      nutrients: {
        energy_kcal_milli: 160_000,
        protein_mg: 8_000,
        fat_mg: 9_000,
        carbohydrate_mg: 12_000,
        fiber_mg: null,
        water_ml_milli: null,
      },
    },
  ];
}
