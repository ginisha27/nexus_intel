// apps/backend/src/lib/riskEngine.ts
//
// Deterministic, explainable weighted-feature risk scorer.
//
// Design goals (see project brief):
//   - No Math.random(), no arbitrary/manual overrides, no "category alone".
//   - Every feature has a max contribution, a deterministic calculation,
//     and a human-readable signal.
//   - The same listing + the same underlying population always produces
//     the same score (pure function of its inputs).
//   - Features that can't be honestly computed from the current dataset
//     (too few data points) are SKIPPED, not faked.
//
// This module only knows about plain data shapes (see ListingInput below)
// so it can be unit-tested and reused from both prisma/seed.ts and the
// /api/listings route without depending on a live PrismaClient.

// ─── Public types ────────────────────────────────────────────────────────

// Canonical, stable identifiers for each contributing feature — one per key
// in WEIGHTS below. These are NOT new scoring logic; they're a presentation
// tag attached to signals that are already produced by the existing
// functions, so downstream layers (vendor/entity/investigation aggregation,
// the API boundary, the frontend) can group/label/aggregate contributors
// without string-matching `label` (which is meant to be a free-text,
// possibly-unique-per-instance description, e.g. "500g in title").
export type RiskFactor =
  | "categoryBase"
  | "bulkQuantity"
  | "priceOutlier"
  | "contentIndicator"
  | "crossMarketplace"
  | "listingVelocity"
  | "riskDiversity"
  | "newVendorHighRisk";

export interface RiskSignal {
  label: string;
  value: number; // points this signal contributed to the final score
  factor?: RiskFactor; // canonical id of the feature that produced this signal
}

// Presentation-only labels for each canonical factor, kept alongside the
// engine (which owns the identifiers) rather than re-derived at each API
// boundary. Purely cosmetic — does not affect scoring.
export const FACTOR_LABELS: Record<RiskFactor, string> = {
  categoryBase: "High-risk category",
  bulkQuantity: "Bulk quantity",
  priceOutlier: "Price outlier",
  contentIndicator: "Content indicators",
  crossMarketplace: "Cross-marketplace",
  listingVelocity: "Listing velocity",
  riskDiversity: "Risk diversity",
  newVendorHighRisk: "Vendor risk",
};

export interface RiskContributor {
  factor: RiskFactor | "other";
  label: string;
  contribution: number;
}

/**
 * Flattens RiskSignal[] into the presentation-ready contributor shape used
 * at API boundaries (see project brief: { factor, label, contribution }).
 * Signals sharing the same factor (e.g. multiple contentIndicator hits) are
 * summed under that factor rather than listed as separate rows — the sum is
 * exactly what those signals already contributed to the score, nothing
 * recomputed. Signals without a `factor` tag (should not normally occur —
 * every producing function below sets one) fall back to "other" rather than
 * being silently dropped.
 */
export function signalsToContributors(signals: RiskSignal[]): RiskContributor[] {
  const byFactor = new Map<string, RiskContributor>();
  for (const s of signals) {
    const factor = s.factor ?? "other";
    const existing = byFactor.get(factor);
    if (existing) {
      existing.contribution += s.value;
    } else {
      byFactor.set(factor, {
        factor,
        label: s.factor ? FACTOR_LABELS[s.factor] : s.label,
        contribution: s.value,
      });
    }
  }
  return Array.from(byFactor.values()).sort((a, b) => b.contribution - a.contribution);
}

export interface RiskResult {
  score: number; // 0-100
  signals: RiskSignal[]; // only signals with value > 0 are included
}

// Minimal shape the engine needs from a Listing row. Matches
// apps/backend/prisma/schema.prisma `Listing` model.
export interface ListingInput {
  id: string;
  category: string;
  title: string | null;
  priceUsd: number | null;
  marketplace: string | null;
  vendorAlias: string | null;
  shipsFrom: string | null;
  firstSeen: Date;
  lastSeen: Date;
}

// ─── Feature max contributions (sum = 100) ──────────────────────────────

export const WEIGHTS = {
  categoryBase: 25,
  bulkQuantity: 20,
  priceOutlier: 15,
  contentIndicator: 15,
  crossMarketplace: 10,
  listingVelocity: 5,
  riskDiversity: 5,
  newVendorHighRisk: 5,
} as const;

// ─── Feature 1: category base risk ──────────────────────────────────────
//
// A transparent lookup table. Deliberately capped well under the max so
// category can never be the whole score. Unmapped/unknown categories fall
// back to a mid-low default rather than 0, since "unknown" is itself mildly
// informative (unclassified activity).

