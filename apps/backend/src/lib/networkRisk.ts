// apps/backend/src/lib/networkRisk.ts
//
// Deterministic network-level aggregation from computed entity risk (see
// entityRisk.ts). Produces "what would this network's risk be right now,
// purely from current listing evidence" — computedBaselineRisk. This is
// intentionally kept SEPARATE from the persisted Network.risk column.
//
// Why separate rather than replacing Network.risk outright:
// Network.risk is event-sourced — routes/simulate.ts advances it
// incrementally as real RiskEvents occur, and NetworkRiskPoint records that
// trajectory over time. If GET /api/networks silently recomputed and
// overwrote Network.risk from a fresh aggregate on every read, the
// trajectory chart would misrepresent history (every read would look like
// a new event), and simulate.ts's incremental delta model would conflict
// with a value that resets underneath it on the next page load. So:
//   - Network.risk / status / change: persisted, event-driven, UNCHANGED by
//     this module. Only routes/simulate.ts and the new explicit
//     POST /api/networks/:displayId/recalculate route may write to them.
//   - computedBaselineRisk: always fresh, always derived from current
//     entity evidence, exposed alongside the persisted value so the two can
//     be compared instead of one silently masquerading as the other.

import type { EntityComputedRisk } from "./entityRisk.js";

export interface NetworkRiskAggregate {
  calculable: boolean;
  computedBaselineRisk: number | null;
  entitiesConsidered: number;
  entitiesExcludedNoEvidence: number;
  maxEntityRisk: number | null;
  averageEntityRisk: number | null;
  highRiskEntityCount: number;
  explanation: string;
}

// Consistent with riskStatus.ts's HIGH threshold.
const HIGH_RISK_ENTITY_THRESHOLD = 60;

export function computeNetworkRiskAggregate(entityRisks: EntityComputedRisk[]): NetworkRiskAggregate {
  const withEvidence = entityRisks.filter(
    (e): e is EntityComputedRisk & { risk: number } => e.risk !== null
  );
  const excluded = entityRisks.length - withEvidence.length;

  if (withEvidence.length === 0) {
    return {
      calculable: false,
      computedBaselineRisk: null,
      entitiesConsidered: 0,
      entitiesExcludedNoEvidence: excluded,
      maxEntityRisk: null,
      averageEntityRisk: null,
      highRiskEntityCount: 0,
      explanation:
        entityRisks.length === 0
          ? "Network has no associated entities."
          : "None of this network's entities have alias-correlated listing evidence, so a computed baseline is not calculable yet.",
    };
  }

  const risks = withEvidence.map((e) => e.risk);
  const maxRisk = Math.max(...risks);
  const avgRisk = risks.reduce((a, b) => a + b, 0) / risks.length;
  const highRiskCount = risks.filter((r) => r >= HIGH_RISK_ENTITY_THRESHOLD).length;
  const highRiskProportion = highRiskCount / risks.length;

  // 0.5 worst-case + 0.3 typical-case + 0.2 breadth-of-risk. Each term is
  // independently bounded to [0,100] so the weighted sum is too — clamp
  // applied anyway as a safety net, not because it's expected to trigger.
  const raw = maxRisk * 0.5 + avgRisk * 0.3 + highRiskProportion * 100 * 0.2;
  const computedBaselineRisk = Math.max(0, Math.min(100, Math.round(raw)));
const entityWord =
  withEvidence.length === 1 ? "entity" : "entities";

const excludedText =
  excluded > 0
    ? `; ${excluded} ${
        excluded === 1 ? "entity" : "entities"
      } excluded — no listing evidence`
    : "";
    
  return {
    calculable: true,
    computedBaselineRisk,
    entitiesConsidered: withEvidence.length,
    entitiesExcludedNoEvidence: excluded,
    maxEntityRisk: maxRisk,
    averageEntityRisk: Math.round(avgRisk * 10) / 10,
    highRiskEntityCount: highRiskCount,
    explanation:      `Derived from ${withEvidence.length} alias-correlated ${entityWord} ` +
    `(0.5×max + 0.3×avg + 0.2×high-risk proportion)` +
    excludedText,
  };
}