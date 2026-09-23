// prisma/generateActivity.ts
//
// Companion to importDatadump.ts. That script imports REAL marketplace
// listings and derives vendor Entities from them — but the Hansa/Valhalla
// CSVs obviously contain no investigations, alerts, or wallet data, so
// those tables were left exactly as seed.ts's original demo rows (5-6
// rows each) even after 1,500+ real listings were imported. That's the
// "1,529 Flagged Intelligence vs. 5 Active Investigations" mismatch.
//
// This script closes that gap by generating activity data — Networks,
// Alerts, Investigations, and Wallets — DERIVED from the real entities
// now in the DB (their live computed risk drives clustering, severity,
// and priority) rather than invented from nothing. It is explicitly
// synthetic — same as seed.ts's own alerts/investigations/wallets — and
// does not pretend to be real intelligence extracted from the CSVs.
//
// Deterministic (hash-based, no Math.random — re-running gives identical
// output) and idempotent: guarded by checking for N-101, a displayId in
// a numbering range disjoint from seed.ts's (N-101+, ALT-1000+,
// INV-2026-100+, WALLET-G1+), so it only ever runs its work once.

import { PrismaClient } from '@prisma/client'
import { computeVendorRisk } from '../src/lib/vendorRisk.js'
import { computeEntityRisk } from '../src/lib/entityRisk.js'
import type { ListingInput } from '../src/lib/riskEngine.js'

const prisma = new PrismaClient()

const WINDOW_DAYS = 30
const NETWORK_COUNT = 8
const INVESTIGATION_COUNT = 24
const WALLET_COUNT = 28

// ─── Deterministic pseudo-randomness (same convention as importDatadump.ts) ─
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
function pick<T>(arr: T[], seed: string): T {
  return arr[hashString(seed) % arr.length]
}
function daysAgoDate(n: number, seed: string): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  d.setUTCHours(hashString(seed + 'h') % 24, hashString(seed + 'm') % 60, 0, 0)
  return d
}

async function buildListingInputs(): Promise<ListingInput[]> {
  const listings = await prisma.listing.findMany()
  return listings.map((l) => ({
    id: l.id,
    category: l.category,
    title: l.title,
    priceUsd: l.priceUsd,
    marketplace: l.marketplace,
    vendorAlias: l.vendorAlias,
    shipsFrom: l.shipsFrom,
    firstSeen: l.firstSeen,
    lastSeen: l.lastSeen,
  }))
}