const CATEGORY_RISK: Record<string, number> = {
  "Drugs": 25,
  "Fraud Related": 22,
  "Counterfeits": 18,
  "Security & Hosting": 12,
  "Erotica": 10,
  "Digital Goods": 6,
  "Electronics": 5,
  "Services": 5,
  "Guides & Tutorials": 2,
};
const CATEGORY_RISK_DEFAULT = 8;

function categoryBaseRisk(category: string): RiskSignal | null {
  const value = CATEGORY_RISK[category] ?? CATEGORY_RISK_DEFAULT;
  if (value <= 0) return null;
  return { label: `Category baseline: ${category}`, value, factor: "categoryBase" };
}

// High-risk categories used by several other features below. Defined once
// so the notion of "high risk category" stays consistent across features.
// Exported (was previously module-private) so vendor/entity/network-level
// aggregation modules can reuse the exact same definition of "high-risk
// category" instead of maintaining a second, potentially drifting copy.
// This is the ONLY change made to this file — no scoring logic touched.
export const HIGH_RISK_CATEGORIES = new Set(["Drugs", "Fraud Related", "Counterfeits"]);

// ─── Feature 2: bulk quantity indicator ─────────────────────────────────
//
// Looks for explicit quantity language in the title. Larger/heavier/more
// numerous quantities score higher, since they suggest wholesale/dealer
// activity rather than a single retail unit. Detection is regex-based,
// not a hardcoded title.

interface BulkMatch {
  value: number;
  detail: string;
}

function bulkQuantityIndicator(title: string | null): RiskSignal | null {
  if (!title) return null;
  const candidates: BulkMatch[] = [];

  // Kilograms — always treated as large bulk regardless of magnitude.
  const kg = title.match(/(\d+(?:\.\d+)?)\s?(kg|kilo(?:gram)?s?)\b/i);
  if (kg) candidates.push({ value: 20, detail: `${kg[1]}${kg[2]} in title` });

  // Grams — scaled by magnitude.
  const g = title.match(/(\d+(?:\.\d+)?)\s?(g|gr|grams?)\b/i);
  if (g) {
    const n = parseFloat(g[1]);
    const v = n >= 100 ? 20 : n >= 20 ? 14 : 6;
    candidates.push({ value: v, detail: `${g[1]}${g[2]} in title` });
  }

  // Pills / tablets / tabs — scaled by count.
  const pills = title.match(/(\d+)\s?(pills?|tablets?|tabs?)\b/i);
  if (pills) {
    const n = parseInt(pills[1], 10);
    const v = n >= 100 ? 18 : n >= 20 ? 12 : 6;
    candidates.push({ value: v, detail: `${pills[1]} ${pills[2]} in title` });
  }

  // "500x", "1000x" style multiplier/unit-count patterns.
  const mult = title.match(/(\d{2,6})\s?x\b/i);
  if (mult) {
    const n = parseInt(mult[1], 10);
    const v = n >= 100 ? 18 : n >= 10 ? 10 : 4;
    candidates.push({ value: v, detail: `${mult[1]}x in title` });
  }

  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) => (b.value > a.value ? b : a));
  return { label: `Bulk quantity detected (${best.detail})`, value: best.value, factor: "bulkQuantity" };
}

// ─── Feature 4: high-risk content/title indicators ──────────────────────
//
// Three independent keyword groups (financial fraud, identity documents,
// high-risk drug terminology), each worth up to 5 points. Transparent and
// easy to extend — this is a pattern list, not a claim about any specific
// listing's legal status.

