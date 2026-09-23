import { PrismaClient, SourceAccess, RiskLevel, Priority, InvestigationStatus, EvidenceStatus, AlertStatus, TxnDirection } from '@prisma/client'
import crypto from 'node:crypto'
import { syncGraphFromEntities } from '../src/lib/graphSync.js'

const prisma = new PrismaClient()
const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex').toUpperCase()

async function main() {
  console.log('Seeding NEXUS — Dark Web Threat Actor De-anonymization demo data…')

  // Clear demo intelligence while preserving users/sessions.
  await prisma.graphEdge.deleteMany()
  await prisma.graphNode.deleteMany()
  await prisma.investigationEvidence.deleteMany()
  await prisma.caseTimelineEvent.deleteMany()
  await prisma.aiAssessment.deleteMany()
  await prisma.investigationEntity.deleteMany()
  await prisma.investigationNoteRevision.deleteMany()
  await prisma.investigationNote.deleteMany()
  await prisma.evidenceRecord.deleteMany()
  await prisma.investigation.deleteMany()
  await prisma.alertEntity.deleteMany()
  await prisma.alert.deleteMany()
  await prisma.riskEvent.deleteMany()
  await prisma.walletTransaction.deleteMany()
  await prisma.wallet.deleteMany()
  await prisma.listing.deleteMany()
  await prisma.identifier.deleteMany()
  await prisma.entity.deleteMany()
  await prisma.networkRiskPoint.deleteMany()
  await prisma.network.deleteMany()
  await prisma.source.deleteMany()

  const [forum, marketplace, osint, infra] = await Promise.all([
    prisma.source.create({ data: { name: 'Forum-A / Synthetic Feed', type: 'dark_web_forum', access: SourceAccess.SYNTHETIC } }),
    prisma.source.create({ data: { name: 'Marketplace-B / Synthetic Feed', type: 'dark_web_market', access: SourceAccess.SYNTHETIC } }),
    prisma.source.create({ data: { name: 'Clearnet OSINT Feed', type: 'public_information', access: SourceAccess.PUBLIC } }),
    prisma.source.create({ data: { name: 'Infrastructure Correlation Feed', type: 'infrastructure_intelligence', access: SourceAccess.AUTHORIZED } }),
  ])

  const actors = [
    ['ACT-001','ShadowFox',84,91,['handle','ShadowFox'],['pgp','9F2A-71C4-88DE'],['wallet','WLT-8A31'],['forum_account','ForumA-ShadowFox']],
    ['ACT-002','NightCipher',77,86,['handle','NightCipher'],['pgp','1B73-CC91-4402'],['wallet','WLT-41D8'],['email','contact-17@synthetic.invalid']],
    ['ACT-003','GhostLedger',69,79,['handle','GhostLedger'],['pgp','7A91-D42E-1190'],['wallet','WLT-5F20'],['onion','dw-demo-7xk3.onion']],
    ['ACT-004','CipherWolf',61,74,['handle','CipherWolf'],['pgp','7A91-D42E-1190'],['wallet','WLT-5F20'],['forum_account','ForumB-CipherWolf']],
    ['ACT-005','BlackOrchid',55,68,['handle','BlackOrchid'],['pgp','33AC-9120-EE17'],['wallet','WLT-91BC'],['onion','orchid-demo.onion']],
    ['ACT-006','NullHarbor',48,63,['handle','NullHarbor'],['pgp','4D22-8A18-19F1'],['wallet','WLT-23C9'],['domain','demo-clearnet.example']],
    ['ACT-007','RedQuasar',43,58,['handle','RedQuasar'],['pgp','5C71-AC20-0B31'],['wallet','WLT-77E1'],['forum_account','ForumA-RedQ']],
    ['ACT-008','SilverMoth',37,54,['handle','SilverMoth'],['pgp','8E19-DA40-7741'],['wallet','WLT-61AA'],['email','moth-02@synthetic.invalid']],
  ] as const

  for (const [displayId, alias, risk, confidence, ...ids] of actors) {
    await prisma.entity.create({
      data: {
        displayId, alias, risk, confidence, riskChange: risk % 13 - 5,
        firstSeen: new Date('2026-06-01T00:00:00Z'), lastSeen: new Date('2026-09-22T00:00:00Z'),
        identifiers: { create: ids.map(([type, value]) => ({ type, value, confidence: Math.min(99, confidence + (type === 'pgp' ? 6 : 0)) })) },
      }
    })
  }

  const entities = await prisma.entity.findMany()

  const entityMap = new Map(entities.map(e => [e.displayId, e]))
  const actorMap = new Map(entities.map(e => [e.alias, e]))

  const infraDefs = [
    ['INF-001','ONION_SERVICE','dw-demo-7xk3.onion','ACT-003',91,forum.id],
    ['INF-002','TLS_CERTIFICATE','SHA256: 4A8E…C91D','ACT-005',84,infra.id],
    ['INF-003','CLEARNET_DOMAIN','demo-clearnet.example','ACT-006',76,osint.id],
    ['INF-004','SERVER_FINGERPRINT','nginx-demo-fp-17','ACT-005',72,infra.id],
    ['INF-005','TOR_DESCRIPTOR','descriptor-demo-04','ACT-001',68,forum.id],
  ] as const
  for (const [displayId,type,value,actor,confidence,sourceId] of infraDefs) {
    await prisma.infrastructureIndicator.create({ data: { displayId, type, value, confidence, sourceId, entityId: entityMap.get(actor)!.id, service: type === 'ONION_SERVICE' ? 'HTTPS' : null, metadata: { synthetic: true, correlation: 'passive_indicator' } } })
  }

  const personaDefs = [
    ['ACT-001',88,81,'22:00–03:00 UTC'],['ACT-003',83,86,'20:00–02:00 UTC'],['ACT-004',81,79,'20:00–02:00 UTC'],['ACT-006',61,70,'18:00–23:00 UTC'],
  ] as const
  for (const [actor,stylometry,behavior,window] of personaDefs) {
    await prisma.personaProfile.create({ data: { entityId: entityMap.get(actor)!.id, stylometricScore: stylometry, behavioralScore: behavior, activityWindow: window, commonPhrases: ['synthetic corpus','service update','new account'], migrationSignals: { handleReuse: true, temporalOverlap: behavior >= 80 } } })
  }

  for (const [actor,candidate,confidence,rationale] of [
    ['ACT-001','Candidate Entity A',84,['handle_reuse','pgp_correlation','behavioral_overlap']],
    ['ACT-003','Candidate Entity B',79,['wallet_reuse','pgp_correlation','temporal_overlap']],
    ['ACT-004','Candidate Entity B',74,['pgp_correlation','stylometry','forum_migration']],
    ['ACT-006','Candidate Entity C',63,['tls_certificate','domain_correlation']],
  ] as const) {
    await prisma.attributionLink.create({ data: { actorId: entityMap.get(actor)!.id, candidateLabel: candidate, confidence, rationale, evidenceSummary: 'Synthetic correlation record for academic demonstration.', status: 'CANDIDATE' } })
  }

  const records = [
    ['REC-001','Cross-source Persona Observation','ShadowFox','Forum profile observed with repeated alias and matching PGP fingerprint',['handle_reuse','pgp_match','temporal_overlap']],
    ['REC-002','PGP Identifier Discovery','NightCipher','PGP fingerprint associated with two synthetic source records',['pgp_fingerprint']],
    ['REC-003','Wallet Correlation','GhostLedger','Wallet WLT-5F20 also observed in CipherWolf record',['wallet_reuse','cross_actor_link']],
    ['REC-004','Infrastructure Indicator','BlackOrchid','Synthetic onion service shares certificate fingerprint with monitored infrastructure',['onion_service','tls_certificate']],
    ['REC-005','Persona Migration','CipherWolf','Writing-style features correlate with GhostLedger sample corpus',['stylometry','migration_pattern']],
    ['REC-006','Clearnet Correlation','NullHarbor','Synthetic TLS certificate metadata overlaps with a clearnet domain record',['certificate','domain_correlation']],
    ['REC-007','Behavioral Pattern','RedQuasar','Activity window and posting cadence overlap across two synthetic sources',['activity_window','temporal_correlation']],
    ['REC-008','Forum Identifier','SilverMoth','Forum account and email identifier observed in synthetic source',['forum_account','email_identifier']],
  ] as const

  for (const [displayId,title,actor,content,signals] of records) {
    const e = actorMap.get(actor)!
    await prisma.listing.create({
      data: {
        displayId, category: 'Threat Actor Intelligence', risk: e.risk, signals,
        firstSeen: new Date('2026-08-01T00:00:00Z'), lastSeen: new Date('2026-09-22T00:00:00Z'),
        status: 'Monitoring', sourceId: actor === 'NullHarbor' ? infra.id : forum.id,
        marketplace: actor === 'NullHarbor' ? 'Clearnet OSINT' : 'Dark Web Source',
        vendorAlias: actor, title, priceUsd: null, shipsFrom: null,
      }
    })
  }

  const walletDefs = [
    ['WLT-8A31',71,'Cluster-A'],['WLT-41D8',63,'Cluster-B'],['WLT-5F20',82,'Cluster-C'],['WLT-91BC',57,'Cluster-D'],
    ['WLT-23C9',46,'Cluster-E'],['WLT-77E1',39,'Cluster-F'],['WLT-61AA',31,'Cluster-G'],
  ] as const
  for (const [displayId,risk,cluster] of walletDefs) {
    await prisma.wallet.create({ data: { displayId, risk, cluster, txnCount: 4, entityCount: 1, totalVolume: 'synthetic', flagged: risk >= 70 } })
  }
  const wallets = await prisma.wallet.findMany()
  for (const w of wallets) {
    const actor = ['ACT-001','ACT-002','ACT-003','ACT-004','ACT-005','ACT-006','ACT-007'].find((_,i) => wallets[i]?.id === w.id)
    const entity = actor ? entityMap.get(actor) : undefined
    await prisma.walletTransaction.createMany({ data: [
      { walletId: w.id, entityId: entity?.id, direction: TxnDirection.INBOUND, amountBtcEq: 0.42, occurredAt: new Date('2026-09-10T21:00:00Z') },
      { walletId: w.id, entityId: entity?.id, direction: TxnDirection.OUTBOUND, amountBtcEq: 0.18, occurredAt: new Date('2026-09-18T01:30:00Z') },
    ] })
  }

  const network = await prisma.network.create({
    data: { displayId: 'NET-017', risk: 78, change: 9, status: RiskLevel.HIGH, lastActivity: new Date('2026-09-22T10:00:00Z'),
      entities: { connect: ['ACT-001','ACT-003','ACT-004','ACT-006'].map(id => ({ id: entityMap.get(id)!.id })) },
      riskPoints: { create: [32,41,49,61,70,78].map((score,i) => ({ label: `Day ${i+1}`, score, recordedAt: new Date(Date.UTC(2026,8,17+i)) })) }
    }
  })

  const alertDefs = [
    ['ALT-001',91,'PGP fingerprint cross-source match','The same synthetic PGP fingerprint was observed for GhostLedger and CipherWolf.','NEW'],
    ['ALT-002',84,'Wallet reuse correlation','WLT-5F20 is associated with two synthetic actor personas.','NEW'],
    ['ALT-003',76,'Infrastructure overlap detected','TLS certificate metadata overlaps between an onion-service record and clearnet OSINT sample.','REVIEWED'],
    ['ALT-004',68,'Persona migration candidate','Stylometric features show a high similarity between two synthetic text corpora.','NEW'],
  ] as const
  for (const [displayId,severity,title,reason,status] of alertDefs) {
    const alert = await prisma.alert.create({ data: { displayId, severity, title, reason, status: status as AlertStatus, networkId: network.id } })
    const actorIds = displayId === 'ALT-001' ? ['ACT-003','ACT-004'] : displayId === 'ALT-002' ? ['ACT-003','ACT-004'] : displayId === 'ALT-003' ? ['ACT-005','ACT-006'] : ['ACT-001','ACT-004']
    await prisma.alertEntity.createMany({ data: actorIds.map(id => ({ alertId: alert.id, entityId: entityMap.get(id)!.id })) })
  }

  const inv = await prisma.investigation.create({
    data: { displayId: 'INV-2026-017', title: 'ShadowFox persona de-anonymization', description: 'Synthetic demonstration case combining identifiers, infrastructure, stylometry and behavioral evidence.', status: InvestigationStatus.UNDER_REVIEW, priority: Priority.HIGH, assignee: 'Investigator A', networkId: network.id,
      entities: { create: ['ACT-001','ACT-003','ACT-004'].map(id => ({ entityId: entityMap.get(id)!.id })) },
      timeline: { create: [
        { occurredAt: new Date('2026-09-12T10:00:00Z'), label: 'Identifier observed', type: 'DETECTION', source: 'Forum-A', agent: 'System', description: 'ShadowFox handle observed in synthetic forum corpus.' },
        { occurredAt: new Date('2026-09-15T12:00:00Z'), label: 'PGP correlation', type: 'DISCOVERY', source: 'Forum-A', agent: 'System', description: 'PGP fingerprint matched a second persona.' },
        { occurredAt: new Date('2026-09-18T08:00:00Z'), label: 'Infrastructure correlation', type: 'DISCOVERY', source: 'Infrastructure Feed', agent: 'System', description: 'Certificate metadata overlap identified.' },
      ] }
    }
  })

  await prisma.evidenceRecord.createMany({ data: [
    { displayId:'EV-001', type:'PGP Fingerprint', notes:'Synthetic fingerprint match used for demonstration.', hash:hash('PGP 7A91-D42E-1190'), uploadedBy:'System', status:EvidenceStatus.VERIFIED, sourceId:forum.id, investigationId:inv.id },
    { displayId:'EV-002', type:'Wallet Correlation', notes:'Synthetic wallet reuse relationship.', hash:hash('Wallet WLT-5F20'), uploadedBy:'System', status:EvidenceStatus.VERIFIED, sourceId:marketplace.id, investigationId:inv.id },
    { displayId:'EV-003', type:'Stylometry Sample', notes:'Synthetic text corpus for persona similarity demo.', hash:hash('Stylometry GhostLedger CipherWolf'), uploadedBy:'System', status:EvidenceStatus.PENDING, sourceId:forum.id, investigationId:inv.id },
  ] })

  await syncGraphFromEntities(prisma)
  console.log('Seed complete: 8 synthetic actors, identifiers, wallets, infrastructure records, alerts and investigation evidence.')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
