// src/routes/scrape.ts
//
// POST /api/scrape   { url: string }
// Fetches the target page and returns structured raw data:
// title, meta tags, headings, paragraphs, links, and table data.
//
// SECURITY NOTE: this endpoint makes a server-side request to a
// user-supplied URL, which is a classic SSRF vector if left unrestricted —
// someone could point it at localhost, an internal service, or a cloud
// metadata endpoint (169.254.169.254) and read the response back through
// this route. assertPublicHost() below blocks loopback / private / link-
// local / metadata targets, both on the initial URL and after any
// redirect. If this endpoint is only ever reachable by fully trusted
// internal users, you can relax this — but it's on by default.

import { Router } from "express";
import * as cheerio from "cheerio";
import dns from "node:dns/promises";
import net from "node:net";
import { asyncHandler } from "../lib/asyncHandler.js";
import { extractTextFromImageUrl } from "../lib/ocr.js";
import { analyzeOcrText, type OcrTextAnalysis } from "../lib/ocrSentiment.js";
import { DEFAULT_MODEL, type SupportedModel } from "../lib/llmClient.js";

export const scrapeRouter = Router();

// Max number of images we run OCR + sentiment on per scrape. OCR is the
// slow step (Tesseract WASM), so this is capped hard to keep a hackathon
// demo responsive — raise it if you have time budget to spare.
const MAX_IMAGE_ANALYSIS = 5;

interface ScrapeResult {
  url: string;
  fetchedAt: string;
  title: string | null;
  meta: Record<string, string>;
  headings: { level: string; text: string }[];
  paragraphs: string[];
  links: { text: string; href: string }[];
  tables: { headers: string[]; rows: string[][] }[];
  images: { alt: string; src: string; ocrText?: string; sentiment?: OcrTextAnalysis | null }[];
  wordCount: number;
  rawTextPreview: string;
  /** LLM sentiment analysis of the page's own text content. */
  textSentiment: OcrTextAnalysis | null;
}

// ── SSRF guard ──────────────────────────────────────────────────────────
// Resolves the hostname and rejects anything pointing at loopback,
// private (RFC1918), link-local, or cloud metadata address space.
function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 0) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (hostname === "localhost") throw new Error("Target host is not allowed");
  const records = await dns.lookup(hostname, { all: true });
  for (const { address } of records) {
    if (isBlockedIp(address)) throw new Error("Target host resolves to a blocked address");
  }
}

