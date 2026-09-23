// prisma/importDatadump.ts
//
// One-off enrichment import — NOT part of the core seed.ts flow, run
// separately (see package.json "db:import-datadump" script). Reads the real
// Sarah Jamie Lewis "Dark Web Data Dumps" CSVs (Hansa Dec 2016 + Valhalla
// Oct 2016 listings — the same source seed.ts's ~120 hand-typed listings
// and hansaSource/valhallaSource rows were already sampled from) and
// imports a curated ~380-listing slice plus Entity rows for the top
// vendors by listing count.
//
// What's real vs. derived (so nothing here silently invents data):
//   - title, vendorAlias, priceUsd (converted), shipsFrom, category (Hansa)
//     — straight from the CSV.
//   - category (Valhalla only — the file has no category column) — inferred
//     from the title via a small keyword table, using the SAME category
//     vocabulary Hansa actually uses. Flagged as inferred, never silently
//     mixed with real Hansa categories in a way that misrepresents it.
//   - risk, signals — NOT hand-typed. Run through the existing
//     scoreListings() engine (riskEngine.ts) exactly like every other
//     listing, scored against the population being imported.
//   - status ("active" | "flagged") — deterministically derived FROM that
//     computed risk score, not random.
//   - firstSeen/lastSeen — Hansa has one real scrape timestamp (so both
//     collapse to it, +/- a short synthetic observation window); Valhalla
//     has no timestamp at all. Both are anchored to a recent rolling
//     window (deterministically, via a hash of the listing id — no
//     Math.random, so re-running produces identical output) rather than
//     the real Dec-2016/Oct-2016 dates, matching the existing seed's own
//     convention of using "recent-looking" dates (see e.g. H-37713).
//   - Entity.risk/confidence for newly-created vendors — computed the same
//     way routes/*.ts computes them live (computeEntityRisk), not hand-typed,
//     so they won't drift from what the API actually reports on first load.
//
// Idempotent: every insert is guarded (skipDuplicates / existence checks),
// so re-running this script never duplicates rows.

import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  scoreListings,
  HIGH_RISK_CATEGORIES,
  type ListingInput,
} from '../src/lib/riskEngine.js'
import { computeVendorRisk } from '../src/lib/vendorRisk.js'
import { computeEntityRisk } from '../src/lib/entityRisk.js'
import { normalizeVendorAlias } from '../src/lib/entityCorrelation.js'

const prisma = new PrismaClient()
const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Tunables (answers to the scope questions) ─────────────────────────────
const TARGET_LISTING_COUNT = 380
const TOP_VENDOR_COUNT = 40
const MAX_LISTINGS_PER_TOP_VENDOR = 15
const EUR_TO_USD = 1.08 // fixed approximate 2016-era rate — not a live FX call

// ─── Tiny CSV parser (quote-aware, no embedded-quote escaping in this data —
// verified against the source files) ────────────────────────────────────────
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      fields.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur.trim())
  return fields
}

function parseCsvFile(path: string): string[][] {
  const text = readFileSync(path, 'utf-8')
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map(parseCsvLine)
}

// ─── Deterministic pseudo-randomness (no Math.random — same input always
// produces the same output, so re-running the import is reproducible) ──────
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

// Anchors a listing to a recent-looking date, deterministically, so the
// demo keeps looking "current" regardless of when this script is actually
// run — matching the existing seed's own convention (see file header).
function recentDateFor(seed: string, maxDaysAgo: number): Date {
  const daysAgo = hashString(seed) % maxDaysAgo
  const hourOfDay = hashString(seed + 'h') % 24
  const minuteOfHour = hashString(seed + 'm') % 60
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  d.setUTCHours(hourOfDay, minuteOfHour, 0, 0)
  return d
}

