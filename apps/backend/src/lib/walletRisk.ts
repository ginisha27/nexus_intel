// apps/backend/src/lib/walletRisk.ts
//
// Deterministic, explainable wallet-level risk, computed ONLY from real
// WalletTransaction rows (see prisma/schema.prisma). Replaces trust in the
// hand-typed Wallet.risk column, which is fake in two different ways:
//   - WALLET-W1..W5 (prisma/seed.ts): literal numbers with zero backing
//     WalletTransaction rows at all.
//   - WALLET-G1..G28 (prisma/generateActivity.ts): `target.risk + a
//     deterministic-but-arbitrary +/-10 jitter` — cosmetically tied to a
//     real entity's risk, but the jitter itself is not derived from any
//     observable transaction signal, so it is still not reproducible from
//     data a user can see.
//
// This module is the blockchain-intelligence analogue of riskEngine.ts
// (listings) / vendorRisk.ts: same "every signal has a max contribution,
// a deterministic calculation, and a human-readable label" discipline, same
// "skip a feature rather than fake it when the data is too thin" rule.
//
// Flow this module sits in (per project brief):
//   WalletTransaction -> blockchain risk signals -> wallet risk -> Entity
//   -> Entity risk -> Network risk
// See entityRisk.ts for how wallet risk is folded into entity risk, and
// networkRisk.ts for how that reaches network risk.

export type WalletRiskFactor =
  | "transactionActivity"
  | "transactionVolume"
  | "linkedEntities"
  | "linkedNetworks"
  | "directionImbalance";

export interface WalletRiskSignal {
  label: string;
  value: number; // points this signal contributed to the final score
  factor: WalletRiskFactor;
  available: true;
}

export interface WalletRiskSignalUnavailable {
  label: string;
  factor: WalletRiskFactor;
  available: false;
  reason: string;
}

export type WalletRiskSignalOrGap = WalletRiskSignal | WalletRiskSignalUnavailable;

export const WALLET_FACTOR_LABELS: Record<WalletRiskFactor, string> = {
  transactionActivity: "Transaction activity",
  transactionVolume: "Transaction volume",
  linkedEntities: "Linked entities",
  linkedNetworks: "Linked networks",
  directionImbalance: "Inbound/outbound imbalance",
};

// Max contribution per feature. Sum = 100. Kept deliberately weighted so
// no single feature can dominate the score on its own (mirrors
// riskEngine.ts's WEIGHTS discipline).
export const WALLET_WEIGHTS = {
  transactionActivity: 30,
  transactionVolume: 30,
  linkedEntities: 20,
  linkedNetworks: 15,
  directionImbalance: 5,
} as const;

// Minimal shape this module needs from a WalletTransaction row. Matches
// apps/backend/prisma/schema.prisma `WalletTransaction` model exactly —
// nothing invented, nothing hardcoded.
export interface WalletTransactionInput {
  id: string;
  walletId: string;
  entityId: string | null;
  networkId: string | null;
  direction: "INBOUND" | "OUTBOUND";
  amountBtcEq: number;
  occurredAt: Date;
}

export interface WalletRiskResult {
  walletId: string;
  score: number; // 0-100
  calculable: boolean; // false when there is no transaction evidence at all
  signals: WalletRiskSignalOrGap[]; // ALL signals, including unavailable ones — UI shows gaps explicitly
  evidence: {
    transactionCount: number;
    totalVolumeBtcEq: number;
    linkedEntityCount: number;
    linkedEntityIds: string[];
    linkedNetworkCount: number;
    linkedNetworkIds: string[];
    inboundCount: number;
    outboundCount: number;
    firstSeen: Date | null;
    lastSeen: Date | null;
  };
  explanation: string;
}

// ─── Population stats (needed so "activity"/"volume" are relative, not
// arbitrary absolute cutoffs pulled from nowhere) ───────────────────────

interface WalletPopulationStats {
  meanTxnCount: number;
  maxTxnCount: number;
  meanVolume: number;
  maxVolume: number;
  meanLinkedEntities: number;
  maxLinkedEntities: number;
}

const MIN_SAMPLE_FOR_RELATIVE_STATS = 3;

