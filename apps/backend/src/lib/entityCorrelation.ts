// apps/backend/src/lib/entityCorrelation.ts
//
// Deterministic, explainable, multi-signal ENTITY CORRELATION layer.
//
// This module answers "which listings belong to the same vendor/entity?" —
// a different question from entityRisk.ts, which answers "how risky is
// that entity?" once membership is known. The two are kept strictly
// separate: this file never computes a risk score, and entityRisk.ts's
// weighted risk formula is not touched or duplicated here.
//
// ─── Design rules (see project correlation brief) ───────────────────────
//   - No LLM, no Math.random(), no scoring based on category or price
//     alone.
//   - The ONLY thing that ever creates a group (i.e. asserts two listings
//     belong to the same entity) is a NORMALIZED VENDOR ALIAS match.
//     Every other signal below (title similarity, category consistency,
//     cross-marketplace presence, temporal consistency, shipping
//     location) only ADDS SUPPORTING CONFIDENCE to an already-formed
//     group. None of them can merge two listings that have different
//     normalized aliases. This is the single most important invariant in
//     this file — it's what keeps false positives out: a shared category,
//     similar price, same ship-from country, or generically-worded title
//     can never by itself declare two different vendors to be the same
//     entity.
//   - Confidence is a CORRELATION CONFIDENCE SCORE (0-100), not a
//     statistical probability. It measures how much corroborating,
//     independent evidence backs an already-established alias match.
//   - Every signal has a fixed, capped, documented contribution so the
//     score is reproducible and explainable (matches the style of
//     riskEngine.ts's WEIGHTS table).
//
// ─── Why normalized alias, not fuzzy alias matching ─────────────────────
// We still avoid edit-distance/fuzzy guesses, but we do canonicalize common
// visual separators because the imported marketplace data contains the same
// handle in forms such as "HappyEyes" and "Happy_Eyes". Case, spaces,
// underscores, hyphens and dots are therefore treated as formatting noise;
// no broader fuzzy matching is performed.

import { HIGH_RISK_CATEGORIES, type ListingInput } from "./riskEngine.js";

// ─── Public types ─────────────────────────────────────────────────────────

export type CorrelationSignal =
  | "normalized_vendor_alias"
  | "listing_volume"
  | "title_similarity"
  | "category_consistency"
  | "cross_marketplace"
  | "temporal_consistency"
  | "shipping_location_consistency";

export interface CorrelationSignalDetail {
  signal: CorrelationSignal;
  points: number;
  detail: string;
}

export interface EntityCorrelationGroup {
  // The normalized alias is the correlation identity key for this group.
  normalizedAlias: string;
  // Every distinct raw (as-stored) vendorAlias string that normalized to
  // this key — usually one, but can be >1 when case/whitespace formatting
  // differed across listings or marketplaces.
  rawAliasVariants: string[];
  // A display alias: the most common raw variant, ties broken by first
  // appearance order — deterministic, not arbitrary.
  displayAlias: string;
  method: "multi_signal_correlation";
  confidence: number; // 0-100, correlation confidence — NOT a risk score
  matchedSignals: CorrelationSignal[];
  signalDetails: CorrelationSignalDetail[];
  listingIds: string[];
  listingCount: number;
  marketplaces: string[];
  categories: string[];
  shipsFromLocations: string[];
  firstSeen: Date;
  lastSeen: Date;
  explanation: string;
}

export interface CorrelationResult {
  groups: Map<string, EntityCorrelationGroup>; // keyed by normalizedAlias
  // Convenience index: raw vendorAlias string -> normalizedAlias key.
  aliasIndex: Map<string, string>;
}

// ─── Signal contribution caps (documented, sum intentionally > 100 so a
// single missing signal doesn't cap out confidence prematurely; the total
// is clamped to 100 at the end — same pattern as riskEngine.ts) ──────────

export const CORRELATION_WEIGHTS = {
  normalizedVendorAlias: 40, // required baseline for any group to exist at all
  listingVolume: 20, // corroborating breadth of observed activity, capped
  titleSimilarity: 15, // self-consistent writing/listing style within the group
  categoryConsistency: 10, // supports, never sufficient alone (brief requirement)
  crossMarketplace: 10, // same normalized alias independently observed on 2+ markets
  temporalConsistency: 5, // supports, never sufficient alone
  shippingLocationConsistency: 5, // supports, NEVER definitive identity evidence
} as const;

