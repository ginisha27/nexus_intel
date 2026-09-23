// producer.mjs
//
// Standalone "live simulation" producer for NEXUS INTEL.
//
// Every PRODUCER_INTERVAL_MS, this script:
//   1. Reads the staging pool (a local JSON file — see below).
//   2. Finds the next row that hasn't been sent yet.
//   3. POSTs it to the backend's POST /api/ingest/event, authenticated
//      with INGEST_SECRET_KEY (sent as the x-ingest-key header).
//   4. On success, marks that row sent (with a timestamp) and rewrites
//      the pool file.
//
// This process talks to the backend over HTTP only — never to the
// database directly — so it can run on the same box as the backend today
// and move to a completely separate machine later with no changes beyond
// setting BACKEND_URL to wherever the backend is reachable from.
//
// ── Where the "listing_detected" rows come from ─────────────────────────
// The staging pool is built from GET /api/ingest/candidates — REAL,
// not-yet-ingested rows from the same Hansa/Valhalla dark-web CSVs the
// backend was seeded/imported from (see lib/realListingFeed.ts). Each row
// carries the actual title/price/marketplace/vendorAlias/category from
// the data set, not a synthetic label. When POSTed to /event, the backend
// inserts it as a real Listing row, so vendor/entity/network risk is
// recomputed from genuinely new evidence instead of pulling toward a
// value that never moves. That candidates endpoint is stateless (it
// diffs against what's already a Listing row in the DB), so this script
// never has to track "which real rows have I used" itself — asking again
// naturally returns the next unseen slice once this process has POSTed
// the ones it was given.
//
// When the real CSV data for our tracked vendors is fully exhausted,
// GET /api/ingest/candidates returns an empty list. The pool then falls
// back to occasional transaction_detected replays (existing evidence,
// no new listing) just so the feed doesn't go completely silent — this
// is clearly a fallback, not a source of new listings.
//
// The staging pool itself lives entirely on THIS machine (staging-pool.json
// next to this script by default). Delete staging-pool.json and restart
// to force a fresh pull of candidates (e.g. after seeding new demo data).
//
// Run it:
//   npm install
//   cp .env.example .env   # fill in INGEST_SECRET_KEY to match the backend
//   npm start

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

const BACKEND_URL = (process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/+$/, "");
const INGEST_SECRET_KEY = process.env.INGEST_SECRET_KEY;
const INTERVAL_MS = Number(process.env.PRODUCER_INTERVAL_MS ?? 5000);
// How many real candidates to pull per refill. Independent of network
// count now — candidates are real listings for whichever tracked vendors
// still have unseen CSV rows, not an even N-per-network allocation.
const CANDIDATE_BATCH_SIZE = Number(process.env.CANDIDATE_BATCH_SIZE ?? Number(process.env.ROWS_PER_NETWORK ?? 5) * 5);
const POOL_PATH = process.env.STAGING_POOL_PATH
  ? path.resolve(process.env.STAGING_POOL_PATH)
  : path.join(process.cwd(), "staging-pool.json");

if (!INGEST_SECRET_KEY) {
  console.error("[producer] INGEST_SECRET_KEY is not set (check your .env) — refusing to start.");
  process.exit(1);
}

let running = false; // simple re-entrancy guard in case a tick overruns the interval

