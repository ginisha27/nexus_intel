# NEXUS INTEL — producer

Standalone process that drives the "live simulation": every few seconds it
takes the next unsent row from a local staging pool and POSTs it to the
backend's ingestion endpoint.

It only talks to the backend over HTTP (`BACKEND_URL`), never to the
database — so it can run on the same machine as the backend for now, and
move to its own device later with nothing to change but `BACKEND_URL` (and
keeping `INGEST_SECRET_KEY` in sync with the backend's `.env`).

## Setup

```bash
npm install
cp .env.example .env
# edit .env: set INGEST_SECRET_KEY to the same value as the backend's
# INGEST_SECRET_KEY, and point BACKEND_URL at the running backend.
npm start
```

## What it does

1. On first run, if `staging-pool.json` doesn't exist yet, it calls
   `GET {BACKEND_URL}/api/networks` and builds a local queue of events
   (`ROWS_PER_NETWORK` per network, interleaved round-robin across
   networks) — each row just a `networkDisplayId` + a `listing_detected` /
   `transaction_detected` label.
2. Every `PRODUCER_INTERVAL_MS`, it picks the first row still marked
   `sent: false`, POSTs it to `POST {BACKEND_URL}/api/ingest/event` with
   header `x-ingest-key: <INGEST_SECRET_KEY>`, and — only on a successful
   response — marks that row `sent: true` with a timestamp and rewrites
   `staging-pool.json`.
3. If a send fails, the row is left unmarked and retried on the next tick.
4. Once every row has been sent, the pool is rebuilt from the backend's
   current networks so the simulation keeps going indefinitely.

Delete `staging-pool.json` any time to force a rebuild (e.g. after
reseeding demo data).
