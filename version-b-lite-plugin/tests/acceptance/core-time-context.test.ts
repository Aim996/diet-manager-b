import { describe, expect, it } from "vitest";

import casesCatalog from "../../../shared/acceptance-cases/cases.json";
import fixturesCatalog from "../../../shared/acceptance-cases/fixtures/core-v1.json";
import { resolveMealContext } from "../../src/parser/context.js";
import { resolveOccurredTime } from "../../src/parser/time.js";
import type {
  CoreContextEntry,
  CoreParseInput,
  OccurredTimeEvidence,
  OffsetIsoTimestamp,
} from "../../src/parser/types.js";

interface CatalogCase {
  readonly id: string;
  readonly source_text: string;
  readonly setup: {
    readonly environment_fixture: string;
    readonly prior_context: readonly CoreContextEntry[];
    readonly domain_scenario_fixture?: string;
  };
  readonly oracle: {
    readonly parsing: {
      readonly disposition: string;
      readonly occurred_time?: OccurredTimeEvidence;
      readonly context?: {
        readonly scene: "home" | "outside" | "company" | "unknown";
        readonly expired_context_ids: readonly string[];
        readonly inventory_read: boolean;
      };
      readonly time_anchors?: {
        readonly stocked_at: OffsetIsoTimestamp;
        readonly received_at: OffsetIsoTimestamp;
        readonly ingestion_at: null;
        readonly expiration_resolution_basis: "stocked_at";
        readonly estimated_expires_at: OffsetIsoTimestamp;
        readonly rule_version: string;
      };
    };
  };
}

interface EnvironmentFixture {
  readonly fixture_id: string;
  readonly clock: OffsetIsoTimestamp;
  readonly timezone: "Asia/Shanghai";
}

interface ShelfLifeFixture {
  readonly fixture_id: string;
  readonly time_anchors: {
    readonly stocked_at: OffsetIsoTimestamp;
    readonly received_at: OffsetIsoTimestamp;
    readonly ingestion_at: null;
    readonly timezone: "Asia/Shanghai";
  };
  readonly expected: {
    readonly estimated_expires_at: OffsetIsoTimestamp;
    readonly resolution_basis: "stocked_at";
    readonly must_not_anchor_to: "ingestion_at";
  };
}

const catalogCases = new Map(
  (casesCatalog.cases as readonly unknown[] as readonly CatalogCase[]).map((entry) => [entry.id, entry]),
);
const environmentFixtures = new Map(
  (fixturesCatalog.environments as readonly unknown[] as readonly EnvironmentFixture[])
    .map((entry) => [entry.fixture_id, entry]),
);
const domainFixtures = new Map(
  (fixturesCatalog.domain_scenarios as readonly unknown[] as readonly { readonly fixture_id: string }[])
    .map((entry) => [entry.fixture_id, entry]),
);

function catalogCase(id: string): CatalogCase {
  const entry = catalogCases.get(id);
  if (entry === undefined) throw new Error(`missing acceptance case: ${id}`);
  return entry;
}

function environmentFor(entry: CatalogCase): EnvironmentFixture {
  const fixture = environmentFixtures.get(entry.setup.environment_fixture);
  if (fixture === undefined) {
    throw new Error(`missing environment fixture: ${entry.setup.environment_fixture}`);
  }
  return fixture;
}

function occurredOracle(id: string): OccurredTimeEvidence {
  const oracle = catalogCase(id).oracle.parsing.occurred_time;
  if (oracle === undefined) throw new Error(`missing occurred-time oracle: ${id}`);
  return oracle;
}

function resolveCatalogTime(id: string): OccurredTimeEvidence {
  const entry = catalogCase(id);
  return resolveOccurredTime(entry.source_text, environmentFor(entry).clock);
}

