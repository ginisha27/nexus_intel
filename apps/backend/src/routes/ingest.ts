import { Router, type Request } from "express";
import { prisma } from "../lib/prisma.js";
import { runIntelligencePipeline } from "../lib/intelligencePipeline.js";
import { logAudit, ipFromRequest } from "../lib/audit.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getNextRealListings, resolveSourceIdForMarketplace } from "../lib/realListingFeed.js";
import { scoreListings, signalsToDisplayStrings, type ListingInput } from "../lib/riskEngine.js";

export const ingestRouter = Router();

function checkIngestKey(req: Request): string | null {
  const expectedKey = process.env.INGEST_SECRET_KEY;
  if (!expectedKey) return "INGEST_SECRET_KEY is not configured on the server";
  const providedKey = req.header("x-ingest-key");
  if (!providedKey || providedKey !== expectedKey) return "Invalid or missing ingestion key";
  return null;
}

// GET /api/ingest/candidates?count=5
// Header: x-ingest-key: <INGEST_SECRET_KEY>
//
// Hands the producer the next batch of REAL, not-yet-ingested rows from
// the Hansa/Valhalla CSVs (see lib/realListingFeed.ts) — genuine listing
// data for vendors we already track, rather than the producer replaying
// the same already-imported listings forever. Stateless: once the
// producer POSTs one of these back via /event (below) and it becomes a
// real Listing row, it naturally drops out of the next call here.
ingestRouter.get("/candidates", asyncHandler(async (req, res) => {
  const err = checkIngestKey(req);
  if (err) return res.status(err.startsWith("INGEST") ? 500 : 401).json({ error: err });

  const count = Math.max(1, Math.min(100, Number(req.query.count) || 10));
  const candidates = await getNextRealListings(count);
  res.json({ candidates });
}));

// POST /api/ingest/event
// Header: x-ingest-key: <INGEST_SECRET_KEY>
// Body:   { networkDisplayId: string, entityDisplayId?: string, eventType?: string, description?: string }
//
// This is the real push-ingestion endpoint referenced in routes/simulate.ts
// and lib/intelligencePipeline.ts ("routes/ingest.ts, coming next"). It's
// the network-facing counterpart to the "Simulate Incoming Intelligence"
// button: same pipeline, same response shape, but:
//
//   1. Authenticated with a shared secret (x-ingest-key) instead of a user
//      session, since the caller is an automated producer process, not a
//      logged-in investigator.
//   2. Takes eventType/description from the caller instead of picking one
//      deterministically — the producer's staging pool already knows what
//      kind of event each row represents.
//   3. Logs "Live Intelligence Ingested" (attributed to "Producer") rather
//      than "Simulated Incoming Intelligence", so the audit trail can tell
//      real pushed events apart from manual demo clicks.
//
// Everything else — resolving the network/entity, correlation, risk
// recalculation, alerting, wallet evidence, Socket.IO broadcast — is
// identical to /api/simulate/event because both call the same
// runIntelligencePipeline().
// Real listing payload, as handed back by GET /candidates. Optional —
// callers that just want the old cosmetic behavior can omit it.
interface IncomingListing {
  displayId: string;
  marketplace: string;
  title: string;
  vendorAlias: string;
  priceUsd: number | null;
  category: string;
  shipsFrom: string | null;
}