const CONTENT_GROUPS: { label: string; pattern: RegExp; value: number }[] = [
  {
    label: "financial fraud terminology",
    pattern: /\b(cvv|fullz|dumps?|carding|paypal|western union|\bwu\b|bank ?log|swift|iban|\bbin\b)\b/i,
    value: 5,
  },
  {
    label: "identity-document terminology",
    pattern: /\b(passport|driver'?s?\s?licen[sc]e|id card|\bssn\b|social security|fake id)\b/i,
    value: 5,
  },
  {
    label: "high-risk drug terminology",
    pattern: /\b(pure|uncut|aaa\+*|fentanyl|carfentanil|heroin|cocaine|meth(?:amphetamine)?|\bmdma\b|\blsd\b)\b/i,
    value: 5,
  },
];

function contentIndicators(title: string | null): RiskSignal[] {
  if (!title) return [];
  const out: RiskSignal[] = [];
  for (const group of CONTENT_GROUPS) {
    if (group.pattern.test(title)) {
      out.push({ label: `Content indicator: ${group.label}`, value: group.value, factor: "contentIndicator" });
    }
  }
  return out;
}

// ─── Population-level aggregates ────────────────────────────────────────
//
// Several features (price outlier, cross-marketplace, velocity, diversity,
// new-vendor) need statistics over the whole listing population, not just
// the single listing being scored. We compute those once per scoring pass
// and reuse them for every listing — this is the "population" referenced
// throughout the functions below.

interface CategoryStats {
  mean: number;
  stddev: number;
  n: number;
}

interface VendorStats {
  marketplaces: Set<string>;
  categories: Set<string>;
  count: number;
  firstSeenMin: number; // epoch ms
  lastSeenMax: number; // epoch ms
}

interface Population {
  categoryStats: Map<string, CategoryStats>;
  globalStats: CategoryStats;
  vendorStats: Map<string, VendorStats>;
  globalAvgVendorRate: number | null; // listings/day, averaged over vendors with enough history
  newVendorCutoff: number | null; // epoch ms; vendors first seen at/after this are "new"
}

function meanStddev(values: number[]): { mean: number; stddev: number } {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, stddev: Math.sqrt(variance) };
}

function buildPopulation(listings: ListingInput[]): Population {
  // Category-level price stats
  const byCategory = new Map<string, number[]>();
  const allPrices: number[] = [];
  for (const l of listings) {
    if (l.priceUsd != null && l.priceUsd > 0) {
      allPrices.push(l.priceUsd);
      const arr = byCategory.get(l.category) ?? [];
      arr.push(l.priceUsd);
      byCategory.set(l.category, arr);
    }
  }
  const categoryStats = new Map<string, CategoryStats>();
  for (const [cat, prices] of byCategory) {
    const { mean, stddev } = meanStddev(prices);
    categoryStats.set(cat, { mean, stddev, n: prices.length });
  }
  const global = meanStddev(allPrices.length > 0 ? allPrices : [0]);
  const globalStats: CategoryStats = { ...global, n: allPrices.length };

  // Vendor-level stats
  const vendorStats = new Map<string, VendorStats>();
  for (const l of listings) {
    if (!l.vendorAlias) continue;
    const v = vendorStats.get(l.vendorAlias) ?? {
      marketplaces: new Set<string>(),
      categories: new Set<string>(),
      count: 0,
      firstSeenMin: Infinity,
      lastSeenMax: -Infinity,
    };
    if (l.marketplace) v.marketplaces.add(l.marketplace);
    v.categories.add(l.category);
    v.count += 1;
    v.firstSeenMin = Math.min(v.firstSeenMin, l.firstSeen.getTime());
    v.lastSeenMax = Math.max(v.lastSeenMax, l.lastSeen.getTime());
    vendorStats.set(l.vendorAlias, v);
  }

  // Global average listing velocity (listings/day), only over vendors with
  // >=2 listings AND a non-zero observed active window — a single listing
  // or a zero-width window can't support a rate estimate.
  const rates: number[] = [];
  for (const v of vendorStats.values()) {
    const spanDays = (v.lastSeenMax - v.firstSeenMin) / (1000 * 60 * 60 * 24);
    if (v.count >= 2 && spanDays > 0) rates.push(v.count / spanDays);
  }
  const globalAvgVendorRate = rates.length >= 3 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;

  // "New vendor" cutoff: the newest quartile of vendors by first-seen date.
  // Needs a reasonable number of vendors to be meaningful.
  const firstSeenDates = Array.from(vendorStats.values())
    .map((v) => v.firstSeenMin)
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  let newVendorCutoff: number | null = null;
  if (firstSeenDates.length >= 4) {
    const idx = Math.floor(firstSeenDates.length * 0.75);
    newVendorCutoff = firstSeenDates[Math.min(idx, firstSeenDates.length - 1)];
  }

  return { categoryStats, globalStats, vendorStats, globalAvgVendorRate, newVendorCutoff };
}

// ─── Feature 3: price outlier ────────────────────────────────────────────
//
// Compares the listing's price against its category's price distribution.
// Falls back to the global price distribution when the category sample is
// too small to be meaningful, and skips the feature entirely (rather than
// inventing a stddev) when even the global sample is too small.