function buildWalletGroups(
  transactions: WalletTransactionInput[]
): Map<string, WalletTransactionInput[]> {
  const byWallet = new Map<string, WalletTransactionInput[]>();
  for (const t of transactions) {
    const arr = byWallet.get(t.walletId) ?? [];
    arr.push(t);
    byWallet.set(t.walletId, arr);
  }
  return byWallet;
}

function computePopulationStats(
  byWallet: Map<string, WalletTransactionInput[]>
): WalletPopulationStats | null {
  if (byWallet.size < MIN_SAMPLE_FOR_RELATIVE_STATS) return null; // too few wallets with any evidence to form a meaningful baseline

  const txnCounts: number[] = [];
  const volumes: number[] = [];
  const entityCounts: number[] = [];

  for (const [, txns] of byWallet) {
    txnCounts.push(txns.length);
    volumes.push(txns.reduce((sum, t) => sum + t.amountBtcEq, 0));
    entityCounts.push(new Set(txns.map((t) => t.entityId).filter((x): x is string => !!x)).size);
  }

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    meanTxnCount: mean(txnCounts),
    maxTxnCount: Math.max(...txnCounts),
    meanVolume: mean(volumes),
    maxVolume: Math.max(...volumes),
    meanLinkedEntities: mean(entityCounts),
    maxLinkedEntities: Math.max(...entityCounts),
  };
}

// ─── Feature 1: transaction activity (count, relative to population) ────

function transactionActivitySignal(
  txnCount: number,
  stats: WalletPopulationStats | null
): WalletRiskSignalOrGap {
  if (!stats || stats.maxTxnCount === 0) {
    return {
      factor: "transactionActivity",
      available: false,
      label: WALLET_FACTOR_LABELS.transactionActivity,
      reason:
        "Not enough wallets with transaction history in the current dataset to establish a relative baseline (need at least 3).",
    };
  }
  // Ratio of this wallet's txn count to the busiest wallet observed, so the
  // scale is always relative to real, current data rather than a hardcoded
  // "42 transactions = high risk" assumption.
  const ratio = txnCount / stats.maxTxnCount;
  const value = Math.round(ratio * WALLET_WEIGHTS.transactionActivity);
  return {
    factor: "transactionActivity",
    available: true,
    label: `${txnCount} recorded transaction(s) (${Math.round(ratio * 100)}% of the busiest tracked wallet)`,
    value,
  };
}

// ─── Feature 2: transaction volume (BTC-eq sum, relative to population) ─

function transactionVolumeSignal(
  totalVolume: number,
  stats: WalletPopulationStats | null
): WalletRiskSignalOrGap {
  if (!stats || stats.maxVolume === 0) {
    return {
      factor: "transactionVolume",
      available: false,
      label: WALLET_FACTOR_LABELS.transactionVolume,
      reason:
        "Not enough wallets with transaction history in the current dataset to establish a relative volume baseline.",
    };
  }
  const ratio = totalVolume / stats.maxVolume;
  const value = Math.round(ratio * WALLET_WEIGHTS.transactionVolume);
  return {
    factor: "transactionVolume",
    available: true,
    label: `${totalVolume.toFixed(2)} BTC-eq total volume (${Math.round(ratio * 100)}% of the highest tracked wallet)`,
    value,
  };
}

// ─── Feature 3: linked entities (distinct real entityId FKs) ───────────

function linkedEntitiesSignal(
  linkedEntityCount: number,
  stats: WalletPopulationStats | null
): WalletRiskSignalOrGap {
  if (linkedEntityCount === 0) {
    return {
      factor: "linkedEntities",
      available: false,
      label: WALLET_FACTOR_LABELS.linkedEntities,
      reason: "No transaction on this wallet carries a non-null entityId.",
    };
  }
  if (!stats || stats.maxLinkedEntities === 0) {
    // We do have entity links, just no population to compare against —
    // fall back to a small fixed per-entity increment instead of a ratio,
    // capped at the feature max. Still fully derived from real FK counts.
    const value = Math.min(WALLET_WEIGHTS.linkedEntities, linkedEntityCount * 5);
    return {
      factor: "linkedEntities",
      available: true,
      label: `Transactions link to ${linkedEntityCount} distinct entity/entities (no population baseline available for relative scaling)`,
      value,
    };
  }
  const ratio = linkedEntityCount / stats.maxLinkedEntities;
  const value = Math.round(ratio * WALLET_WEIGHTS.linkedEntities);
  return {
    factor: "linkedEntities",
    available: true,
    label: `Transactions link to ${linkedEntityCount} distinct entity/entities (${Math.round(ratio * 100)}% of the most-connected tracked wallet)`,
    value,
  };
}

