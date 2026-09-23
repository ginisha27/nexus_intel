# NEXUS transformation — Dark Web Threat Actor De-anonymization

This version has been refocused from a marketplace/drug-monitoring demo into the supplied **Dark web threat actor de-anonymization** problem statement.

## What changed

- `Entity` is presented as a **Threat Actor**.
- Marketplace/listing language in the main UI is presented as **Dark Web Intelligence**.
- Added **Attribution Analysis** screen.
- Added **Infrastructure Intelligence** screen.
- Added database models for `InfrastructureIndicator`, `PersonaProfile`, and `AttributionLink`.
- Added `/api/infrastructure` and `/api/attribution` endpoints.
- Seed data now uses synthetic actor aliases, PGP fingerprints, wallet IDs, onion-service indicators, TLS/certificate indicators, stylometry/behavioral scores, attribution candidates, alerts, evidence and an investigation.
- Relationship graph remains backed by the existing entity/wallet relationships.
- Existing investigation/evidence/report/audit capabilities are retained.

## Mapping to the problem statement

| Problem statement requirement | NEXUS implementation |
|---|---|
| Continuous footprint collection | Existing ingestion/scraper pipeline + intelligence records |
| Tor hidden-service indicators | Infrastructure Intelligence + `InfrastructureIndicator` |
| Clearnet correlation | Clearnet domain / TLS certificate indicator records |
| Handles / PGP / wallets | Existing `Identifier` + `Wallet` models |
| Cross-marketplace/source actor mapping | Entity correlation + Relationship Graph |
| Stylometric persona identification | `PersonaProfile.stylometricScore` + Attribution Analysis |
| Behavioral profiling | `PersonaProfile.behavioralScore`, activity window and migration signals |
| Attribution confidence | `AttributionLink.confidence` |
| Evidence-backed investigations | Existing Investigation + Evidence modules |
| Timeline querying | Existing case timeline and dashboard timeline |
| CSV / JSON / report export | Existing Reports module |

## Demo-data note

The new seed deliberately uses **synthetic/authorized records**. It does not exploit Tor services, deanonymize real individuals, or provide operational instructions for compromising infrastructure.
