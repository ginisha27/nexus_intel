// apps/backend/src/lib/investigationDetail.ts
//
// Assembles everything the Investigation Workspace needs for one case into
// a single response, so the frontend never has to stitch together
// entities/wallets/listings/risk from separate, unrelated calls.
//
// Every relationship exposed here is a real FK or field match that already
// exists elsewhere in this codebase — nothing is invented to make the
// graph/response look more complete than the data actually is:
//
//   - Entity <-> Network        : Entity.networkId (real FK)
//   - Entity <-> Wallet         : WalletTransaction.entityId (real FK)
//   - Entity <-> Listing        : normalizeVendorAlias(Listing.vendorAlias)
//                                 === normalizeVendorAlias(Entity.alias)
//                                 (normalized-alias correlation — same
//                                 convention as vendorRisk.ts/entityRisk.ts;
//                                 NOT identity resolution, see those files)
//   - Entity <-> Alert          : AlertEntity (real FK, already modeled)
//   - Wallet <-> Investigation  : derived transitively through
//                                 WalletTransaction rows that reference
//                                 either one of the investigation's linked
//                                 entities OR its network
//
// Risk/riskFactors reuse computeInvestigationSignals from
// investigationAssessment.ts (the exact function that already backs
// POST /:displayId/ai-assessment) rather than re-implementing scoring, so
// the live risk block can never silently disagree with a persisted
// AiAssessment for the same case.

import type { Entity, Investigation, Listing, Network, Source, Wallet, WalletTransaction } from "@prisma/client";
import { prisma } from "./prisma.js";
import { computeVendorRisk, type VendorRisk } from "./vendorRisk.js";
import { computeEntityRisk } from "./entityRisk.js";
import { normalizeVendorAlias } from "./entityCorrelation.js";
import { scoreListings, signalsToDisplayStrings, type ListingInput } from "./riskEngine.js";
import { computeInvestigationSignals, type AssessmentSignal } from "./investigationAssessment.js";
import { riskToStatus } from "./riskStatus.js";

// ─── Entity relationships ───────────────────────────────────────────────

export type EntityRelationship =
  | {
      type: "NETWORK_MEMBER";
      networkDisplayId: string;
      networkRisk: number;
      networkStatus: string;
      explanation: string;
    }
  | {
      type: "WALLET_TRANSACTION";
      walletDisplayId: string;
      transactionCount: number;
      explanation: string;
    }
  | {
      type: "LISTING_MATCH";
      listingDisplayId: string;
      category: string;
      marketplace: string | null;
      explanation: string;
    }
  | {
      type: "ALERT_LINK";
      alertDisplayId: string;
      severity: number;
      explanation: string;
    };

export interface EntityWithRelationships {
  displayId: string;
  alias: string;
  risk: number;
  confidence: number;
  riskChange: number;
  relationships: EntityRelationship[];
  // Seed-time stored values, exposed alongside the computed ones above so
  // a caller never has to guess why this entity's risk here (evidence-
  // derived, see entityRisk.ts) can differ from the average cited in
  // riskFactors below (which intentionally uses these legacy values — see
  // buildInvestigationDetailExtras's comment on computeInvestigationSignals
  // for why). Same computed/legacy split routes/entities.ts already uses.
  legacy: { risk: number; confidence: number; riskChange: number };
}

type EntityForRelationships = Entity & {
  network: Network | null;
  alertLinks: { alert: { displayId: string; severity: number } }[];
};

