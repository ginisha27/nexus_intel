# App.tsx split — file map

`App.tsx` was one 2200-line file. It's now split so 4 people can work
without constant merge conflicts. Map:

src/
├── App.tsx                    — routing + auth state ONLY. Rarely needs editing.
├── data.ts                    — unchanged, still the mock-data source
├── lib/
│   └── socket.ts               — Socket.IO singleton + EVENT_META (Person A/B territory)
├── components/
│   ├── shared.tsx              — Sparkline, RingScore, RiskBadge, CustomTooltip,
│   │                             Section, PulseIndicator, BarContrib, TimelineView
│   ├── Login.tsx                — LoginScreen + LoginNetworkViz
│   └── Layout.tsx                — NAV, Sidebar, Topbar
└── screens/
    ├── OverviewScreen.tsx        — Person B/C
    ├── NetworkRiskScreen.tsx     — Person C
    ├── GraphScreen.tsx           — Person C
    ├── EntityScreen.tsx          — Person C
    ├── EntitiesScreen.tsx        — Person C
    ├── WorkspaceScreen.tsx       — Person B (AI Assessment lives here)
    ├── InvestigationsScreen.tsx  — Person B
    ├── TimelineScreen.tsx        — Person B
    ├── EvidenceScreen.tsx        — Person D
    ├── ReportsScreen.tsx         — Person D
    ├── AuditScreen.tsx           — Person D
    ├── AlertsScreen.tsx          — shared (Person A wires backend, whoever touches UI edits this file)
    ├── ListingsScreen.tsx
    ├── BlockchainScreen.tsx
    ├── AnalyticsScreen.tsx
    └── AdminScreen.tsx

## Rules
- Editing a screen? Only touch that one file. `App.tsx` should almost never
  need edits again — only if you add a brand-new screen (one new import +
  one new `case` line).
- Shared components (shared.tsx, Layout.tsx) are used by many screens.
  Changes there affect everyone — announce before editing, pull/push fast.
- Verified: this split was type-checked with `tsc --noEmit` and confirmed
  to build cleanly with `vite build` before being handed back — the app
  compiles and bundles exactly as before, just reorganized.
