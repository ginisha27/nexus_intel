// src/lib/ocr.ts
//
// Local, free OCR via tesseract.js (pure JS/WASM — no system tesseract
// binary needed, so nothing to add to the Docker image). Used in two
// places:
//   1. routes/misc.ts's POST /api/evidence — when the uploaded evidence is
//      an image, extract its text into EvidenceRecord.ocrText.
//   2. lib/crawlerListingFeed.ts — when a crawled listing page has an
//      associated image, extract its text into Listing.ocrText.
//
// A single worker is created lazily and reused across calls (spinning one
// up per call is slow — worker init loads the language model). The worker
// is intentionally never terminated during the process lifetime; it's
// cheap to keep warm for a long-running server.

import { createWorker, type Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng");
  }
  return workerPromise;
}

export interface OcrResult {
  text: string;
  confidence: number; // 0-100, tesseract's mean confidence across recognized words
}

/**
 * Runs OCR on image bytes (any format tesseract.js/its decoder supports —
 * png, jpg, webp, bmp, gif). Returns null on failure instead of throwing:
 * OCR is a best-effort enrichment, and a bad/corrupt image must never take
 * down evidence upload or listing ingestion.
 */
export async function extractTextFromImage(imageBuffer: Buffer): Promise<OcrResult | null> {
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(imageBuffer);
    const text = data.text?.trim() ?? "";
    if (!text) return null;
    return { text, confidence: data.confidence ?? 0 };
  } catch (err) {
    console.error("[ocr] recognition failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Fetches an image URL and runs OCR on it. Returns null on any failure. */
export async function extractTextFromImageUrl(url: string): Promise<OcrResult | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[ocr] image fetch failed: ${url} -> ${res.status}`);
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      console.error(`[ocr] not an image (content-type: ${contentType}): ${url}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    return extractTextFromImage(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error(`[ocr] failed to fetch/process ${url}:`, err instanceof Error ? err.message : err);
    return null;
  }
}