// apps/backend/src/lib/riskEngine.test.ts
//
// Run with: npx tsx --test src/lib/riskEngine.test.ts
//
// Focused on signalsToContributors — the new additive helper that flattens
// RiskSignal[] into the { factor, label, contribution } shape used at API
// boundaries. Does NOT re-test the scoring functions themselves (untouched
// by this change).

import { test } from "node:test";
import assert from "node:assert/strict";
import { signalsToContributors, scoreListingAgainstPopulation, type ListingInput } from "./riskEngine.js";

function population(listings: ListingInput[]) {
  // Minimal population builder mirroring buildPopulation's shape closely
  // enough for scoreListingAgainstPopulation's needs in these tests — we
  // only exercise categoryBase/bulkQuantity/contentIndicator, which don't
  // need population stats, so an empty-ish population is fine here.
  return {
    categoryStats: new Map(),
    globalStats: { mean: 0, stddev: 0, n: 0 },
    vendorStats: new Map(),
    globalAvgVendorRate: null,
    newVendorCutoff: null,
  };
}

test("signalsToContributors sums multiple signals sharing a factor", () => {
  const contributors = signalsToContributors([
    { label: "Content indicator: a", value: 5, factor: "contentIndicator" },
    { label: "Content indicator: b", value: 5, factor: "contentIndicator" },
  ]);
  assert.equal(contributors.length, 1);
  assert.equal(contributors[0].factor, "contentIndicator");
  assert.equal(contributors[0].contribution, 10);
  assert.equal(contributors[0].label, "Content indicators");
});

test("signalsToContributors keeps distinct factors separate and sorts by contribution desc", () => {
  const contributors = signalsToContributors([
    { label: "Bulk quantity detected (500g)", value: 20, factor: "bulkQuantity" },
    { label: "Category baseline: Drugs", value: 25, factor: "categoryBase" },
  ]);
  assert.deepEqual(
    contributors.map((c) => c.factor),
    ["categoryBase", "bulkQuantity"]
  );
});

test("signalsToContributors never fabricates a value: empty input yields empty output", () => {
  assert.deepEqual(signalsToContributors([]), []);
});

test("real riskEngine output for a drug listing produces the expected canonical factors", () => {
  const listing: ListingInput = {
    id: "l1",
    category: "Drugs",
    title: "Pure fentanyl 500g bulk",
    priceUsd: 500,
    marketplace: "Valhalla",
    vendorAlias: "vendor1",
    shipsFrom: null,
    firstSeen: new Date("2016-01-01"),
    lastSeen: new Date("2016-01-01"),
  };
  const result = scoreListingAgainstPopulation(listing, population([listing]));
  const contributors = signalsToContributors(result.signals);
  const factors = contributors.map((c) => c.factor);
  assert.ok(factors.includes("categoryBase"));
  assert.ok(factors.includes("bulkQuantity"));
  assert.ok(factors.includes("contentIndicator"));
  // Every contributor value must trace back to the real signals — total
  // contribution across factors must equal the sum of raw signal values.
  const totalFromContributors = contributors.reduce((a, c) => a + c.contribution, 0);
  const totalFromSignals = result.signals.reduce((a, s) => a + s.value, 0);
  assert.equal(totalFromContributors, totalFromSignals);
});