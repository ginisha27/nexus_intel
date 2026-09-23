// apps/backend/src/lib/vendorRisk.ts
//
// Deterministic vendor-level aggregation, derived entirely from Listing rows
// scored by riskEngine.ts. No new data source, no schema change, no
// duplicate scoring logic — this module groups already-scored listings by
// normalized vendorAlias and aggregates.
//
// IMPORTANT — this is ALIAS CORRELATION, not identity resolution:
//
// Listing.vendorAlias is a free-text marketplace handle. Two listings whose
// vendorAlias NORMALIZES to the same key (see normalizeVendorAlias in
// entityCorrelation.ts — case-folding, whitespace trimming/collapsing,
// zero-width-char stripping only, deliberately NOT punctuation-stripping)
// are assumed to belong to the same seller.
//
// That's a reasonable prototype-grade correlation key, but it is NOT a claim
// that we've cryptographically or forensically resolved the same real person
// across marketplaces.
//
// An alias could be reused coincidentally, or the same seller could operate
// under two genuinely different aliases undetected.
//
// Every downstream consumer of VendorRisk (entityRisk.ts, networkRisk.ts,
// routes/vendors.ts) must preserve this caveat rather than presenting it as
// confirmed identity.
//
// NORMALIZATION FIX:
//
// This module used to group by the raw, un-normalized vendorAlias string,
// while lib/entityCorrelation.ts already normalized aliases before matching.
// That meant the two layers could disagree about which listings belong to
// the same vendor.
//
// Example:
//
//   "HappyEyes"
//   "happyeyes"
//   " HappyEyes "
//
// should correlate into the same vendor group when normalizeVendorAlias()
// considers them equivalent.
//
// Both layers now share the exact same normalizeVendorAlias() function, so
// they cannot disagree about the correlation key.

import {
  normalizeVendorAlias,
} from "./entityCorrelation.js";

import {
  scoreListings,
  HIGH_RISK_CATEGORIES,
  type ListingInput,
  type RiskSignal,
} from "./riskEngine.js";

export interface VendorRisk {
  // Display alias: the most common RAW (as-stored) variant within this
  // normalized group.
  //
  // Ties are broken by first-appearance order so the result is deterministic.
  //
  // This matches entityCorrelation.ts's displayAliasFor convention so the
  // two layers show the same label for the same normalized group.
  vendorAlias: string;

  // Every distinct raw vendorAlias string that normalized into this group.
  //
  // Usually this will contain one value, but it can contain multiple values
  // when capitalization/whitespace formatting differs across listings or
  // marketplaces.
  //
  // Example:
  //   ["HappyEyes", "happyeyes", " HappyEyes "]
  rawAliasVariants: string[];

  risk: number; // 0-100, computed

  listingCount: number;

  // Number of listings individually scored >= HIGH_RISK_LISTING_THRESHOLD.
  highRiskListingCount: number;

  marketplaceCount: number;
  marketplaces: string[];

  categoryCount: number;
  categories: string[];

  highRiskCategoryCount: number;
  highRiskCategories: string[];

  firstSeen: Date;
  lastSeen: Date;

  averageListingRisk: number;
  maxListingRisk: number;

  // IMPORTANT:
  //
  // This describes the correlation mechanism. It does NOT mean that the
  // normalized aliases have been proven to belong to the same real person.
  correlationMethod: "vendorAlias_normalized_match";

  // Additive — NOT part of the vendor risk formula above.
  //
  // `risk` is still:
  //
  //   meanRisk * 0.5
  //   + maxRisk * 0.3
  //   + bonuses
  //
  // It is a blended aggregate, not a sum of individual listing signals, so
  // it cannot honestly be decomposed back into contributor form.
  //
  // What CAN be shown honestly is the actual, unmodified RiskSignal[] of
  // the vendor's highest-scoring listing.
  //
  // This listing drives the maxRisk component and provides something
  // traceable for entity/investigation layers when asked:
  //
  //   "Why is this vendor's risk high?"
  //
  // without pretending that these signals are a full breakdown of the
  // blended vendor score.
  representativeListingId: string | null;
  representativeListingSignals: RiskSignal[];
}