const MIN_SAMPLE_FOR_STATS = 5;

function priceOutlier(listing: ListingInput, pop: Population): RiskSignal | null {
  if (listing.priceUsd == null || listing.priceUsd <= 0) return null;

  let stats = pop.categoryStats.get(listing.category);
  let basis = `"${listing.category}" category`;
  if (!stats || stats.n < MIN_SAMPLE_FOR_STATS) {
    // Fallback: not enough same-category listings for a meaningful
    // percentile/stddev, so fall back to the full listing population.
    if (pop.globalStats.n < MIN_SAMPLE_FOR_STATS) return null; // still too small — skip, don't fake it
    stats = pop.globalStats;
    basis = "full listing population (category sample too small)";
  }
  if (stats.stddev === 0) return null; // no variance to compare against

  const z = Math.abs((listing.priceUsd - stats.mean) / stats.stddev);
  let value = 0;
  if (z >= 2.5) value = 15;
  else if (z >= 1.5) value = 9;
  else if (z >= 1) value = 4;
  if (value === 0) return null;

  return {
    label: `Price outlier vs ${basis} (z=${z.toFixed(2)})`,
    value,
    factor: "priceOutlier",
  };
}

// ─── Feature 5: cross-marketplace appearance ────────────────────────────

function crossMarketplace(listing: ListingInput, pop: Population): RiskSignal | null {
  if (!listing.vendorAlias) return null;
  const v = pop.vendorStats.get(listing.vendorAlias);
  if (!v || v.marketplaces.size < 2) return null;
  const markets = Array.from(v.marketplaces).sort().join(" & ");
  return { label: `Cross-marketplace vendor (${markets})`, value: WEIGHTS.crossMarketplace, factor: "crossMarketplace" };
}

// ─── Feature 6: listing velocity ────────────────────────────────────────

function listingVelocity(listing: ListingInput, pop: Population): RiskSignal | null {
  if (!listing.vendorAlias || pop.globalAvgVendorRate == null) return null;
  const v = pop.vendorStats.get(listing.vendorAlias);
  if (!v || v.count < 2) return null;
  const spanDays = (v.lastSeenMax - v.firstSeenMin) / (1000 * 60 * 60 * 24);
  if (spanDays <= 0) return null;
  const rate = v.count / spanDays;
  const ratio = rate / pop.globalAvgVendorRate;
  let value = 0;
  if (ratio >= 2) value = 5;
  else if (ratio >= 1.5) value = 3;
  if (value === 0) return null;
  return {
    label: `Elevated listing velocity (${ratio.toFixed(1)}x baseline vendor rate)`,
    value,
    factor: "listingVelocity",
  };
}

// ─── Feature 7: high-risk category diversity ────────────────────────────

function riskDiversity(listing: ListingInput, pop: Population): RiskSignal | null {
  if (!listing.vendorAlias) return null;
  const v = pop.vendorStats.get(listing.vendorAlias);
  if (!v) return null;
  const count = Array.from(v.categories).filter((c) => HIGH_RISK_CATEGORIES.has(c)).length;
  let value = 0;
  if (count >= 3) value = 5;
  else if (count === 2) value = 3;
  if (value === 0) return null;
  return { label: `Vendor active in ${count} distinct high-risk categories`, value, factor: "riskDiversity" };
}

// ─── Feature 8: new vendor + high-risk category ─────────────────────────

function newVendorHighRisk(listing: ListingInput, pop: Population): RiskSignal | null {
  if (!listing.vendorAlias || pop.newVendorCutoff == null) return null;
  const v = pop.vendorStats.get(listing.vendorAlias);
  if (!v) return null;
  const isNew = v.firstSeenMin >= pop.newVendorCutoff;
  const isHighRiskCategory = HIGH_RISK_CATEGORIES.has(listing.category);
  if (!isNew || !isHighRiskCategory) return null;
  return {
    label: "Recently first-seen vendor active in a high-risk category",
    value: WEIGHTS.newVendorHighRisk,
    factor: "newVendorHighRisk",
  };
}

// Feature 9 (vendor price consistency/anomaly) from the design brief is
// intentionally NOT implemented: with ~2-6 priced listings per vendor in
// the current dataset, a per-vendor variance estimate would not be
// statistically meaningful. Skipping it here rather than inventing a
// result; it's a reasonable candidate for future work once a larger
// per-vendor price history is loaded.

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Score a single listing against a population (all listings currently in
 * the dataset). Pure function — same inputs always produce the same
 * output, no randomness anywhere.
 */
