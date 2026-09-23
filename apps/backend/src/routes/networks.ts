import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { computeVendorRisk, type VendorRisk } from "../lib/vendorRisk.js";
import { computeEntityRisk, buildEntityWalletEvidence, type EntityWalletEvidence } from "../lib/entityRisk.js";
import { computeNetworkRiskAggregate } from "../lib/networkRisk.js";
import { riskToStatus } from "../lib/riskStatus.js";
import type { ListingInput } from "../lib/riskEngine.js";
import { scoreAllWallets } from "../lib/walletRisk.js";
import { logAudit, ipFromRequest } from "../lib/audit.js";

export const networksRouter = Router();

async function buildVendorRiskMap(): Promise<Map<string, VendorRisk>> {
  const listings = await prisma.listing.findMany();
  const inputs: ListingInput[] = listings.map((l) => ({
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
  return computeVendorRisk(inputs);
}

// Same wallet -> entity evidence pipeline as routes/entities.ts (see that
// file's buildWalletEvidenceByEntityId for the full explanation). Kept as
// a separate copy here rather than a shared import cycle between routes,
// but the underlying computation (scoreAllWallets + buildEntityWalletEvidence)
// is the same real, deterministic logic from lib/walletRisk.ts / lib/entityRisk.ts.
async function buildWalletEvidenceByEntityId(): Promise<Map<string, EntityWalletEvidence>> {
  const [wallets, transactions] = await Promise.all([
    prisma.wallet.findMany({ select: { id: true } }),
    prisma.walletTransaction.findMany(),
  ]);
  const walletRiskById = scoreAllWallets(
    wallets.map((w) => w.id),
    transactions
  );
  return buildEntityWalletEvidence(walletRiskById, transactions);
}

async function calculateNetworkRisk(
  entities: { id: string; alias: string }[]
) {
  const [vendorRiskByAlias, walletEvidenceByEntityId] = await Promise.all([
    buildVendorRiskMap(),
    buildWalletEvidenceByEntityId(),
  ]);

  const entityRisks = entities.map((entity) =>
    computeEntityRisk(entity.alias, vendorRiskByAlias, walletEvidenceByEntityId, entity.id)
  );

  const aggregate = computeNetworkRiskAggregate(entityRisks);

  return {
    entityRisks,
    aggregate,
  };
}
// GET /api/networks — emerging networks list (Overview page ranking)
//
// `risk` / `change` / `status` remain the persisted, event-sourced values
// (see routes/simulate.ts) — completely UNCHANGED by this route, so the
// existing API contract and trajectory semantics stay intact. `computed` is
// a fresh, always-current aggregate derived from each network's entities'
// listing evidence, exposed alongside so the two can be compared rather
// than one silently masquerading as the other. See lib/networkRisk.ts.
networksRouter.get("/", async (req, res) => {
  const [networks, vendorRiskByAlias, walletEvidenceByEntityId] = await Promise.all([
    prisma.network.findMany({
      include: { _count: { select: { entities: true } }, entities: true },
    }),
    buildVendorRiskMap(),
    buildWalletEvidenceByEntityId(),
  ]);

  const out = networks.map((n) => {
    const entityRisks = n.entities.map((e) => computeEntityRisk(e.alias, vendorRiskByAlias, walletEvidenceByEntityId, e.id));
    const aggregate = computeNetworkRiskAggregate(entityRisks);
    const { entities, ...rest } = n; // keep list-view payload the same shape as before (no raw entity rows)
    return {
      ...rest,
      computed: aggregate,
      computedStatus: aggregate.computedBaselineRisk !== null ? riskToStatus(aggregate.computedBaselineRisk) : null,
    };
  });
  out.sort(
  (a, b) =>
    (b.computed.computedBaselineRisk ?? -1) -
    (a.computed.computedBaselineRisk ?? -1)
);

  await logAudit({
    user: "System",
    action: "Viewed Networks List",
    resource: `${out.length} networks`,
    type: "read",
    ip: ipFromRequest(req),
  });

  res.json(out);
});

// GET /api/networks/:displayId — full network details
networksRouter.get("/:displayId", async (req, res) => {
  const network = await prisma.network.findUnique({
    where: { displayId: req.params.displayId },
    include: {
      entities: true,
      riskPoints: {
        orderBy: { recordedAt: "asc" },
      },
      alerts: true,
    },
  });

  if (!network) {
    return res.status(404).json({ error: "Network not found" });
  }

  const { entityRisks, aggregate } = await calculateNetworkRisk(
    network.entities
  );

  const calculatedEntities = network.entities.map((entity, index) => {
  const computed = entityRisks[index];

  return {
    ...entity,

    // These are the values the frontend should treat as authoritative.
    risk: computed.risk ?? entity.risk,
    confidence: computed.confidence ?? entity.confidence,

    // No historical entity snapshots exist, so this cannot be calculated.
    riskChange: null,

    legacy: {
      risk: entity.risk,
      confidence: entity.confidence,
      riskChange: entity.riskChange,
      note: "Seed-time stored values — not derived from current listing evidence.",
    },
  };
});

  await logAudit({
    user: "System",
    action: "Viewed Network",
    resource: network.displayId,
    type: "read",
    ip: ipFromRequest(req),
  });

  res.json({
    ...network,
    entities: calculatedEntities,
    computed: aggregate,
    computedStatus:
      aggregate.computedBaselineRisk !== null
        ? riskToStatus(aggregate.computedBaselineRisk)
        : null,
    entityRiskBreakdown: entityRisks,
  });
});

// GET /api/networks/:displayId/trajectory — the early-warning risk-over-time
// chart, built from real NetworkRiskPoint rows instead of a hardcoded array.
// `riskPoints`/base network fields are UNCHANGED from before — if a network
// has no NetworkRiskPoint rows yet (e.g. immediately after a fresh seed,
// before any /api/simulate/event calls), `riskPoints` will correctly be an
// empty array, and existing consumers of this shape keep working exactly as
// before.
//
// ADDITIVE: `events` — a chronological merge of this network's real
// RiskEvents and Alerts, so the frontend can render "70 -> 73 -> 75 -> 87"
// alongside what actually happened at each step ("09:41 New intelligence",
// "09:41 Alert generated", etc.) instead of just bare numbers.
//
// RiskEvent has no networkId column (only entityId), so events are matched
// to this network via entity.networkId — this covers every RiskEvent
// routes/simulate.ts creates (it always resolves an entity, falling back to
// network.entities[0]). The one exception is routes/networks.ts's own
// POST /:displayId/recalculate route, which creates a RiskEvent with no
// entityId at all; those are matched instead by exact-timestamp proximity
// to one of THIS network's own NetworkRiskPoint rows (created in the same
// transaction, so timestamps coincide to the millisecond). Both match
// methods are labeled on each event so this is never silently ambiguous
// about whether a link is a real FK or an inferred one.
const RECALC_EVENT_MATCH_WINDOW_MS = 2000;

networksRouter.get("/:displayId/trajectory", async (req, res) => {
  const network = await prisma.network.findUnique({
    where: { displayId: req.params.displayId },
    include: {
      riskPoints: { orderBy: { recordedAt: "asc" } },
      entities: { select: { id: true } },
      alerts: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!network) return res.status(404).json({ error: "Network not found" });

  const entityIds = network.entities.map((e) => e.id);
  const recalcPointTimes = network.riskPoints.map((p) => p.recordedAt.getTime());

  const [entityLinkedEvents, unlinkedRecalcEvents] = await Promise.all([
    entityIds.length > 0
      ? prisma.riskEvent.findMany({ where: { entityId: { in: entityIds } }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    prisma.riskEvent.findMany({ where: { entityId: null, type: "network_recalculated" }, orderBy: { createdAt: "asc" } }),
  ]);

  const matchedRecalcEvents = unlinkedRecalcEvents.filter((e) =>
    recalcPointTimes.some((t) => Math.abs(t - e.createdAt.getTime()) <= RECALC_EVENT_MATCH_WINDOW_MS)
  );

  const events = [
    ...entityLinkedEvents.map((e) => ({
      at: e.createdAt,
      kind: "risk_event" as const,
      type: e.type,
      description: e.description,
      scoreDelta: e.scoreDelta,
      matchMethod: "entity_link" as const,
    })),
    ...matchedRecalcEvents.map((e) => ({
      at: e.createdAt,
      kind: "risk_event" as const,
      type: e.type,
      description: e.description,
      scoreDelta: e.scoreDelta,
      matchMethod: "time_proximity" as const,
    })),
    ...network.alerts.map((a) => ({
      at: a.createdAt,
      kind: "alert" as const,
      type: "alert_generated",
      description: `${a.title} — ${a.reason}`,
      severity: a.severity,
      status: a.status,
      matchMethod: "network_link" as const, // Alert.networkId is a real FK
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  await logAudit({
    user: "System",
    action: "Viewed Network Trajectory",
    resource: network.displayId,
    type: "read",
    ip: ipFromRequest(req),
  });

  res.json({ ...network, events });
});

// POST /api/networks/:displayId/recalculate — EXPLICIT, non-silent
// recalculation. Overwrites the persisted risk/status/change from the
// current computed entity-evidence baseline, records why via a RiskEvent,
// and appends a NetworkRiskPoint so the trajectory chart shows a real,
// honestly-labeled jump instead of quietly rewriting history. This is the
// only code path — besides routes/simulate.ts's event-driven deltas —
// allowed to write Network.risk/status/change, and it is deliberately
// gated behind an explicit POST rather than happening automatically on
// every GET (see lib/networkRisk.ts for why GET stays read-only).
networksRouter.post("/:displayId/recalculate", async (req, res) => {
  const network = await prisma.network.findUnique({
    where: { displayId: req.params.displayId },
    include: { entities: true },
  });
  if (!network) return res.status(404).json({ error: "Network not found" });

  const [vendorRiskByAlias, walletEvidenceByEntityId] = await Promise.all([
    buildVendorRiskMap(),
    buildWalletEvidenceByEntityId(),
  ]);
  const entityRisks = network.entities.map((e) => computeEntityRisk(e.alias, vendorRiskByAlias, walletEvidenceByEntityId, e.id));
  const aggregate = computeNetworkRiskAggregate(entityRisks);

  if (!aggregate.calculable || aggregate.computedBaselineRisk === null) {
    return res.status(422).json({ error: "Not calculable", explanation: aggregate.explanation });
  }

  const newRisk = aggregate.computedBaselineRisk;
  const status = riskToStatus(newRisk);
  const change = newRisk - network.risk;

  const [updatedNetwork] = await prisma.$transaction([
    prisma.network.update({
      where: { id: network.id },
      data: { risk: newRisk, status, change, lastActivity: new Date() },
    }),
    prisma.networkRiskPoint.create({
      data: { networkId: network.id, label: `Recalculated: ${new Date().toISOString()}`, score: newRisk },
    }),
    prisma.riskEvent.create({
      data: {
        type: "network_recalculated",
        description: `Network risk explicitly recalculated from entity evidence: ${aggregate.explanation}`,
        scoreDelta: change,
      },
    }),
  ]);

  await logAudit({
    user: "System",
    action: `Recalculated Network Risk (${network.risk} -> ${newRisk})`,
    resource: network.displayId,
    type: "write",
    ip: ipFromRequest(req),
  });

  res.json({ network: updatedNetwork, aggregate });
});