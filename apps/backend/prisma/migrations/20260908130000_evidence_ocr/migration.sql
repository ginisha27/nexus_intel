-- Adds OCR support for uploaded evidence images.
--
-- EvidenceRecord.ocrText: populated when evidence uploaded via
-- POST /api/evidence includes an image (new imageBase64 field). The
-- existing `hash` column keeps being computed over the raw submitted
-- bytes either way — ocrText is a separate, best-effort searchable
-- derivative, never treated as the evidence itself.
ALTER TABLE "EvidenceRecord" ADD COLUMN "ocrText" TEXT;