// ─── 1. Normalized vendor alias ─────────────────────────────────────────

/**
 * Canonical alias normalization: case-folding, trimming, removing
 * zero-width characters, and removing common visual separators. This is
 * deterministic and intentionally narrower than fuzzy/edit-distance
 * matching.
 */
export function normalizeVendorAlias(alias: string): string {
  return alias
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, "");
}

// ─── 2. Title similarity ────────────────────────────────────────────────

// Generic marketplace filler: units, quantity words, and superlatives that
// appear across many unrelated vendors' listings. Excluding these keeps
// title similarity from being driven by coincidental, non-identifying
// vocabulary (the brief explicitly warns against correlating on "titles
// [that] contain generic words").
const TITLE_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "free", "shipping", "fast", "best",
  "quality", "sale", "new", "pure", "high", "top", "premium", "guaranteed",
  "min", "max", "order", "price", "sample", "samples", "stock", "available",
  "kg", "kilo", "kilos", "kilogram", "kilograms", "mg", "ml", "gr", "gram",
  "grams", "pill", "pills", "tablet", "tablets", "tab", "tabs", "x",
]);

function tokenizeTitle(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !TITLE_STOPWORDS.has(t));
  return new Set(tokens);
}

/**
 * Dice coefficient over filtered token sets: 2*|A∩B| / (|A|+|B|).
 * Deterministic, symmetric, no external libraries. Returns 0 when either
 * title has no meaningful (non-stopword, non-numeric) tokens at all —
 * there is nothing to honestly compare.
 */
export function titleSimilarity(titleA: string, titleB: string): number {
  const a = tokenizeTitle(titleA);
  const b = tokenizeTitle(titleB);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return (2 * intersection) / (a.size + b.size);
}

// Minimum similarity AND minimum shared-token count required before title
// similarity counts as a signal at all — guards against a single short,
// coincidentally shared word producing a misleadingly high ratio.
const TITLE_SIMILARITY_THRESHOLD = 0.5;
const TITLE_SIMILARITY_MIN_SHARED_TOKENS = 2;

/**
 * Average pairwise title similarity across a group's listings, capped to a
 * reasonable number of comparisons (n choose 2 on large groups gets
 * expensive and adds no explanatory value beyond a representative sample).
 */
function groupTitleConsistency(titles: string[]): { avgSimilarity: number; comparisons: number; sharedTokenExample: number } {
  const usable = titles.filter((t) => tokenizeTitle(t).size > 0);
  if (usable.length < 2) return { avgSimilarity: 0, comparisons: 0, sharedTokenExample: 0 };

  const MAX_LISTINGS_SAMPLED = 12; // caps comparisons at 66 pairs, plenty for a consistency estimate
  const sample = usable.slice(0, MAX_LISTINGS_SAMPLED);

  let total = 0;
  let count = 0;
  let maxShared = 0;
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const setA = tokenizeTitle(sample[i]);
      const setB = tokenizeTitle(sample[j]);
      let shared = 0;
      for (const t of setA) if (setB.has(t)) shared++;
      maxShared = Math.max(maxShared, shared);
      const sim = setA.size === 0 || setB.size === 0 ? 0 : (2 * shared) / (setA.size + setB.size);
      total += sim;
      count++;
    }
  }
  return { avgSimilarity: count > 0 ? total / count : 0, comparisons: count, sharedTokenExample: maxShared };
}

// ─── 3-6. Grouping + supporting signals ─────────────────────────────────

interface RawGroup {
  normalizedAlias: string;
  rawAliasCounts: Map<string, number>;
  rawAliasFirstIndex: Map<string, number>;
  listings: ListingInput[];
}

function displayAliasFor(group: RawGroup): string {
  let best: string | null = null;
  let bestCount = -1;
  let bestIndex = Infinity;
  for (const [raw, count] of group.rawAliasCounts) {
    const idx = group.rawAliasFirstIndex.get(raw) ?? Infinity;
    if (count > bestCount || (count === bestCount && idx < bestIndex)) {
      best = raw;
      bestCount = count;
      bestIndex = idx;
    }
  }
  return best ?? group.normalizedAlias;
}

