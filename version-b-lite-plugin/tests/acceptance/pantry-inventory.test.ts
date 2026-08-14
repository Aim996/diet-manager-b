import { describe, expect, it } from "vitest";

import {
  PantryEvidenceAuthorityError,
  resolveInventoryAllocation,
  type InventoryAllocationInput,
} from "../../src/domain/inventory-service.js";
import { resolveInventoryMatch } from "../../src/domain/rules.js";

function candidate(options: {
  batch: string;
  product?: string;
  fingerprint?: string;
  available: number;
  unit?: string;
  expiration?: string | null;
  stocked?: string;
  status?: "available" | "expired" | "unavailable";
}) {
  return {
    product_id: options.product ?? "product-milk-whole-250",
    product_identity_fingerprint: options.fingerprint ?? "A".repeat(64),
    batch_id: options.batch,
    available_microunits: options.available,
    unit: options.unit ?? "carton",
    effective_expiration_at: options.expiration ?? null,
    stocked_at: options.stocked ?? "2026-08-10T08:30:00+08:00",
    effective_status: options.status ?? "available",
  } as const;
}

function input(overrides: Partial<InventoryAllocationInput> = {}): InventoryAllocationInput {
  return {
    location: "home",
    explicit_skip: false,
    requested_microunits: 1_000_000,
    unit: "carton",
    specified_batch_id: null,
    candidates: [candidate({ batch: "batch-milk-001", available: 6_000_000 })],
    ...overrides,
  };
}

