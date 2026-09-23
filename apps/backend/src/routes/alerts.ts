import { Router } from "express";

import { prisma } from "../lib/prisma.js";
import { computeVendorRisk, type VendorRisk } from "../lib/vendorRisk.js";
import { computeEntityRisk } from "../lib/entityRisk.js";
import type { ListingInput } from "../lib/riskEngine.js";
import { logAudit, ipFromRequest } from "../lib/audit.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const alertsRouter = Router();

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

// How close a RiskEvent's createdAt must be to an alert's createdAt to be
// treated as "the event that likely triggered this alert". routes/
// simulate.ts creates the RiskEvent, updates the Network, appends the
// NetworkRiskPoint, and (if threshold-crossed) creates the Alert all inside
// one synchronous request handler, so a genuinely-related event/alert pair
// is typically milliseconds apart. This is a TIME-PROXIMITY heuristic, not
// a foreign key — RiskEvent has no networkId/alertId column to join on
// directly (RiskEvent.entityId is the only link, and some risk events, e.g.
// explicit network recalculations, don't set one at all). Kept honest via
// `triggerMatchMethod` on the response so callers know this is inferred,
// not a persisted relationship.
const TRIGGER_PROXIMITY_MS = 5000;

/**
 * Reconstructs previous/current risk context for an alert purely from
 * already-persisted rows — never fabricates a number. `previousRisk` is the
 * network's risk at the most recent NetworkRiskPoint strictly before the
 * alert; `currentRisk` is the alert's own persisted `severity` field, which
 * routes/simulate.ts always sets to the network's risk at alert-creation
 * time. Returns nulls with an explanation when there isn't enough history
 * to answer (e.g. the alert was the network's very first recorded point).
 */
function buildAlertRiskContext(
  alert: { createdAt: Date; severity: number; networkId: string | null },
  riskPointsByNetwork: Map<string, { score: number; recordedAt: Date }[]>,
  riskEventsByNetworkEntity: { createdAt: Date; type: string; description: string; scoreDelta: number }[]
) {
  if (!alert.networkId) {
    return {
      previousRisk: null,
      currentRisk: alert.severity,
      change: null,
      trigger: null,
      triggerMatchMethod: "none" as const,
      explanation: "Alert is not linked to a network, so no risk-point history exists to compare against.",
    };
  }

  const points = riskPointsByNetwork.get(alert.networkId) ?? [];
  const priorPoints = points.filter((p) => p.recordedAt.getTime() < alert.createdAt.getTime());
  const previousPoint = priorPoints.length > 0 ? priorPoints[priorPoints.length - 1] : null;

  const trigger =
    riskEventsByNetworkEntity
      .filter((e) => Math.abs(e.createdAt.getTime() - alert.createdAt.getTime()) <= TRIGGER_PROXIMITY_MS)
      .sort(
        (a, b) =>
          Math.abs(a.createdAt.getTime() - alert.createdAt.getTime()) -
          Math.abs(b.createdAt.getTime() - alert.createdAt.getTime())
      )[0] ?? null;

  return {
    previousRisk: previousPoint?.score ?? null,
    currentRisk: alert.severity,
    change: previousPoint ? alert.severity - previousPoint.score : null,
    trigger: trigger ? { type: trigger.type, description: trigger.description, scoreDelta: trigger.scoreDelta } : null,
    triggerMatchMethod: trigger ? ("time_proximity" as const) : ("none" as const),
    explanation: previousPoint
      ? `Previous risk (${previousPoint.score}) from the network's last recorded risk point before this alert; current risk (${alert.severity}) is the alert's own persisted severity.`
      : "No NetworkRiskPoint exists before this alert's creation time, so a previous risk value is not calculable.",
  };
}

alertsRouter.get("/", async (_req, res) => {
  const [alerts, vendorRiskByAlias] = await Promise.all([
    prisma.alert.findMany({
      include: {
        network: { include: { riskPoints: { orderBy: { recordedAt: "asc" } } } },
        entities: {
          include: {
            entity: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    buildVendorRiskMap(),
  ]);

  // Built once for all alerts rather than per-alert, to avoid N+1 queries.
  const networkIds = Array.from(new Set(alerts.map((a) => a.networkId).filter((id): id is string => !!id)));
  const riskPointsByNetwork = new Map<string, { score: number; recordedAt: Date }[]>();
  for (const alert of alerts) {
    if (alert.networkId && alert.network) riskPointsByNetwork.set(alert.networkId, alert.network.riskPoints);
  }
  // RiskEvents aren't linked to a network directly (see comment above), so
  // pull ALL of them once and let buildAlertRiskContext's time-proximity
  // match narrow it down per alert — the dataset is small (demo-scale), so
  // this stays cheap.
  const allRiskEvents = networkIds.length > 0 ? await prisma.riskEvent.findMany() : [];

  const calculatedAlerts = alerts.map((alert) => ({
    ...alert,
    riskContext: buildAlertRiskContext(alert, riskPointsByNetwork, allRiskEvents),

    entities: alert.entities.map((alertEntity) => {
      const entity = alertEntity.entity;
      const computed = computeEntityRisk(entity.alias, vendorRiskByAlias);

      return {
        ...alertEntity,

        entity: {
          ...entity,

          risk: computed.risk ?? entity.risk,
          confidence: computed.confidence ?? entity.confidence,
          riskChange: null,

          legacy: {
            risk: entity.risk,
            confidence: entity.confidence,
            riskChange: entity.riskChange,
            note: "Seed-time stored values — not derived from current listing evidence.",
          },
        },
      };
    }),
  }));

  res.json(calculatedAlerts);
});

// PATCH /api/alerts/:displayId/status — keyed by displayId ("ALT-089") for
// consistency with every other resource in this API (investigations,
// networks, entities, evidence all key their update/detail routes by
// displayId, never the internal cuid).
alertsRouter.patch("/:displayId/status", asyncHandler(async (req, res) => {
  const { status, reviewedBy } = req.body as { status?: string; reviewedBy?: string };
  const VALID = ["NEW", "REVIEWED", "RESOLVED"];
  if (!status || !VALID.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${VALID.join(", ")}` });
  }

  const existing = await prisma.alert.findUnique({ where: { displayId: req.params.displayId } });
  if (!existing) return res.status(404).json({ error: "Alert not found" });

  const alert = await prisma.alert.update({
    where: { id: existing.id },
    data: { status: status as any },
  });

  await logAudit({
    user: reviewedBy?.trim() || "System",
    action: `Alert marked ${status}`,
    resource: alert.displayId,
    type: "write",
    ip: ipFromRequest(req),
  });

  res.json(alert);
}));