// apps/backend/src/lib/entityCorrelation.test.ts
//
// Deterministic tests for the multi-signal entity correlation layer.
// Uses Node's built-in test runner (node:test) — no new dependency, run
// with: `node --import tsx --test src/lib/entityCorrelation.test.ts`
// (or `npx tsx --test src/lib/entityCorrelation.test.ts`).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  correlateListings,
  getCorrelationForAlias,
  normalizeVendorAlias,
  titleSimilarity,
} from "./entityCorrelation.js";
import type { ListingInput } from "./riskEngine.js";

let idCounter = 0;
function listing(overrides: Partial<ListingInput>): ListingInput {
  idCounter++;
  return {
    id: `l${idCounter}`,
    category: "Drugs",
    title: "Generic listing",
    priceUsd: 20,
    marketplace: "Valhalla",
    vendorAlias: "vendor",
    shipsFrom: null,
    firstSeen: new Date("2016-10-01"),
    lastSeen: new Date("2016-10-01"),
    ...overrides,
  };
}

test("exact normalized alias match groups listings together", () => {
  const listings = [
    listing({ vendorAlias: "pure12", title: "MST Morphine sulphate tablets 100mg" }),
    listing({ vendorAlias: "pure12", title: "Morphine sulphate tablets continus 30mg" }),
  ];
  const result = correlateListings(listings);
  assert.equal(result.groups.size, 1);
  const group = result.groups.get("pure12")!;
  assert.equal(group.listingCount, 2);
  assert.ok(group.matchedSignals.includes("normalized_vendor_alias"));
});

test("case differences normalize into the same group", () => {
  const listings = [listing({ vendorAlias: "DutchDrugz" }), listing({ vendorAlias: "dutchdrugz" })];
  const result = correlateListings(listings);
  assert.equal(result.groups.size, 1);
  const group = result.groups.get("dutchdrugz")!;
  assert.equal(group.listingCount, 2);
  assert.equal(group.rawAliasVariants.length, 2);
});

test("whitespace differences normalize into the same group", () => {
  const listings = [listing({ vendorAlias: "  pure12 " }), listing({ vendorAlias: "pure12" }), listing({ vendorAlias: "pure  12" })];
  const result = correlateListings(listings);
  // "pure  12" collapses to "pure 12" which is distinct from "pure12" —
  // whitespace COLLAPSING (not stripping) is intentional and conservative.
  assert.equal(result.groups.size, 2);
  assert.equal(result.groups.get("pure12")!.listingCount, 2);
  assert.equal(result.groups.get("pure 12")!.listingCount, 1);
});

test("same category but unrelated vendors are never merged", () => {
  const listings = [
    listing({ vendorAlias: "vendorA", category: "Drugs", title: "White powder special" }),
    listing({ vendorAlias: "vendorB", category: "Drugs", title: "Blue pills wholesale" }),
  ];
  const result = correlateListings(listings);
  assert.equal(result.groups.size, 2);
  for (const group of result.groups.values()) {
    assert.ok(!group.matchedSignals.includes("category_consistency") || group.listingCount < 2);
  }
});

test("similar titles but different vendor aliases are never merged", () => {
  const listings = [
    listing({ vendorAlias: "vendorA", title: "Premium uncut heroin brown powder 10g" }),
    listing({ vendorAlias: "vendorB", title: "Premium uncut heroin brown powder 10g" }),
  ];
  const result = correlateListings(listings);
  // Even with identical titles, different aliases must remain separate
  // entities — title similarity can never merge across aliases.
  assert.equal(result.groups.size, 2);
  assert.equal(result.groups.get("vendora")!.listingCount, 1);
  assert.equal(result.groups.get("vendorb")!.listingCount, 1);
});

test("cross-marketplace correlation strengthens confidence for the same alias", () => {
  const listings = [
    listing({ vendorAlias: "dutchdrugz", marketplace: "Valhalla", title: "Batch A cocaine 1g" }),
    listing({ vendorAlias: "dutchdrugz", marketplace: "Hansa", title: "Batch A cocaine 1g" }),
  ];
  const result = correlateListings(listings);
  const group = result.groups.get("dutchdrugz")!;
  assert.ok(group.matchedSignals.includes("cross_marketplace"));
  assert.equal(group.marketplaces.length, 2);

  const singleMarket = correlateListings([
    listing({ vendorAlias: "soloseller", marketplace: "Valhalla" }),
    listing({ vendorAlias: "soloseller", marketplace: "Valhalla" }),
  ]).groups.get("soloseller")!;
  assert.ok(!singleMarket.matchedSignals.includes("cross_marketplace"));
  assert.ok(group.confidence > singleMarket.confidence);
});