describe("SEL-PANTRY-001 FEFO/FIFO inventory allocation", () => {
  it("short-circuits outside, explicit-skip and unknown-amount paths without reading candidates", () => {
    let traps = 0;
    const candidates = new Proxy([], {
      get() { traps += 1; throw new Error("candidate access"); },
      getOwnPropertyDescriptor() { traps += 1; throw new Error("candidate descriptor"); },
      ownKeys() { traps += 1; throw new Error("candidate keys"); },
    });
    expect(resolveInventoryAllocation(input({ location: "outside", candidates }))).toEqual({
      status: "skipped_outside",
      requested_microunits: 1_000_000,
      unit: "carton",
      allocations: [],
      candidate_count: 0,
      issue_code: null,
      read_required: false,
    });
    expect(resolveInventoryAllocation(input({ explicit_skip: true, candidates }))).toEqual({
      status: "skipped_by_user",
      requested_microunits: 1_000_000,
      unit: "carton",
      allocations: [],
      candidate_count: 0,
      issue_code: null,
      read_required: false,
    });
    expect(resolveInventoryAllocation(input({ requested_microunits: null, candidates }))).toEqual({
      status: "skipped_amount_unknown",
      requested_microunits: null,
      unit: "carton",
      allocations: [],
      candidate_count: 0,
      issue_code: "inventory_amount_unknown",
      read_required: false,
    });
    expect(traps).toBe(0);
  });

  it("allocates one sufficient exact batch", () => {
    expect(resolveInventoryAllocation(input())).toEqual({
      status: "matched",
      requested_microunits: 1_000_000,
      unit: "carton",
      allocations: [{
        product_id: "product-milk-whole-250",
        batch_id: "batch-milk-001",
        before_microunits: 6_000_000,
        deducted_microunits: 1_000_000,
        after_microunits: 5_000_000,
        unit: "carton",
        selection_basis: "fifo",
      }],
      candidate_count: 1,
      issue_code: null,
      read_required: true,
    });
  });

  it("allocates across same-product batches in FEFO then FIFO order", () => {
    expect(resolveInventoryAllocation(input({
      requested_microunits: 2_000_000,
      candidates: [
        candidate({ batch: "batch-later", available: 1_000_000, expiration: "2026-08-13T08:30:00+08:00", stocked: "2026-08-09T08:30:00+08:00" }),
        candidate({ batch: "batch-first", available: 1_000_000, expiration: "2026-08-12T08:30:00+08:00", stocked: "2026-08-10T08:30:00+08:00" }),
        candidate({ batch: "batch-no-expiry", available: 1_000_000, expiration: null, stocked: "2026-08-08T08:30:00+08:00" }),
      ],
    }))).toMatchObject({
      status: "matched",
      candidate_count: 3,
      allocations: [
        { batch_id: "batch-first", deducted_microunits: 1_000_000, selection_basis: "fefo" },
        { batch_id: "batch-later", deducted_microunits: 1_000_000, selection_basis: "fefo" },
      ],
    });
  });

  it("uses stocked time then ordinal batch ID as the stable FIFO tie-break", () => {
    expect(resolveInventoryAllocation(input({
      requested_microunits: 2_000_000,
      candidates: [
        candidate({ batch: "batch-z", available: 1_000_000, stocked: "2026-08-10T08:30:00+08:00" }),
        candidate({ batch: "batch-b", available: 1_000_000, stocked: "2026-08-09T08:30:00+08:00" }),
        candidate({ batch: "batch-a", available: 1_000_000, stocked: "2026-08-09T08:30:00+08:00" }),
      ],
    }))).toMatchObject({
      status: "matched",
      allocations: [
        { batch_id: "batch-a", selection_basis: "fifo" },
        { batch_id: "batch-b", selection_basis: "fifo" },
      ],
    });
  });

  it("prioritizes an explicit compatible batch before FEFO", () => {
    expect(resolveInventoryAllocation(input({
      specified_batch_id: "batch-specified",
      candidates: [
        candidate({ batch: "batch-fefo", available: 1_000_000, expiration: "2026-08-12T08:30:00+08:00" }),
        candidate({ batch: "batch-specified", available: 1_000_000, expiration: "2026-08-20T08:30:00+08:00" }),
      ],
    }))).toMatchObject({
      status: "matched",
      allocations: [{ batch_id: "batch-specified", selection_basis: "explicit_batch" }],
    });
  });

  it("excludes expired batches and leaves them unchanged", () => {
    expect(resolveInventoryAllocation(input({
      candidates: [
        candidate({ batch: "batch-expired", available: 2_000_000, status: "expired", expiration: "2026-08-10T08:30:00+08:00" }),
        candidate({ batch: "batch-fresh", available: 1_000_000, expiration: "2026-08-12T08:30:00+08:00" }),
      ],
    }))).toMatchObject({
      status: "matched",
      candidate_count: 1,
      allocations: [{ batch_id: "batch-fresh", before_microunits: 1_000_000, after_microunits: 0 }],
    });
  });

  it("rejects multiple exact product identities without allocating", () => {
    expect(resolveInventoryAllocation(input({
      candidates: [
        candidate({ batch: "batch-whole", available: 2_000_000, fingerprint: "A".repeat(64) }),
        candidate({ batch: "batch-lowfat", available: 2_000_000, product: "product-milk-lowfat", fingerprint: "B".repeat(64) }),
      ],
    }))).toEqual({
      status: "skipped_ambiguous",
      requested_microunits: 1_000_000,
      unit: "carton",
      allocations: [],
      candidate_count: 2,
      issue_code: "inventory_multiple_candidates",
      read_required: true,
    });
  });

  it("rejects unit-incompatible stock without converting nutrition amounts", () => {
    expect(resolveInventoryAllocation(input({
      unit: "g",
      requested_microunits: 100_000_000,
      candidates: [candidate({ batch: "batch-rice", product: "product-rice", available: 1_000_000, unit: "bag" })],
    }))).toEqual({
      status: "skipped_unit_incompatible",
      requested_microunits: 100_000_000,
      unit: "g",
      allocations: [],
      candidate_count: 1,
      issue_code: "inventory_unit_conversion_unproven",
      read_required: true,
    });
  });

  it("uses all-or-none semantics when total stock is insufficient", () => {
    expect(resolveInventoryAllocation(input({
      requested_microunits: 2_000_000,
      candidates: [candidate({ batch: "batch-half", available: 500_000 })],
    }))).toEqual({
      status: "skipped_insufficient",
      requested_microunits: 2_000_000,
      unit: "carton",
      allocations: [],
      candidate_count: 1,
      issue_code: "inventory_insufficient",
      read_required: true,
    });
  });

  it("keeps the legacy single-match decision object exact", () => {
    expect(resolveInventoryMatch({
      location: "home",
      requested_unit: "carton",
      observed_microunits: 1_000_000,
      nutrition_adoption_microunits: 1_000_000,
      inventory_deduction_microunits: 1_000_000,
      template_reference_microunits: null,
      candidates: [{
        batch_id: "legacy-batch",
        product_id: "legacy-product",
        available_microunits: 2_000_000,
        unit: "carton",
      }],
    })).toEqual({
      status: "matched",
      batch_id: "legacy-batch",
      product_id: "legacy-product",
      deduction_microunits: 1_000_000,
      unit: "carton",
      issue_code: null,
    });
  });

  it("rejects unsafe candidate quantities instead of wrapping or going negative", () => {
    expect(() => resolveInventoryAllocation(input({
      candidates: [candidate({ batch: "unsafe", available: Number.MAX_SAFE_INTEGER + 1 })],
    }))).toThrow(PantryEvidenceAuthorityError);
  });
});
