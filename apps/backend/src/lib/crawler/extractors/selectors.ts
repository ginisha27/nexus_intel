// src/lib/crawler/extractors/selectors.ts
//
// "Configured" extraction mode: the operator supplies exact CSS selectors
// instead of relying on the automatic heuristics in listings.ts. Useful
// when a site's markup is unusual enough that the heuristic misses it, or
// when the operator wants precise, repeatable fields rather than a
// best-guess. Selector syntax is documented in parseHelpers.ts
// (parseFieldSelector) — "css.selector" for text, "css.selector @attr"
// for an attribute.
//
// A bad/invalid selector from the operator must never crash the crawl —
// cheerio throws on some malformed selectors, so every lookup here is
// wrapped and degrades to a null field with the failure surfaced back to
// the caller as a warning, not a thrown error.
 
import type { CheerioAPI } from "cheerio";
import type { ConfiguredSelectors, ExtractedListing, FieldSelectorMap } from "../types.js";
import { parseFieldSelector, normalizeWhitespace } from "./parseHelpers.js";
 
export interface ConfiguredExtractionResult {
  fields: Record<string, string | null>;
  listings: ExtractedListing[];
  errors: string[];
}
 
const MAX_LIST_ITEMS = 50;
 
function readField($scope: ReturnType<CheerioAPI>, spec: string, errors: string[], label: string): string | null {
  try {
    const { selector, attr } = parseFieldSelector(spec);
    const found = $scope.find(selector).first();
    if (found.length === 0) return null;
    if (attr) {
      const v = found.attr(attr);
      return v != null ? v.trim() : null;
    }
    return normalizeWhitespace(found.text()) || null;
  } catch (err: any) {
    errors.push(`Field "${label}": invalid selector — ${err.message ?? String(err)}`);
    return null;
  }
}
 
function resolveMaybeUrl(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}
 
export function extractConfigured(
  $: CheerioAPI,
  pageUrl: string,
  config: ConfiguredSelectors
): ConfiguredExtractionResult {
  const errors: string[] = [];
  const $root = $.root();
 
  const fields: Record<string, string | null> = {};
  if (config.fields) {
    for (const [name, spec] of Object.entries(config.fields as FieldSelectorMap)) {
      fields[name] = readField($root, spec, errors, name);
    }
  }
 
  const listings: ExtractedListing[] = [];
  if (config.list?.container) {
    let items: ReturnType<CheerioAPI>;
    try {
      items = $(config.list.container);
    } catch (err: any) {
      errors.push(`List container selector invalid — ${err.message ?? String(err)}`);
      items = $();
    }
    items.slice(0, MAX_LIST_ITEMS).each((_, el) => {
      const $item = $(el);
      const itemFields: Record<string, string | null> = {};
      for (const [name, spec] of Object.entries(config.list!.fields ?? {})) {
        itemFields[name] = readField($item, spec, errors, `list.${name}`);
      }
      const title = itemFields.title ?? itemFields.name ?? null;
      const priceRaw = itemFields.price ?? null;
      const url = resolveMaybeUrl(itemFields.url ?? itemFields.link ?? null, pageUrl);
      const image = resolveMaybeUrl(itemFields.image ?? itemFields.img ?? null, pageUrl);
      if (!title && !priceRaw && !url && !image && Object.keys(itemFields).length === 0) return;
      listings.push({
        source: "configured",
        title,
        price: priceRaw,
        currency: itemFields.currency ?? null,
        url,
        image,
        raw: itemFields,
      });
    });
  }
 
  return { fields, listings, errors };
}
 