test("insufficient evidence (single listing) yields low confidence and few signals", () => {
  const result = correlateListings([listing({ vendorAlias: "newbie", title: "x" })]);
  const group = result.groups.get("newbie")!;
  assert.deepEqual(group.matchedSignals, ["normalized_vendor_alias"]);
  assert.equal(group.confidence, 40); // base weight only
});

test("conflicting signals (same alias, inconsistent categories/titles) still group by alias but score lower", () => {
  const listings = [
    listing({ vendorAlias: "chaosvendor", category: "Drugs", title: "Cocaine batch" }),
    listing({ vendorAlias: "chaosvendor", category: "Digital Goods", title: "VPN account access" }),
    listing({ vendorAlias: "chaosvendor", category: "Erotica", title: "Photo set bundle" }),
  ];
  const result = correlateListings(listings);
  const group = result.groups.get("chaosvendor")!;
  assert.equal(group.listingCount, 3);
  assert.ok(!group.matchedSignals.includes("category_consistency"));
  assert.ok(!group.matchedSignals.includes("title_similarity"));

  const consistent = correlateListings([
    listing({ vendorAlias: "focusedvendor", category: "Drugs", title: "Cocaine 1g pure batch" }),
    listing({ vendorAlias: "focusedvendor", category: "Drugs", title: "Cocaine 2g pure batch" }),
    listing({ vendorAlias: "focusedvendor", category: "Drugs", title: "Cocaine 5g pure batch" }),
  ]).groups.get("focusedvendor")!;
  assert.ok(group.confidence < consistent.confidence);
});

test("avoids false-positive merges from shared category, similar price, same ship-from country, or generic title words", () => {
  const listings = [
    listing({
      vendorAlias: "vendorX",
      category: "Drugs",
      priceUsd: 25,
      title: "Best quality pure premium sample",
      shipsFrom: "Germany",
    }),
    listing({
      vendorAlias: "vendorY",
      category: "Drugs",
      priceUsd: 25,
      title: "Best quality pure premium sample",
      shipsFrom: "Germany",
    }),
  ];
  const result = correlateListings(listings);
  assert.equal(result.groups.size, 2, "distinct aliases must never be merged regardless of other shared attributes");
});

test("normalizeVendorAlias is case- and whitespace-insensitive but preserves punctuation", () => {
  assert.equal(normalizeVendorAlias("  DutchDrugz  "), "dutchdrugz");
  assert.equal(normalizeVendorAlias("Dutch_Drugz"), "dutch_drugz");
  assert.equal(normalizeVendorAlias("dutch-drugz"), "dutch-drugz");
});

test("titleSimilarity ignores generic/stopword vocabulary", () => {
  const sim = titleSimilarity("Best quality pure premium sample", "Best quality pure premium offer");
  assert.equal(sim, 0, "titles with only generic/stopword overlap should score 0 meaningful similarity");
});

test("titleSimilarity scores real overlap deterministically", () => {
  const sim = titleSimilarity(
    "MST Morphine sulphate tablets 100 mg",
    "Morphine sulphate tablets continus 30mg"
  );
  assert.ok(sim > 0.3, `expected meaningful similarity, got ${sim}`);
  // Deterministic: repeated calls produce the identical result.
  assert.equal(sim, titleSimilarity(
    "MST Morphine sulphate tablets 100 mg",
    "Morphine sulphate tablets continus 30mg"
  ));
});

test("getCorrelationForAlias normalizes lookups", () => {
  const result = correlateListings([listing({ vendorAlias: "DutchDrugz" })]);
  const group = getCorrelationForAlias("dutchdrugz", result);
  assert.ok(group);
  assert.equal(group!.normalizedAlias, "dutchdrugz");

  const missing = getCorrelationForAlias("nonexistent-alias", result);
  assert.equal(missing, null);
});

test("existing simulation flow shape is unaffected: listings without vendorAlias are skipped, not errored", () => {
  const listings = [listing({ vendorAlias: null }), listing({ vendorAlias: "vendorZ" })];
  const result = correlateListings(listings);
  assert.equal(result.groups.size, 1);
  assert.ok(result.groups.has("vendorz"));
});