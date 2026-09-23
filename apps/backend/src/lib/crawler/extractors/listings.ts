// src/lib/crawler/extractors/listings.ts
//
// "Automatic" listing/table extraction — no operator-supplied selectors.
// Two independent sources, both explainable (no ML classifier, same
// philosophy as textSuspicionEngine.ts):
//
//   1. JSON-LD Product entries (extractors/jsonld.ts) — the reliable
//      source when present.
//   2. A structural heuristic: find groups of >=3 sibling elements that
//      share a tag+class signature (a "card" repeated in a grid/list) and
//      that contain price-looking text. This catches the common
//      marketplace-listing-grid pattern without needing to know the
//      site's specific class names ahead of time.
//
// Tables are extracted separately and far more simply: any <table> with a
// header row and at least one data row, capped so a huge data table
// doesn't blow up storage or the response payload.

import type { CheerioAPI } from "cheerio";
import type { ExtractedListing, ExtractedTable } from "../types.js";
import { parsePrice, looksLikePrice, normalizeWhitespace } from "./parseHelpers.js";
import { findProductEntries } from "./jsonld.js";

const MAX_LISTINGS = 20;
const MAX_TABLES = 5;
const MAX_TABLE_ROWS = 25;
const MAX_TABLE_COLS = 12;
const MIN_CARD_GROUP_SIZE = 3;

export function listingsFromJsonLd(jsonLdBlocks: unknown[], pageUrl: string): ExtractedListing[] {
  const products = findProductEntries(jsonLdBlocks);
  const out: ExtractedListing[] = [];
  for (const p of products.slice(0, MAX_LISTINGS)) {
    const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
    const image = Array.isArray(p.image) ? p.image[0] : p.image;
    let url: string | null = null;
    if (typeof p.url === "string") {
      try {
        url = new URL(p.url, pageUrl).toString();
      } catch {
        url = p.url;
      }
    }
    out.push({
      source: "jsonld",
      title: typeof p.name === "string" ? p.name : null,
      price: offer?.price != null ? String(offer.price) : null,
      currency: offer?.priceCurrency ?? null,
      url,
      image: typeof image === "string" ? image : null,
      raw: { "@type": p["@type"], sku: p.sku, brand: p.brand },
    });
  }
  return out;
}

// Cheap structural "signature" for grouping candidate cards: tag name +
// sorted class list. Two elements with the same signature under the same
// parent are treated as repeats of the same card template.
function signatureOf($: CheerioAPI, el: any): string {
  const $el = $(el);
  const tag = (el as any).tagName ?? "";
  const classes = ($el.attr("class") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(".");
  return `${tag}.${classes}`;
}

export function listingsFromHeuristic($: CheerioAPI, pageUrl: string): ExtractedListing[] {
  // Group every element that has a class attribute by (parent, signature).
  // Parent identity is tracked with a WeakMap-assigned incrementing id
  // rather than any cheerio/domhandler internal field, so this doesn't
  // depend on implementation details that vary across cheerio versions.
  const parentIds = new WeakMap<object, number>();
  let nextParentId = 0;
  const idForParent = (parentNode: object | null): number => {
    if (!parentNode) return -1;
    let id = parentIds.get(parentNode);
    if (id === undefined) {
      id = nextParentId++;
      parentIds.set(parentNode, id);
    }
    return id;
  };

  const groups = new Map<string, ReturnType<CheerioAPI>[]>();
  $("body *[class]").each((_, el) => {
    const $el = $(el);
    const sig = signatureOf($, el);
    if (!sig || sig === ".") return;
    const parentNode = $el.parent().get(0) ?? null;
    const key = `${idForParent(parentNode)}::${sig}`;
    const list = groups.get(key) ?? [];
    list.push($el as any);
    groups.set(key, list);
  });

  const candidateGroups = [...groups.values()].filter((g) => g.length >= MIN_CARD_GROUP_SIZE);

  const out: ExtractedListing[] = [];
  for (const group of candidateGroups) {
    if (out.length >= MAX_LISTINGS) break;
    // Only treat this group as "listings" if at least half its members
    // contain price-looking text — otherwise it's probably nav items,
    // footer links, or some other repeated-but-not-a-product structure.
    const withPrice = group.filter((g) => looksLikePrice(normalizeWhitespace(g.text())));
    if (withPrice.length < Math.max(MIN_CARD_GROUP_SIZE, Math.ceil(group.length / 2))) continue;

    for (const $card of group) {
      if (out.length >= MAX_LISTINGS) break;
      const text = normalizeWhitespace($card.text());
      const { amount: price, currency } = parsePrice(text);
      if (!price) continue;

      const titleEl = $card.find("h1,h2,h3,h4,a").filter((_, e) => normalizeWhitespace($(e).text()).length > 2).first();
      const title = titleEl.length ? normalizeWhitespace(titleEl.text()).slice(0, 200) : null;

      const linkHref = $card.find("a[href]").first().attr("href") ?? ($card.is("a") ? $card.attr("href") : undefined);
      let url: string | null = null;
      if (linkHref) {
        try {
          url = new URL(linkHref, pageUrl).toString();
        } catch {
          url = null;
        }
      }

      const imgSrc = $card.find("img[src]").first().attr("src");
      let image: string | null = null;
      if (imgSrc) {
        try {
          image = new URL(imgSrc, pageUrl).toString();
        } catch {
          image = null;
        }
      }

      if (!title && !url && !image) continue; // pure noise — nothing usable was found besides a price
      out.push({ source: "heuristic", title, price: String(price), currency, url, image });
    }
  }
  return out;
}

/** Merges JSON-LD-derived and heuristic-derived listings, preferring JSON-LD and dropping obvious duplicates (same title+price). */
export function mergeListings(jsonLd: ExtractedListing[], heuristic: ExtractedListing[]): ExtractedListing[] {
  const seen = new Set(jsonLd.map((l) => `${l.title ?? ""}::${l.price ?? ""}`));
  const merged = [...jsonLd];
  for (const h of heuristic) {
    const key = `${h.title ?? ""}::${h.price ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(h);
    if (merged.length >= MAX_LISTINGS) break;
  }
  return merged.slice(0, MAX_LISTINGS);
}

export function extractTables($: CheerioAPI): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  $("table").each((_, tableEl) => {
    if (tables.length >= MAX_TABLES) return false;
    const $table = $(tableEl);
    const rows = $table.find("tr").toArray();
    if (rows.length < 2) return;

    const headerCells = $(rows[0]).find("th,td").toArray();
    const headers = headerCells.slice(0, MAX_TABLE_COLS).map((c) => normalizeWhitespace($(c).text()));
    if (headers.every((h) => !h)) return;

    const bodyRows = rows.slice(1, 1 + MAX_TABLE_ROWS).map((r) =>
      $(r)
        .find("td,th")
        .toArray()
        .slice(0, MAX_TABLE_COLS)
        .map((c) => normalizeWhitespace($(c).text()))
    );
    const dataRows = bodyRows.filter((r) => r.some((cell) => cell.length > 0));
    if (dataRows.length === 0) return;

    tables.push({ headers, rows: dataRows, truncated: rows.length - 1 > MAX_TABLE_ROWS });
  });
  return tables;
}