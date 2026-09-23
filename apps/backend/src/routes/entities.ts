import { Router } from "express";

import { prisma } from "../lib/prisma.js";

import { computeVendorRisk, type VendorRisk } from "../lib/vendorRisk.js";

import { computeEntityRisk, buildEntityWalletEvidence, type EntityWalletEvidence } from "../lib/entityRisk.js";

import {
  correlateListings,
  getCorrelationForAlias,
  type CorrelationResult,
} from "../lib/entityCorrelation.js";

import type { ListingInput } from "../lib/riskEngine.js";

import { scoreAllWallets, type WalletRiskResult } from "../lib/walletRisk.js";

import { logAudit, ipFromRequest } from "../lib/audit.js";

export const entitiesRouter = Router();

async function buildListingInputs(): Promise<ListingInput[]> {
  const listings = await prisma.listing.findMany();

  return listings.map((l) => ({
    id: l.id,
    category: l.category,
    title: l.title,
    priceUsd: l.priceUsd,
    marketplace: l.marketplace,
    vendorAlias: l.vendorAlias,
    firstSeen: l.firstSeen,
    lastSeen: l.lastSeen,
    shipsFrom: l.shipsFrom,
  }));
}

async function buildVendorRiskMap(): Promise<Map<string, VendorRisk>> {
  return computeVendorRisk(await buildListingInputs());
}

// Builds the wallet-derived evidence map keyed by entityId — see
// lib/walletRisk.ts and lib/entityRisk.ts. Fetches all wallet ids + all
// transactions once, scores every wallet deterministically, then groups by
// the real WalletTransaction.entityId FK. This is what lets a wallet's
// computed risk actually reach entity (and, from there, network) risk
// instead of stopping at the Blockchain Intelligence screen.
async function buildWalletEvidenceByEntityId(): Promise<{
  walletEvidenceByEntityId: Map<string, EntityWalletEvidence>;
  walletRiskById: Map<string, WalletRiskResult>;
}> {
  const [wallets, transactions] = await Promise.all([
    prisma.wallet.findMany({ select: { id: true, displayId: true } }),
    prisma.walletTransaction.findMany(),
  ]);

  const walletRiskById = scoreAllWallets(
    wallets.map((w) => w.id),
    transactions
  );

  const walletEvidenceByEntityId = buildEntityWalletEvidence(walletRiskById, transactions);

  // Fill in walletDisplayIds (buildEntityWalletEvidence only has walletIds,
  // not the human-readable displayId, since it has no DB access).
  const displayIdById = new Map(wallets.map((w) => [w.id, w.displayId]));
  const transactionsByEntity = new Map<string, Set<string>>();
  for (const t of transactions) {
    if (!t.entityId) continue;
    const set = transactionsByEntity.get(t.entityId) ?? new Set<string>();
    set.add(t.walletId);
    transactionsByEntity.set(t.entityId, set);
  }
  for (const [entityId, evidence] of walletEvidenceByEntityId) {
    const walletIds = transactionsByEntity.get(entityId) ?? new Set<string>();
    evidence.walletDisplayIds = Array.from(walletIds)
      .map((id) => displayIdById.get(id))
      .filter((x): x is string => !!x)
      .sort();
  }

  return { walletEvidenceByEntityId, walletRiskById };
}

// Correlation is intentionally computed independently of vendor/entity
// risk (see lib/entityCorrelation.ts header): it answers "which listings
// belong together", never "how risky this is". Reused as-is by the
// simulation pipeline (routes/simulate.ts) so the two never disagree.
async function buildCorrelationResult(): Promise<CorrelationResult> {
  return correlateListings(await buildListingInputs());
}

