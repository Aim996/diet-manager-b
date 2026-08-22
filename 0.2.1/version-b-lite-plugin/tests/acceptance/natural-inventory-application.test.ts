import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleCoreRequest } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { openDietDatabase } from "../../src/storage/database.js";

const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "diet-manager-natural-inventory-"));
  ownedRoots.add(root);
  return root;
}

function removeRoot(root: string): void {
  if (!ownedRoots.delete(root)) throw new Error(`unregistered test root: ${root}`);
  rmSync(root, { recursive: true, force: false });
}

afterEach(() => {
  for (const root of [...ownedRoots]) removeRoot(root);
});

describe("natural brought-home inventory application", () => {
  it("persists one egg carton as an outer package without inventing an inner egg count", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-20T06:30:00.000Z",
    });
    try {
      const outcome = handleCoreRequest(runtime, {
        action: "add_inventory",
        source_text: "今天带回来一盒鸡蛋，先放进库存。",
        received_at: "2026-08-20T14:30:00+08:00",
        timezone: "Asia/Shanghai",
        operation_id: "operation-natural-inventory-001",
        source_message_id: "message-natural-inventory-001",
        conversation_id: "conversation-natural-inventory",
        prior_context: [],
      });

      expect(outcome).toMatchObject({
        action: "add_inventory",
        status: "committed",
        committed: true,
        operation_id: "operation-natural-inventory-001",
      });

      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(inspection.database.prepare(
          "SELECT normalized_name, product_type FROM products",
        ).all()).toEqual([{ normalized_name: "egg", product_type: "food" }]);
        const batch = inspection.database.prepare(
          "SELECT quantity_unit, payload_json FROM inventory_batches",
        ).get() as { quantity_unit: string; payload_json: string };
        expect(batch.quantity_unit).toBe("unknown");
        expect(JSON.parse(batch.payload_json)).toMatchObject({
          pantry_evidence: {
            package_quantity: {
              outer_count: 1,
              outer_unit: "carton",
              inner_per_outer: null,
              total_inner: null,
            },
          },
        });
        expect(inspection.database.prepare(
          "SELECT quantity_status, json_extract(payload_json, '$.quantity_microunits') AS quantity FROM inventory_batch_projections",
        ).all()).toEqual([{ quantity_status: "unknown", quantity: null }]);
      } finally {
        inspection.close();
      }
    } finally {
      runtime.close();
    }
  });
});