// POST /api/scrape
// Body: { url: string }
scrapeRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { url, model } = req.body as { url?: string; model?: SupportedModel };
    const llmModel: SupportedModel = model ?? DEFAULT_MODEL;

    if (!url || !url.trim()) {
      return res.status(400).json({ error: "url is required" });
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(url.trim());
    } catch {
      return res.status(400).json({ error: "Invalid URL — must include protocol (e.g. https://)" });
    }

    if (!["http:", "https:"].includes(targetUrl.protocol)) {
      return res.status(400).json({ error: "Only http and https URLs are supported" });
    }

    try {
      await assertPublicHost(targetUrl.hostname);
    } catch (err: any) {
      return res.status(400).json({ error: err?.message ?? "Target host is not allowed" });
    }

    // Fetch the target page with a browser-like UA so sites don't block us.
    // redirect: "manual" so we can re-validate the host before following —
    // otherwise a public URL could 302 to an internal address and bypass
    // the check above.
    let html: string;
    try {
      let currentUrl = targetUrl;
      let response: Response;
      let hops = 0;

      while (true) {
        response = await fetch(currentUrl.toString(), {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; NexusIntelScraper/1.0; +https://nexus-intel.local)",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(15_000), // 15 s hard timeout
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (++hops > 5) {
            return res.status(502).json({ error: "Too many redirects" });
          }
          const location = response.headers.get("location");
          if (!location) {
            return res.status(502).json({ error: "Redirect with no Location header" });
          }
          currentUrl = new URL(location, currentUrl);
          if (!["http:", "https:"].includes(currentUrl.protocol)) {
            return res.status(400).json({ error: "Redirected to an unsupported protocol" });
          }
          await assertPublicHost(currentUrl.hostname);
          continue;
        }
        break;
      }

      targetUrl = currentUrl;

      if (!response.ok) {
        return res.status(502).json({
          error: `Target site returned HTTP ${response.status} ${response.statusText}`,
        });
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        return res.status(415).json({
          error: `Target URL returned non-HTML content (${contentType}). Only HTML pages are supported.`,
        });
      }

      html = await response.text();
    } catch (err: any) {
      if (err?.name === "TimeoutError") {
        return res.status(504).json({ error: "Request timed out after 15 s" });
      }
      return res.status(502).json({ error: `Could not reach ${targetUrl.host}: ${err?.message ?? err}` });
    }

    // Parse with Cheerio
    const $ = cheerio.load(html);

    // Remove noise: scripts, styles, nav, footer, hidden elements
    $("script, style, noscript, [hidden], [aria-hidden='true']").remove();

    // ── Title ──────────────────────────────────────────────────────────
    const title = $("title").first().text().trim() || null;

    // ── Meta tags ──────────────────────────────────────────────────────
    const meta: Record<string, string> = {};
    $("meta").each((_, el) => {
      const name =
        $(el).attr("name") ||
        $(el).attr("property") ||
        $(el).attr("http-equiv");
      const content = $(el).attr("content");
      if (name && content) meta[name] = content;
    });

    // ── Headings ───────────────────────────────────────────────────────
    const headings: { level: string; text: string }[] = [];
    $("h1, h2, h3, h4, h5, h6").each((_, el) => {
      const text = $(el).text().trim();
      if (text) headings.push({ level: el.tagName.toUpperCase(), text });
    });

    // ── Paragraphs (first 50 non-empty) ───────────────────────────────
    const paragraphs: string[] = [];
    $("p").each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 20 && paragraphs.length < 50) paragraphs.push(text);
    });

    // ── Links (first 100 unique hrefs) ────────────────────────────────
    const seenHrefs = new Set<string>();
    const links: { text: string; href: string }[] = [];
    $("a[href]").each((_, el) => {
      const raw = $(el).attr("href") ?? "";
      let href: string;
      try {
        href = new URL(raw, targetUrl.toString()).toString();
      } catch {
        return; // skip malformed
      }
      if (!seenHrefs.has(href) && links.length < 100) {
        seenHrefs.add(href);
        links.push({ text: $(el).text().trim().slice(0, 120), href });
      }
    });

    // ── Tables ────────────────────────────────────────────────────────
    const tables: { headers: string[]; rows: string[][] }[] = [];
    $("table").each((_, table) => {
      const headers: string[] = [];
      $(table)
        .find("thead th, thead td")
        .each((_, th) => {
          headers.push($(th).text().trim());
        });

      const rows: string[][] = [];
      $(table)
        .find("tbody tr")
        .each((_, tr) => {
          const cells: string[] = [];
          $(tr)
            .find("td, th")
            .each((_, td) => {
              cells.push($(td).text().trim());
            });
          if (cells.length) rows.push(cells);
        });

      if (rows.length || headers.length) tables.push({ headers, rows });
    });

    // ── Images ────────────────────────────────────────────────────────
    const images: { alt: string; src: string; ocrText?: string; sentiment?: OcrTextAnalysis | null }[] = [];
    $("img[src]").each((_, el) => {
      if (images.length >= 30) return;
      const rawSrc = $(el).attr("src") ?? "";
      let src: string;
      try {
        src = new URL(rawSrc, targetUrl.toString()).toString();
      } catch {
        return;
      }
      images.push({ alt: $(el).attr("alt")?.trim() ?? "", src });
    });

    // ── Plain-text word count + preview ───────────────────────────────
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
    const rawTextPreview = bodyText.slice(0, 1000);

    // ── Sentiment analysis: page text ───────────────────────────────
    // Reuses the same deterministic-suspicion + LLM-sentiment pipeline
    // already used for uploaded evidence (lib/ocrSentiment.ts), applied
    // here to the scraped page's own paragraph text instead of OCR text.
    const combinedText = paragraphs.join("\n\n").slice(0, 6000);
    const textSentiment = combinedText.trim()
      ? await analyzeOcrText(combinedText, llmModel)
      : null;

    // ── Sentiment analysis: images (OCR text -> sentiment) ──────────
    // For the first MAX_IMAGE_ANALYSIS images, fetch the image, OCR it,
    // and if any text was found, run it through the same LLM sentiment
    // pipeline. Runs in parallel; each image fails independently so one
    // bad/slow image never blocks the rest.
    await Promise.all(
      images.slice(0, MAX_IMAGE_ANALYSIS).map(async (img) => {
        try {
          const ocrResult = await extractTextFromImageUrl(img.src);
          if (!ocrResult?.text) return;
          img.ocrText = ocrResult.text;
          img.sentiment = await analyzeOcrText(ocrResult.text, llmModel);
        } catch (err) {
          console.error(`[scrape] image analysis failed for ${img.src}:`, err instanceof Error ? err.message : err);
        }
      })
    );

    const result: ScrapeResult = {
      url: targetUrl.toString(),
      fetchedAt: new Date().toISOString(),
      title,
      meta,
      headings,
      paragraphs,
      links,
      tables,
      images,
      wordCount,
      rawTextPreview,
      textSentiment,
    };

    res.json(result);
  })
);