// apps/backend/src/lib/vendorRisk.test.ts
//
// Regression tests for the normalized-alias matching fix.
//
// Background: computeVendorRisk() used to group listings by the raw, exact
// vendorAlias string, while entityCorrelation.ts (the correlation-
// confidence layer) already normalized aliases (case-folding, whitespace
// trimming/collapsing) before matching. That meant the two layers could
// disagree about which listings belong to the same vendor — e.g.
// "HappyEyes" and "happyeyes" would correlate as one group in the
// confidence display, but silently score as two separate, lower-confidence
// vendors in the risk pipeline. These tests lock in that both layers now
// agree, via the shared normalizeVendorAlias() function.
//
// Run with: npx tsx --test src/lib/vendorRisk.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVendorRisk } from "./vendorRisk.js";
import { computeEntityRisk } from "./entityRisk.js";
import { normalizeVendorAlias } from "./entityCorrelation.js";
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

test("computeVendorRisk merges listings whose vendorAlias differs only by case", () => {
  const listings = [
    listing({ vendorAlias: "HappyEyes", marketplace: "Hansa" }),
    listing({ vendorAlias: "happyeyes", marketplace: "Valhalla" }),
  ];
  const vendors = computeVendorRisk(listings);

  // Exactly one merged group, not two.
  assert.equal(vendors.size, 1);

  const vendor = vendors.get(normalizeVendorAlias("HappyEyes"))!;
  assert.ok(vendor, "merged vendor should be reachable via the normalized key");
  assert.equal(vendor.listingCount, 2);
  // Both raw spellings on record, so nothing is silently discarded.
  assert.deepEqual(vendor.rawAliasVariants, ["HappyEyes", "happyeyes"].sort());
  // Cross-marketplace bonus should apply now that the two listings (one per
  // marketplace) are correctly recognized as the same vendor.
  assert.equal(vendor.marketplaceCount, 2);
  assert.equal(vendor.correlationMethod, "vendorAlias_normalized_match");
});

test("computeVendorRisk picks the most common raw spelling as the display alias, ties broken by first appearance", () => {
  const listings = [
    listing({ vendorAlias: "happyeyes" }), // first appearance
    listing({ vendorAlias: "HappyEyes" }),
    listing({ vendorAlias: "HappyEyes" }), // more common
  ];
  const vendors = computeVendorRisk(listings);
  const vendor = vendors.get(normalizeVendorAlias("HappyEyes"))!;
  assert.equal(vendor.vendorAlias, "HappyEyes");
});

test("computeVendorRisk still keeps genuinely different aliases separate (underscore is not stripped)", () => {
  // Confirms the fix does not over-merge: normalization only folds case and
  // whitespace, not punctuation/separators, so "happy_eyes" and "HappyEyes"
  // remain distinct vendors unless they are ever the same raw string.
  assert.notEqual(normalizeVendorAlias("happy_eyes"), normalizeVendorAlias("HappyEyes"));

  const listings = [listing({ vendorAlias: "happy_eyes" }), listing({ vendorAlias: "HappyEyes" })];
  const vendors = computeVendorRisk(listings);
  assert.equal(vendors.size, 2);
});

test("computeEntityRisk finds a vendor match even when Entity.alias and Listing.vendorAlias differ only by case/whitespace", () => {
  const listings = [
    listing({ vendorAlias: "HappyEyes", marketplace: "Hansa" }),
    listing({ vendorAlias: "HappyEyes", marketplace: "Valhalla" }),
  ];
  const vendorRiskByAlias = computeVendorRisk(listings);

  // Entity.alias stored with different whitespace/case than the listings.
  const computed = computeEntityRisk("  happyeyes ", vendorRiskByAlias);

  assert.equal(computed.correlated, true);
  assert.equal(computed.correlationMethod, "alias_normalized_match");
  assert.equal(computed.risk, vendorRiskByAlias.get(normalizeVendorAlias("HappyEyes"))!.risk);
  assert.equal(computed.vendorAlias, "HappyEyes"); // display alias, not the entity's own spelling
});

test("computeEntityRisk correctly reports no match for a genuinely unrelated alias", () => {
  const listings = [listing({ vendorAlias: "HappyEyes" })];
  const vendorRiskByAlias = computeVendorRisk(listings);

  const computed = computeEntityRisk("SomeoneElse", vendorRiskByAlias);
  assert.equal(computed.correlated, false);
  assert.equal(computed.risk, null);
});