export function scoreListingAgainstPopulation(listing: ListingInput, population: Population): RiskResult {
  const signals: RiskSignal[] = [];

  const cat = categoryBaseRisk(listing.category);
  if (cat) signals.push(cat);

  const bulk = bulkQuantityIndicator(listing.title);
  if (bulk) signals.push(bulk);

  const price = priceOutlier(listing, population);
  if (price) signals.push(price);

  signals.push(...contentIndicators(listing.title));

  const cross = crossMarketplace(listing, population);
  if (cross) signals.push(cross);

  const velocity = listingVelocity(listing, population);
  if (velocity) signals.push(velocity);

  const diversity = riskDiversity(listing, population);
  if (diversity) signals.push(diversity);

  const newVendor = newVendorHighRisk(listing, population);
  if (newVendor) signals.push(newVendor);

  const rawScore = signals.reduce((sum, s) => sum + s.value, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  return { score, signals };
}

/**
 * Score every listing in a set against the population formed by that same
 * set. This is the entry point used by both the seed script and the
 * /api/listings route — build the population once, then score each row.
 */
export function scoreListings(listings: ListingInput[]): Map<string, RiskResult> {
  const population = buildPopulation(listings);
  const out = new Map<string, RiskResult>();
  for (const listing of listings) {
    out.set(listing.id, scoreListingAgainstPopulation(listing, population));
  }
  return out;
}

/**
 * Flatten a RiskResult's structured signals down to the plain string[]
 * shape the existing `Listing.signals` Json field / frontend expect
 * (see apps/frontend/src/App.tsx `signalsList`/`signalsLabel`, which treat
 * `signals` as a string array). Keeps the point value in the string so the
 * information isn't lost, without changing the stored/returned data shape.
 */
export function signalsToDisplayStrings(signals: RiskSignal[]): string[] {
  return signals.map((s) => `${s.label} (+${s.value})`);
}

// ─── Simulate pipeline: deterministic score delta ───────────────────────
//
// Replaces `4 + Math.floor(Math.random() * 6)` in routes/simulate.ts.
// The delta is a deterministic function of the correlated entity's own
// risk/confidence AND the network's current risk — a higher-risk,
// higher-confidence correlated entity pulls the network's score toward
// its own level, which is the explainable story the pipeline is telling.
// When no entity is available to correlate against, falls back to a
// fixed, documented baseline instead of inventing a random one.
//
// IMPORTANT: this is a PULL toward the entity's risk, not a flat
// increment. Earlier versions always returned a positive delta
// (floor 3), so with the producer feeding events continuously and
// forever (see /producer), every network's risk only ever went up and
// every network eventually saturated at 100 regardless of how risky its
// entities actually were. Scaling by the gap between the entity's risk
// and the network's current risk means a network catches up quickly
// while it's well below its entities' risk, then the delta shrinks
// toward zero (and can go slightly negative) once it's caught up — so
// each network settles near what its entity evidence actually supports
// instead of climbing to 100 on every single event.

const SIMULATE_DELTA_FALLBACK = 5; // midpoint of the old random 4-9 range, used only when no entity is available
const SIMULATE_DELTA_MIN = -8;
const SIMULATE_DELTA_MAX = 12;

export function computeSimulateScoreDelta(
  entity: { risk: number; confidence: number } | null | undefined,
  currentNetworkRisk = 0
): {
  delta: number;
  explanation: string;
} {
  if (!entity) {
    return {
      delta: SIMULATE_DELTA_FALLBACK,
      explanation: "No correlated entity available; used fixed baseline escalation",
    };
  }
  // Gap between where the network's risk sits now and where the
  // correlated entity's own risk says it should be, pulled by a fraction
  // that scales with how confident the correlation is (25%-50% of the
  // gap per event). Both inputs are already deterministic fields on the
  // Entity row, so this is fully reproducible.
  const gap = entity.risk - currentNetworkRisk;
  const pullFraction = 0.25 + (entity.confidence / 100) * 0.25;
  const raw = gap * pullFraction;
  const delta = Math.max(SIMULATE_DELTA_MIN, Math.min(SIMULATE_DELTA_MAX, Math.round(raw)));
  return {
    delta,
    explanation: `Pulled toward correlated entity risk (${entity.risk}, confidence ${entity.confidence}) from current network risk (${currentNetworkRisk})`,
  };
}