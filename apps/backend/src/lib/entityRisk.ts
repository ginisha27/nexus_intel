// apps/backend/src/lib/entityRisk.ts
//
// Computes entity-level risk/confidence FROM vendor evidence, instead of
// trusting the seeded Entity.risk/confidence columns as if they were
// measured (they aren't — see seed.ts, where every entity's risk and
// confidence are literal hand-typed numbers with no calculation behind
// them).
//
// Correlation is by NORMALIZED Entity.alias <-> Listing.vendorAlias match
// (see normalizeVendorAlias in entityCorrelation.ts — case-folding,
// whitespace trimming/collapsing, zero-width-char stripping; deliberately
// NOT punctuation-stripping, to avoid aggressive merging of genuinely
// distinct handles).
//
// Same ALIAS CORRELATION caveat as vendorRisk.ts:
// this is NOT identity resolution.
//
// Two aliases that normalize to the same key are treated as belonging to
// the same seller for prototype-grade correlation purposes, but this does
// not prove they belong to the same real-world person. An alias could be
// reused coincidentally, or the same seller could operate under two
// different aliases undetected.
//
// Design: when an entity's alias matches a vendor with real listing
// evidence, entity risk is initially set equal to that vendor's computed
// risk — a deliberate 1:1 pass-through rather than a second listing-based
// weighted formula.
//
// The vendor score already IS the aggregate of the observable listing
// signals. Re-blending those same listing signals again at the entity
// layer would double-count the same evidence.
//
// Wallet evidence is an independent evidence source. When an entity has
// linked wallet transactions through the real WalletTransaction.entityId
// relationship, the wallet-derived risk may be blended with listing-derived
// vendor risk.
//
// The overall pipeline is:
//
//   Listing -> Vendor -> Entity
//                  \
//                   -> Wallet evidence -> Entity
//
// Evidence flows upward; individual listing signals are not re-scored at
// every layer.
//
// When there is no alias match AND no linked wallet evidence, there is no
// evidence at all for this entity, so risk/confidence are reported as null
// ("not calculable"), never defaulted to some arbitrary number.

import type { VendorRisk } from "./vendorRisk.js";
import { normalizeVendorAlias } from "./entityCorrelation.js";
import {
  signalsToContributors,
  type RiskContributor,
} from "./riskEngine.js";
import type { WalletRiskResult } from "./walletRisk.js";

export interface EntityWalletEvidence {
  // Number of distinct wallets with a real WalletTransaction.entityId FK
  // pointing to this entity.
  walletCount: number;

  // Human-readable wallet display IDs.
  //
  // This is populated by the route layer because that layer has access to
  // the Wallet.displayId lookup.
  walletDisplayIds: string[];

  // Highest computed wallet risk among this entity's linked wallets.
  maxWalletRisk: number | null;

  // Average computed wallet risk among this entity's linked wallets.
  averageWalletRisk: number | null;

  // Total number of transactions linking the wallets to this entity.
  totalTransactionCount: number;
}

export interface EntityComputedRisk {
  correlated: boolean;

  // "alias_normalized_match" means the entity alias and vendor alias
  // matched after normalizeVendorAlias().
  //
  // "none" means there was no marketplace alias correlation.
  //
  // NOTE: wallet-only evidence can still result in correlated=true while
  // correlationMethod remains "none", because no alias correlation exists.
  correlationMethod: "alias_normalized_match" | "none";

  risk: number | null; // 0-100, or null if not calculable

  confidence: number | null; // 0-100, or null if not calculable

  // Display alias from VendorRisk, if marketplace evidence exists.
  vendorAlias: string | null;

  // Marketplace/listing-derived evidence.
  evidence: {
    listingCount: number;
    marketplaceCount: number;
    highRiskCategoryCount: number;
  } | null;

  // Wallet-derived evidence.
  //
  // Independent of listing/vendorAlias evidence:
  //
  //   entity can have listing evidence only
  //   entity can have wallet evidence only
  //   entity can have both
  //   entity can have neither
  //
  // Null when no calculable wallet evidence exists for this entity.
  walletEvidence: EntityWalletEvidence | null;

  explanation: string;

  // Pass-through of vendorRisk.ts's representative-listing data.
  //
  // `contributors` is produced from the real, unmodified RiskSignal[]
  // belonging to the highest-scoring listing.
  //
  // It is NOT a decomposition of the blended entity/vendor score.
  representativeListingId: string | null;
  contributors: RiskContributor[];
}

// How much a linked wallet's own computed risk can move this entity's
// final risk, on top of/independent of listing evidence.
//
// Deliberately capped well under 100 so wallet evidence can escalate an
// entity without allowing a single wallet to manufacture a maximal entity
// score on its own.
const WALLET_RISK_BLEND_WEIGHT = 0.4;