/**
 * Correlate a set of listings into explainable entity groups. This is the
 * single source of truth for "which listings belong together" — reusable
 * by entity routes, simulation, and seed/rebuild workflows so correlation
 * logic is never duplicated.
 */
export function correlateListings(listings: ListingInput[]): CorrelationResult {
  const rawGroups = new Map<string, RawGroup>();

  listings.forEach((l, index) => {
    if (!l.vendorAlias) return; // nothing to correlate without an alias
    const normalized = normalizeVendorAlias(l.vendorAlias);
    if (!normalized) return; // alias was only whitespace/control chars

    let group = rawGroups.get(normalized);
    if (!group) {
      group = {
        normalizedAlias: normalized,
        rawAliasCounts: new Map(),
        rawAliasFirstIndex: new Map(),
        listings: [],
      };
      rawGroups.set(normalized, group);
    }
    group.listings.push(l);
    group.rawAliasCounts.set(l.vendorAlias, (group.rawAliasCounts.get(l.vendorAlias) ?? 0) + 1);
    if (!group.rawAliasFirstIndex.has(l.vendorAlias)) group.rawAliasFirstIndex.set(l.vendorAlias, index);
  });

  const groups = new Map<string, EntityCorrelationGroup>();
  const aliasIndex = new Map<string, string>();

  for (const group of rawGroups.values()) {
    const { listings: groupListings, normalizedAlias } = group;

    const marketplaces = new Set<string>();
    const categories = new Set<string>();
    const shipsFrom = new Set<string>();
    const titles: string[] = [];
    let firstSeen = groupListings[0].firstSeen;
    let lastSeen = groupListings[0].lastSeen;

    for (const l of groupListings) {
      if (l.marketplace) marketplaces.add(l.marketplace);
      categories.add(l.category);
      if (l.shipsFrom) shipsFrom.add(l.shipsFrom);
      if (l.title) titles.push(l.title);
      if (l.firstSeen < firstSeen) firstSeen = l.firstSeen;
      if (l.lastSeen > lastSeen) lastSeen = l.lastSeen;
    }

    const signalDetails: CorrelationSignalDetail[] = [];
    const matchedSignals: CorrelationSignal[] = [];

    // Signal: normalized vendor alias — the ONLY signal that establishes
    // the group in the first place. Always present for any group.
    matchedSignals.push("normalized_vendor_alias");
    const variantNote =
      group.rawAliasCounts.size > 1
        ? ` (${group.rawAliasCounts.size} raw alias variants normalized together: ${Array.from(group.rawAliasCounts.keys())
            .map((a) => `"${a}"`)
            .join(", ")})`
        : "";
    signalDetails.push({
      signal: "normalized_vendor_alias",
      points: CORRELATION_WEIGHTS.normalizedVendorAlias,
      detail: `Normalized alias "${normalizedAlias}"${variantNote}`,
    });

    // Signal: listing volume — more observed listings under this identity
    // is corroborating breadth of evidence, capped so volume alone can't
    // dominate the score.
    if (groupListings.length >= 2) {
      const points = Math.min(CORRELATION_WEIGHTS.listingVolume, groupListings.length * 4);
      matchedSignals.push("listing_volume");
      signalDetails.push({
        signal: "listing_volume",
        points,
        detail: `${groupListings.length} listings observed under this identity`,
      });
    }

    // Signal: title similarity — deterministic token-overlap consistency
    // across the group's own listings. Requires both a similarity
    // threshold and a minimum shared-token count so a single generic word
    // can't trigger it.
    const titleConsistency = groupTitleConsistency(titles);
    if (
      titleConsistency.comparisons > 0 &&
      titleConsistency.avgSimilarity >= TITLE_SIMILARITY_THRESHOLD &&
      titleConsistency.sharedTokenExample >= TITLE_SIMILARITY_MIN_SHARED_TOKENS
    ) {
      matchedSignals.push("title_similarity");
      signalDetails.push({
        signal: "title_similarity",
        points: CORRELATION_WEIGHTS.titleSimilarity,
        detail: `Average title similarity ${(titleConsistency.avgSimilarity * 100).toFixed(0)}% across ${titleConsistency.comparisons} listing pair(s) (non-generic terms only)`,
      });
    }

    // Signal: category consistency — supports, never sufficient alone.
    // Since group membership is already established by alias, this can
    // never by itself create or merge a group; it only adds bonus
    // confidence when the vendor's listings are concentrated in a
    // consistent set of categories rather than scattered.
    if (groupListings.length >= 2) {
      const dominantCount = Math.max(
        ...Array.from(categories).map((c) => groupListings.filter((l) => l.category === c).length)
      );
      const dominantRatio = dominantCount / groupListings.length;
      if (dominantRatio >= 0.7) {
        matchedSignals.push("category_consistency");
        signalDetails.push({
          signal: "category_consistency",
          points: CORRELATION_WEIGHTS.categoryConsistency,
          detail: `${Math.round(dominantRatio * 100)}% of listings share a dominant category`,
        });
      }
    }

    // Signal: cross-marketplace — same normalized alias independently
    // observed on 2+ marketplaces.
    if (marketplaces.size >= 2) {
      matchedSignals.push("cross_marketplace");
      signalDetails.push({
        signal: "cross_marketplace",
        points: CORRELATION_WEIGHTS.crossMarketplace,
        detail: `Present on ${marketplaces.size} marketplaces (${Array.from(marketplaces).sort().join(", ")})`,
      });
    }

    // Signal: temporal consistency — supports, never sufficient alone.
    // Only credited when there's an actual observed activity window
    // (lastSeen strictly after firstSeen) across 2+ listings.
    if (groupListings.length >= 2 && lastSeen.getTime() > firstSeen.getTime()) {
      matchedSignals.push("temporal_consistency");
      signalDetails.push({
        signal: "temporal_consistency",
        points: CORRELATION_WEIGHTS.temporalConsistency,
        detail: `Activity observed across a ${Math.max(1, Math.round((lastSeen.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24)))}-day window`,
      });
    }

    // Signal: shipping location consistency — supports, NEVER definitive.
    // Capped at the lowest weight in the table for exactly that reason.
    if (groupListings.length >= 2 && shipsFrom.size === 1) {
      matchedSignals.push("shipping_location_consistency");
      signalDetails.push({
        signal: "shipping_location_consistency",
        points: CORRELATION_WEIGHTS.shippingLocationConsistency,
        detail: `All listings ship from ${Array.from(shipsFrom)[0]} (supporting only, not definitive)`,
      });
    }

    const rawConfidence = signalDetails.reduce((sum, s) => sum + s.points, 0);
    const confidence = Math.max(0, Math.min(100, Math.round(rawConfidence)));

    const highRiskCategoryNote = Array.from(categories).some((c) => HIGH_RISK_CATEGORIES.has(c))
      ? " Includes high-risk category activity (see riskEngine.ts for risk scoring, kept separate from this correlation confidence)."
      : "";

    const result: EntityCorrelationGroup = {
      normalizedAlias,
      rawAliasVariants: Array.from(group.rawAliasCounts.keys()).sort(),
      displayAlias: displayAliasFor(group),
      method: "multi_signal_correlation",
      confidence,
      matchedSignals,
      signalDetails,
      listingIds: groupListings.map((l) => l.id),
      listingCount: groupListings.length,
      marketplaces: Array.from(marketplaces).sort(),
      categories: Array.from(categories).sort(),
      shipsFromLocations: Array.from(shipsFrom).sort(),
      firstSeen,
      lastSeen,
      explanation: `Correlated ${groupListings.length} listing(s) under normalized alias "${normalizedAlias}" via ${matchedSignals.length} signal(s): ${matchedSignals.join(", ")}.${highRiskCategoryNote}`,
    };

    groups.set(normalizedAlias, result);
    for (const raw of group.rawAliasCounts.keys()) aliasIndex.set(raw, normalizedAlias);
  }

  return { groups, aliasIndex };
}

/**
 * Convenience lookup: given a raw alias string (e.g. Entity.alias or
 * Listing.vendorAlias as stored), find its correlation group, if any.
 * Normalizes internally so callers never need to normalize themselves.
 */
export function getCorrelationForAlias(
  rawAlias: string,
  result: CorrelationResult
): EntityCorrelationGroup | null {
  const normalized = normalizeVendorAlias(rawAlias);
  const key = result.aliasIndex.get(rawAlias) ?? normalized;
  return result.groups.get(key) ?? null;
}