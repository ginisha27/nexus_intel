-- Adds image-forensics metadata and OCR-text suspicion/sentiment analysis
-- to uploaded evidence.
--
-- EvidenceRecord.imageMetadata: EXIF/GPS/dimension metadata extracted from
-- the uploaded image (see lib/imageMetadata.ts). Computed against the same
-- decoded image bytes that ocrText and the SHA-256 hash are computed from.
--
-- EvidenceRecord.ocrSentiment: deterministic suspicion score + AFINN
-- sentiment (plus an optional LLM explanation) computed from ocrText (see
-- lib/ocrSentiment.ts). Both are best-effort, best-effort enrichment —
-- never required for an evidence record to exist.
ALTER TABLE "EvidenceRecord" ADD COLUMN "imageMetadata" JSONB;
ALTER TABLE "EvidenceRecord" ADD COLUMN "ocrSentiment" JSONB;
