// apps/backend/src/lib/reportGenerator.ts
//
// WHY THIS FILE EXISTS
// ─────────────────────────────────────────────────────────────────────────
// The Reports screen previously built its sections in the BROWSER
// (ReportsScreen.tsx's buildSections()), from whatever GET
// /api/investigations/:displayId happened to return. Two concrete bugs
// fell out of that:
//
//   1. `reportType` was tracked in React state but never actually used
//      anywhere in buildSections() — every section's *content* was
//      identical no matter which of the three report types was selected,
//      and the preview header's title text was a hardcoded string
//      ("INTELLIGENCE ASSESSMENT REPORT") regardless of reportType. So
//      switching report types visibly changed nothing.
//
//   2. Risk Assessment / Entity Analysis pulled straight from whatever
//      Entity.risk / Network.risk the investigations route had joined in.
//      Per entityRisk.ts's own docs, Entity.risk is a hand-typed seed
//      column with no calculation behind it, and per this project's own
//      "compute fresh on read" convention (see routes/graph.ts), the
//      honest number is what computeEntityRisk() / computeNetworkRiskAggregate()
//      derive from real Listing / WalletTransaction rows RIGHT NOW — not
//      a column that may never have been recomputed since seeding. That's
//      why the same risk figure (e.g. "50/100") kept showing up unchanged.
//
// This module fixes both: it is the SINGLE place that turns a real
// Investigation row (with its real linked Entities / Network / Evidence /
// Timeline / AiAssessment) into report sections, using the same
// Listing -> Vendor -> Entity -> Network risk pipeline routes/graph.ts
// already established, and branches actual CONTENT DEPTH per report type
// (not just a relabeled string).
//
// Nothing here invents a number. Anywhere the underlying computation
// reports null / not-calculable, the section says so in words rather than
// substituting 0 or a placeholder — same rule entityRisk.ts and
// walletRisk.ts already follow.

import { prisma } from "./prisma.js";
import { computeVendorRisk, type VendorRisk } from "./vendorRisk.js";
import {
  computeEntityRisk,
  buildEntityWalletEvidence,
  type EntityComputedRisk,
  type EntityWalletEvidence,
} from "./entityRisk.js";
import { computeNetworkRiskAggregate } from "./networkRisk.js";
import { scoreAllWallets, walletSignalsToContributors } from "./walletRisk.js";
import type { ListingInput } from "./riskEngine.js";

// ─── Public types ───────────────────────────────────────────────────────

