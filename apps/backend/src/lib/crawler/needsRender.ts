// src/lib/crawler/needsRender.ts
//
// Heuristic used by renderMode "auto": given the HTML we already fetched
// statically, does this page look like its real content only shows up
// after JavaScript runs? Explainable signals, not a classifier — a
// near-empty <body>, a lone SPA root div, or a "please enable JavaScript"
// notice are all strong, well-known tells.

import type { CheerioAPI } from "cheerio";

const SPA_ROOT_IDS = ["root", "app", "__next", "___gatsby", "svelte", "__nuxt"];
const NOSCRIPT_HINT_PATTERN = /enable\s*javascript|javascript\s*is\s*(required|disabled)/i;
const MIN_TEXT_LENGTH_FOR_STATIC = 200;

export function needsRender($: CheerioAPI, bodyText: string): boolean {
  const trimmedText = bodyText.trim();

  if (NOSCRIPT_HINT_PATTERN.test($("noscript").text())) return true;

  if (trimmedText.length < MIN_TEXT_LENGTH_FOR_STATIC) {
    const bodyChildren = $("body").children();
    // Very little text AND the body is essentially a single empty mount
    // point (typical create-react-app / Vue / Next.js shell) is a strong
    // signal — plenty of short legitimate pages exist, so we also require
    // a recognizable SPA root id/class before triggering a render.
    const hasSpaRoot = SPA_ROOT_IDS.some((id) => $(`#${id}`).length > 0);
    if (hasSpaRoot && bodyChildren.length <= 3) return true;
    if (trimmedText.length < 40 && bodyChildren.length === 0) return true;
  }

  return false;
}