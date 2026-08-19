import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import { handleCoreRequest } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";

const ownedRoots = new Set<string>();

function newOfficialDataRoot(): string {
  const root = join(tmpdir(), `diet-manager-purchase-capacity-${randomUUID().replaceAll("-", "")}`);
  mkdirSync(root, { recursive: false });
  ownedRoots.add(root);
  return root;
}

afterEach(() => {
  for (const root of [...ownedRoots]) {
    ownedRoots.delete(root);
    rmSync(root, { recursive: true, force: false });
  }
});

it("commits a one-layer capacity purchase and exposes its capacity through inventory", () => {
  const officialDataRoot = newOfficialDataRoot();
  const runtime = createCoreRuntime({
    officialDataRoot,
    now: () => "2026-08-17T08:30:01.000Z",
  });
  try {
    const purchase = handleCoreRequest(runtime, {
      action: "add_inventory",
      source_text: "买了2盒牛奶，每盒250ml",
      received_at: "2026-08-17T08:30:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "operation-purchase-capacity-001",
      source_message_id: "message-purchase-capacity-001",
      conversation_id: "conversation-purchase-capacity-001",
      prior_context: [],
    });

    expect(purchase.committed, JSON.stringify(purchase)).toBe(true);
    expect(purchase).toMatchObject({
      action: "add_inventory",
      status: "committed",
      committed: true,
    });

    const inventory = handleCoreRequest(runtime, {
      action: "query_inventory",
      source_text: "看看库存",
      received_at: "2026-08-17T08:31:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "operation-purchase-capacity-001-inventory",
      source_message_id: "message-purchase-capacity-001-inventory",
      conversation_id: "conversation-purchase-capacity-001",
      prior_context: [],
    });

    expect(inventory).toMatchObject({
      action: "query_inventory",
      status: "ignored",
      committed: false,
      inventory_view: {
        batches: [{
          name: "milk",
          quantity_microunits: 500_000_000,
          unit: "ml",
          quantity_status: "available",
          effective_status: "active",
        }],
      },
    });
    expect(inventory.inventory_view?.batches).toHaveLength(1);
  } finally {
    runtime.close();
  }
});