export function computeEntityRisk(
  entityAlias: string,
  vendorRiskByAlias: Map<string, VendorRisk>,
  walletEvidenceByEntityId?: Map<string, EntityWalletEvidence>,
  entityId?: string,
): EntityComputedRisk {
  // vendorRiskByAlias is keyed by NORMALIZED alias (see vendorRisk.ts).
  //
  // The entity's own alias must therefore be normalized using the exact same
  // function before lookup.
  //
  // Example:
  //
  //   Entity.alias      = "HappyEyes"
  //   Listing.vendorAlias = "happyeyes"
  //
  // Both normalize to the same lookup key.
  const normalizedEntityAlias =
    normalizeVendorAlias(entityAlias);

  const vendor =
    vendorRiskByAlias.get(normalizedEntityAlias);

  const walletEvidence = entityId
    ? walletEvidenceByEntityId?.get(entityId) ?? null
    : null;

  // ---------------------------------------------------------------
  // No evidence
  // ---------------------------------------------------------------
  //
  // No marketplace correlation and no calculable wallet evidence means
  // there is nothing honest from which to calculate risk or confidence.
  if (!vendor && !walletEvidence) {
    return {
      correlated: false,
      correlationMethod: "none",
      risk: null,
      confidence: null,
      vendorAlias: null,
      evidence: null,
      walletEvidence: null,
      explanation:
        "No listing carries a vendorAlias matching this entity's alias, and no wallet transaction links to this entity — there is no evidence to compute risk or confidence from, so both are reported as not calculable rather than defaulted to a number.",
      representativeListingId: null,
      contributors: [],
    };
  }

  // ---------------------------------------------------------------
  // Wallet-only evidence
  // ---------------------------------------------------------------
  //
  // There is no marketplace/vendor evidence, but the entity has linked
  // wallet evidence.
  //
  // Since there is nothing else to blend it with, the wallet-derived risk
  // becomes the entity risk.
  //
  // Wallet risk itself is worst-case weighted:
  //
  //   max wallet risk     = 70%
  //   average wallet risk = 30%
  //
  // This follows the same principle used elsewhere in the codebase:
  // severe evidence should not be completely diluted by milder evidence.
  if (!vendor && walletEvidence) {
    const risk = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          (walletEvidence.maxWalletRisk ?? 0) * 0.7 +
          (walletEvidence.averageWalletRisk ?? 0) * 0.3,
        ),
      ),
    );

    // Confidence is based on the amount of wallet evidence available.
    //
    // Base: 20
    // Transaction volume: up to +50
    // Distinct wallets: up to +20
    //
    // Maximum = 90, intentionally leaving room for stronger future
    // corroborating evidence.
    const confidence = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          20 +
            Math.min(
              50,
              walletEvidence.totalTransactionCount * 3,
            ) +
            Math.min(
              20,
              walletEvidence.walletCount * 10,
            ),
        ),
      ),
    );

    return {
      correlated: true,

      // There is no alias correlation here.
      //
      // "correlated: true" means the entity has real evidence, not that an
      // alias correlation was established.
      correlationMethod: "none",

      risk,
      confidence,

      vendorAlias: null,
      evidence: null,

      walletEvidence,

      explanation:
        `Derived from ${walletEvidence.walletCount} linked wallet(s) ` +
        `(${walletEvidence.totalTransactionCount} total transaction(s)) ` +
        `— no marketplace listing evidence exists for this entity.`,

      representativeListingId: null,
      contributors: [],
    };
  }

  // Vendor is guaranteed non-null past this point.
  const vendorRisk = vendor!.risk;

  // ---------------------------------------------------------------
  // Listing/vendor confidence
  // ---------------------------------------------------------------
  //
  // Confidence measures how much corroborating evidence backs the
  // correlation, NOT how risky the behavior is.
  //
  // Base:
  //   30 points for having at least one matching listing.
  //
  // Volume:
  //   +4 per listing, capped at +40.
  //
  // Cross-marketplace corroboration:
  //   +20 for appearing under the same normalized alias on 2+ marketplaces.
  //
  // High-risk category diversity:
  //   +5 per high-risk category, capped at +10.
  const volumeBonus = Math.min(
    40,
    vendor!.listingCount * 4,
  );

  const crossMarketBonus =
    vendor!.marketplaceCount >= 2
      ? 20
      : 0;

  const consistencyBonus = Math.min(
    10,
    vendor!.highRiskCategoryCount * 5,
  );

  let confidence = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        30 +
          volumeBonus +
          crossMarketBonus +
          consistencyBonus,
      ),
    ),
  );

  // Start with the vendor-derived listing risk.
  let risk = vendorRisk;

  let explanation =
    `Derived from ${vendor!.listingCount} listing(s) ` +
    `under alias "${vendor!.vendorAlias}" ` +
    `across ${vendor!.marketplaceCount} marketplace(s) ` +
    `(normalized alias correlation, not identity resolution).`;

  // ---------------------------------------------------------------
  // Listing + wallet evidence
  // ---------------------------------------------------------------
  //
  // When both evidence sources exist, blend the vendor-derived listing
  // risk with the wallet-derived risk.
  if (walletEvidence) {
    // Wallet component:
    //
    //   max wallet risk     = 70%
    //   average wallet risk = 30%
    //
    // This produces a single wallet-risk figure before blending it with
    // marketplace/vendor risk.
    const walletRiskFigure = Math.round(
      (walletEvidence.maxWalletRisk ?? 0) * 0.7 +
        (walletEvidence.averageWalletRisk ?? 0) * 0.3,
    );

    // Combine listing/vendor risk and wallet risk.
    //
    // Vendor/listing evidence:
    //   60%
    //
    // Wallet evidence:
    //   40%
    const blendedRisk = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          vendorRisk *
            (1 - WALLET_RISK_BLEND_WEIGHT) +
            walletRiskFigure *
              WALLET_RISK_BLEND_WEIGHT,
        ),
      ),
    );

    // Wallet evidence may escalate the entity's risk, but it must never
    // dilute the already-computed vendor/listing risk.
    //
    // This is especially important because vendorRisk.ts already protects
    // the maximum severe listing from being hidden by the aggregate.
    risk = Math.max(
      vendorRisk,
      blendedRisk,
    );

    // Wallet corroboration can also increase confidence slightly.
    confidence = Math.max(
      0,
      Math.min(
        100,
        confidence +
          Math.min(
            10,
            walletEvidence.walletCount * 3,
          ),
      ),
    );

    explanation +=
      ` Blended with computed risk from ` +
      `${walletEvidence.walletCount} linked wallet(s) ` +
      `(${walletEvidence.totalTransactionCount} transaction(s); ` +
      `wallet-derived component weighted at ` +
      `${Math.round(WALLET_RISK_BLEND_WEIGHT * 100)}%).`;
  }

  return {
    correlated: true,

    correlationMethod:
      "alias_normalized_match",

    risk,

    confidence,

    vendorAlias: vendor!.vendorAlias,

    evidence: {
      listingCount: vendor!.listingCount,
      marketplaceCount: vendor!.marketplaceCount,
      highRiskCategoryCount:
        vendor!.highRiskCategoryCount,
    },

    walletEvidence,

    explanation,

    representativeListingId:
      vendor!.representativeListingId,

    contributors:
      signalsToContributors(
        vendor!.representativeListingSignals,
      ),
  };
}