function buildEntityRelationships(
  entity: EntityForRelationships,
  walletTxnsByEntityId: Map<string, WalletTransaction[]>,
  listingsByVendorAlias: Map<string, Listing[]>
): EntityRelationship[] {
  const relationships: EntityRelationship[] = [];

  if (entity.network) {
    relationships.push({
      type: "NETWORK_MEMBER",
      networkDisplayId: entity.network.displayId,
      networkRisk: entity.network.risk,
      networkStatus: entity.network.status,
      explanation: `Entity.networkId links this entity to Network ${entity.network.displayId}.`,
    });
  }

  const walletTxns = walletTxnsByEntityId.get(entity.id) ?? [];
  const txnsByWallet = new Map<string, WalletTransaction[]>();
  for (const t of walletTxns) {
    const arr = txnsByWallet.get(t.walletId) ?? [];
    arr.push(t);
    txnsByWallet.set(t.walletId, arr);
  }
  for (const [, txns] of txnsByWallet) {
    // walletDisplayId is set to the raw walletId here since this function
    // has no wallet lookup table — buildInvestigationDetailExtras rewrites
    // it to the real Wallet.displayId right after calling this function.
    relationships.push({
      type: "WALLET_TRANSACTION",
      walletDisplayId: txns[0].walletId, // placeholder, rewritten below
      transactionCount: txns.length,
      explanation: `${txns.length} observed transaction(s) between this entity and the wallet.`,
    });
  }

  // listingsByVendorAlias is keyed by NORMALIZED alias (see where it's
  // built, below) — normalize entity.alias the same way before lookup, so
  // this can't silently miss a match that vendorRisk.ts/entityRisk.ts would
  // find (e.g. entity alias "HappyEyes" vs listing vendorAlias "happyeyes").
  const listings = listingsByVendorAlias.get(normalizeVendorAlias(entity.alias)) ?? [];
  for (const listing of listings) {
    const sameRawSpelling = listing.vendorAlias === entity.alias;
    relationships.push({
      type: "LISTING_MATCH",
      listingDisplayId: listing.displayId,
      category: listing.category,
      marketplace: listing.marketplace,
      explanation: sameRawSpelling
        ? `Listing.vendorAlias "${listing.vendorAlias}" matches this entity's alias exactly.`
        : `Listing.vendorAlias "${listing.vendorAlias}" matches this entity's alias "${entity.alias}" after normalization (case/whitespace only — not an exact string match).`,
    });
  }

  for (const link of entity.alertLinks) {
    relationships.push({
      type: "ALERT_LINK",
      alertDisplayId: link.alert.displayId,
      severity: link.alert.severity,
      explanation: `Entity is linked to Alert ${link.alert.displayId} via AlertEntity.`,
    });
  }

  return relationships;
}

// ─── Wallet contribution ────────────────────────────────────────────────

export interface WalletTransactionSummary {
  entityDisplayId: string | null;
  entityAlias: string | null;
  networkDisplayId: string | null;
  direction: string;
  amountBtcEq: number;
  occurredAt: Date;
}

export interface WalletContribution {
  displayId: string;
  risk: number;
  cluster: string | null;
  totalVolume: string | null;
  flagged: boolean;
  connectedBecause: string;
  transactions: WalletTransactionSummary[];
}

function describeWalletRelevance(
  txns: WalletTransactionSummary[]
): string {
  const networks = new Set(txns.map((t) => t.networkDisplayId).filter((v): v is string => !!v));
  const entityAliases = new Set(txns.map((t) => t.entityAlias).filter((v): v is string => !!v));
  const plural = txns.length === 1 ? "" : "s";

  if (networks.size === 1) {
    const [network] = networks;
    return `${txns.length} transaction${plural} associated with Network ${network}`;
  }
  if (entityAliases.size > 0) {
    return `${txns.length} transaction${plural} with ${Array.from(entityAliases).join(", ")}`;
  }
  return `${txns.length} transaction${plural} linked to this investigation`;
}

// Finds every wallet with at least one transaction to one of this
// investigation's entities, or to its network — i.e. every wallet that is
// ACTUALLY connected, derived from real WalletTransaction rows rather than
// hardcoded. A wallet with zero matching transactions never appears here.
export async function computeInvestigationWallets(
  entityIds: string[],
  networkId: string | null
): Promise<WalletContribution[]> {
  if (entityIds.length === 0 && !networkId) return [];

  const orConditions: Array<{ entityId?: { in: string[] }; networkId?: string }> = [];
  if (entityIds.length > 0) orConditions.push({ entityId: { in: entityIds } });
  if (networkId) orConditions.push({ networkId });

  const txns = await prisma.walletTransaction.findMany({
    where: { OR: orConditions },
    include: { wallet: true, entity: true, network: true },
    orderBy: { occurredAt: "desc" },
  });

  const byWallet = new Map<string, { wallet: Wallet; txns: WalletTransactionSummary[] }>();
  for (const t of txns) {
    const summary: WalletTransactionSummary = {
      entityDisplayId: t.entity?.displayId ?? null,
      entityAlias: t.entity?.alias ?? null,
      networkDisplayId: t.network?.displayId ?? null,
      direction: t.direction,
      amountBtcEq: t.amountBtcEq,
      occurredAt: t.occurredAt,
    };
    const existing = byWallet.get(t.walletId);
    if (existing) {
      existing.txns.push(summary);
    } else {
      byWallet.set(t.walletId, { wallet: t.wallet, txns: [summary] });
    }
  }

  return Array.from(byWallet.values())
    .map(({ wallet, txns }) => ({
      displayId: wallet.displayId,
      risk: wallet.risk,
      cluster: wallet.cluster,
      totalVolume: wallet.totalVolume,
      flagged: wallet.flagged,
      connectedBecause: describeWalletRelevance(txns),
      transactions: txns,
    }))
    .sort((a, b) => b.risk - a.risk);
}

