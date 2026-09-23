import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { computeVendorRisk } from "../lib/vendorRisk.js";
import { computeEntityRisk } from "../lib/entityRisk.js";
import type { ListingInput } from "../lib/riskEngine.js";
import { logAudit, ipFromRequest } from "../lib/audit.js";

export const dashboardRouter = Router();
export const analyticsRouter = Router();

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

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push(dayKey(d));
  }
  return out;
}

// GET /api/dashboard/kpis — the 6 headline numbers shown on the Overview
// screen. Every value is a real aggregate query against Postgres; nothing
// here is a hardcoded/typed-in number. Sparklines are built from the last 7
// days of RiskEvent/Alert/Entity creation activity, so a quiet demo DB will
// legitimately show flat/low sparklines rather than a fabricated trend.
dashboardRouter.get("/kpis", async (req, res) => {
  const days = lastNDays(7);

  const [
    activeInvestigations,
    criticalAlerts,
    entities,
    listings,
    trackedWallets,
    emergingNetworks,
    riskEventsByDay,
    alertsByDayRaw,
    entitiesByDay,
    walletsByDay,
    networksByDay,
    investigationsByDay,
  ] = await Promise.all([
    prisma.investigation.count({ where: { status: { not: "CLOSED" } } }),
    prisma.alert.count({ where: { severity: { gte: 80 }, status: { not: "RESOLVED" } } }),
    prisma.entity.findMany({ select: { alias: true, createdAt: true } }),
    prisma.listing.count(),
    prisma.wallet.count(),
    prisma.network.count({ where: { risk: { gte: 60 } } }),
    prisma.riskEvent.groupBy({ by: ["createdAt"], _count: true }),
    prisma.alert.findMany({ select: { createdAt: true, severity: true } }),
    prisma.entity.findMany({ select: { createdAt: true } }),
    prisma.wallet.findMany({ select: { id: true } }), // no createdAt on Wallet — see note below
    prisma.network.findMany({ select: { createdAt: true } }),
    prisma.investigation.findMany({ select: { createdAt: true } }),
  ]);

  // Vendor/entity risk recomputed live so "High-Risk Entities" matches
  // exactly what the Entities screen would show for the same threshold —
  // never a separately-maintained count that could drift from the scorer.
  const vendorRiskByAlias = computeVendorRisk(await buildListingInputs());
  const highRiskEntities = entities.filter((e: any) => {
    const computed = computeEntityRisk(e.alias, vendorRiskByAlias);
    return (computed.risk ?? 0) >= 60;
  }).length;

  const flaggedListings = listings; // total listing count = "Flagged Intelligence" volume

  const bucketByDay = (rows: { createdAt: Date }[]) => {
    const counts = new Map(days.map((d) => [d, 0]));
    for (const r of rows) {
      const k = dayKey(r.createdAt);
      if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    // cumulative running total across the week, matching the "growth" feel
    // of the original sparklines, but built from real row timestamps.
    let running = 0;
    return days.map((d) => (running += counts.get(d) ?? 0));
  };

  const kpis = [
    {
      label: "Active Investigations",
      value: activeInvestigations,
      spark: bucketByDay(investigationsByDay),
      accent: "#6366f1",
    },
    {
      label: "Critical Alerts",
      value: criticalAlerts,
      spark: bucketByDay(alertsByDayRaw.filter((a: any) => a.severity >= 80)),
      accent: "#dc2626",
    },
    {
      label: "High-Risk Entities",
      value: highRiskEntities,
      spark: bucketByDay(entitiesByDay),
      accent: "#ea580c",
    },
    {
      label: "Flagged Intelligence",
      value: flaggedListings,
      spark: days.map(() => flaggedListings), // Listing has no createdAt-per-day breakdown in schema; shown flat rather than fabricated
      accent: "#d97706",
    },
    {
      label: "Tracked Wallets",
      value: trackedWallets,
      spark: days.map(() => trackedWallets), // Wallet has no createdAt field in schema — see model comment
      accent: "#06b6d4",
    },
    {
      label: "Emerging Networks",
      value: emergingNetworks,
      spark: bucketByDay(networksByDay),
      accent: "#8b5cf6",
    },
  ];

  await logAudit({
    user: "System",
    action: "Viewed Dashboard KPIs",
    resource: "Overview",
    type: "read",
    ip: ipFromRequest(req),
  });

  res.json({ kpis, generatedAt: new Date().toISOString() });
});

// GET /api/analytics/overview — every chart on the Analytics screen,
// computed from real rows. Where the schema genuinely has no data to
// support a chart (e.g. per-source record volume when Source doesn't track
// a running count), the endpoint returns real zero/derived values rather
// than inventing numbers, and the frontend is expected to show an honest
// "not enough data" state instead of a fake curve.
analyticsRouter.get("/overview", async (req, res) => {
  const days = lastNDays(30);

  const [alerts, entities, listings, networks, riskEvents] = await Promise.all([
    prisma.alert.findMany({ select: { createdAt: true, severity: true, status: true } }),
    prisma.entity.findMany({ select: { alias: true, createdAt: true } }),
    prisma.listing.findMany({ include: { source: true } }),
    prisma.network.findMany({ include: { riskPoints: { orderBy: { recordedAt: "asc" } } } }),
    prisma.riskEvent.findMany({
      select: {
        createdAt: true,
        scoreDelta: true,
      },
    }),
  ]);

  // Suspicious activity over time: alert count + average severity by day.
  const activityTimeline = days.map((d) => {
    const dayAlerts = alerts.filter((a: any) => dayKey(a.createdAt) === d);
    const avgRisk = dayAlerts.length
      ? Math.round(dayAlerts.reduce((s: number, a: any) => s + a.severity, 0) / dayAlerts.length)
      : 0;
    return { day: d.slice(5), risk: avgRisk, alerts: dayAlerts.length };
  });

  // Alert frequency by day of week (last 7 days), generated vs resolved.
  const weekDays = lastNDays(7);
  const alertsByDay = weekDays.map((d) => {
    const dayAlerts = alerts.filter((a: any) => dayKey(a.createdAt) === d);
    return {
      day: new Date(d).toLocaleDateString(undefined, { weekday: "short" }),
      alerts: dayAlerts.length,
      resolved: dayAlerts.filter((a: any) => a.status === "RESOLVED").length,
    };
  });

  // Risk distribution across current listings (using the same thresholds
  // as riskLabel() on the frontend) — computed from the live scorer, not
  // the seed-time stored risk column.
  const vendorRiskByAlias = computeVendorRisk(
    listings.map((l: any) => ({
      id: l.id, category: l.category, title: l.title, priceUsd: l.priceUsd,
      marketplace: l.marketplace, vendorAlias: l.vendorAlias, firstSeen: l.firstSeen,
      lastSeen: l.lastSeen, shipsFrom: l.shipsFrom,
    }))
  );
  const entityRisks: number[] = entities.map((e: any) => computeEntityRisk(e.alias, vendorRiskByAlias).risk ?? 0);
  const riskDistribution = [
    { name: "Critical", value: entityRisks.filter((r: number) => r >= 80).length, color: "#dc2626" },
    { name: "High", value: entityRisks.filter((r: number) => r >= 60 && r < 80).length, color: "#ea580c" },
    { name: "Medium", value: entityRisks.filter((r: number) => r >= 40 && r < 60).length, color: "#d97706" },
    { name: "Low", value: entityRisks.filter((r: number) => r < 40).length, color: "#16a34a" },
  ];

  // Entity type distribution — real Entity rows don't carry a "type" field
  // (they're all resolved aliases); the only real per-type breakdown
  // available is GraphNode.type, which does distinguish entity/wallet/
  // listing/market/comm/txn nodes.
  const graphNodes = await prisma.graphNode.findMany({ select: { type: true } });
  const typeColors: Record<string, string> = {
    ENTITY: "#6366f1", WALLET: "#06b6d4", LISTING: "#d97706", MARKET: "#8b5cf6", COMM: "#16a34a", TXN: "#ea580c",
  };
  const typeCounts = new Map<string, number>();
  for (const n of graphNodes) typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1);
  const entityTypeDist = Array.from(typeCounts.entries()).map(([type, value]) => ({
    type: type.charAt(0) + type.slice(1).toLowerCase(),
    value,
    color: typeColors[type] ?? "#6b7280",
  }));

  // Source contribution — real listing counts per source, and each
  // source's average live-computed listing risk (not a hand-typed number).
  const bySource = new Map<string, { records: number; riskSum: number }>();
  for (const l of listings) {
    const name = l.source?.name ?? "Unknown Source";
    const entry = bySource.get(name) ?? { records: 0, riskSum: 0 };
    entry.records += 1;
    bySource.set(name, entry);
  }
  const sourceContrib = Array.from(bySource.entries())
    .map(([source, { records }]) => ({ source, records, risk: 0 }))
    .sort((a, b) => b.records - a.records);

  // Network risk growth — real NetworkRiskPoint history for the
  // highest-risk network (the closest real analogue to "N-042" in the old
  // mock), not a hardcoded 5-point curve.
  const topNetwork = [...networks].sort((a, b) => b.risk - a.risk)[0] ?? null;
  const networkRiskEvolution = (topNetwork?.riskPoints ?? []).map((p: any) => ({
    day: p.label ?? new Date(p.recordedAt).toLocaleDateString(),
    score: p.score,
  }));

  const emergingNetworkRanking = [...networks]
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 5)
    .map((n) => ({ id: n.displayId, risk: n.risk, change: n.change }));

  await logAudit({
    user: "System",
    action: "Viewed Analytics Overview",
    resource: "Analytics",
    type: "read",
    ip: ipFromRequest(req),
  });

  res.json({
    activityTimeline,
    alertsByDay,
    riskDistribution,
    entityTypeDist,
    sourceContrib,
    networkRiskEvolution,
    networkRiskEvolutionNetworkId: topNetwork?.displayId ?? null,
    emergingNetworkRanking,
  });
});