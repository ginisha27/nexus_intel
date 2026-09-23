-- Join table for attaching an EXISTING EvidenceRecord to an (additional)
-- Investigation, without moving it out of its original/home investigation
-- (EvidenceRecord.investigationId) and without creating a new
-- EvidenceRecord. Backs POST /api/investigations/:displayId/evidence
-- ({ evidenceIds }) from the Investigation Workspace's "Attach Existing
-- Evidence" picker. Deleting a row here (via
-- DELETE /api/investigations/:displayId/evidence/:evidenceId) only removes
-- the attachment — the underlying EvidenceRecord is untouched.
CREATE TABLE "InvestigationEvidence" (
    "investigationId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestigationEvidence_pkey" PRIMARY KEY ("investigationId","evidenceId")
);

-- AddForeignKey
ALTER TABLE "InvestigationEvidence" ADD CONSTRAINT "InvestigationEvidence_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationEvidence" ADD CONSTRAINT "InvestigationEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;