// ─── Listing contribution ───────────────────────────────────────────────

export interface ListingContribution {
  displayId: string;
  category: string;
  title: string | null;
  priceUsd: number | null;
  marketplace: string | null;
  vendorAlias: string | null;
  source: string | null;
  status: string;
  risk: number;
  signals: string[];
  relatedEntity: { displayId: string; alias: string } | null;
}

// Reuses riskEngine.ts's live scorer — the exact same function GET
// /api/listings calls — so a listing's risk/signals here can never drift
// from what the Listings screen shows for the same row.
export async function computeInvestigationListings(
  investigationEntities: { displayId: string; alias: string }[]
): Promise<ListingContribution[]> {
  // Keyed by NORMALIZED alias (see normalizeVendorAlias in
  // entityCorrelation.ts) — same convention as vendorRisk.ts/entityRisk.ts,
  // so a listing's vendorAlias only needs to match an investigation
  // entity's alias after case/whitespace normalization, not byte-for-byte.
  const aliasToEntity = new Map(investigationEntities.map((e) => [normalizeVendorAlias(e.alias), e]));
  if (aliasToEntity.size === 0) return [];

  const allListings = await prisma.listing.findMany({ include: { source: true } });
  const relevant = allListings.filter((l) => l.vendorAlias && aliasToEntity.has(normalizeVendorAlias(l.vendorAlias)));
  if (relevant.length === 0) return [];

  const inputs: ListingInput[] = allListings.map((l) => ({
    id: l.id,
    category: l.category,
    title: l.title,
    priceUsd: l.priceUsd,
    marketplace: l.marketplace,
    vendorAlias: l.vendorAlias,
    shipsFrom: l.shipsFrom,
    firstSeen: l.firstSeen,
    lastSeen: l.lastSeen,
  }));
  const scored = scoreListings(inputs);

  return relevant
    .map((l) => {
      const result = scored.get(l.id);
      const entity = l.vendorAlias ? aliasToEntity.get(normalizeVendorAlias(l.vendorAlias)) ?? null : null;
      return {
        displayId: l.displayId,
        category: l.category,
        title: l.title,
        priceUsd: l.priceUsd,
        marketplace: l.marketplace,
        vendorAlias: l.vendorAlias,
        source: (l as Listing & { source: Source | null }).source?.name ?? null,
        status: l.status,
        risk: result?.score ?? l.risk,
        signals: result ? signalsToDisplayStrings(result.signals) : (l.signals as string[]),
        relatedEntity: entity,
      };
    })
    .sort((a, b) => b.risk - a.risk);
}

// ─── Full assembly ───────────────────────────────────────────────────────

export interface InvestigationDetailExtras {
  entities: EntityWithRelationships[];
  wallets: WalletContribution[];
  listings: ListingContribution[];
  risk: { score: number; level: string };
  riskFactors: AssessmentSignal[];
  // Explicit, in-response note on which entity risk source riskFactors
  // was averaged from — since it's deliberately the legacy/seed-time
  // value (to stay consistent with any already-persisted AiAssessment,
  // see below), not the `entities[].risk` evidence-derived value shown
  // elsewhere in this same payload. Without this, the two numbers
  // silently disagree with no clue why.
  riskFactorsSource: "legacy";
}

interface AssembleInput {
  investigation: Investigation;
  network: Network | null;
  linkedEntities: EntityForRelationships[];
  evidence: { status: string }[];
  timeline: { type: string }[];
}

