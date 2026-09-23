# NEXUS — Dark Web Threat Actor De-anonymization & Attribution

> **Project focus:** collection, correlation and analysis of dark-web threat-actor intelligence using identifiers, wallets, infrastructure indicators, stylometry, behavioral patterns and evidence-backed attribution confidence.
>
> **Demo data:** the bundled seed uses synthetic/authorized demonstration records. It is designed for an academic cybersecurity/CTF-style prototype and does not perform exploitation of Tor services.

## Core capabilities
- Threat actor profiles and cross-source identifiers
- PGP, wallet, handle, email and forum-account correlation
- Onion-service / TLS / clearnet infrastructure intelligence
- Relationship graph and timeline analysis
- Stylometric and behavioral persona comparison UI
- Attribution confidence with evidence review and alternative explanations
- Investigation workspace, alerts, audit trail and CSV/JSON/report export

## Main UI
**Overview → Threat Actors → Dark Web Intelligence → Infrastructure Intel → Attribution Analysis → Relationship Graph → Investigations → Evidence → Reports**

---

# NEXUS INTEL

AI-assisted cyber-intelligence investigation platform. Monorepo: existing
React frontend + new Express/Prisma/PostgreSQL/Socket.IO backend.

## Structure

```
nexus-intel/
├── apps/
│   ├── frontend/     existing React 19 + Vite + Tailwind app (uploaded prototype)
│   └── backend/      Express + Prisma + PostgreSQL + Socket.IO
├── docker-compose.yml   local Postgres, no manual install needed
└── package.json         pnpm workspace root
```



# 1
npm install -g pnpm

# 2. 
pnpm install

# 3. need docker
docker compose up -d

# 4. Configure backend env
cp apps/backend/.env.example apps/backend/.env
# DATABASE_URL default already matches docker-compose — no edit needed
# Add your ANTHROPIC_API_KEY when you get to the AI Assessment feature

# 5. Create the database tables from the schema
pnpm db:migrate
# When prompted for a migration name, use: init

# 6. Load demo data (mirrors what the frontend already displays)
pnpm db:seed
```

## Running day-to-day

```bash
# Run frontend + backend together
pnpm dev

# Or separately, in two terminals:
pnpm dev:frontend   # http://localhost:5173
pnpm dev:backend    # http://localhost:4000
```

Check the backend is alive: `curl http://localhost:4000/api/health`

Browse the database visually: `pnpm db:studio`

## The core demo pipeline

```
POST /api/simulate/event  { "networkDisplayId": "N-018" }
```

This is your "Simulate Incoming Intelligence" button's backend call. It runs
the real pipeline — not a fake animation:

```
event created -> entity correlated -> risk recalculated -> risk point stored
-> threshold checked -> alert created if crossed -> broadcast live via
   Socket.IO on the "intelligence-event" channel
```

Try it against `N-018` (currently risk 78) — one or two calls will push it
past 80 and you'll see an alert get created for real in the response, plus a
live event on the socket channel.

## API reference (so frontend work can start immediately)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/entities` | Entities list screen |
| GET | `/api/entities/:displayId` | Entity profile page |
| GET | `/api/alerts` | Alert Center |
| PATCH | `/api/alerts/:id/status` | Dismiss/review an alert |
| GET | `/api/networks` | Emerging networks ranking |
| GET | `/api/networks/:displayId/trajectory` | Early-warning risk-over-time chart |
| GET | `/api/investigations` | Investigations list |
| GET | `/api/investigations/:displayId` | Investigation detail (entities, evidence, timeline, AI assessment) |
| GET | `/api/graph` | Full network graph (nodes + edges) |
| GET | `/api/graph/:nodeId/expand` | Click-to-expand a node's relationships |
| GET | `/api/evidence` | Evidence Repository |
| POST | `/api/evidence` | Add evidence — computes a real SHA-256 hash |
| GET | `/api/wallets` | Blockchain Intelligence wallets table |
| GET | `/api/listings` | Listings Intelligence |
| GET | `/api/audit-log` | Audit Logs |
| GET | `/api/sources` | Data Governance panel (source access levels) |
| POST | `/api/simulate/event` | The demo pipeline described above |

Socket.IO event: `intelligence-event` — payload `{ type, payload, at }`, types:
`event_detected`, `correlation`, `risk_updated`, `alert_generated`. This is
what feeds the "Live Intelligence Feed" panel on the Overview screen.

## Schema

See `apps/backend/prisma/schema.prisma` — it's modeled directly off
`apps/frontend/src/data.ts`'s existing TypeScript types (`Entity`, `Alert`,
`Investigation`, `EvidenceRecord`, `NetworkNode`, `NetworkEdge`), so every
screen already built has a matching real table.

## Next steps (in order)

1. Confirm `pnpm dev` runs both apps and `/api/health` responds
2. Replace one screen's hardcoded import from `data.ts` with a `fetch` to
   its matching endpoint above (Entities screen -> `/api/entities` is the
   easiest first one) — this proves the full loop before touching the rest
3. Wire Socket.IO client into the frontend for the Live Intelligence Feed
4. Wire the "Simulate Incoming Intelligence" button to `POST /api/simulate/event`
5. Build the AI Assessment call (Claude API, using `signals` stored on
   `AiAssessment` — never let the model invent the risk score itself)