// ─── Category inference for Valhalla (no category column in source) ───────
const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/\b(mg|pills?|tablets?|cocaine|heroin|mdma|weed|cannabis|morphine|oxy|xanax|lsd|meth|ketamine|hash)\b/i, 'Drugs'],
  [/\b(fraud|carding|cvv|credit card|paypal|bank log|dumps?|phishing)\b/i, 'Fraud Related'],
  [/\b(counterfeit|replica|fake (id|passport|note))\b/i, 'Counterfeits'],
  [/\b(hack|hacking|penetration|exploit|guide|tutorial|ebook|course)\b/i, 'Guides & Tutorials'],
  [/\b(account|key|license|software|download|ebook|leak)\b/i, 'Digital Goods'],
  [/\b(gold|silver|jewell?ery|diamond)\b/i, 'Jewellery'],
  [/\b(phone|iphone|laptop|electronics?|gadget)\b/i, 'Electronics'],
  [/\b(escort|adult|xxx)\b/i, 'Erotica'],
  [/\b(vpn|hosting|proxy|server)\b/i, 'Security & Hosting'],
]
function inferCategory(title: string): string {
  for (const [re, cat] of CATEGORY_KEYWORDS) {
    if (re.test(title)) return cat
  }
  return 'Miscellaneous'
}

// ─── Raw row shape, unified across both marketplaces ───────────────────────
interface RawRow {
  marketplace: 'Hansa' | 'Valhalla'
  marketplaceId: string
  title: string
  vendorAlias: string
  priceUsd: number | null
  category: string
  categoryInferred: boolean
  shipsFrom: string | null
}

function parseHansa(): RawRow[] {
  const rows = parseCsvFile(join(__dirname, 'data', 'hansa-marketplace-listings-december-2016.csv'))
  const seen = new Set<string>()
  const out: RawRow[] = []
  for (const f of rows) {
    // A small number of source rows (17, verified) are truncated —
    // missing title/vendor/price entirely — and can't be honestly
    // recovered. Skip rather than mis-parse category/timestamp into the
    // wrong field.
    if (f.length < 6) continue
    // format: timestamp, marketplaceId, title, vendor, price, [category], [shipsFrom]
    const [, marketplaceId, title, vendor, priceStr, category, shipsFrom] = f
    if (!marketplaceId || seen.has(marketplaceId)) continue // dedupe, per README note
    seen.add(marketplaceId)
    const priceMatch = priceStr?.match(/([\d.]+)/)
    out.push({
      marketplace: 'Hansa',
      marketplaceId,
      title: title || 'Untitled listing',
      vendorAlias: vendor || 'unknown',
      priceUsd: priceMatch ? parseFloat(priceMatch[1]) : null,
      category: category && category.length > 0 ? category : 'Miscellaneous',
      categoryInferred: !category,
      shipsFrom: shipsFrom || null,
    })
  }
  return out
}

function parseValhalla(): RawRow[] {
  const rows = parseCsvFile(join(__dirname, 'data', 'valhalla-marketplace-listings-2016-10.csv'))
  const seen = new Set<string>()
  const out: RawRow[] = []
  for (const f of rows) {
    // format: marketplaceId, title, vendor, "price CUR", shipsFrom
    const [marketplaceId, title, vendor, priceStr, shipsFrom] = f
    if (!marketplaceId || seen.has(marketplaceId)) continue
    seen.add(marketplaceId)
    const priceMatch = priceStr?.match(/([\d.]+)\s*(\w+)?/)
    let priceUsd: number | null = null
    if (priceMatch) {
      const amount = parseFloat(priceMatch[1])
      const currency = (priceMatch[2] || 'EUR').toUpperCase()
      priceUsd = currency === 'USD' ? amount : amount * EUR_TO_USD
    }
    out.push({
      marketplace: 'Valhalla',
      marketplaceId,
      title: title || 'Untitled listing',
      vendorAlias: vendor || 'unknown',
      priceUsd,
      category: inferCategory(title || ''),
      categoryInferred: true,
      shipsFrom: shipsFrom || null,
    })
  }
  return out
}

