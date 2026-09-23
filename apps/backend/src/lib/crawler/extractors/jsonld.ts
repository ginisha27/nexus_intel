// src/lib/crawler/extractors/jsonld.ts
//
// Pulls every <script type="application/ld+json"> block off the page.
// Sites embed this for SEO (schema.org Product/Offer/Article/etc.) and it
// is, when present, the single most reliable structured-data source on a
// page — far more trustworthy than guessing from CSS class names, because
// it's meant to be machine-read. A block can be a single object, an
// array, or (rarely) malformed — each is handled without letting one bad
// block take down extraction for the rest of the page.

import type { CheerioAPI } from "cheerio";

const MAX_BLOCKS = 10;
const MAX_SERIALIZED_BYTES = 60 * 1024; // cap what we persist per page

export function extractJsonLd($: CheerioAPI): unknown[] {
  const blocks: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    if (blocks.length >= MAX_BLOCKS) return false;
    const raw = $(el).contents().text();
    if (!raw || !raw.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (blocks.length < MAX_BLOCKS) blocks.push(item);
        }
      } else {
        blocks.push(parsed);
      }
    } catch {
      // Malformed JSON-LD is common (trailing commas, HTML-escaped
      // quotes) — skip this one block rather than failing the whole crawl.
    }
  });
  return blocks;
}

/** Caps the serialized size of extracted JSON-LD before it's persisted. */
export function capJsonLdForStorage(blocks: unknown[]): { data: unknown[]; truncated: boolean } {
  let serialized = JSON.stringify(blocks);
  if (Buffer.byteLength(serialized) <= MAX_SERIALIZED_BYTES) {
    return { data: blocks, truncated: false };
  }
  const kept: unknown[] = [];
  for (const block of blocks) {
    const candidate = [...kept, block];
    if (Buffer.byteLength(JSON.stringify(candidate)) > MAX_SERIALIZED_BYTES) break;
    kept.push(block);
  }
  return { data: kept, truncated: true };
}

function flattenType(t: unknown): string[] {
  if (!t) return [];
  if (Array.isArray(t)) return t.map(String);
  return [String(t)];
}

/** Finds schema.org Product-ish entries anywhere in the parsed JSON-LD graph (including @graph arrays and ItemList members). */
export function findProductEntries(blocks: unknown[]): Record<string, any>[] {
  const found: Record<string, any>[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    const obj = node as Record<string, any>;
    const types = flattenType(obj["@type"]);
    if (types.some((t) => /product/i.test(t))) found.push(obj);
    if (obj["@graph"]) visit(obj["@graph"]);
    if (obj.itemListElement) visit(obj.itemListElement);
    if (obj.item) visit(obj.item);
  };
  for (const b of blocks) visit(b);
  return found;
}