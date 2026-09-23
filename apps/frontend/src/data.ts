// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type InvStatus = "UNDER INVESTIGATION" | "UNDER REVIEW" | "MONITORING" | "CLOSED";
export type EvidenceStatus = "Verified" | "Pending" | "Rejected";

export interface Entity {
  id: string;
  alias: string;
  risk: number;
  confidence: number;
  marketplaces: number;
  wallets: number;
  listings: number;
  comms: number;
  firstSeen: string;
  lastSeen: string;
  riskChange: number;
  identifiers: { type: string; value: string; confidence: number }[];
}

export interface Alert {
  id: string;
  severity: number;
  title: string;
  time: string;
  entities: string[];
  reason: string;
  status: "new" | "reviewed" | "resolved";
  network?: string;
}

export interface Investigation {
  id: string;
  title: string;
  status: InvStatus;
  priority: "HIGH" | "MEDIUM" | "LOW";
  assignee: string;
  entities: number;
  evidence: number;
  updated: string;
  description: string;
}

export interface EvidenceRecord {
  id: string;
  type: string;
  source: string;
  ts: string;
  hash: string;
  caseRef: string;
  by: string;
  status: EvidenceStatus;
}

export interface NetworkNode {
  id: string;
  label: string;
  type: "entity" | "market" | "listing" | "wallet" | "comm" | "txn";
  risk: number;
  x: number;
  y: number;
}