async function loadPool() {
  try {
    const raw = await fs.readFile(POOL_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function savePool(pool) {
  await fs.writeFile(POOL_PATH, JSON.stringify(pool, null, 2));
}

// Round-robins across networks so the feed looks like activity spread
// across the whole map, instead of draining one network at a time.
function interleaveByNetwork(rows) {
  const byNetwork = new Map();
  for (const row of rows) {
    const key = row.networkDisplayId ?? "__none__";
    if (!byNetwork.has(key)) byNetwork.set(key, []);
    byNetwork.get(key).push(row);
  }
  const buckets = [...byNetwork.values()];
  const out = [];
  let i = 0;
  while (out.length < rows.length) {
    for (const bucket of buckets) {
      if (bucket[i]) out.push(bucket[i]);
    }
    i++;
  }
  return out;
}

async function fetchRealCandidates(count) {
  const res = await fetch(`${BACKEND_URL}/api/ingest/candidates?count=${count}`, {
    headers: { "x-ingest-key": INGEST_SECRET_KEY },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET /api/ingest/candidates -> ${res.status}: ${body}`);
  }
  const { candidates } = await res.json();
  return Array.isArray(candidates) ? candidates : [];
}

async function fetchNetworkDisplayIds() {
  const res = await fetch(`${BACKEND_URL}/api/networks`);
  if (!res.ok) throw new Error(`GET /api/networks -> ${res.status} ${res.statusText}`);
  const networks = await res.json();
  return Array.isArray(networks) ? networks.map((n) => n.displayId) : [];
}

let seq = 0;
function nextId() {
  return seq++;
}

async function buildPool() {
  console.log(`[producer] refilling staging pool from ${BACKEND_URL}/api/ingest/candidates`);

  const candidates = await fetchRealCandidates(CANDIDATE_BATCH_SIZE);

  let rows = candidates
    .filter((c) => c.networkDisplayId) // only vendors we can attribute to a network
    .map((c) => ({
      id: nextId(),
      networkDisplayId: c.networkDisplayId,
      entityDisplayId: c.entityDisplayId,
      eventType: "listing_detected",
      description: `New listing detected: "${c.title}" on ${c.marketplace}`,
      listing: {
        displayId: c.displayId,
        marketplace: c.marketplace,
        title: c.title,
        vendorAlias: c.vendorAlias,
        priceUsd: c.priceUsd,
        category: c.category,
        shipsFrom: c.shipsFrom,
      },
      sent: false,
      sentAt: null,
    }));

  if (rows.length === 0) {
    // Real CSV data for our tracked vendors is exhausted — fall back to
    // transaction_detected replays against existing evidence so the feed
    // keeps a heartbeat instead of going silent. This never creates a new
    // Listing row and is clearly a fallback, not a source of new evidence.
    console.log("[producer] no new real listings left for tracked vendors — falling back to transaction replay.");
    const networkDisplayIds = await fetchNetworkDisplayIds();
    rows = networkDisplayIds.map((networkDisplayId) => ({
      id: nextId(),
      networkDisplayId,
      entityDisplayId: undefined,
      eventType: "transaction_detected",
      description: "New blockchain transaction detected on existing wallet evidence",
      listing: undefined,
      sent: false,
      sentAt: null,
    }));
  }

  rows = interleaveByNetwork(rows);

  const pool = { builtAt: new Date().toISOString(), rows };
  await savePool(pool);
  console.log(`[producer] staging pool built: ${rows.length} row(s) -> ${POOL_PATH}`);
  return pool;
}

async function sendRow(row) {
  const res = await fetch(`${BACKEND_URL}/api/ingest/event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ingest-key": INGEST_SECRET_KEY,
    },
    body: JSON.stringify({
      networkDisplayId: row.networkDisplayId,
      entityDisplayId: row.entityDisplayId,
      eventType: row.eventType,
      description: row.description,
      listing: row.listing,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`POST /api/ingest/event -> ${res.status}: ${body}`);
  }
  return res.json();
}

async function tick() {
  if (running) return; // previous tick still in flight — skip this one
  running = true;
  try {
    let pool = await loadPool();
    if (!pool) pool = await buildPool();

    const next = pool.rows.find((r) => !r.sent);
    if (!next) {
      console.log("[producer] staging pool exhausted — rebuilding from current backend state.");
      await buildPool();
      return; // next tick picks up the fresh pool
    }

    try {
      await sendRow(next);
      next.sent = true;
      next.sentAt = new Date().toISOString();
      await savePool(pool);
      console.log(
        `[producer] sent row #${next.id} -> ${next.networkDisplayId} (${next.eventType}` +
          (next.listing ? `: "${next.listing.title}"` : "") +
          ")"
      );
    } catch (err) {
      // A row that keeps failing (stale network/entity id, transient
      // backend error, etc.) must NOT be allowed to permanently block
      // every row behind it — that's exactly the kind of "gets stuck"
      // symptom this whole redesign is meant to avoid. Retry a few times,
      // then drop it and move on; the rest of the pool keeps flowing.
      next.attempts = (next.attempts ?? 0) + 1;
      if (next.attempts >= 3) {
        next.sent = true; // drop it — mark as "handled" so it stops blocking the queue
        next.sentAt = null;
        next.error = err.message;
        console.error(`[producer] row #${next.id} failed ${next.attempts}x, dropping it:`, err.message);
      } else {
        console.error(`[producer] row #${next.id} failed (attempt ${next.attempts}/3), will retry:`, err.message);
      }
      await savePool(pool);
    }
  } catch (err) {
    console.error(`[producer] tick failed, will retry next interval:`, err.message);
  } finally {
    running = false;
  }
}

console.log(`[producer] starting — backend=${BACKEND_URL} interval=${INTERVAL_MS}ms pool=${POOL_PATH}`);
tick();
const timer = setInterval(tick, INTERVAL_MS);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[producer] received ${sig}, stopping.`);
    clearInterval(timer);
    process.exit(0);
  });
}
