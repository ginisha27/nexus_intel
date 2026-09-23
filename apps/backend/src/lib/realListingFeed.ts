// Synthetic/authorized intelligence producer feed for the threat-actor demo.
// The original marketplace CSV feed has intentionally been removed from this
// distribution so the project is centered on attribution intelligence.
import { prisma } from './prisma.js'
import { normalizeVendorAlias } from './entityCorrelation.js'

export interface RealListingCandidate {
  displayId: string
  marketplace: string
  title: string
  vendorAlias: string
  priceUsd: number | null
  category: string
  categoryInferred: boolean
  shipsFrom: string | null
  entityDisplayId: string
  networkDisplayId: string | null
}

const FEED: Omit<RealListingCandidate,'entityDisplayId'|'networkDisplayId'>[] = [
  { displayId:'LIVE-001', marketplace:'Forum-A / Synthetic Feed', title:'Handle reuse observation', vendorAlias:'ShadowFox', priceUsd:null, category:'Handle Correlation', categoryInferred:false, shipsFrom:null },
  { displayId:'LIVE-002', marketplace:'Forum-A / Synthetic Feed', title:'PGP fingerprint observation', vendorAlias:'GhostLedger', priceUsd:null, category:'PGP Correlation', categoryInferred:false, shipsFrom:null },
  { displayId:'LIVE-003', marketplace:'Infrastructure Correlation Feed', title:'TLS certificate overlap', vendorAlias:'NullHarbor', priceUsd:null, category:'Infrastructure Correlation', categoryInferred:false, shipsFrom:null },
  { displayId:'LIVE-004', marketplace:'Forum-A / Synthetic Feed', title:'Persona migration candidate', vendorAlias:'CipherWolf', priceUsd:null, category:'Persona Analysis', categoryInferred:false, shipsFrom:null },
  { displayId:'LIVE-005', marketplace:'Clearnet OSINT Feed', title:'Domain and certificate correlation', vendorAlias:'BlackOrchid', priceUsd:null, category:'Clearnet Correlation', categoryInferred:false, shipsFrom:null },
]

export async function getNextRealListings(count: number): Promise<RealListingCandidate[]> {
  const [existing, entities] = await Promise.all([
    prisma.listing.findMany({ select:{ displayId:true } }),
    prisma.entity.findMany({ include:{ network:true } }),
  ])
  const seen = new Set(existing.map(x=>x.displayId))
  const byAlias = new Map(entities.map(e=>[normalizeVendorAlias(e.alias),e]))
  const out: RealListingCandidate[] = []
  for (const row of FEED) {
    if (out.length >= count || seen.has(row.displayId)) continue
    const entity = byAlias.get(normalizeVendorAlias(row.vendorAlias))
    if (!entity) continue
    out.push({ ...row, entityDisplayId:entity.displayId, networkDisplayId:entity.network?.displayId ?? null })
  }
  return out
}

export async function resolveSourceIdForMarketplace(name: string): Promise<string | null> {
  const source = await prisma.source.findUnique({ where:{ name } })
  return source?.id ?? null
}