// Turns one real, not-yet-seen CSV row into an actual Listing row, scored
// against the CURRENT full population (same convention as
// GET /api/listings and importDatadump.ts — never hand-typed). This is
// what lets vendor/entity/network risk actually move over time instead of
// converging on a static target: computeVendorRisk/computeEntityRisk (see
// intelligencePipeline.ts) re-read prisma.listing.findMany() fresh on
// every event, so a genuinely new row here is genuinely new evidence.
async function createRealListing(listing: IncomingListing, ip: string) {
  const existing = await prisma.listing.findUnique({ where: { displayId: listing.displayId } });
  if (existing) return existing; // already ingested (race/retry) — reuse, don't duplicate

  const sourceId = await resolveSourceIdForMarketplace(listing.marketplace);
  const now = new Date();

  const currentListings = await prisma.listing.findMany();
  const inputs: ListingInput[] = [
    ...currentListings.map((l) => ({
      id: l.id,
      category: l.category,
      title: l.title,
      priceUsd: l.priceUsd,
      marketplace: l.marketplace,
      vendorAlias: l.vendorAlias,
      firstSeen: l.firstSeen,
      lastSeen: l.lastSeen,
      shipsFrom: l.shipsFrom,
    })),
    {
      id: listing.displayId,
      category: listing.category,
      title: listing.title,
      priceUsd: listing.priceUsd,
      marketplace: listing.marketplace,
      vendorAlias: listing.vendorAlias,
      firstSeen: now,
      lastSeen: now,
      shipsFrom: listing.shipsFrom,
    },
  ];
  const scored = scoreListings(inputs);
  const result = scored.get(listing.displayId)!;
  const status = result.score >= 75 ? "Flagged" : result.score >= 50 ? "Under Review" : "Monitoring";

  const created = await prisma.listing.create({
    data: {
      displayId: listing.displayId,
      category: listing.category,
      risk: result.score,
      signals: signalsToDisplayStrings(result.signals),
      firstSeen: now,
      lastSeen: now,
      status,
      marketplace: listing.marketplace,
      vendorAlias: listing.vendorAlias,
      title: listing.title,
      priceUsd: listing.priceUsd,
      shipsFrom: listing.shipsFrom,
      sourceId: sourceId ?? undefined,
    },
  });

  await logAudit({
    user: "Producer",
    action: "Real Listing Ingested",
    resource: created.displayId,
    type: "system",
    ip,
  });

  return created;
}

ingestRouter.post("/event", asyncHandler(async (req, res) => {
  const err = checkIngestKey(req);
  if (err) return res.status(err.startsWith("INGEST") ? 500 : 401).json({ error: err });

  const { networkDisplayId, entityDisplayId, eventType, description, listing } = req.body as {
    networkDisplayId?: string;
    entityDisplayId?: string;
    eventType?: string;
    description?: string;
    listing?: IncomingListing;
  };

  if (!networkDisplayId || !networkDisplayId.trim()) {
    return res.status(400).json({ error: "networkDisplayId is required" });
  }

  const network = await prisma.network.findUnique({
    where: { displayId: networkDisplayId },
    include: { entities: true },
  });
  if (!network) return res.status(404).json({ error: "Network not found" });

  // Event label: caller-supplied (the staging pool row already knows what
  // it is). Falls back to the same default the "Simulate" button starts
  // from if the row didn't carry one. The actual "event_detected"
  // broadcast (now carrying a real listing/entity reference when one
  // resolves) happens inside runIntelligencePipeline, not here.
  const chosen = {
    type: eventType?.trim() || "listing_detected",
    description: description?.trim() || "New listing detected on monitored source",
  };

  // If the caller handed us a real, not-yet-seen listing row (from
  // GET /candidates), persist it FIRST. Everything downstream —
  // correlation, computeVendorRisk/computeEntityRisk, the wallet step's
  // "most recent real listing" lookup — reads prisma.listing.findMany()
  // fresh, so this one row is immediately real evidence for the rest of
  // the pipeline, not just a cosmetic event label.
  let createdListing = null;
  if (listing && listing.displayId && listing.vendorAlias) {
    createdListing = await createRealListing(listing, ipFromRequest(req));
  }

  const entity =
    (entityDisplayId
      ? await prisma.entity.findUnique({ where: { displayId: entityDisplayId } })
      : null) ??
    (network.entities[0] || null);

  const result = await runIntelligencePipeline({
    network,
    entity,
    triggerType: chosen.type,
    triggerDescription: chosen.description,
    ip: ipFromRequest(req),
  });

  await logAudit({
    user: "Producer",
    action: "Live Intelligence Ingested",
    resource: network.displayId,
    type: "system",
    ip: ipFromRequest(req),
  });

  res.status(201).json({
    riskEvent: result.riskEvent,
    network: result.network,
    alert: result.alert,
    deltaInputSource: result.deltaInputSource,
    riskChange: result.riskChange,
    wallet: result.wallet,
    listing: createdListing,
  });
}));