function contextInput(
  entry: CatalogCase,
  priorContext: readonly CoreContextEntry[] = entry.setup.prior_context,
  overrides: Partial<Pick<CoreParseInput, "source_text" | "conversation_id" | "source_message_id">> = {},
  occurredTime?: OccurredTimeEvidence,
) {
  const environment = environmentFor(entry);
  return {
    source_text: overrides.source_text ?? entry.source_text,
    received_at: environment.clock,
    conversation_id: overrides.conversation_id ?? "conversation-core-v1",
    source_message_id: overrides.source_message_id ?? "message-meal-current",
    prior_context: priorContext,
    occurred_time: occurredTime,
  } as const;
}

function validContextFromCatalog(): CoreContextEntry {
  const expired = catalogCase("CASE-MEAL-020").setup.prior_context[0];
  const environment = environmentFor(catalogCase("CASE-MEAL-020"));
  return {
    ...expired,
    generated_at: "2026-08-11T08:20:00+08:00",
    valid_until: "2026-08-11T08:40:00+08:00",
    conversation_id: "conversation-core-v1",
    source_message_id: "message-meal-020-prior",
    revision: 1,
    rule_version: "diet-manager/context-v1",
    scope: "meal_date",
    scene: "company",
  } satisfies CoreContextEntry;
}

