import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { runIntelligencePipeline } from "../lib/intelligencePipeline.js";
import { logAudit, ipFromRequest } from "../lib/audit.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const simulateRouter = Router();

// POST /api/simulate/event
// Body: { networkDisplayId: string, entityDisplayId?: string }
//
// This is the "Simulate Incoming Intelligence" button. It resolves a
// network + entity, picks a cosmetic event label, then hands off to
// lib/intelligencePipeline.ts for the real work — correlation, risk,
// alerts, and (new) wallet evidence. See that file's header for exactly
// what it does and why the wallet step lives there instead of here.
//
// CHANGES from the previous version:
//   1. The correlate -> risk -> alert -> wallet pipeline body has moved
//      to lib/intelligencePipeline.ts so routes/ingest.ts (real push
//      ingestion, coming next) can call the exact same logic instead of
//      duplicating it. Nothing about what this route DOES has changed —
//      same inputs, same response shape, same behavior — only where the
//      logic lives.
//   2. Status thresholds still come from lib/riskStatus.ts (unchanged).
//   3. The only remaining Math.random() in this file — picking which of
//      the two cosmetic event-type labels to show — is still the
//      deterministic accumulated-RiskEvent-count selection from before;
//      no randomness anywhere in this route.
simulateRouter.post("/event", asyncHandler(async (req, res) => {
  const { networkDisplayId, entityDisplayId } = req.body as {
    networkDisplayId?: string;
    entityDisplayId?: string;
  };

  if (!networkDisplayId || !networkDisplayId.trim()) {
    return res.status(400).json({ error: "networkDisplayId is required" });
  }

  const network = await prisma.network.findUnique({
    where: { displayId: networkDisplayId },
    include: { entities: true },
  });
  if (!network) return res.status(404).json({ error: "Network not found" });

  // 1. New listing/transaction event detected. Deterministic selection —
  // alternates based on the real total RiskEvent count so far. The
  // actual "event_detected" broadcast (now carrying a real listing/entity
  // reference when one resolves) happens inside runIntelligencePipeline,
  // not here — see that file's header.
  const eventTypes = [
    { type: "listing_detected", description: "New listing detected on monitored source" },
    { type: "transaction_detected", description: "New blockchain transaction detected" },
  ];
  const priorEventCount = await prisma.riskEvent.count();
  const chosen = eventTypes[priorEventCount % eventTypes.length];

  // 2. Entity resolution — unchanged from before.
  const entity =
    (entityDisplayId
      ? await prisma.entity.findUnique({ where: { displayId: entityDisplayId } })
      : null) ??
    (network.entities[0] || null);

  // 3. Correlate -> risk -> alert -> wallet. All in intelligencePipeline.ts.
  const result = await runIntelligencePipeline({
    network,
    entity,
    triggerType: chosen.type,
    triggerDescription: chosen.description,
    ip: ipFromRequest(req),
  });

  await logAudit({
    user: "System",
    action: "Simulated Incoming Intelligence",
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
  });
}));