export const REPORT_TYPES = [
  "Intelligence Assessment",
  "Executive Summary",
  "Technical Analysis",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export function isReportType(value: unknown): value is ReportType {
  return typeof value === "string" && (REPORT_TYPES as readonly string[]).includes(value);
}

export const REPORT_SECTION_KEYS = [
  "Executive Summary",
  "Risk Assessment",
  "Entity Analysis",
  "Network Analysis",
  "Evidence Summary",
  "Investigation Timeline",
  "AI Explanation",
  "Audit Information",
] as const;
export type ReportSectionKey = (typeof REPORT_SECTION_KEYS)[number];

export interface ReportSectionPlain {
  title: ReportSectionKey;
  kind: "plain";
  content: string;
}

export interface ReportSectionAi {
  title: "AI Explanation";
  kind: "ai";
  tone: "accepted" | "rejected" | "modified" | "pending" | "none";
  badgeLabel: string;
  byline?: string;
  body?: string;
  steps?: string[];
  footer?: string;
}

export type ReportSection = ReportSectionPlain | ReportSectionAi;

export interface GeneratedReport {
  investigation: {
    id: string;
    displayId: string;
    title: string;
    status: string;
    priority: string;
  };
  reportType: ReportType;
  reportTitle: string; // e.g. "TECHNICAL ANALYSIS REPORT" — drives the preview header, per report type
  classification: string;
  generatedAt: string; // ISO timestamp, set once, server-side
  // Null only when there is truly nothing to show a risk figure for — no
  // linked network AND no resolved entity with calculable risk. Never a
  // fabricated score.
  //   kind "network": live computeNetworkRiskAggregate() figure for the
  //     investigation's linked network (not the possibly-stale Network.risk
  //     column).
  //   kind "entity": no network is linked, but the investigation has a
  //     resolved entity with real computed risk — falls back to the
  //     highest one, same entity the Risk Assessment section body already
  //     names in this case.
  headerRisk:
    | { kind: "network"; label: string; value: number }
    | { kind: "entity"; label: string; value: number }
    | null;
  sections: ReportSection[];
}

// Per-report-type depth. Section PRESENCE is entirely controlled by the
// caller's `sections` checkboxes (see generateReport() below) — depth only
// controls how much real detail each included section prints.
type ReportDepth = "brief" | "standard" | "technical";

const REPORT_TYPE_CONFIG: Record<ReportType, { depth: ReportDepth; title: string }> = {
  "Executive Summary": { depth: "brief", title: "EXECUTIVE SUMMARY REPORT" },
  "Intelligence Assessment": { depth: "standard", title: "INTELLIGENCE ASSESSMENT REPORT" },
  "Technical Analysis": { depth: "technical", title: "TECHNICAL ANALYSIS REPORT" },
};

// ─── Live risk context (mirrors routes/graph.ts's buildVendorRiskMap) ───
//
// Duplicated here rather than imported from routes/graph.ts, same reason
// graph.ts itself gives for not importing from routes/networks.ts: this is
// a lib module and shouldn't reach into a route file. Same pure inputs
// (real Listing / WalletTransaction / Wallet rows), same lib functions.

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

async function buildWalletEvidenceMap(): Promise<{
  walletEvidenceByEntityId: Map<string, EntityWalletEvidence>;
  walletDisplayIdById: Map<string, string>;
}> {
  const [wallets, transactions] = await Promise.all([
    prisma.wallet.findMany({ select: { id: true, displayId: true } }),
    prisma.walletTransaction.findMany({
      select: {
  id: true,
  walletId: true,
  entityId: true,
  networkId: true,
  direction: true,
  amountBtcEq: true,
  occurredAt: true,
},
    }),
  ]);

  const walletDisplayIdById = new Map(wallets.map((w) => [w.id, w.displayId]));

  const walletRiskById = scoreAllWallets(
    wallets.map((w) => w.id),
    transactions,
  );

  const walletEvidenceByEntityId = buildEntityWalletEvidence(
    walletRiskById,
    transactions.map((t) => ({ walletId: t.walletId, entityId: t.entityId })),
  );

  // Fill in walletDisplayIds — entityRisk.ts's buildEntityWalletEvidence()
  // deliberately leaves this to the route/lib layer, which has the
  // Wallet.displayId lookup. EntityWalletEvidence doesn't retain the raw
  // wallet ids it was built from, so recompute the per-entity wallet-id
  // set directly from the same transactions (cheap, no signature change
  // needed on the shared lib function).
  const walletIdsByEntity = new Map<string, Set<string>>();
  for (const t of transactions) {
    if (!t.entityId) continue;
    const set = walletIdsByEntity.get(t.entityId) ?? new Set<string>();
    set.add(t.walletId);
    walletIdsByEntity.set(t.entityId, set);
  }
  for (const [entityId, evidence] of walletEvidenceByEntityId) {
    const ids = walletIdsByEntity.get(entityId);
    if (ids) {
      evidence.walletDisplayIds = Array.from(ids)
        .map((id) => walletDisplayIdById.get(id))
        .filter((id): id is string => !!id);
    }
  }

  return { walletEvidenceByEntityId, walletDisplayIdById };
}

interface RiskContext {
  vendorRiskByAlias: Map<string, VendorRisk>;
  walletEvidenceByEntityId: Map<string, EntityWalletEvidence>;
}

async function buildRiskContext(): Promise<RiskContext> {
  const [vendorRiskByAlias, { walletEvidenceByEntityId }] = await Promise.all([
    buildVendorRiskMap(),
    buildWalletEvidenceMap(),
  ]);
  return { vendorRiskByAlias, walletEvidenceByEntityId };
}

// ─── Fetch the real investigation, with everything a report needs ──────

async function fetchInvestigation(displayId: string) {
  return prisma.investigation.findUnique({
    where: { displayId },
    include: {
      network: { include: { entities: true } },
      entities: { include: { entity: true } },
      // Real bug fix: the record's OWN investigationId (its original home)
      // is NOT the same as "every investigation it's attached to" — see
      // the InvestigationEvidence model's doc comment in schema.prisma.
      // Union both below so a record attached to this case via "+ Add
      // Evidence" actually shows up in its Evidence Summary.
      evidence: { include: { source: true } },
      evidenceLinks: { include: { evidence: { include: { source: true } } } },
      timeline: { orderBy: { occurredAt: "asc" } },
      aiAssessments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

type Investigation = NonNullable<Awaited<ReturnType<typeof fetchInvestigation>>>;

function dedupeEvidence(inv: Investigation) {
  const byId = new Map<string, Investigation["evidence"][number]>();
  for (const e of inv.evidence) byId.set(e.id, e);
  for (const link of inv.evidenceLinks) byId.set(link.evidence.id, link.evidence as any);
  return Array.from(byId.values());
}

function parseSteps(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  try {
    const parsed = JSON.parse(raw as string);
    return Array.isArray(parsed) ? parsed : [String(raw)];
  } catch {
    return [String(raw)];
  }
}

// ─── Section builders ────────────────────────────────────────────────────
// Each takes the real data plus `depth` and returns the section content.
// `depth` changes how MUCH real detail is printed; it never invents a
// number depth="brief" doesn't have.

function buildExecutiveSummary(
  inv: Investigation,
  entityRisks: { alias: string; computed: EntityComputedRisk }[],
  networkRiskValue: number | null,
  depth: ReportDepth,
): string {
  const statusLabel = inv.status.replace(/_/g, " ");
  const entityCount = entityRisks.length;

  if (depth === "brief") {
    const riskPart = networkRiskValue !== null ? `network risk ${networkRiskValue}/100` : "no linked network";
    return `${inv.displayId}: ${statusLabel}, priority ${inv.priority}. ${entityCount} entit${entityCount === 1 ? "y" : "ies"} resolved, ${riskPart}.`;
  }

  const topConfidence = entityRisks.length
    ? Math.max(...entityRisks.map((e) => e.computed.confidence ?? 0))
    : null;

  let text = `Investigation ${inv.displayId} (${inv.title}) is currently ${statusLabel}, priority ${inv.priority}.`;
  text += inv.network
    ? ` It is linked to network ${inv.network.displayId}, live computed risk ${networkRiskValue}/100 (${inv.network.status}).`
    : " No network is currently linked to this case.";
  text += entityCount
    ? ` ${entityCount} entit${entityCount === 1 ? "y has" : "ies have"} been resolved to this case${topConfidence !== null ? `, with the strongest resolution confidence at ${topConfidence}%` : ""}.`
    : " No entities have been added to this case yet.";

  if (depth === "technical") {
    const withEvidence = entityRisks.filter((e) => e.computed.correlated).length;
    text += ` ${withEvidence} of ${entityCount} resolved entit${entityCount === 1 ? "y carries" : "ies carry"} real computed evidence (marketplace and/or wallet); risk for the remainder is not calculable rather than defaulted.`;
  }

  return text;
}

function buildRiskAssessment(
  inv: Investigation,
  entityRisks: { alias: string; computed: EntityComputedRisk }[],
  networkRiskValue: number | null,
  depth: ReportDepth,
): string {
  if (!inv.network) {
    const calculable = entityRisks.filter((e) => e.computed.risk !== null);
    if (depth === "brief" || calculable.length === 0) {
      return "No network is linked to this investigation, so no aggregate network risk score is available. Risk should be assessed per-entity.";
    }
    const top = calculable.reduce((a, b) => ((b.computed.risk ?? 0) > (a.computed.risk ?? 0) ? b : a));
    let text = `No network is linked to this investigation, so no aggregate network risk score is available. Highest individual entity risk: ${top.alias} at ${top.computed.risk}/100 (confidence ${top.computed.confidence}%).`;
    if (depth === "technical" && top.computed.contributors.length) {
      text += ` Top contributing signals: ${top.computed.contributors
        .slice(0, 3)
        .map((c) => `${c.label} (+${c.contribution})`)
        .join(", ")}.`;
    }
    return text;
  }

  let text = `Overall network risk (live computed): ${networkRiskValue}/100, status ${inv.network.status}.`;

  if (depth === "brief") return text;

  text += ` Stored status classification: ${inv.network.status}, last activity ${new Date(inv.network.lastActivity).toLocaleString()}.`;

  if (depth === "technical") {
    const contributingEntities = entityRisks
      .filter((e) => e.computed.risk !== null)
      .sort((a, b) => (b.computed.risk ?? 0) - (a.computed.risk ?? 0))
      .slice(0, 3);
    if (contributingEntities.length) {
      text += ` Highest-risk resolved entities driving this figure: ${contributingEntities
        .map((e) => `${e.alias} (${e.computed.risk}/100)`)
        .join(", ")}.`;
    }
    const walletBacked = entityRisks.filter((e) => e.computed.walletEvidence);
    if (walletBacked.length) {
      text += ` ${walletBacked.length} entit${walletBacked.length === 1 ? "y has" : "ies have"} corroborating wallet-transaction evidence blended into their risk figure.`;
    }
  }

  return text;
}

function buildEntityAnalysis(
  entityRisks: { alias: string; entityId: string; displayId: string; computed: EntityComputedRisk }[],
  depth: ReportDepth,
): string {
  if (!entityRisks.length) return "No entities have been resolved to this investigation yet.";

  const names = entityRisks.map((e) => e.alias).join(", ");
  if (depth === "brief") {
    return `${entityRisks.length} entit${entityRisks.length === 1 ? "y" : "ies"} identified: ${names}.`;
  }

  let text = `${entityRisks.length} entit${entityRisks.length === 1 ? "y" : "ies"} identified: ${names}. `;
  text += entityRisks
    .map((e) => {
      const c = e.computed;
      const riskPart = c.risk !== null ? `risk ${c.risk}/100, confidence ${c.confidence}%` : "risk not calculable (no marketplace or wallet evidence)";
      return `${e.alias} — ${riskPart}`;
    })
    .join("; ") + ".";

  if (depth === "technical") {
    text += " " + entityRisks.map((e) => `${e.alias}: ${e.computed.explanation}`).join(" ");
  }

  return text;
}

function buildNetworkAnalysis(
  inv: Investigation,
  networkRiskValue: number | null,
  depth: ReportDepth,
): string {
  if (!inv.network) return "This investigation is not currently associated with a tracked network.";

  const net = inv.network;
  let text = `Network ${net.displayId} status: ${net.status}. Live computed risk: ${networkRiskValue}/100. Last activity recorded ${new Date(net.lastActivity).toLocaleString()}.`;

  if (depth === "brief") {
    return `Network ${net.displayId}: ${net.status}, risk ${networkRiskValue}/100.`;
  }

  if (depth === "technical") {
    text += ` Network currently has ${net.entities.length} associated entit${net.entities.length === 1 ? "y" : "ies"} in scope for this risk computation.`;
  }

  return text;
}

function buildEvidenceSummary(
  evidenceList: { displayId: string; status: string; type: string; hash: string; source: { name: string; type: string } | null }[],
  depth: ReportDepth,
): string {
  const verifiedCount = evidenceList.filter((e) => e.status === "VERIFIED").length;
  const pendingCount = evidenceList.filter((e) => e.status === "PENDING").length;
  const rejectedCount = evidenceList.filter((e) => e.status === "REJECTED").length;

  let text = `${evidenceList.length} evidence record${evidenceList.length === 1 ? "" : "s"} collected. ${verifiedCount} verified via SHA-256 hash, ${pendingCount} pending verification${rejectedCount ? `, ${rejectedCount} rejected` : ""}.`;

  if (depth === "brief") return text;

  if (evidenceList.length) {
    text += ` Evidence IDs: ${evidenceList.map((e) => e.displayId).join(", ")}.`;
  }

  if (depth === "technical" && evidenceList.length) {
    const bySource = new Map<string, number>();
    for (const e of evidenceList) {
      const key = e.source ? `${e.source.name} (${e.source.type})` : "No source recorded";
      bySource.set(key, (bySource.get(key) ?? 0) + 1);
    }
    text += ` Source breakdown: ${Array.from(bySource.entries()).map(([k, v]) => `${k} — ${v}`).join("; ")}.`;
  }

  return text;
}

function buildTimeline(
  timeline: { occurredAt: Date; label: string; type: string }[],
  depth: ReportDepth,
): string {
  if (!timeline.length) return "No timeline events have been recorded for this investigation yet.";

  const first = timeline[0];
  const last = timeline[timeline.length - 1];
  let text = `${timeline.length} recorded timeline event${timeline.length === 1 ? "" : "s"}, spanning from ${first.occurredAt.toLocaleDateString()} to ${last.occurredAt.toLocaleDateString()}. Most recent: "${last.label}" (${last.type}).`;

  if (depth === "technical" && timeline.length > 1) {
    text += ` Full sequence: ${timeline.map((t) => `${t.occurredAt.toLocaleDateString()} — ${t.label} (${t.type})`).join("; ")}.`;
  }

  return text;
}

function buildAiExplanation(
  assessment: Investigation["aiAssessments"][number] | undefined,
  depth: ReportDepth,
): ReportSectionAi | ReportSectionPlain {
  if (!assessment) {
    return { title: "AI Explanation", kind: "plain", content: "No AI assessment has been generated for this investigation yet." };
  }

  const byline = (label: string) =>
    `${label}${assessment.reviewedBy ? ` by ${assessment.reviewedBy}` : ""}${assessment.reviewedAt ? ` on ${new Date(assessment.reviewedAt).toLocaleDateString()}` : ""}`;

  const signalsFooter =
    depth === "technical" && Array.isArray(assessment.signals) && (assessment.signals as any[]).length
      ? ` Signals at time of assessment: ${(assessment.signals as { label: string; value: number }[])
          .map((s) => `${s.label} (+${s.value})`)
          .join(", ")}.`
      : "";

  if (assessment.reviewStatus === "REJECTED") {
    return {
      title: "AI Explanation",
      kind: "ai",
      tone: "rejected",
      badgeLabel: "Rejected",
      byline: byline("Rejected"),
      footer: assessment.reviewNote
        ? `Reason given: "${assessment.reviewNote}"`
        : `This AI-generated narrative was not accepted and is excluded from this report. (Risk score at time of assessment: ${assessment.riskScore}/100.)${signalsFooter}`,
    };
  }
  if (assessment.reviewStatus === "MODIFIED") {
    return {
      title: "AI Explanation",
      kind: "ai",
      tone: "modified",
      badgeLabel: "Modified",
      byline: byline("Modified"),
      body: depth === "brief" ? undefined : assessment.editedExplanation ?? undefined,
      steps: depth === "brief" ? undefined : parseSteps(assessment.editedRecommendedNext),
      footer: `Risk score at time of assessment: ${assessment.riskScore}/100. This is the investigator-edited version of the original AI-generated narrative.${signalsFooter}`,
    };
  }
  if (assessment.reviewStatus === "ACCEPTED") {
    return {
      title: "AI Explanation",
      kind: "ai",
      tone: "accepted",
      badgeLabel: "Accepted",
      byline: byline("Accepted"),
      body: depth === "brief" ? undefined : assessment.explanation,
      steps: depth === "brief" ? undefined : parseSteps(assessment.recommendedNext),
      footer: `Risk score at time of assessment: ${assessment.riskScore}/100.${signalsFooter}`,
    };
  }
  return {
    title: "AI Explanation",
    kind: "ai",
    tone: "pending",
    badgeLabel: "Pending Review",
    body: depth === "brief" ? undefined : assessment.explanation,
    steps: depth === "brief" ? undefined : parseSteps(assessment.recommendedNext),
    footer: `Risk score at time of assessment: ${assessment.riskScore}/100. This assessment has not yet been reviewed by an investigator.${signalsFooter}`,
  };
}

function buildAuditInformation(
  inv: Investigation,
  reportType: ReportType,
  classification: string,
  generatedAt: Date,
  depth: ReportDepth,
): string {
  let text = `Report generated ${generatedAt.toLocaleString()} for case ${inv.displayId}, classification ${classification}, report type "${reportType}". This document and its generation are recorded in the platform audit log.`;
  if (depth === "technical") {
    text += " Risk figures in this report were computed live from current Listing / WalletTransaction records at generation time, not read from cached columns.";
  }
  return text;
}

// ─── Entry point ─────────────────────────────────────────────────────────

export interface GenerateReportInput {
  investigationDisplayId: string;
  reportType: string;
  classification: string;
  sections: Partial<Record<ReportSectionKey, boolean>>;
}

export async function generateReport(input: GenerateReportInput): Promise<GeneratedReport | null> {
  const reportType: ReportType = isReportType(input.reportType) ? input.reportType : "Intelligence Assessment";
  const { depth, title: reportTitle } = REPORT_TYPE_CONFIG[reportType];

  const inv = await fetchInvestigation(input.investigationDisplayId);
  if (!inv) return null;

  const ctx = await buildRiskContext();

  const entityRisks = inv.entities.map((link) => ({
    alias: link.entity.alias,
    entityId: link.entity.id,
    displayId: link.entity.displayId,
    computed: computeEntityRisk(link.entity.alias, ctx.vendorRiskByAlias, ctx.walletEvidenceByEntityId, link.entity.id),
  }));

  let networkRiskValue: number | null = null;
  if (inv.network) {
    const networkEntityRisks = inv.network.entities.map((e) =>
      computeEntityRisk(e.alias, ctx.vendorRiskByAlias, ctx.walletEvidenceByEntityId, e.id),
    );
    const aggregate = computeNetworkRiskAggregate(networkEntityRisks);
    networkRiskValue = aggregate.computedBaselineRisk;
  }

  const evidenceList = dedupeEvidence(inv);
  const generatedAt = new Date();
  const assessment = inv.aiAssessments[0];

  const sections: ReportSection[] = [];
  const checked = (key: ReportSectionKey) => input.sections[key] !== false && input.sections[key] !== undefined
    ? !!input.sections[key]
    : true; // default to included if the caller omitted the key entirely

  if (checked("Executive Summary")) {
    sections.push({ title: "Executive Summary", kind: "plain", content: buildExecutiveSummary(inv, entityRisks, networkRiskValue, depth) });
  }
  if (checked("Risk Assessment")) {
    sections.push({ title: "Risk Assessment", kind: "plain", content: buildRiskAssessment(inv, entityRisks, networkRiskValue, depth) });
  }
  if (checked("Entity Analysis")) {
    sections.push({ title: "Entity Analysis", kind: "plain", content: buildEntityAnalysis(entityRisks, depth) });
  }
  if (checked("Network Analysis")) {
    sections.push({ title: "Network Analysis", kind: "plain", content: buildNetworkAnalysis(inv, networkRiskValue, depth) });
  }
  if (checked("Evidence Summary")) {
    sections.push({ title: "Evidence Summary", kind: "plain", content: buildEvidenceSummary(evidenceList as any, depth) });
  }
  if (checked("Investigation Timeline")) {
    sections.push({ title: "Investigation Timeline", kind: "plain", content: buildTimeline(inv.timeline, depth) });
  }
  if (checked("AI Explanation")) {
    sections.push(buildAiExplanation(assessment, depth));
  }
  if (checked("Audit Information")) {
    sections.push({
      title: "Audit Information",
      kind: "plain",
      content: buildAuditInformation(inv, reportType, input.classification, generatedAt, depth),
    });
  }

  // Fallback for the header chip when there's no linked network: the
  // highest-risk resolved entity with real calculable evidence. Same
  // entity the Risk Assessment section body already surfaces in this
  // case — this just makes it visible in the header too, instead of a
  // bare "—" when there's actually something real to show.
  const topEntity = entityRisks
    .filter((e) => e.computed.risk !== null)
    .reduce<typeof entityRisks[number] | null>(
      (best, e) => (best === null || (e.computed.risk ?? 0) > (best.computed.risk ?? 0) ? e : best),
      null,
    );

  const headerRisk: GeneratedReport["headerRisk"] =
    inv.network && networkRiskValue !== null
      ? { kind: "network", label: inv.network.status, value: networkRiskValue }
      : topEntity
        ? { kind: "entity", label: topEntity.alias, value: topEntity.computed.risk as number }
        : null;

  return {
    investigation: {
      id: inv.id,
      displayId: inv.displayId,
      title: inv.title,
      status: inv.status,
      priority: inv.priority,
    },
    reportType,
    reportTitle,
    classification: input.classification,
    generatedAt: generatedAt.toISOString(),
    headerRisk,
    sections,
  };
}
