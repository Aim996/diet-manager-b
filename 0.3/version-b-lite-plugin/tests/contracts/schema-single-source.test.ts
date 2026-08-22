import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";

import * as contracts from "../../src/contracts.js";
import * as publicAgentCommand from "../../src/public/agent-command.js";
import pluginEntry, {
  dietManagerParameters,
} from "../../src/openclaw/index.js";

describe("agent command machine contract", () => {
  it("uses the public shared TypeBox schema object for OpenClaw registration", () => {
    const publicSchema = Reflect.get(
      publicAgentCommand,
      "agentCommandParametersSchema",
    );
    expect(publicSchema, "the public boundary must export the shared parameter schema")
      .toBeDefined();

    const metadata = getToolPluginMetadata(pluginEntry);
    expect(dietManagerParameters).toBe(publicSchema);
    expect(metadata?.tools[0]?.parameters).toBe(publicSchema);
    expect(JSON.stringify(metadata?.tools[0]?.parameters))
      .toBe(JSON.stringify(publicSchema));
  });

  it("publishes v1, v2, semantic proposal, outcome, and progress schemas through the compatibility facade", () => {
    for (const exportName of [
      "agentCommandV1Schema",
      "agentCommandV2Schema",
      "semanticProposalV2Schema",
      "frozenIngestionOutcomeV2Schema",
      "frozenReceiptV1Schema",
      "frozenDateProgressV1Schema",
    ]) {
      expect(Reflect.get(contracts, exportName), exportName).toBeDefined();
    }
  });

  it("expresses legacy, v1, and v2 as exact alternatives in the shared machine schema", () => {
    expect(Check(dietManagerParameters, {
      action: "query_inventory",
      source_text: "查询库存",
    })).toBe(true);
    expect(Check(dietManagerParameters, {
      schema_version: "diet-manager/agent-command/v1",
      action: "query_inventory",
      source_text: "查询库存",
    })).toBe(true);
    const v2 = {
      schema_version: "diet-manager/agent-command/v2",
      action: "record_water",
      source_text: "我喝了500毫升白水",
      semantic_proposal: {
        kind: "water",
        subject: {
          kind: "self",
          basis: "explicit",
          evidence_span: "我",
          explicit_other_spans: [],
        },
        amount: {
          kind: "exact",
          value: 500,
          unit: "ml",
          evidence_span: "500毫升",
        },
        occurred_at: { kind: "unspecified", evidence_span: null },
      },
    } as const;
    expect(Check(dietManagerParameters, v2)).toBe(true);
    expect(Check(dietManagerParameters, {
      ...v2,
      schema_version: "diet-manager/agent-command/v1",
    })).toBe(false);
    expect(Check(dietManagerParameters, { ...v2, operation_id: "forged" })).toBe(false);
  });
});