export interface NetworkEdge {
  from: string;
  to: string;
  label: string;
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

export const riskColor = (s: number) =>
  s >= 80 ? "#dc2626" : s >= 60 ? "#ea580c" : s >= 40 ? "#d97706" : "#16a34a";

export const riskColorLight = (s: number) =>
  s >= 80 ? "#f87171" : s >= 60 ? "#fb923c" : s >= 40 ? "#fbbf24" : "#4ade80";

export const riskLabel = (s: number): RiskLevel =>
  s >= 80 ? "CRITICAL" : s >= 60 ? "HIGH" : s >= 40 ? "MEDIUM" : "LOW";

export const riskBg = (s: number) =>
  s >= 80
    ? "rgba(220,38,38,0.12)"
    : s >= 60
    ? "rgba(234,88,12,0.12)"
    : s >= 40
    ? "rgba(217,119,6,0.12)"
    : "rgba(22,163,74,0.1)";

export const riskBorder = (s: number) =>
  s >= 80
    ? "rgba(220,38,38,0.25)"
    : s >= 60
    ? "rgba(234,88,12,0.25)"
    : s >= 40
    ? "rgba(217,119,6,0.25)"
    : "rgba(22,163,74,0.2)";

// ─── Chart data ───────────────────────────────────────────────────────────────

export const activityTimeline = [
  { day: "Aug 1", risk: 28, alerts: 2, entities: 94 },
  { day: "Aug 3", risk: 34, alerts: 3, entities: 101 },
  { day: "Aug 5", risk: 41, alerts: 5, entities: 108 },
  { day: "Aug 7", risk: 38, alerts: 4, entities: 105 },
  { day: "Aug 9", risk: 52, alerts: 7, entities: 117 },
  { day: "Aug 11", risk: 61, alerts: 9, entities: 124 },
  { day: "Aug 13", risk: 58, alerts: 8, entities: 121 },
  { day: "Aug 15", risk: 74, alerts: 12, entities: 131 },
  { day: "Aug 16", risk: 84, alerts: 15, entities: 137 },
];

export const riskDistribution = [
  { name: "Critical", value: 18, color: "#dc2626" },
  { name: "High", value: 34, color: "#ea580c" },
  { name: "Medium", value: 52, color: "#d97706" },
  { name: "Low", value: 33, color: "#16a34a" },
];

export const networkRiskEvolution = [
  { day: "Day 1", score: 32 },
  { day: "Day 5", score: 47 },
  { day: "Day 10", score: 63 },
  { day: "Day 15", score: 81 },
  { day: "Day 20", score: 91 },
];

export const alertsByDay = [
  { day: "Mon", alerts: 8, resolved: 5 },
  { day: "Tue", alerts: 14, resolved: 9 },
  { day: "Wed", alerts: 11, resolved: 8 },
  { day: "Thu", alerts: 19, resolved: 12 },
  { day: "Fri", alerts: 23, resolved: 14 },
  { day: "Sat", alerts: 9, resolved: 7 },
  { day: "Sun", alerts: 6, resolved: 6 },
];

export const entityTypeDist = [
  { type: "Alias", value: 42, color: "#6366f1" },
  { type: "Wallet", value: 28, color: "#06b6d4" },
  { type: "Listing", value: 19, color: "#d97706" },
  { type: "Market", value: 11, color: "#8b5cf6" },
  { type: "Comm ID", value: 8, color: "#16a34a" },
];

export const sourceContrib = [
  { source: "Source Alpha", records: 1842, risk: 74 },
  { source: "Source Beta", records: 1337, risk: 61 },
  { source: "Source Gamma", records: 941, risk: 48 },
  { source: "Source Delta", records: 528, risk: 39 },
  { source: "Source Epsilon", records: 241, risk: 27 },
];

export const walletClusterData = [
  { date: "Aug 12", vol: 0.42, txns: 4 },
  { date: "Aug 13", vol: 1.18, txns: 9 },
  { date: "Aug 14", vol: 0.87, txns: 7 },
  { date: "Aug 15", vol: 2.34, txns: 14 },
  { date: "Aug 16", vol: 1.92, txns: 11 },
];

// ─── KPIs ─────────────────────────────────────────────────────────────────────

export const kpis = [
  { label: "Active Investigations", value: 24, change: "+12%", up: true, spark: [18, 20, 21, 19, 22, 23, 24], accent: "#6366f1" },
  { label: "Critical Alerts", value: 8, change: "+33%", up: true, spark: [3, 4, 5, 4, 6, 7, 8], accent: "#dc2626" },
  { label: "High-Risk Entities", value: 137, change: "+8%", up: true, spark: [110, 118, 122, 125, 130, 133, 137], accent: "#ea580c" },
  { label: "Flagged Intelligence", value: 482, change: "+21%", up: true, spark: [340, 380, 395, 410, 440, 460, 482], accent: "#d97706" },
  { label: "Tracked Wallets", value: 319, change: "+15%", up: true, spark: [250, 270, 280, 289, 299, 309, 319], accent: "#06b6d4" },
  { label: "Emerging Networks", value: 12, change: "+20%", up: true, spark: [6, 7, 8, 9, 10, 11, 12], accent: "#8b5cf6" },
];

// ─── Entities ─────────────────────────────────────────────────────────────────

export const entities: Entity[] = [
  {
    id: "ENT-001", alias: "Alias_X", risk: 84, confidence: 91,
    marketplaces: 4, wallets: 3, listings: 7, comms: 2,
    firstSeen: "Aug 6, 2026", lastSeen: "Aug 16, 2026", riskChange: 22,
    identifiers: [
      { type: "Primary Alias", value: "Alias_X", confidence: 100 },
      { type: "Username", value: "Username_X23", confidence: 94 },
      { type: "Wallet", value: "WALLET-W1", confidence: 91 },
      { type: "Comm ID", value: "Email_ID_04", confidence: 87 },
    ],
  },
  {
    id: "ENT-002", alias: "Alias_Y", risk: 71, confidence: 87,
    marketplaces: 2, wallets: 5, listings: 3, comms: 1,
    firstSeen: "Aug 9, 2026", lastSeen: "Aug 15, 2026", riskChange: 18,
    identifiers: [
      { type: "Primary Alias", value: "Alias_Y", confidence: 100 },
      { type: "Username", value: "Vendor_YY9", confidence: 88 },
      { type: "Wallet", value: "WALLET-W3", confidence: 82 },
    ],
  },
  {
    id: "ENT-003", alias: "Username_X23", risk: 68, confidence: 83,
    marketplaces: 3, wallets: 2, listings: 9, comms: 3,
    firstSeen: "Aug 3, 2026", lastSeen: "Aug 16, 2026", riskChange: 12,
    identifiers: [
      { type: "Primary Alias", value: "Username_X23", confidence: 100 },
      { type: "Alias", value: "Alias_X", confidence: 94 },
      { type: "Wallet", value: "WALLET-W2", confidence: 79 },
    ],
  },
  {
    id: "ENT-004", alias: "Alias_Z", risk: 52, confidence: 74,
    marketplaces: 1, wallets: 1, listings: 4, comms: 2,
    firstSeen: "Aug 11, 2026", lastSeen: "Aug 14, 2026", riskChange: 8,
    identifiers: [
      { type: "Primary Alias", value: "Alias_Z", confidence: 100 },
      { type: "Comm ID", value: "Tel_ID_17", confidence: 71 },
    ],
  },
  {
    id: "ENT-005", alias: "Alias_Q", risk: 44, confidence: 69,
    marketplaces: 2, wallets: 0, listings: 2, comms: 4,
    firstSeen: "Aug 12, 2026", lastSeen: "Aug 13, 2026", riskChange: 3,
    identifiers: [
      { type: "Primary Alias", value: "Alias_Q", confidence: 100 },
      { type: "Email", value: "anon_hash_7a3f", confidence: 67 },
    ],
  },
];

// ─── Alerts ───────────────────────────────────────────────────────────────────

export const alerts: Alert[] = [
  {
    id: "ALT-089", severity: 91,
    title: "Network N-042 crossed critical risk threshold",
    time: "2m ago", entities: ["N-042", "Alias_X", "Wallet_W1"],
    reason: "3 connected high-risk entities, 2 recurring identifiers, abnormal transaction pattern",
    status: "new", network: "N-042",
  },
  {
    id: "ALT-088", severity: 74,
    title: "New wallet relationship detected in tracked cluster",
    time: "14m ago", entities: ["Wallet_W2", "Alias_Y"],
    reason: "Wallet linked to known high-risk cluster; cross-source identifier match confidence 87%",
    status: "new",
  },
  {
    id: "ALT-087", severity: 58,
    title: "Repeated identifier observed across 3 intelligence sources",
    time: "31m ago", entities: ["Alias_Z", "Listing_019"],
    reason: "Same communication identifier appeared across Source Alpha, Beta, and Gamma independently",
    status: "reviewed",
  },
  {
    id: "ALT-086", severity: 45,
    title: "Listing activity spike in monitored category",
    time: "1h 12m ago", entities: ["Listing_024", "Source Beta"],
    reason: "Listing frequency increased 340% over baseline in a 4-hour window",
    status: "reviewed",
  },
  {
    id: "ALT-085", severity: 91,
    title: "Entity resolution confidence exceeded 95% threshold",
    time: "2h ago", entities: ["Alias_Q", "Username_X23", "Email_ID_04"],
    reason: "Cross-source entity correlation achieved 96% match confidence across 3 independent sources",
    status: "resolved",
  },
  {
    id: "ALT-084", severity: 62,
    title: "Blockchain cluster Cluster-C1 shows abnormal outflow",
    time: "3h ago", entities: ["WALLET-W1", "WALLET-W2"],
    reason: "Transaction volume 5.2× above 30-day moving average; timing correlation with listing activity",
    status: "resolved",
  },
];

// ─── Emerging networks ────────────────────────────────────────────────────────

export const emergingNetworks = [
  { id: "N-042", risk: 91, change: 59, entities: 17, last: "2m ago", status: "CRITICAL" },
  { id: "N-018", risk: 78, change: 31, entities: 9, last: "18m ago", status: "HIGH" },
  { id: "N-067", risk: 72, change: 24, entities: 12, last: "1h ago", status: "HIGH" },
  { id: "N-031", risk: 65, change: 19, entities: 6, last: "3h ago", status: "HIGH" },
  { id: "N-009", risk: 58, change: 14, entities: 4, last: "6h ago", status: "MEDIUM" },
];

// ─── Listings ─────────────────────────────────────────────────────────────────

export const listings = [
  { id: "REC-1024", source: "Source Alpha", category: "Category A", risk: 88, signals: 5, first: "Aug 12", last: "Aug 16", status: "Flagged", entities: ["Alias_X", "Marketplace_A"], patterns: ["Repeated identifier", "Abnormal pricing pattern", "Cross-source correlation"] },
  { id: "REC-1017", source: "Source Beta", category: "Category B", risk: 72, signals: 4, first: "Aug 10", last: "Aug 15", status: "Flagged", entities: ["Alias_Y"], patterns: ["Volume spike", "Known vendor alias"] },
  { id: "REC-0998", source: "Source Alpha", category: "Category A", risk: 63, signals: 3, first: "Aug 8", last: "Aug 14", status: "Under Review", entities: ["Username_X23"], patterns: ["Communication identifier match"] },
  { id: "REC-0991", source: "Source Gamma", category: "Category C", risk: 49, signals: 2, first: "Aug 6", last: "Aug 13", status: "Monitoring", entities: [], patterns: ["Unusual terminology"] },
  { id: "REC-0984", source: "Source Delta", category: "Category B", risk: 38, signals: 2, first: "Aug 4", last: "Aug 12", status: "Monitoring", entities: [], patterns: ["Category anomaly"] },
  { id: "REC-0971", source: "Source Beta", category: "Category A", risk: 27, signals: 1, first: "Aug 1", last: "Aug 11", status: "Clear", entities: [], patterns: [] },
];

// ─── Wallets ──────────────────────────────────────────────────────────────────

export const wallets = [
  { id: "WALLET-W1", risk: 87, txns: 42, entities: 8, cluster: "Cluster-C1", first: "Aug 12, 2026", last: "Aug 16, 2026", totalVol: "4.73 BTC-eq", flagged: true },
  { id: "WALLET-W2", risk: 74, txns: 28, entities: 5, cluster: "Cluster-C1", first: "Aug 10, 2026", last: "Aug 15, 2026", totalVol: "2.18 BTC-eq", flagged: true },
  { id: "WALLET-W3", risk: 61, txns: 15, entities: 3, cluster: "Cluster-C2", first: "Aug 8, 2026", last: "Aug 14, 2026", totalVol: "0.94 BTC-eq", flagged: false },
  { id: "WALLET-W4", risk: 44, txns: 9, entities: 2, cluster: "Cluster-C2", first: "Aug 7, 2026", last: "Aug 13, 2026", totalVol: "0.41 BTC-eq", flagged: false },
  { id: "WALLET-W5", risk: 31, txns: 6, entities: 1, cluster: "Cluster-C3", first: "Aug 5, 2026", last: "Aug 12, 2026", totalVol: "0.17 BTC-eq", flagged: false },
];

// ─── Investigations ───────────────────────────────────────────────────────────

export const investigations: Investigation[] = [
  { id: "INV-2026-042", title: "Emerging Network Investigation", status: "UNDER INVESTIGATION", priority: "HIGH", assignee: "Investigator A", entities: 17, evidence: 24, updated: "4 minutes ago", description: "Cross-source network N-042 investigation following early-warning trigger on Aug 16, 2026. Primary entity Alias_X resolved with 93% confidence across 4 sources." },
  { id: "INV-2026-039", title: "Cross-Source Entity Resolution", status: "UNDER INVESTIGATION", priority: "HIGH", assignee: "Investigator B", entities: 9, evidence: 14, updated: "1 hour ago", description: "Entity resolution case for Username_X23 cluster. Multiple aliases identified with high confidence." },
  { id: "INV-2026-031", title: "Wallet Cluster Analysis", status: "UNDER REVIEW", priority: "MEDIUM", assignee: "Investigator A", entities: 6, evidence: 8, updated: "2 hours ago", description: "Blockchain cluster Cluster-C1 analysis following abnormal outflow detection." },
  { id: "INV-2026-028", title: "Marketplace Activity Monitoring", status: "MONITORING", priority: "MEDIUM", assignee: "Investigator C", entities: 12, evidence: 19, updated: "Yesterday", description: "Ongoing monitoring of Source Alpha and Source Beta listing patterns." },
  { id: "INV-2026-019", title: "Historical Pattern Analysis", status: "CLOSED", priority: "LOW", assignee: "Investigator B", entities: 4, evidence: 7, updated: "3 days ago", description: "Completed retrospective analysis of Aug 1–10 baseline patterns." },
];

// ─── Evidence ─────────────────────────────────────────────────────────────────

export const evidenceRecords: EvidenceRecord[] = [
  { id: "EV-1029", type: "Intelligence Record", source: "Source Alpha", ts: "16 Aug 2026 · 19:32 UTC", hash: "7A9F3C2D1B4E8A6F93C0D5B2E7F1A4C8", caseRef: "INV-042", by: "Investigator A", status: "Verified" },
  { id: "EV-1028", type: "Wallet Transaction Log", source: "Blockchain Data", ts: "16 Aug 2026 · 18:47 UTC", hash: "B2E4F8A1C6D9E3B72A5C8F0D4E7B1A9C", caseRef: "INV-042", by: "Investigator A", status: "Verified" },
  { id: "EV-1025", type: "Communication Record", source: "Source Beta", ts: "15 Aug 2026 · 14:22 UTC", hash: "C4A8E2D7F1B3C9A5E6D0F2B4C8A1E7D3", caseRef: "INV-042", by: "Investigator B", status: "Pending" },
  { id: "EV-1021", type: "Network Analysis Report", source: "System", ts: "14 Aug 2026 · 10:05 UTC", hash: "D6B2C4E8F3A7B1C9D5E2A4F6B8C0D3E7", caseRef: "INV-039", by: "System", status: "Verified" },
  { id: "EV-1018", type: "Intelligence Record", source: "Source Gamma", ts: "13 Aug 2026 · 16:30 UTC", hash: "E8D4A6C2B8F5C3D1E7A9B3C5D8F2A0E4", caseRef: "INV-039", by: "Investigator B", status: "Verified" },
  { id: "EV-1015", type: "Listing Capture", source: "Source Alpha", ts: "12 Aug 2026 · 09:14 UTC", hash: "F1A3C5E7B9D2F4A6C8E0B2D4F6A8C0E2", caseRef: "INV-042", by: "System", status: "Verified" },
];

// ─── Network graph nodes & edges ──────────────────────────────────────────────

export const graphNodes: NetworkNode[] = [
  { id: "alias-x", label: "Alias_X", type: "entity", risk: 84, x: 420, y: 240 },
  { id: "alias-y", label: "Alias_Y", type: "entity", risk: 71, x: 680, y: 180 },
  { id: "market-a", label: "Marketplace_A", type: "market", risk: 72, x: 240, y: 340 },
  { id: "market-b", label: "Marketplace_B", type: "market", risk: 49, x: 330, y: 150 },
  { id: "listing-17", label: "Listing_017", type: "listing", risk: 58, x: 148, y: 460 },
  { id: "wallet-w1", label: "Wallet_W1", type: "wallet", risk: 87, x: 560, y: 350 },
  { id: "wallet-w2", label: "Wallet_W2", type: "wallet", risk: 74, x: 620, y: 480 },
  { id: "comm-04", label: "Comm_ID_04", type: "comm", risk: 62, x: 520, y: 130 },
  { id: "txn-001", label: "Txn_3f8a", type: "txn", risk: 55, x: 690, y: 380 },
  { id: "alias-z", label: "Alias_Z", type: "entity", risk: 52, x: 780, y: 290 },
];

export const graphEdges: NetworkEdge[] = [
  { from: "alias-x", to: "market-a", label: "Appeared On" },
  { from: "alias-x", to: "market-b", label: "Appeared On" },
  { from: "alias-x", to: "wallet-w1", label: "Transacted With" },
  { from: "alias-x", to: "comm-04", label: "Linked To" },
  { from: "market-a", to: "listing-17", label: "Contains" },
  { from: "wallet-w1", to: "wallet-w2", label: "Transacted With" },
  { from: "wallet-w1", to: "alias-y", label: "Associated With" },
  { from: "wallet-w2", to: "txn-001", label: "Transacted With" },
  { from: "alias-y", to: "market-a", label: "Appeared On" },
  { from: "alias-y", to: "alias-z", label: "Shared Identifier" },
  { from: "txn-001", to: "alias-z", label: "Associated With" },
];

// ─── Audit log ────────────────────────────────────────────────────────────────

export const auditLog = [
  { ts: "19:37:14", user: "Investigator A", action: "Generated Report", resource: "INV-042", ip: "10.0.1.47", status: "Success", type: "export" },
  { ts: "19:34:22", user: "Investigator A", action: "Added Evidence", resource: "EV-1029", ip: "10.0.1.47", status: "Success", type: "write" },
  { ts: "19:32:14", user: "Investigator A", action: "Viewed Entity", resource: "Alias_X", ip: "10.0.1.47", status: "Success", type: "read" },
  { ts: "19:28:01", user: "Investigator B", action: "Exported Data", resource: "INV-039", ip: "10.0.2.33", status: "Success", type: "export" },
  { ts: "19:21:48", user: "Investigator A", action: "Created Investigation", resource: "INV-042", ip: "10.0.1.47", status: "Success", type: "write" },
  { ts: "19:18:33", user: "Admin", action: "Modified Permissions", resource: "Investigator C", ip: "10.0.0.1", status: "Success", type: "admin" },
  { ts: "19:14:09", user: "Investigator C", action: "Viewed Alert", resource: "ALT-089", ip: "10.0.3.12", status: "Success", type: "read" },
  { ts: "19:08:55", user: "Investigator B", action: "Ran Search", resource: "Query: Alias_X", ip: "10.0.2.33", status: "Success", type: "search" },
  { ts: "19:04:31", user: "System", action: "Alert Generated", resource: "ALT-089", ip: "Internal", status: "Success", type: "system" },
  { ts: "19:02:18", user: "Investigator A", action: "Viewed Network Graph", resource: "N-042", ip: "10.0.1.47", status: "Success", type: "read" },
];

// ─── AI flagging contributions ────────────────────────────────────────────────

export const flagContributions = [
  { label: "Suspicious behavioral pattern", value: 24, color: "#dc2626" },
  { label: "Network connectivity score", value: 21, color: "#ea580c" },
  { label: "Repeated identifiers (cross-source)", value: 18, color: "#d97706" },
  { label: "Wallet association pattern", value: 15, color: "#6366f1" },
  { label: "Listing characteristics", value: 12, color: "#8b5cf6" },
];

export const networkSignals = [
  { label: "Behavioral anomaly", value: 24, color: "#dc2626" },
  { label: "Entity connectivity", value: 21, color: "#ea580c" },
  { label: "Repeated identifiers", value: 18, color: "#d97706" },
  { label: "Wallet relationships", value: 15, color: "#6366f1" },
  { label: "Suspicious activity concentration", value: 13, color: "#8b5cf6" },
];

// ─── Timeline events ──────────────────────────────────────────────────────────

export const caseTimeline = [
  { date: "Aug 12", time: "09:14", label: "Entity Detected", type: "DETECTION", source: "Source Alpha", agent: "System", desc: "Initial detection of Alias_X during intelligence ingestion pipeline", color: "#6366f1" },
  { date: "Aug 13", time: "14:32", label: "Suspicious Activity", type: "ALERT", source: "Source Beta", agent: "System", desc: "Anomalous behavioral pattern identified across two independent sources", color: "#ea580c" },
  { date: "Aug 14", time: "10:05", label: "Wallet Relationship", type: "DISCOVERY", source: "Blockchain Data", agent: "System", desc: "Wallet_W1 linked to entity through transaction pattern analysis", color: "#06b6d4" },
  { date: "Aug 15", time: "16:22", label: "Network Risk Increase", type: "ESCALATION", source: "Risk Engine", agent: "System", desc: "Network N-042 risk score escalated from 63 → 81 over monitored period", color: "#d97706" },
  { date: "Aug 16", time: "08:47", label: "Early Warning Triggered", type: "WARNING", source: "Alert Engine", agent: "System", desc: "Critical threshold crossed — automatic alert generated, investigator notified", color: "#dc2626" },
  { date: "Aug 16", time: "19:21", label: "Investigation Opened", type: "ACTION", source: "Investigation Platform", agent: "Investigator A", desc: "Case INV-2026-042 created; primary entity Alias_X added as lead subject", color: "#8b5cf6" },
  { date: "Aug 16", time: "19:34", label: "Evidence Added", type: "EVIDENCE", source: "Source Alpha", agent: "Investigator A", desc: "Intelligence record EV-1029 collected and integrity-verified (SHA-256)", color: "#16a34a" },
];
