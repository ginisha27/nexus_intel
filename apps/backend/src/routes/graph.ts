import { Router } from "express";

import { prisma } from "../lib/prisma.js";

import { syncGraphFromEntities } from "../lib/graphSync.js";
import { computeVendorRisk, type VendorRisk } from "../lib/vendorRisk.js";
import { computeEntityRisk } from "../lib/entityRisk.js";
import { computeNetworkRiskAggregate } from "../lib/networkRisk.js";
import type { ListingInput } from "../lib/riskEngine.js";
import { logAudit, ipFromRequest } from "../lib/audit.js";

export const graphRouter = Router();

// Same computation as routes/networks.ts's (unexported) buildVendorRiskMap
// — duplicated here rather than importing from that route file so this
// graph-specific route doesn't reach into a teammate-owned route file.
// Same pure inputs (real Listing rows) and same lib function; no new model.
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

// GET /api/graph — full node + edge set for the Network Graph screen
//
// Rebuilds GraphNode/GraphEdge from whatever entities currently exist
// before responding, so any entity added later (via ingestion, simulate
// events, etc.) shows up automatically on the very next graph load — no
// manual reseed required. Mirrors the "compute fresh on GET" pattern used
// for network risk in routes/networks.ts.
graphRouter.get("/", async (req, res) => {
  await syncGraphFromEntities(prisma);

  const [nodes, edges] = await Promise.all([
    prisma.graphNode.findMany(),
    prisma.graphEdge.findMany(),
  ]);

  // GraphNode only stores entityId (the entity's internal cuid), not its
  // human-readable displayId slug (e.g. "cerberus"). Without this, clicking
  // a node's "View Full Profile" button had nothing but the graph node's
  // OWN id to work with, which isn't a valid entity lookup key at all and
  // produced a 404 against /api/entities/:displayId. Attaching displayId
  // here — computed on the fly, no schema change needed — fixes that.
  const entityIds = nodes
    .map((n) => n.entityId)
    .filter((id): id is string => !!id);

  const entities = entityIds.length
    ? await prisma.entity.findMany({
        where: {
          id: {
            in: entityIds,
          },
        },
        select: {
          id: true,
          displayId: true,
          alias: true,
          networkId: true,
        },
      })
    : [];

  const displayIdByEntityId = new Map(
    entities.map((e) => [e.id, e.displayId])
  );

  // Use the same live listing-derived risk calculation as /api/entities,
  // rather than the seed-time GraphNode.risk value. This removes the last
  // visible source of score drift between the graph and entity/listing
  // screens.
  const vendorRiskByAlias = await buildVendorRiskMap();
  const liveEntityRiskByEntityId = new Map(
    entities.map((e) => [e.id, computeEntityRisk(e.alias, vendorRiskByAlias).risk])
  );

  // Entity Risk vs. Network Risk (GraphScreen's top toggle): previously
  // both modes rendered the exact same thing because the frontend had
  // nothing but each node's own Entity.risk to draw from, no matter which
  // mode was selected. This attaches a SECOND, genuinely different, real
  // signal — the aggregate computed risk of the criminal Network an entity
  // belongs to (the same computeNetworkRiskAggregate value shown on
  // GET /api/networks / NetworkRiskScreen) — as `networkRisk`, alongside
  // the existing per-entity `risk`. An entity with no networkId (not part
  // of a tracked network) simply gets networkRisk: null — never a
  // fabricated score. Non-entity nodes (market/listing/wallet/txn) don't
  // belong to a Network at all, so they're left without a networkRisk
  // field entirely, same as before.
  const networkIds = [
    ...new Set(
      entities
        .map((e) => e.networkId)
        .filter((id): id is string => !!id)
    ),
  ];

  const networkRiskByNetworkId = new Map<string, number | null>();
  if (networkIds.length) {
    const networks = await prisma.network.findMany({
      where: { id: { in: networkIds } },
      include: { entities: { select: { alias: true } } },
    });

    for (const network of networks) {
      const entityRisks = network.entities.map((e) =>
        computeEntityRisk(e.alias, vendorRiskByAlias)
      );
      const aggregate = computeNetworkRiskAggregate(entityRisks);
      networkRiskByNetworkId.set(network.id, aggregate.computedBaselineRisk);
    }
  }

  const networkIdByEntityId = new Map(
    entities.map((e) => [e.id, e.networkId])
  );

  const enrichedNodes = nodes.map((n) => {
    if (!n.entityId) return n;
    const entityNetworkId = networkIdByEntityId.get(n.entityId) ?? null;
    const networkRisk = entityNetworkId
      ? networkRiskByNetworkId.get(entityNetworkId) ?? null
      : null;
    return {
      ...n,
      risk: liveEntityRiskByEntityId.get(n.entityId) ?? n.risk,
      displayId: displayIdByEntityId.get(n.entityId) ?? null,
      networkRisk,
    };
  });

  await logAudit({
    user: "System",
    action: "Viewed Network Graph",
    resource: `${enrichedNodes.length} nodes / ${edges.length} edges`,
    type: "read",
    ip: ipFromRequest(req),
  });

  res.json({
    nodes: enrichedNodes,
    edges,
  });
});

// GET /api/graph/:nodeId/expand — click-to-expand a node's direct relationships
graphRouter.get("/:nodeId/expand", async (req, res) => {
  const node = await prisma.graphNode.findUnique({
    where: {
      id: req.params.nodeId,
    },
    include: {
      edgesFrom: {
        include: {
          to: true,
        },
      },
      edgesTo: {
        include: {
          from: true,
        },
      },
    },
  });

  if (!node) {
    return res.status(404).json({
      error: "Node not found",
    });
  }

  await logAudit({
    user: "System",
    action: "Expanded Graph Node",
    resource: node.label,
    type: "read",
    ip: ipFromRequest(req),
  });

  res.json(node);
});