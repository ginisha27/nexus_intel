-- Threat actor de-anonymization intelligence tables
CREATE TABLE "InfrastructureIndicator" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "displayId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "service" TEXT,
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "sourceId" TEXT,
  "entityId" TEXT
);
CREATE UNIQUE INDEX "InfrastructureIndicator_displayId_key" ON "InfrastructureIndicator"("displayId");
CREATE TABLE "PersonaProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "entityId" TEXT NOT NULL,
  "stylometricScore" INTEGER NOT NULL DEFAULT 0,
  "behavioralScore" INTEGER NOT NULL DEFAULT 0,
  "commonPhrases" JSONB,
  "activityWindow" TEXT,
  "migrationSignals" JSONB,
  "lastAnalyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PersonaProfile_entityId_key" ON "PersonaProfile"("entityId");
CREATE TABLE "AttributionLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorId" TEXT NOT NULL,
  "candidateLabel" TEXT NOT NULL,
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "rationale" JSONB,
  "evidenceSummary" TEXT,
  "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AttributionLink_actorId_idx" ON "AttributionLink"("actorId");
ALTER TABLE "InfrastructureIndicator" ADD CONSTRAINT "InfrastructureIndicator_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InfrastructureIndicator" ADD CONSTRAINT "InfrastructureIndicator_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonaProfile" ADD CONSTRAINT "PersonaProfile_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttributionLink" ADD CONSTRAINT "AttributionLink_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
