import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { computeVendorRisk } from "../lib/vendorRisk.js";
import { computeEntityRisk } from "../lib/entityRisk.js";
import { logAudit, ipFromRequest } from "../lib/audit.js";
import type { ListingInput } from "../lib/riskEngine.js";

export const searchRouter = Router();

async function buildListingInputs(): Promise<ListingInput[]> {
  const listings = await prisma.listing.findMany();
  return listings.map((l: any) => ({
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

// GET /api/search?q=... — real cross-resource search across entities,
// wallets, listings, and investigations, using Postgres/Prisma
// case-insensitive `contains` filters. Replaces the previous SearchScreen
// behaviour, which ignored the query entirely and just echoed the entire
// mock entity list back regardless of what was typed.
searchRouter.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json({ query: q, entities: [], wallets: [], listings: [], investigations: [] });

  const [entities, wallets, listings, investigations] = await Promise.all([
    prisma.entity.findMany({
      where: {
        OR: [
          { alias: { contains: q, mode: "insensitive" } },
          { displayId: { contains: q, mode: "insensitive" } },
          { identifiers: { some: { value: { contains: q, mode: "insensitive" } } } },
        ],
      },
      include: { identifiers: true },
      take: 25,
    }),
    prisma.wallet.findMany({
      where: {
        OR: [
          { displayId: { contains: q, mode: "insensitive" } },
          { cluster: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 25,
    }),
    prisma.listing.findMany({
      where: {
        OR: [
          { displayId: { contains: q, mode: "insensitive" } },
          { title: { contains: q, mode: "insensitive" } },
          { vendorAlias: { contains: q, mode: "insensitive" } },
          { category: { contains: q, mode: "insensitive" } },
        ],
      },
      include: { source: true },
      take: 25,
    }),
    prisma.investigation.findMany({
      where: {
        OR: [
          { displayId: { contains: q, mode: "insensitive" } },
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 25,
    }),
  ]);

  // Live-recompute entity risk for search results too — a search result
  // must never show a different risk number than the Entities screen would
  // for the same entity.
  const vendorRiskByAlias = computeVendorRisk(await buildListingInputs());
  const entitiesWithRisk = entities.map((e: any) => {
    const computed = computeEntityRisk(e.alias, vendorRiskByAlias);
    return { ...e, risk: computed.risk ?? e.risk, confidence: computed.confidence ?? e.confidence };
  });

  await logAudit({
    user: "System",
    action: "Ran Search",
    resource: `Query: ${q}`,
    type: "search",
    ip: ipFromRequest(req),
  });

  res.json({
    query: q,
    entities: entitiesWithRisk,
    wallets,
    listings,
    investigations,
  });
});