describe("core occurred-time resolution", () => {
  it.each(["CASE-MEAL-002", "CASE-MEAL-012", "CASE-MEAL-013", "CASE-MEAL-014"])(
    "matches the frozen occurred-time oracle for %s",
    (id) => {
      expect(resolveCatalogTime(id)).toEqual(occurredOracle(id));
    },
  );

  it("uses Asia/Shanghai calendar math independently of the host timezone", () => {
    const before = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      const westCoastHost = resolveCatalogTime("CASE-MEAL-012");
      process.env.TZ = "UTC";
      const utcHost = resolveCatalogTime("CASE-MEAL-012");

      expect(westCoastHost).toEqual(occurredOracle("CASE-MEAL-012"));
      expect(utcHost).toEqual(occurredOracle("CASE-MEAL-012"));
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it("treats an explicit offset ISO timestamp as occurrence evidence", () => {
    const purchase = catalogCase("CASE-PURCHASE-004");
    const fixture = domainFixtures.get(purchase.setup.domain_scenario_fixture ?? "") as ShelfLifeFixture | undefined;
    if (fixture === undefined) throw new Error("missing shelf-life fixture");
    const sourceText = `${purchase.source_text} ${fixture.time_anchors.stocked_at}`;

    expect(resolveOccurredTime(sourceText, fixture.time_anchors.received_at)).toMatchObject({
      raw_text: fixture.time_anchors.stocked_at,
      resolved_start: fixture.time_anchors.stocked_at,
      resolved_end: "2026-08-10T16:01:00+08:00",
      precision: "exact",
      timezone: fixture.time_anchors.timezone,
      resolution_basis: "explicit",
      resolution_anchor: fixture.time_anchors.received_at,
      resolver_version: "diet-manager/time-parser-v1",
    });
  });

  it("does not turn purchase or shelf-life evidence into an ingestion date", () => {
    const meal = catalogCase("CASE-MEAL-002");
    const purchase = catalogCase("CASE-PURCHASE-004");
    const fixture = domainFixtures.get(purchase.setup.domain_scenario_fixture ?? "") as ShelfLifeFixture | undefined;
    if (fixture === undefined) throw new Error("missing shelf-life fixture");
    const purchaseOracle = purchase.oracle.parsing.time_anchors;
    if (purchaseOracle === undefined) throw new Error("missing purchase time-anchor oracle");

    expect(resolveCatalogTime(meal.id)).toEqual(occurredOracle(meal.id));
    expect(resolveOccurredTime(purchase.source_text, fixture.time_anchors.received_at)).toMatchObject({
      raw_text: null,
      resolved_start: purchaseOracle.received_at,
      resolution_basis: "default_received_at",
      resolution_anchor: purchaseOracle.received_at,
    });
    expect(fixture.time_anchors.ingestion_at).toBeNull();
    expect(purchaseOracle.expiration_resolution_basis).toBe(fixture.expected.resolution_basis);
    expect(purchaseOracle.estimated_expires_at).toBe(fixture.expected.estimated_expires_at);
    expect(fixture.expected.must_not_anchor_to).toBe("ingestion_at");
  });
});

describe("bounded meal context resolution", () => {
  it("ignores the expired company context and keeps the inventory-read intent from CASE-MEAL-020", () => {
    const entry = catalogCase("CASE-MEAL-020");
    const oracle = entry.oracle.parsing.context;
    if (oracle === undefined) throw new Error("missing context oracle");

    const result = resolveMealContext(contextInput(entry));

    expect({
      scene: result.scene,
      expired_context_ids: result.expired_context_ids,
      inventory_read: result.inventory_read,
    }).toEqual(oracle);
    expect(result.accepted_context).toBeNull();
    expect(result.rule_version).toBe("diet-manager/context-v1");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.expired_context_ids)).toBe(true);
  });

  it("copies one valid exact-conversation context and detaches the evidence", () => {
    const entry = catalogCase("CASE-MEAL-020");
    const mutable = { ...validContextFromCatalog() };

    const result = resolveMealContext(contextInput(entry, [mutable]));
    mutable.scene = "home";

    expect(result).toMatchObject({
      scene: "company",
      expired_context_ids: [],
      inventory_read: true,
      accepted_context: {
        context_id: "context-meal-020-expired-v1",
        conversation_id: "conversation-core-v1",
        revision: 1,
        generated_at: "2026-08-11T08:20:00+08:00",
        valid_until: "2026-08-11T08:40:00+08:00",
        source_message_id: "message-meal-020-prior",
        rule_version: "diet-manager/context-v1",
        scope: "meal_date",
        scene: "company",
      },
      rule_version: "diet-manager/context-v1",
    });
    expect(Object.isFrozen(result.accepted_context)).toBe(true);
  });

  it("rejects another conversation, the current source message, and a zero revision", () => {
    const entry = catalogCase("CASE-MEAL-020");
    const valid = validContextFromCatalog();
    const invalidEntries = [
      { ...valid, conversation_id: "conversation-other" },
      { ...valid, source_message_id: "message-meal-current" },
      { ...valid, revision: 0 },
    ] as const;

    for (const invalid of invalidEntries) {
      expect(resolveMealContext(contextInput(entry, [invalid])).accepted_context).toBeNull();
    }
  });

  it("accepts only the newest revision of one source message", () => {
    const entry = catalogCase("CASE-MEAL-020");
    const first = validContextFromCatalog();
    const second = { ...first, context_id: "context-meal-020-current-v2", revision: 2, scene: "home" as const };

    const result = resolveMealContext(contextInput(entry, [first, second]));

    expect(result.scene).toBe("home");
    expect(result.accepted_context).toMatchObject({
      context_id: "context-meal-020-current-v2",
      source_message_id: first.source_message_id,
      revision: 2,
      scene: "home",
    });
  });

  it("rejects future, expired, cross-date, wrong-rule, and explicitly corrected context", () => {
    const entry = catalogCase("CASE-MEAL-020");
    const valid = validContextFromCatalog();
    const invalidEntries = [
      { ...valid, generated_at: "2026-08-11T08:31:00+08:00" as OffsetIsoTimestamp },
      { ...valid, valid_until: "2026-08-11T08:30:00+08:00" as OffsetIsoTimestamp },
      {
        ...valid,
        generated_at: "2026-08-10T23:50:00+08:00" as OffsetIsoTimestamp,
        valid_until: "2026-08-11T08:40:00+08:00" as OffsetIsoTimestamp,
      },
      { ...valid, rule_version: "diet-manager/context-v0" as "diet-manager/context-v1" },
    ];

    for (const invalid of invalidEntries) {
      expect(resolveMealContext(contextInput(entry, [invalid])).accepted_context).toBeNull();
    }

    const corrected = resolveMealContext(contextInput(entry, [valid], {
      source_text: `更正：${entry.source_text}`,
    }));
    expect(corrected.accepted_context).toBeNull();
    expect(corrected.scene).toBe("unknown");
  });
});