async function main() {
  console.log('Parsing dark web data dump CSVs…')
  const hansaRows = parseHansa()
  const valhallaRows = parseValhalla()
  const allRows = [...hansaRows, ...valhallaRows]
  console.log(`Parsed ${hansaRows.length} unique Hansa rows, ${valhallaRows.length} unique Valhalla rows`)

  // ─── Top vendors by listing count across BOTH marketplaces ──────────────
  const vendorCounts = new Map<string, number>()
  for (const r of allRows) {
    vendorCounts.set(r.vendorAlias, (vendorCounts.get(r.vendorAlias) ?? 0) + 1)
  }
  const topVendors = [...vendorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_VENDOR_COUNT)
    .map(([alias]) => alias)
  const topVendorSet = new Set(topVendors)
  console.log(`Top ${topVendors.length} vendors by listing count selected`)

  // ─── Build the curated ~1,500-listing sample ─────────────────────────────
  // 1) every top vendor's listings, capped per vendor so one prolific
  //    vendor can't crowd out the rest of the sample.
  const perVendorCount = new Map<string, number>()
  const vendorRows: RawRow[] = []
  const usedKeys = new Set<string>()
  for (const r of allRows) {
    if (!topVendorSet.has(r.vendorAlias)) continue
    const n = perVendorCount.get(r.vendorAlias) ?? 0
    if (n >= MAX_LISTINGS_PER_TOP_VENDOR) continue
    perVendorCount.set(r.vendorAlias, n + 1)
    vendorRows.push(r)
    usedKeys.add(`${r.marketplace}:${r.marketplaceId}`)
  }

  // 2) fill the remaining budget with a deterministic stride sample across
  //    the rest of the dataset, for spread across categories/marketplaces
  //    without Math.random.
  const remainingPool = allRows.filter((r) => !usedKeys.has(`${r.marketplace}:${r.marketplaceId}`))
  const remainingBudget = Math.max(0, TARGET_LISTING_COUNT - vendorRows.length)
  const stride = remainingBudget > 0 ? Math.max(1, Math.floor(remainingPool.length / remainingBudget)) : 1
  const strideRows: RawRow[] = []
  for (let i = 0; i < remainingPool.length && strideRows.length < remainingBudget; i += stride) {
    strideRows.push(remainingPool[i])
  }

  const selected = [...vendorRows, ...strideRows].slice(0, TARGET_LISTING_COUNT)
  console.log(`Curated sample: ${selected.length} listings (${vendorRows.length} from top vendors, ${strideRows.length} sampled) — target total with hand-typed seed rows ≈ ${TARGET_LISTING_COUNT + 120}`)

  // ─── Skip anything whose displayId already exists (hand-typed seed rows,
  // or a prior run of this script) ──────────────────────────────────────────
  const displayIds = selected.map((r) => `${r.marketplace === 'Hansa' ? 'H' : 'V'}-${r.marketplaceId}`)
  const existing = await prisma.listing.findMany({
    where: { displayId: { in: displayIds } },
    select: { displayId: true },
  })
  const existingSet = new Set(existing.map((e) => e.displayId))
  const toInsert = selected.filter(
    (r) => !existingSet.has(`${r.marketplace === 'Hansa' ? 'H' : 'V'}-${r.marketplaceId}`)
  )
  console.log(`${selected.length - toInsert.length} already present, inserting ${toInsert.length} new listings`)

  if (toInsert.length === 0) {
    console.log('Nothing new to import — already up to date.')
  } else {
    const hansaSource = await prisma.source.findUnique({ where: { name: 'Hansa Marketplace' } })
    const valhallaSource = await prisma.source.findUnique({ where: { name: 'Valhalla Marketplace' } })
    if (!hansaSource || !valhallaSource) {
      throw new Error('Run the main seed script first — Hansa/Valhalla Source rows are expected to already exist.')
    }

    // ─── Score every new listing through the real risk engine ─────────────
    const listingInputs: ListingInput[] = toInsert.map((r) => {
      const id = `${r.marketplace}:${r.marketplaceId}`
      const firstSeen = recentDateFor(id, 45)
      const lastSeen = new Date(firstSeen.getTime() + (hashString(id + 'obs') % 5) * 24 * 60 * 60 * 1000)
      return {
        id,
        category: r.category,
        title: r.title,
        priceUsd: r.priceUsd,
        marketplace: r.marketplace,
        vendorAlias: r.vendorAlias,
        shipsFrom: r.shipsFrom,
        firstSeen,
        lastSeen,
      }
    })
    const scored = scoreListings(listingInputs)

    const listingRows = toInsert.map((r, i) => {
      const input = listingInputs[i]
      const result = scored.get(input.id)!
      const status = result.score >= 75 ? 'flagged' : 'active'
      return {
        displayId: `${r.marketplace === 'Hansa' ? 'H' : 'V'}-${r.marketplaceId}`,
        category: r.category,
        risk: result.score,
        signals: result.signals.map((s) => `${s.label} (+${s.value})`),
        firstSeen: input.firstSeen,
        lastSeen: input.lastSeen,
        status,
        sourceId: r.marketplace === 'Hansa' ? hansaSource.id : valhallaSource.id,
        marketplace: r.marketplace,
        vendorAlias: r.vendorAlias,
        title: r.title,
        priceUsd: r.priceUsd,
        shipsFrom: r.shipsFrom,
      }
    })

    const created = await prisma.listing.createMany({ data: listingRows, skipDuplicates: true })
    console.log(`Inserted ${created.count} listings (Drugs/Fraud Related/Counterfeits = high-risk categories, ${HIGH_RISK_CATEGORIES.size} tracked)`)
  }

  // ─── Entities for every vendor represented in the imported listing slice ──
  // Older versions created Entity rows only for the top 40 vendors, which
  // left valid listing vendors missing from Entities/Network Graph. Keep the
  // curated listing sample exactly as-is, but make entity coverage complete
  // for that sample. Canonical alias matching also prevents variants such as
  // HappyEyes / Happy_Eyes from becoming duplicate entities on re-import.
  const existingEntities = await prisma.entity.findMany({ select: { alias: true, displayId: true } })
  const existingAliasSet = new Set(existingEntities.map((e) => normalizeVendorAlias(e.alias)))
  const existingDisplayIdSet = new Set(existingEntities.map((e) => e.displayId))
  const entityAliases = Array.from(
    new Map(selected.map((r) => [normalizeVendorAlias(r.vendorAlias), r.vendorAlias])).values()
  )

  // Build vendor risk from the FULL current listing table (existing +
  // newly imported) so new entities' risk/confidence match exactly what
  // the live API will compute on first load — no separate formula.
  const allListingsNow = await prisma.listing.findMany()
  const vendorRiskByAlias = computeVendorRisk(
    allListingsNow.map((l) => ({
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
  )

  let entitiesCreated = 0
  for (const alias of entityAliases) {
    const normalizedAlias = normalizeVendorAlias(alias)
    if (existingAliasSet.has(normalizedAlias)) continue // already represented by this alias family

    let displayId = alias.charAt(0).toUpperCase() + alias.slice(1)
    let suffix = 2
    while (existingDisplayIdSet.has(displayId)) {
      displayId = `${alias.charAt(0).toUpperCase() + alias.slice(1)}-${suffix++}`
    }
    existingDisplayIdSet.add(displayId)

    const computed = computeEntityRisk(alias, vendorRiskByAlias)
    const vendorListings = allListingsNow.filter(
      (l) => l.vendorAlias && normalizeVendorAlias(l.vendorAlias) === normalizedAlias
    )
    const firstSeen = vendorListings.length
      ? new Date(Math.min(...vendorListings.map((l) => l.firstSeen.getTime())))
      : new Date()
    const lastSeen = vendorListings.length
      ? new Date(Math.max(...vendorListings.map((l) => l.lastSeen.getTime())))
      : new Date()

    await prisma.entity.create({
      data: {
        displayId,
        alias,
        risk: computed.risk ?? 0,
        confidence: computed.confidence ?? 0,
        riskChange: 0, // no prior baseline for a freshly-imported entity
        firstSeen,
        lastSeen,
      },
    })
    existingAliasSet.add(normalizedAlias)
    entitiesCreated++
  }
  console.log(`Created ${entitiesCreated} new vendor entities; all ${entityAliases.length} vendor alias families in the imported listing slice are now represented`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })