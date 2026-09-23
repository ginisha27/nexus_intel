// src/lib/crawler/types.ts
//
// Shared shapes passed between lib/webCrawler.ts and the extractor/render
// modules under lib/crawler/. Kept in one file so the orchestrator and
// each extractor agree on exactly what a "page" looks like without
// importing each other in a circle.

export type RenderMode = "static" | "javascript";
export type RenderPreference = "auto" | "always" | "never";
export type ExtractionMode = "automatic" | "configured";

// A single configured-mode field selector. Plain "h1" grabs that element's
// trimmed text; "img@src" (or any "@attr" suffix) grabs an attribute
// instead — the same convenient shorthand scrapers commonly use.
export type FieldSelectorMap = Record<string, string>;

export interface ConfiguredSelectors {
  // Page-level single-value fields, e.g. { title: "h1.product-title", price: ".price@data-value" }
  fields?: FieldSelectorMap;
  // Repeated-item extraction, e.g. every ".product-card" on the page,
  // with fields resolved relative to each matched item.
  list?: {
    container: string;
    fields: FieldSelectorMap;
  };
}

export interface OpenGraphData {
  og: Record<string, string>;
  twitter: Record<string, string>;
  description: string | null;
  canonical: string | null;
  title: string | null;
  siteName: string | null;
}

export interface ExtractedListing {
  source: "jsonld" | "heuristic" | "configured";
  title: string | null;
  price: string | null;
  currency: string | null;
  url: string | null;
  image: string | null;
  raw?: Record<string, unknown>;
}

export interface ExtractedTable {
  headers: string[];
  rows: string[][];
  truncated: boolean;
}

export interface StaticFetchResult {
  html: string;
  finalUrl: string;
  httpStatus: number;
  contentType: string;
  bytes: number;
}

export interface RenderResult {
  html: string;
  finalUrl: string;
  httpStatus: number;
  bytes: number;
}

export interface CrawlPageResult {
  url: string;
  ok: boolean;
  reason?: string; // set when ok=false (robots-blocked, fetch failed, SSRF-blocked, etc.)
  warning?: string; // set when ok=true but something degraded (e.g. JS render requested but unavailable)
  pageId?: string;
  title?: string | null;
  status?: string;
  suspicionScore?: number;
  imageCount?: number;
  listingCount?: number;
  tableCount?: number;
  hasJsonLd?: boolean;
  renderMode?: RenderMode;
  httpStatus?: number;
  fetchDurationMs?: number;
}