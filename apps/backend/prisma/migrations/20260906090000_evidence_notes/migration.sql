-- Adds a notes column so evidence added from the investigation workspace
-- (POST /api/investigations/:displayId/evidence) actually persists the
-- context/source text the investigator types, instead of it being silently
-- discarded (previously accepted in the request body but never written).
ALTER TABLE "EvidenceRecord" ADD COLUMN "notes" TEXT;