/**
 * Builds the per-entity wallet evidence map from already-computed
 * WalletRiskResult rows and the real WalletTransaction.entityId FKs that
 * link wallets to entities.
 *
 * Pure function — no DB access — so it composes cleanly with
 * scoreAllWallets() from walletRisk.ts at the route layer.
 */
export function buildEntityWalletEvidence(
  walletRiskById: Map<string, WalletRiskResult>,
  transactions: {
    walletId: string;
    entityId: string | null;
  }[],
): Map<string, EntityWalletEvidence> {
  const byEntity = new Map<
    string,
    {
      walletIds: Set<string>;
      walletDisplayIds: Set<string>;
      txnCount: number;
    }
  >();

  for (const transaction of transactions) {
    if (!transaction.entityId) {
      continue;
    }

    const bucket =
      byEntity.get(transaction.entityId) ?? {
        walletIds: new Set<string>(),
        walletDisplayIds: new Set<string>(),
        txnCount: 0,
      };

    bucket.walletIds.add(
      transaction.walletId,
    );

    bucket.txnCount += 1;

    byEntity.set(
      transaction.entityId,
      bucket,
    );
  }

  const out =
    new Map<string, EntityWalletEvidence>();

  for (const [entityId, bucket] of byEntity) {
    // Only include wallets that have a real, calculable WalletRiskResult.
    //
    // If wallets are linked to the entity but none have calculable risk,
    // there is nothing honest to report as wallet-derived risk.
    const risks = Array.from(bucket.walletIds)
      .map((id) => walletRiskById.get(id))
      .filter(
        (risk): risk is WalletRiskResult =>
          !!risk && risk.calculable,
      );

    if (risks.length === 0) {
      continue;
    }

    const scores = risks.map(
      (result) => result.score,
    );

    const averageWalletRisk =
      scores.reduce(
        (sum, score) => sum + score,
        0,
      ) / scores.length;

    out.set(entityId, {
      walletCount: bucket.walletIds.size,

      // Filled in by the route layer, which has access to Wallet.displayId.
      walletDisplayIds: [],

      maxWalletRisk: Math.max(...scores),

      averageWalletRisk:
        Math.round(
          averageWalletRisk * 10,
        ) / 10,

      totalTransactionCount:
        bucket.txnCount,
    });
  }

  return out;
}

/**
 * NOTE on Entity.riskChange:
 *
 * Intentionally NOT computed anywhere in this module.
 *
 * A defensible "risk change" requires comparing the current computed risk
 * against a stored PAST risk value at a known prior point in time — the same
 * role NetworkRiskPoint plays for networks.
 *
 * No equivalent per-entity history table exists in schema.prisma
 * (no "EntityRiskPoint"), so there is nothing real to diff against.
 *
 * Inventing a "before" value here would violate the no-fabricated-history
 * rule.
 *
 * Until a per-entity risk-history table exists, riskChange is
 * NOT CALCULABLE — routes/entities.ts reports computed.riskChange as null
 * with this explanation attached.
 */