// Matches the HIGH status threshold in riskStatus.ts.
//
// Kept as a named constant here so the definition of what counts as a
// high-risk listing is explicit within this aggregation module.
const HIGH_RISK_LISTING_THRESHOLD = 60;

// Picks a deterministic display alias for a group of raw variants that all
// normalize to the same key.
//
// Selection rules:
//
// 1. Most common raw alias wins.
// 2. If multiple raw aliases have the same count, the alias that appeared
//    first in the original listings array wins.
//
// This is deterministic and matches entityCorrelation.ts's displayAliasFor
// convention.
function pickDisplayAlias(
  rawAliasCounts: Map<string, number>,
  rawAliasFirstIndex: Map<string, number>,
): string {
  let best: string | null = null;

  for (const [raw, count] of rawAliasCounts) {
    if (
      best === null ||
      count > rawAliasCounts.get(best)! ||
      (
        count === rawAliasCounts.get(best)! &&
        rawAliasFirstIndex.get(raw)! < rawAliasFirstIndex.get(best)!
      )
    ) {
      best = raw;
    }
  }

  return best!;
}

// Returned Map is keyed by NORMALIZED alias.
//
// Callers must normalize their own lookup key before calling .get() on it.
//
// Example:
//
//   const key = normalizeVendorAlias(vendorAlias);
//   const vendor = vendorRisks.get(key);
//
// See entityRisk.ts / routes/vendors.ts.
export function computeVendorRisk(
  listings: ListingInput[],
): Map<string, VendorRisk> {
  // Reuse the real, existing, unmodified listing risk engine.
  //
  // Vendor risk never re-implements or re-guesses a listing's score.
  const scored = scoreListings(listings);

  // Group listings by normalized vendor alias.
  //
  // We retain:
  //
  // - listings belonging to the group
  // - count of each raw alias variant
  // - first appearance index of each raw alias variant
  //
  // This lets us produce a deterministic display alias while preserving
  // every original alias spelling.
  const byVendor = new Map<
    string,
    {
      listings: ListingInput[];
      rawAliasCounts: Map<string, number>;
      rawAliasFirstIndex: Map<string, number>;
    }
  >();

  listings.forEach((listing, index) => {
    if (!listing.vendorAlias) {
      return;
    }

    const normalizedAlias = normalizeVendorAlias(
      listing.vendorAlias,
    );

    // Do not create a vendor group for an alias that normalizes to nothing.
    if (!normalizedAlias) {
      return;
    }

    let group = byVendor.get(normalizedAlias);

    if (!group) {
      group = {
        listings: [],
        rawAliasCounts: new Map(),
        rawAliasFirstIndex: new Map(),
      };

      byVendor.set(normalizedAlias, group);
    }

    group.listings.push(listing);

    group.rawAliasCounts.set(
      listing.vendorAlias,
      (group.rawAliasCounts.get(listing.vendorAlias) ?? 0) + 1,
    );

    if (!group.rawAliasFirstIndex.has(listing.vendorAlias)) {
      group.rawAliasFirstIndex.set(
        listing.vendorAlias,
        index,
      );
    }
  });

  const out = new Map<string, VendorRisk>();

  for (const [normalizedAlias, group] of byVendor) {
    const vendorListings = group.listings;

    // Pick the most representative raw spelling for display.
    const vendorAlias = pickDisplayAlias(
      group.rawAliasCounts,
      group.rawAliasFirstIndex,
    );

    // Preserve all raw alias variants.
    //
    // Sorted for deterministic output regardless of insertion order.
    const rawAliasVariants = Array.from(
      group.rawAliasCounts.keys(),
    ).sort();

    // Retrieve the already-computed listing risks from riskEngine.ts.
    const risks = vendorListings.map(
      (listing) => scored.get(listing.id)!.score,
    );

    const marketplaces = new Set<string>();
    const categories = new Set<string>();

    let firstSeen = vendorListings[0].firstSeen;
    let lastSeen = vendorListings[0].lastSeen;

    for (const listing of vendorListings) {
      if (listing.marketplace) {
        marketplaces.add(listing.marketplace);
      }

      categories.add(listing.category);

      if (listing.firstSeen < firstSeen) {
        firstSeen = listing.firstSeen;
      }

      if (listing.lastSeen > lastSeen) {
        lastSeen = listing.lastSeen;
      }
    }

    // Identify categories that are considered high-risk by the existing
    // risk engine/category definition.
    const highRiskCategories = Array.from(categories).filter(
      (category) => HIGH_RISK_CATEGORIES.has(category),
    );

    const meanRisk =
      risks.reduce((sum, risk) => sum + risk, 0) / risks.length;

    const maxRisk = Math.max(...risks);

    const highRiskListingCount = risks.filter(
      (risk) => risk >= HIGH_RISK_LISTING_THRESHOLD,
    ).length;

    // Find the highest-risk listing.
    //
    // Ties are broken by first occurrence in vendorListings.
    //
    // This makes the representative listing deterministic.
    let representativeListingId: string | null = null;

    for (const listing of vendorListings) {
      if (scored.get(listing.id)!.score === maxRisk) {
        representativeListingId = listing.id;
        break;
      }
    }

    // These are the REAL signals produced by riskEngine.ts for the
    // representative listing.
    //
    // We intentionally do not calculate new or synthetic signals here.
    const representativeListingSignals =
      representativeListingId
        ? scored.get(representativeListingId)!.signals
        : [];

    // ---------------------------------------------------------------
    // Vendor-level aggregate risk
    // ---------------------------------------------------------------
    //
    // Weighted aggregate:
    //
    //   meanRisk * 0.5
    //   maxRisk  * 0.3
    //   cross-marketplace bonus
    //   category-diversity bonus
    //
    // Mean risk captures typical vendor behavior.
    //
    // Max risk ensures severe behavior contributes strongly even when the
    // vendor has many low-risk listings.
    //
    // Cross-marketplace presence and multiple high-risk categories provide
    // up to 20 additional points of corroborating breadth.
    //
    // This follows the same general "breadth as signal" concept already
    // present in riskEngine.ts, without duplicating listing-level scoring.
    const crossMarketBonus =
      marketplaces.size >= 2 ? 10 : 0;

    const categoryDiversityBonus = Math.min(
      10,
      highRiskCategories.length * 5,
    );

    const raw =
      meanRisk * 0.5 +
      maxRisk * 0.3 +
      crossMarketBonus +
      categoryDiversityBonus;

    // IMPORTANT:
    //
    // An entity/vendor aggregate should never hide a more severe listing
    // that belongs to it.
    //
    // The weighted aggregate remains the primary calculation, but the final
    // score is floored at maxRisk.
    //
    // Example:
    //
    //   listing risks = [90, 20, 20]
    //
    // A pure weighted aggregate could produce a score below 90.
    // The floor ensures the vendor is still represented as at least 90,
    // because a current 90-risk listing belongs to that vendor group.
    const risk = Math.max(
      maxRisk,
      Math.max(
        0,
        Math.min(
          100,
          Math.round(raw),
        ),
      ),
    );

    out.set(normalizedAlias, {
      vendorAlias,
      rawAliasVariants,

      risk,

      listingCount: vendorListings.length,

      highRiskListingCount,

      marketplaceCount: marketplaces.size,
      marketplaces: Array.from(marketplaces).sort(),

      categoryCount: categories.size,
      categories: Array.from(categories).sort(),

      highRiskCategoryCount: highRiskCategories.length,
      highRiskCategories: highRiskCategories.sort(),

      firstSeen,
      lastSeen,

      averageListingRisk:
        Math.round(meanRisk * 10) / 10,

      maxListingRisk: maxRisk,

      correlationMethod:
        "vendorAlias_normalized_match",

      representativeListingId,
      representativeListingSignals,
    });
  }

  return out;
}