// ─── Feature 4: linked networks (distinct real networkId FKs) ──────────

function linkedNetworksSignal(linkedNetworkCount: number): WalletRiskSignalOrGap {
  if (linkedNetworkCount === 0) {
    return {
      factor: "linkedNetworks",
      available: false,
      label: WALLET_FACTOR_LABELS.linkedNetworks,
      reason: "No transaction on this wallet carries a non-null networkId.",
    };
  }
  // Direct link to ANY tracked criminal network is a strong, discrete
  // signal — not scaled by count (one confirmed network link is already
  // meaningful; a second one doesn't meaningfully double the concern).
  const value = linkedNetworkCount >= 2 ? WALLET_WEIGHTS.linkedNetworks : Math.round(WALLET_WEIGHTS.linkedNetworks * 0.7);
  return {
    factor: "linkedNetworks",
    available: true,
    label: `Transactions link to ${linkedNetworkCount} tracked network(s)`,
    value,
  };
}

// ─── Feature 5: inbound/outbound imbalance ──────────────────────────────
//
// A wallet that is overwhelmingly one-directional (near-pure inbound or
// near-pure outbound) is a mild pass-through/collection indicator. Needs a
// minimum transaction count to be meaningful — a 1-transaction wallet is
// always 100% one direction, which isn't informative.

const MIN_TXNS_FOR_IMBALANCE = 4;

