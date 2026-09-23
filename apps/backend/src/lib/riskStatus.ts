// apps/backend/src/lib/riskStatus.ts
//
// Single reusable risk -> status classifier. This threshold logic used to
// live only inline inside routes/simulate.ts. Pulling it out means every
// code path that turns a 0-100 risk number into a LOW/MEDIUM/HIGH/CRITICAL
// label (simulate.ts, routes/networks.ts's computed view) uses the exact
// same thresholds, so a network's displayed status can never silently
// disagree with its risk number because two different files rounded the
// boundary differently.

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const RISK_THRESHOLDS = {
  CRITICAL: 80, // >= 80
  HIGH: 60, // 60-79
  MEDIUM: 30, // 30-59
  // < 30 -> LOW
} as const;

export function riskToStatus(risk: number): RiskLevel {
  if (risk >= RISK_THRESHOLDS.CRITICAL) return "CRITICAL";
  if (risk >= RISK_THRESHOLDS.HIGH) return "HIGH";
  if (risk >= RISK_THRESHOLDS.MEDIUM) return "MEDIUM";
  return "LOW";
}