async function main() {
  // ─── Idempotency guard ───────────────────────────────────────────────
  const already = await prisma.network.findUnique({ where: { displayId: 'N-101' } })
  if (already) {
    console.log(
      'Synthetic activity already generated (N-101 exists) — nothing to do.'
    )
    return
  }

  console.log('Computing live risk for all entities…')
  const vendorRiskByAlias = computeVendorRisk(await buildListingInputs())
  const entities = await prisma.entity.findMany()
  const scoredEntities = entities
    .map((e) => ({
      entity: e,
      risk: computeEntityRisk(e.alias, vendorRiskByAlias).risk ?? e.risk,
    }))
    .sort((a, b) => b.risk - a.risk)

  if (scoredEntities.length === 0) {
    throw new Error('No entities found — run db:seed and db:import-datadump first.')
  }
  console.log(
    `${scoredEntities.length} entities scored (top risk = ${scoredEntities[0].risk})`
  )

  // ─── Networks: cluster the highest-risk entities into up to 8 networks ─
  const clusterable = scoredEntities.filter((s) => s.risk >= 45)
  const networks: { id: string; displayId: string; risk: number; lastActivity: Date }[] = []

  for (let i = 0; i < NETWORK_COUNT; i++) {
    const members = clusterable.filter((_, idx) => idx % NETWORK_COUNT === i).slice(0, 4)
    if (members.length === 0) continue

    const displayId = `N-${101 + i}`
    const risk = Math.round(members.reduce((s, m) => s + m.risk, 0) / members.length)
    const status = risk >= 80 ? 'CRITICAL' : risk >= 60 ? 'HIGH' : risk >= 40 ? 'MEDIUM' : 'LOW'
    const startRisk = Math.max(10, risk - 22 - (hashString(displayId) % 15))
    const change = risk - startRisk
    const lastActivity = daysAgoDate(hashString(displayId + 'la') % 3, displayId)

    const network = await prisma.network.create({
      data: { displayId, risk, change, status: status as any, lastActivity },
    })
    networks.push({ id: network.id, displayId, risk, lastActivity })

    for (const m of members) {
      await prisma.entity.update({
        where: { id: m.entity.id },
        data: { networkId: network.id },
      })
    }

    // 30-day risk trajectory rising to the final `risk`, so the Network
    // Risk Analysis chart has real history instead of a flat line.
    const checkpoints = [30, 26, 22, 18, 14, 10, 7, 4, 2, 1, 0]
    const points = checkpoints.map((daysAgo) => {
      const t = (WINDOW_DAYS - daysAgo) / WINDOW_DAYS
      const jitter = (hashString(displayId + daysAgo) % 5) - 2
      const score =
        daysAgo === 0
          ? risk
          : Math.max(5, Math.min(99, Math.round(startRisk + (risk - startRisk) * t) + jitter))
      return { daysAgo, score }
    })
    await prisma.networkRiskPoint.createMany({
      data: points.map(({ daysAgo, score }) => ({
        networkId: network.id,
        label: daysAgo === 0 ? `Recalculated: ${lastActivity.toISOString()}` : `Day -${daysAgo}`,
        score,
        recordedAt:
          daysAgo === 0
            ? lastActivity
            : new Date(lastActivity.getTime() - daysAgo * 24 * 60 * 60 * 1000),
      })),
    })
  }
  console.log(`Created ${networks.length} networks with 30-day risk trajectories`)

  // ─── Alerts: spread across the last 30 days, 2-8 per day so no day is
  // ever empty (this is what was making the Suspicious Activity chart
  // spike on one day and sit at zero everywhere else) ─────────────────
  const alertTemplates: [string, string][] = [
    ['Listing activity spike in monitored category', 'Listing frequency increased sharply over baseline in a short window'],
    ['New wallet relationship detected in tracked cluster', 'Wallet linked to a known high-risk cluster; cross-source identifier match'],
    ['Repeated identifier observed across intelligence sources', 'Same communication identifier appeared across independent sources'],
    ['Entity resolution confidence exceeded threshold', 'Cross-source entity correlation achieved high match confidence'],
    ['Network risk threshold crossed', 'Connected high-risk entities and an abnormal transaction pattern detected'],
    ['Vendor alias reappeared on a second marketplace', 'Same vendor alias observed operating on another tracked marketplace'],
    ['Category concentration flagged', "Vendor's listing mix concentrated in a high-risk category above baseline"],
    ['Price anomaly detected', 'Listing price deviates significantly from its category median'],
  ]
  const statusForAge = (daysAgo: number) =>
    daysAgo > 14 ? 'RESOLVED' : daysAgo > 5 ? 'REVIEWED' : 'NEW'

  let alertSeq = 1000
  let createdAlerts = 0
  for (let d = 0; d < WINDOW_DAYS; d++) {
    const dailyCount = 2 + (hashString(`alertday${d}`) % 7) // 2..8, never 0
    for (let k = 0; k < dailyCount; k++) {
      const seed = `alert-${d}-${k}`
      const displayId = `ALT-${alertSeq++}`
      const targetEntity = pick(scoredEntities, seed)
      const [title, reason] = pick(alertTemplates, seed + 't')
      const severity = Math.max(
        20,
        Math.min(97, targetEntity.risk + (hashString(seed + 's') % 21) - 10)
      )
      const network = networks.length ? pick(networks, seed + 'n') : null
      const linkToNetwork = network && hashString(seed + 'ln') % 3 === 0

      await prisma.alert.create({
        data: {
          displayId,
          severity,
          title,
          reason,
          status: statusForAge(d) as any,
          createdAt: daysAgoDate(d, seed),
          networkId: linkToNetwork ? network!.id : null,
          entities: { create: [{ entityId: targetEntity.entity.id }] },
        },
      })
      createdAlerts++
    }
  }
  console.log(`Created ${createdAlerts} alerts spread across the last ${WINDOW_DAYS} days (2-8/day)`)

  // ─── Investigations: biased toward NOT closed, so Active Investigations
  // actually reflects the larger dataset ──────────────────────────────
  const invTitleTemplates = [
    'Cross-marketplace vendor correlation',
    'High-risk wallet cluster review',
    'Repeated identifier pattern investigation',
    'Category concentration follow-up',
    'Network escalation review',
    'Vendor alias reappearance case',
  ]
  const nonClosedStatuses = ['UNDER_INVESTIGATION', 'UNDER_REVIEW', 'MONITORING']
  const assignees = ['Investigator A', 'Investigator B', 'Investigator C', 'Investigator D']
  const priorityFor = (risk: number) => (risk >= 75 ? 'HIGH' : risk >= 50 ? 'MEDIUM' : 'LOW')

  let createdInvestigations = 0
  for (let i = 0; i < INVESTIGATION_COUNT; i++) {
    const seed = `inv-${i}`
    const target = pick(scoredEntities, seed)
    const network = networks.length ? pick(networks, seed + 'n') : null
    const daysAgo = 1 + (hashString(seed + 'age') % 60)
    // ~70% stay open, so the dataset reads as an active caseload
    const status =
      hashString(seed + 'status') % 10 < 7
        ? pick(nonClosedStatuses, seed + 'st2')
        : 'CLOSED'
    const displayId = `INV-2026-${100 + i}`

    await prisma.investigation.create({
      data: {
        displayId,
        title: `${pick(invTitleTemplates, seed + 't')}: ${target.entity.alias}`,
        description: `Opened from imported marketplace data — ${target.entity.alias} shows a computed risk of ${target.risk} across correlated listings.`,
        status: status as any,
        priority: priorityFor(target.risk) as any,
        assignee: pick(assignees, seed + 'a'),
        createdAt: daysAgoDate(daysAgo, seed),
        networkId: network?.id ?? null,
        entities: { create: [{ entityId: target.entity.id }] },
      },
    })
    createdInvestigations++
  }
  console.log(`Created ${createdInvestigations} investigations`)

  // ─── Wallets + transactions, tied to real entities ─────────────────────
  const clusterLabels = ['Cluster-C1', 'Cluster-C2', 'Cluster-C3', 'Cluster-D1', 'Cluster-D2', 'Unclustered']
  let createdWallets = 0
  for (let i = 0; i < WALLET_COUNT; i++) {
    const seed = `wallet-${i}`
    const target = pick(scoredEntities, seed)
    const risk = Math.max(15, Math.min(96, target.risk + (hashString(seed + 'j') % 21) - 10))
    const displayId = `WALLET-G${i + 1}`
    const txnCount = 3 + (hashString(seed + 'tc') % 12)

    const wallet = await prisma.wallet.create({
      data: {
        displayId,
        risk,
        txnCount,
        entityCount: 1,
        cluster: pick(clusterLabels, seed + 'c'),
        flagged: risk >= 70,
        totalVolume: `${(1 + (hashString(seed + 'v') % 900) / 100).toFixed(2)} BTC-eq`,
        firstSeen: daysAgoDate(WINDOW_DAYS + (hashString(seed + 'fs') % 30), seed + 'fs'),
        lastSeen: daysAgoDate(hashString(seed + 'ls') % WINDOW_DAYS, seed + 'ls'),
      },
    })

    for (let t = 0; t < txnCount; t++) {
      const txSeed = seed + 'tx' + t
      await prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          entityId: target.entity.id,
          direction: hashString(txSeed) % 2 === 0 ? 'INBOUND' : 'OUTBOUND',
          amountBtcEq: Math.round(((hashString(txSeed + 'amt') % 500) / 100 + 0.01) * 100) / 100,
          occurredAt: daysAgoDate(hashString(txSeed + 'd') % WINDOW_DAYS, txSeed),
        },
      })
    }
    createdWallets++
  }
  console.log(`Created ${createdWallets} wallets with transaction history`)

  console.log('Done. Re-check /api/dashboard/kpis — all six numbers should now move together.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