// Attaches a `computed` block (honest, listing-evidence-derived — see
// lib/entityRisk.ts) alongside a `legacy` block holding the untouched
// seed-time stored values. The original top-level risk/confidence/riskChange
// fields are ALSO left completely unmodified for backward API-contract
// compatibility with anything already reading them directly — nothing about
// this change silently overwrites or removes existing fields.
function attachComputedRisk(
  entity: {
    id: string;
    alias: string;
    risk: number;
    confidence: number;
    riskChange: number;
    [key: string]: unknown;
  },
  vendorRiskByAlias: Map<string, VendorRisk>,
  correlationResult: CorrelationResult,
  walletEvidenceByEntityId: Map<string, EntityWalletEvidence>
) {
  const computed = computeEntityRisk(entity.alias, vendorRiskByAlias, walletEvidenceByEntityId, entity.id);

  // Additive field only — does not replace or feed into risk/confidence
  // above, which remain entirely owned by lib/entityRisk.ts. Correlation
  // answers "which listings make up this entity"; risk answers "how risky
  // is it" — see lib/entityCorrelation.ts header for why these stay separate.
  const correlationGroup = getCorrelationForAlias(
    entity.alias,
    correlationResult
  );

  const correlation = correlationGroup
    ? {
        method: correlationGroup.method,
        confidence: correlationGroup.confidence,
        matchedSignals: correlationGroup.matchedSignals,
        signalDetails: correlationGroup.signalDetails,
        correlatedListings: correlationGroup.listingCount,
        rawAliasVariants: correlationGroup.rawAliasVariants,
        marketplaces: correlationGroup.marketplaces,
        explanation: correlationGroup.explanation,
      }
    : {
        method: "multi_signal_correlation" as const,
        confidence: 0,
        matchedSignals: [] as const,
        signalDetails: [] as const,
        correlatedListings: 0,
        rawAliasVariants: [] as const,
        marketplaces: [] as const,
        explanation:
          "No listing carries a vendorAlias that normalizes to match this entity's alias.",
      };

  return {
    ...entity,

    risk: computed.risk ?? entity.risk,
    confidence: computed.confidence ?? entity.confidence,
    riskChange: null as number | null,

    computed: {
      risk: computed.risk ?? entity.risk,
      confidence: computed.confidence ?? entity.confidence,
      riskChange: null as number | null,

      riskChangeExplanation:
        "Not calculable: no per-entity historical risk snapshots exist in the schema (unlike Network, which has NetworkRiskPoint). See lib/entityRisk.ts.",

      correlated: computed.correlated,
      correlationMethod: computed.correlationMethod,
      vendorAlias: computed.vendorAlias,
      evidence: computed.evidence,
      walletEvidence: computed.walletEvidence,
      explanation: computed.explanation,
    },

    correlation,

    legacy: {
      risk: entity.risk,
      confidence: entity.confidence,
      riskChange: entity.riskChange,

      note:
        "Seed-time stored values — not derived from listing evidence. Prefer `computed` for anything presented to a user as a live/calculated metric.",
    },
  };
}

// GET /api/entities — list, or search when ?search= is supplied.
// The investigation workspace uses this endpoint for its live entity picker,
// so search is performed against real persisted entity/identifier data rather
// than the frontend demo array.
entitiesRouter.get("/", async (req, res) => {
  const search = String(req.query.search ?? "").trim();

  const [entities, vendorRiskByAlias, correlationResult, { walletEvidenceByEntityId }] = await Promise.all([
    prisma.entity.findMany({
      where: search
        ? {
            OR: [
              { alias: { contains: search, mode: "insensitive" } },
              { displayId: { contains: search, mode: "insensitive" } },
              { identifiers: { some: { value: { contains: search, mode: "insensitive" } } } },
            ],
          }
        : undefined,
      include: {
        identifiers: true,
        network: true,
      },
      take: search ? 25 : undefined,
    }),

    buildVendorRiskMap(),
    buildCorrelationResult(),
    buildWalletEvidenceByEntityId(),
  ]);

  const calculatedEntities = entities.map((e) =>
    attachComputedRisk(e, vendorRiskByAlias, correlationResult, walletEvidenceByEntityId)
  );

  calculatedEntities.sort((a, b) => b.risk - a.risk);

  res.json(calculatedEntities);
});