export async function buildInvestigationDetailExtras(input: AssembleInput): Promise<InvestigationDetailExtras> {
  const { investigation, network, linkedEntities, evidence, timeline } = input;
  const entityIds = linkedEntities.map((e) => e.id);

  // Vendor/listing correlation, reused as-is from entities.ts's pattern —
  // computed against the FULL listing population (not just this
  // investigation's) because vendor risk/confidence is a global aggregate.
  const allListings = await prisma.listing.findMany();
  const listingInputs: ListingInput[] = allListings.map((l) => ({
    id: l.id,
    category: l.category,
    title: l.title,
    priceUsd: l.priceUsd,
    marketplace: l.marketplace,
    vendorAlias: l.vendorAlias,
    shipsFrom: l.shipsFrom,
    firstSeen: l.firstSeen,
    lastSeen: l.lastSeen,
  }));
  const vendorRiskByAlias: Map<string, VendorRisk> = computeVendorRisk(listingInputs);
  // Keyed by NORMALIZED alias, same convention as vendorRiskByAlias, so
  // this map can't find a different set of "matching" listings than the
  // risk pipeline does for the same entity.
  const listingsByVendorAlias = new Map<string, Listing[]>();
  for (const l of allListings) {
    if (!l.vendorAlias) continue;
    const normalized = normalizeVendorAlias(l.vendorAlias);
    const arr = listingsByVendorAlias.get(normalized) ?? [];
    arr.push(l);
    listingsByVendorAlias.set(normalized, arr);
  }

  // Wallet transactions for THIS investigation's entities/network — the
  // real FK data that both the entity-relationship view and the
  // wallet-contribution view are built from.
  const walletTxns = entityIds.length > 0 || network
    ? await prisma.walletTransaction.findMany({
        where: {
          OR: [
            ...(entityIds.length > 0 ? [{ entityId: { in: entityIds } }] : []),
            ...(network ? [{ networkId: network.id }] : []),
          ],
        },
        include: { wallet: true },
      })
    : [];
  const walletTxnsByEntityId = new Map<string, WalletTransaction[]>();
  for (const t of walletTxns) {
    if (!t.entityId) continue;
    const arr = walletTxnsByEntityId.get(t.entityId) ?? [];
    arr.push(t);
    walletTxnsByEntityId.set(t.entityId, arr);
  }
  const walletDisplayIdById = new Map<string, string>(
    walletTxns.map((t): [string, string] => [t.walletId, t.wallet.displayId])
  );

  const entities: EntityWithRelationships[] = linkedEntities.map((entity) => {
    const relationships = buildEntityRelationships(entity, walletTxnsByEntityId, listingsByVendorAlias).map((r) =>
      r.type === "WALLET_TRANSACTION"
        ? { ...r, walletDisplayId: walletDisplayIdById.get(r.walletDisplayId) ?? r.walletDisplayId }
        : r
    );
    // computeEntityRisk gives an honest, listing-evidence-derived
    // risk/confidence (see entityRisk.ts) — reused here rather than a
    // third re-derivation. riskChange stays the seed-time value (see
    // entityRisk.ts's note on why riskChange isn't recomputable).
    const computed = computeEntityRisk(entity.alias, vendorRiskByAlias);
    return {
      id: entity.id,
      displayId: entity.displayId,
      alias: entity.alias,
      risk: computed.risk ?? entity.risk,
      confidence: computed.confidence ?? entity.confidence,
      riskChange: entity.riskChange,
      relationships,
      legacy: { risk: entity.risk, confidence: entity.confidence, riskChange: entity.riskChange },
    };
  });

  const wallets = await computeInvestigationWallets(entityIds, network?.id ?? null);
  const listings = await computeInvestigationListings(linkedEntities.map((e) => ({ displayId: e.displayId, alias: e.alias })));

  // Risk/riskFactors: identical inputs to what POST /ai-assessment already
  // feeds computeInvestigationSignals (legacy entity.risk/confidence,
  // matching any persisted AiAssessment for this case), so this block
  // never silently disagrees with an assessment already on file.
  const { score, signals } = computeInvestigationSignals({
    displayId: investigation.displayId,
    title: investigation.title,
    description: investigation.description,
    priority: investigation.priority,
    status: investigation.status,
    entities: linkedEntities.map((e) => ({
      alias: e.alias,
      risk: e.risk,
      confidence: e.confidence,
      riskChange: e.riskChange,
    })),
    evidence,
    timeline,
    network: network ? { displayId: network.displayId, risk: network.risk, change: network.change, status: network.status } : null,
  });

  return {
    entities,
    wallets,
    listings,
    risk: { score, level: riskToStatus(score) },
    riskFactors: signals,
    riskFactorsSource: "legacy",
  };
}