function directionImbalanceSignal(inbound: number, outbound: number): WalletRiskSignalOrGap {
  const total = inbound + outbound;
  if (total < MIN_TXNS_FOR_IMBALANCE) {
    return {
      factor: "directionImbalance",
      available: false,
      label: WALLET_FACTOR_LABELS.directionImbalance,
      reason: `Fewer than ${MIN_TXNS_FOR_IMBALANCE} transactions recorded — a directional split isn't meaningful yet.`,
    };
  }
  const imbalance = Math.abs(inbound - outbound) / total; // 0 = perfectly balanced, 1 = fully one-directional
  const value = Math.round(imbalance * WALLET_WEIGHTS.directionImbalance);
  if (value === 0) {
    return {
      factor: "directionImbalance",
      available: true,
      label: `Balanced flow (${inbound} inbound / ${outbound} outbound)`,
      value: 0,
    };
  }
  const dominant = inbound > outbound ? "inbound" : "outbound";
  return {
    factor: "directionImbalance",
    available: true,
    label: `${Math.round(imbalance * 100)}% skew toward ${dominant} transactions (${inbound} inbound / ${outbound} outbound)`,
    value,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Score every wallet that has at least one real WalletTransaction row.
 * Wallets with zero transactions are NOT scored here — see
 * scoreAllWallets() below, which reports them as not-calculable rather
 * than silently defaulting to 0 or reusing a stored number.
 */
export function scoreWalletsFromTransactions(
  transactions: WalletTransactionInput[]
): Map<string, WalletRiskResult> {
  const byWallet = buildWalletGroups(transactions);
  const stats = computePopulationStats(byWallet);

  const out = new Map<string, WalletRiskResult>();
  for (const [walletId, txns] of byWallet) {
    const totalVolume = txns.reduce((sum, t) => sum + t.amountBtcEq, 0);
    const linkedEntityIds = Array.from(new Set(txns.map((t) => t.entityId).filter((x): x is string => !!x))).sort();
    const linkedNetworkIds = Array.from(new Set(txns.map((t) => t.networkId).filter((x): x is string => !!x))).sort();
    const inboundCount = txns.filter((t) => t.direction === "INBOUND").length;
    const outboundCount = txns.filter((t) => t.direction === "OUTBOUND").length;
    const occurredDates = txns.map((t) => t.occurredAt.getTime());

    const signals: WalletRiskSignalOrGap[] = [
      transactionActivitySignal(txns.length, stats),
      transactionVolumeSignal(totalVolume, stats),
      linkedEntitiesSignal(linkedEntityIds.length, stats),
      linkedNetworksSignal(linkedNetworkIds.length),
      directionImbalanceSignal(inboundCount, outboundCount),
    ];

    const rawScore = signals.reduce((sum, s) => sum + (s.available ? s.value : 0), 0);
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    const availableCount = signals.filter((s) => s.available).length;
    const unavailableCount = signals.length - availableCount;

    out.set(walletId, {
      walletId,
      score,
      calculable: true,
      signals,
      evidence: {
        transactionCount: txns.length,
        totalVolumeBtcEq: Math.round(totalVolume * 100) / 100,
        linkedEntityCount: linkedEntityIds.length,
        linkedEntityIds,
        linkedNetworkCount: linkedNetworkIds.length,
        linkedNetworkIds,
        inboundCount,
        outboundCount,
        firstSeen: occurredDates.length ? new Date(Math.min(...occurredDates)) : null,
        lastSeen: occurredDates.length ? new Date(Math.max(...occurredDates)) : null,
      },
      explanation:
        `Computed from ${txns.length} real WalletTransaction record(s) ` +
        `(${availableCount} of ${signals.length} scoring signal(s) available` +
        (unavailableCount > 0 ? `; ${unavailableCount} signal(s) not calculable from current data` : "") +
        `).`,
    });
  }
  return out;
}

/**
 * Builds a not-calculable result for a wallet with zero WalletTransaction
 * rows — used by routes so every Wallet row gets a response shape, but the
 * absence of data is stated plainly rather than faked as a 0 risk score
 * (0 would falsely read as "confirmed low risk" instead of "unknown").
 */
export function uncalculableWalletRisk(walletId: string): WalletRiskResult {
  const gap = (factor: WalletRiskFactor, reason: string): WalletRiskSignalOrGap => ({
    factor,
    available: false,
    label: WALLET_FACTOR_LABELS[factor],
    reason,
  });
  const reason = "No WalletTransaction records exist for this wallet.";
  return {
    walletId,
    score: 0,
    calculable: false,
    signals: [
      gap("transactionActivity", reason),
      gap("transactionVolume", reason),
      gap("linkedEntities", reason),
      gap("linkedNetworks", reason),
      gap("directionImbalance", reason),
    ],
    evidence: {
      transactionCount: 0,
      totalVolumeBtcEq: 0,
      linkedEntityCount: 0,
      linkedEntityIds: [],
      linkedNetworkCount: 0,
      linkedNetworkIds: [],
      inboundCount: 0,
      outboundCount: 0,
      firstSeen: null,
      lastSeen: null,
    },
    explanation:
      "Not calculable: this wallet has no backing transaction data, so risk cannot be honestly computed. Reported as unavailable rather than defaulted to a score.",
  };
}

/**
 * Convenience: score every wallet row (including ones with zero
 * transactions, which get uncalculableWalletRisk()). Pure function of
 * (wallet ids, all transactions) — no DB access, so it's unit-testable and
 * reusable exactly like scoreListings()/computeVendorRisk().
 */
export function scoreAllWallets(
  walletIds: string[],
  transactions: WalletTransactionInput[]
): Map<string, WalletRiskResult> {
  const scored = scoreWalletsFromTransactions(transactions);
  const out = new Map<string, WalletRiskResult>();
  for (const id of walletIds) {
    out.set(id, scored.get(id) ?? uncalculableWalletRisk(id));
  }
  return out;
}

/**
 * Flattens available WalletRiskSignal[] into the same
 * { factor, label, contribution } contributor shape riskEngine.ts's
 * signalsToContributors() produces for listings, so the UI can render
 * wallet risk breakdowns with the same component. Unavailable signals are
 * intentionally excluded here (they contributed 0) — callers that need to
 * show "signal unavailable" rows should read WalletRiskResult.signals
 * directly instead.
 */
export function walletSignalsToContributors(
  signals: WalletRiskSignalOrGap[]
): { factor: WalletRiskFactor; label: string; contribution: number }[] {
  return signals
    .filter((s): s is WalletRiskSignal => s.available && s.value > 0)
    .map((s) => ({ factor: s.factor, label: s.label, contribution: s.value }))
    .sort((a, b) => b.contribution - a.contribution);
}