// GET /api/entities/:displayId — entity profile page
entitiesRouter.get("/:displayId", async (req, res) => {
  const [entity, vendorRiskByAlias, correlationResult, { walletEvidenceByEntityId, walletRiskById }] = await Promise.all([
    prisma.entity.findUnique({
      where: {
        displayId: req.params.displayId,
      },

      include: {
        identifiers: true,

        network: {
          include: {
            riskPoints: true,
          },
        },

        alertLinks: {
          include: {
            alert: true,
          },
        },

        investigationLinks: {
          include: {
            investigation: true,
          },
        },

        events: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    }),

    buildVendorRiskMap(),
    buildCorrelationResult(),
    buildWalletEvidenceByEntityId(),
  ]);

  if (!entity) {
    return res.status(404).json({
      error: "Entity not found",
    });
  }

  await logAudit({
    user: "System",
    action: "Viewed Entity",
    resource: entity.alias,
    type: "read",
    ip: ipFromRequest(req),
  });

  // ── Listings correlated to this entity ──────────────────────────────
  // Reuses the SAME correlation group entityRisk/the Overview tab already
  // rely on (normalized-alias match — see entityCorrelation.ts). No new
  // correlation logic: correlationGroup.listingIds is exactly the set of
  // real Listing rows already deemed to belong to this entity's alias.
  const correlationGroup = getCorrelationForAlias(entity.alias, correlationResult);
  const listings =
    correlationGroup && correlationGroup.listingIds.length > 0
      ? await prisma.listing.findMany({
          where: { id: { in: correlationGroup.listingIds } },
          include: { source: true },
          orderBy: { lastSeen: "desc" },
        })
      : [];

  // ── Wallets associated with this entity ─────────────────────────────
  // Real WalletTransaction.entityId FK — the same relationship
  // buildEntityWalletEvidence() already aggregates for computed.walletEvidence,
  // just resolved here to full Wallet rows for display, with risk pulled
  // from the already-computed walletRiskById map (lib/walletRisk.ts) rather
  // than recomputed.
  const entityWalletTransactions = await prisma.walletTransaction.findMany({
    where: { entityId: entity.id },
    include: { wallet: true },
    orderBy: { occurredAt: "desc" },
  });

  const walletTxnCountById = new Map<string, number>();
  const walletById = new Map<string, (typeof entityWalletTransactions)[number]["wallet"]>();
  for (const t of entityWalletTransactions) {
    walletById.set(t.walletId, t.wallet);
    walletTxnCountById.set(t.walletId, (walletTxnCountById.get(t.walletId) ?? 0) + 1);
  }

  const wallets = Array.from(walletById.values()).map((w) => {
    const walletRisk = walletRiskById.get(w.id);
    return {
      ...w,
      risk: walletRisk?.calculable ? walletRisk.score : w.risk,
      computed: walletRisk
        ? {
            score: walletRisk.score,
            calculable: walletRisk.calculable,
            explanation: walletRisk.explanation,
          }
        : null,
      transactionCountForEntity: walletTxnCountById.get(w.id) ?? 0,
    };
  });

  // ── Evidence corresponding to this entity ───────────────────────────
  // An EvidenceRecord has no direct entityId (see schema.prisma) — it's
  // scoped to Investigations. So "evidence for this entity" is every
  // EvidenceRecord that belongs to (owning investigationId) OR is
  // attached to (InvestigationEvidence join) an Investigation this entity
  // is actually linked to via the real InvestigationEntity join
  // (entity.investigationLinks, already fetched above). No evidence is
  // duplicated or created — this only reads existing rows.
  const linkedInvestigationIds = entity.investigationLinks.map((l) => l.investigationId);
  const evidence =
    linkedInvestigationIds.length > 0
      ? await prisma.evidenceRecord.findMany({
          where: {
            OR: [
              { investigationId: { in: linkedInvestigationIds } },
              { investigationLinks: { some: { investigationId: { in: linkedInvestigationIds } } } },
            ],
          },
          include: {
            source: true,
            investigation: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

  // ── Marketplace / Comm identifiers ───────────────────────────────────
  // No dedicated Marketplace or Communication model exists in the schema
  // (see lib/graphSync.ts) — marketplace presence is the same
  // correlation.marketplaces list already computed from real Listing rows,
  // and "Comm" identifiers are whatever real Identifier rows this entity
  // has whose type actually denotes a communication channel. Nothing is
  // invented: if no such identifiers exist, this is an empty array and the
  // frontend shows an honest empty state rather than fabricating data.
  const commIdentifiers = entity.identifiers.filter((id) => /comm|telegram|email|username|discord|jabber|xmpp/i.test(id.type));

  res.json({
    ...attachComputedRisk(
      entity,
      vendorRiskByAlias,
      correlationResult,
      walletEvidenceByEntityId
    ),
    listings,
    wallets,
    evidence,
    commIdentifiers,
  });
});