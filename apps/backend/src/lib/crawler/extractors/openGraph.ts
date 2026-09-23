// src/lib/crawler/extractors/openGraph.ts
//
// Reads OpenGraph (og:*), Twitter Card (twitter:*), the standard meta
// description, and the canonical link — the same tags social previews and
// search engines read. Cheap, reliable, present on the overwhelming
// majority of real-world pages (unlike JSON-LD, which is common but not
// universal), so this runs unconditionally as part of automatic extraction.

import type { CheerioAPI } from "cheerio";
import type { OpenGraphData } from "../types.js";

export function extractOpenGraph($: CheerioAPI, pageUrl: string): OpenGraphData {
  const og: Record<string, string> = {};
  const twitter: Record<string, string> = {};

  $("meta[property]").each((_, el) => {
    const prop = $(el).attr("property")?.trim().toLowerCase();
    const content = $(el).attr("content");
    if (prop?.startsWith("og:") && content) og[prop.slice(3)] = content;
  });
  $("meta[name]").each((_, el) => {
    const name = $(el).attr("name")?.trim().toLowerCase();
    const content = $(el).attr("content");
    if (name?.startsWith("twitter:") && content) twitter[name.slice(8)] = content;
  });

  const description = $('meta[name="description"]').first().attr("content")?.trim() || null;

  let canonical: string | null = null;
  const canonicalHref = $('link[rel="canonical"]').first().attr("href");
  if (canonicalHref) {
    try {
      canonical = new URL(canonicalHref, pageUrl).toString();
    } catch {
      canonical = canonicalHref;
    }
  }

  return {
    og,
    twitter,
    description,
    canonical,
    title: og.title || $("title").first().text().trim() || null,
    siteName: og.site_name || null,
  };
}