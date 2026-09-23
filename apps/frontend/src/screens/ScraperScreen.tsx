// src/screens/ScraperScreen.tsx
//
// UI-driven web scraper: user enters any URL, hits Scrape, and gets back
// structured raw data (title, meta, headings, paragraphs, links, tables,
// images) from the backend POST /api/scrape endpoint.

import { useState } from "react";
import { apiPost } from "../lib/api";

// ─── Types ────────────────────────────────────────────────────────────────
interface ScrapeResult {
  url: string;
  fetchedAt: string;
  title: string | null;
  meta: Record<string, string>;
  headings: { level: string; text: string }[];
  paragraphs: string[];
  links: { text: string; href: string }[];
  tables: { headers: string[]; rows: string[][] }[];
  images: { alt: string; src: string }[];
  wordCount: number;
  rawTextPreview: string;
}

type Tab = "overview" | "headings" | "paragraphs" | "links" | "tables" | "images" | "meta" | "raw";

// ─── helpers ──────────────────────────────────────────────────────────────
function Badge({ children, color = "var(--accent-hi)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 7px",
      borderRadius: 99,
      fontSize: 10,
      fontWeight: 700,
      background: `${color}18`,
      border: `1px solid ${color}40`,
      color,
    }}>
      {children}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{
      background: "var(--surface-2)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      padding: "12px 16px",
      minWidth: 100,
      flex: 1,
    }}>
      <div style={{ fontSize: 11, color: "var(--text-4)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)" }}>{value}</div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────
export function ScraperScreen() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  async function handleScrape() {
    const trimmed = url.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await apiPost<ScrapeResult>("/api/scrape", { url: trimmed });
      setResult(data);
      setTab("overview");
    } catch (err: any) {
      setError(err?.message ?? "Network error — is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleScrape();
  }

  const tabs: { key: Tab; label: string; count?: number }[] = result
    ? [
        { key: "overview",   label: "Overview" },
        { key: "headings",   label: "Headings",   count: result.headings.length },
        { key: "paragraphs", label: "Paragraphs", count: result.paragraphs.length },
        { key: "links",      label: "Links",      count: result.links.length },
        { key: "tables",     label: "Tables",     count: result.tables.length },
        { key: "images",     label: "Images",     count: result.images.length },
        { key: "meta",       label: "Meta",       count: Object.keys(result.meta).length },
        { key: "raw",        label: "Raw Text" },
      ]
    : [];

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 20 }}>🕷</span>
          <h1 className="display grad-text" style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
            Web Scraper
          </h1>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
          Enter any public URL to extract raw structured data from the page.
        </p>
      </div>

      {/* ── URL Input ── */}
      <div style={{
        display: "flex",
        gap: 10,
        marginBottom: 28,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "14px 16px",
      }}>
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://example.com"
          disabled={loading}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: 14,
            color: "var(--text-1)",
            fontFamily: "var(--font-mono, monospace)",
          }}
        />
        <button
          className="btn btn-primary"
          onClick={handleScrape}
          disabled={loading || !url.trim()}
          style={{ minWidth: 110, fontSize: 13, fontWeight: 700 }}
        >
          {loading ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                width: 12, height: 12, border: "2px solid #fff4",
                borderTopColor: "#fff", borderRadius: "50%",
                display: "inline-block",
                animation: "spin 0.7s linear infinite",
              }} />
              Scraping…
            </span>
          ) : "Scrape"}
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          marginBottom: 24,
          padding: "12px 16px",
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: 10,
          color: "var(--critical)",
          fontSize: 13,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <div>
          {/* ── Page header row ── */}
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "16px 20px",
            marginBottom: 16,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginBottom: 4, wordBreak: "break-word" }}>
                  {result.title ?? <span style={{ color: "var(--text-4)" }}>(no title)</span>}
                </div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-4)", wordBreak: "break-all" }}>
                  {result.url}
                </div>
              </div>
              <div className="mono" style={{ fontSize: 10, color: "var(--text-4)", flexShrink: 0 }}>
                {new Date(result.fetchedAt).toLocaleTimeString()}
              </div>
            </div>

            {/* Stat cards */}
            <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <StatCard label="Words" value={result.wordCount.toLocaleString()} />
              <StatCard label="Headings" value={result.headings.length} />
              <StatCard label="Paragraphs" value={result.paragraphs.length} />
              <StatCard label="Links" value={result.links.length} />
              <StatCard label="Tables" value={result.tables.length} />
              <StatCard label="Images" value={result.images.length} />
              <StatCard label="Meta tags" value={Object.keys(result.meta).length} />
            </div>
          </div>

          {/* ── Tabs ── */}
          <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: "1px solid",
                  borderColor: tab === t.key ? "var(--accent-hi)" : "var(--border)",
                  background: tab === t.key ? "rgba(99,102,241,0.12)" : "transparent",
                  color: tab === t.key ? "var(--accent-hi)" : "var(--text-3)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                {t.label}
                {t.count !== undefined && (
                  <span style={{
                    background: tab === t.key ? "var(--accent-hi)" : "var(--text-4)",
                    color: "#fff",
                    borderRadius: 99,
                    padding: "0 5px",
                    fontSize: 9,
                    fontWeight: 700,
                    minWidth: 16,
                    textAlign: "center",
                  }}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Tab content ── */}
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
          }}>
            {/* OVERVIEW */}
            {tab === "overview" && (
              <div style={{ padding: "20px 24px" }}>
                <Section title="Page Title">
                  <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0 }}>
                    {result.title ?? <em style={{ color: "var(--text-4)" }}>No title found</em>}
                  </p>
                </Section>

                {result.headings.slice(0, 5).length > 0 && (
                  <Section title="Top Headings">
                    {result.headings.slice(0, 5).map((h, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                        <Badge color="var(--accent-hi)">{h.level}</Badge>
                        <span style={{ fontSize: 13, color: "var(--text-1)" }}>{h.text}</span>
                      </div>
                    ))}
                  </Section>
                )}

                {result.paragraphs.slice(0, 3).length > 0 && (
                  <Section title="First Paragraphs">
                    {result.paragraphs.slice(0, 3).map((p, i) => (
                      <p key={i} style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 8, lineHeight: 1.6 }}>{p}</p>
                    ))}
                  </Section>
                )}

                <Section title="Raw Text Preview">
                  <pre style={{
                    fontSize: 11,
                    color: "var(--text-3)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "12px 14px",
                    margin: 0,
                    maxHeight: 200,
                    overflowY: "auto",
                    fontFamily: "var(--font-mono, monospace)",
                  }}>
                    {result.rawTextPreview}
                  </pre>
                </Section>
              </div>
            )}

            {/* HEADINGS */}
            {tab === "headings" && (
              <div style={{ padding: "20px 24px" }}>
                {result.headings.length === 0 ? (
                  <Empty message="No headings found on this page." />
                ) : (
                  result.headings.map((h, i) => (
                    <div key={i} style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 10,
                      padding: "8px 0",
                      borderBottom: "1px solid var(--border)",
                    }}>
                      <Badge color={
                        h.level === "H1" ? "#ef4444" :
                        h.level === "H2" ? "#f97316" :
                        h.level === "H3" ? "#eab308" : "var(--accent-hi)"
                      }>{h.level}</Badge>
                      <span style={{ fontSize: 13, color: "var(--text-1)" }}>{h.text}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* PARAGRAPHS */}
            {tab === "paragraphs" && (
              <div style={{ padding: "20px 24px" }}>
                {result.paragraphs.length === 0 ? (
                  <Empty message="No paragraphs found on this page." />
                ) : (
                  result.paragraphs.map((p, i) => (
                    <div key={i} style={{
                      padding: "10px 0",
                      borderBottom: "1px solid var(--border)",
                    }}>
                      <span style={{ fontSize: 10, color: "var(--text-4)", marginRight: 8 }}>#{i + 1}</span>
                      <span style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>{p}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* LINKS */}
            {tab === "links" && (
              <div>
                {result.links.length === 0 ? (
                  <div style={{ padding: "20px 24px" }}>
                    <Empty message="No links found on this page." />
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                        <th style={{ padding: "10px 20px", textAlign: "left", color: "var(--text-4)", fontWeight: 600, width: "35%" }}>Text</th>
                        <th style={{ padding: "10px 20px", textAlign: "left", color: "var(--text-4)", fontWeight: 600 }}>URL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.links.map((link, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "9px 20px", color: "var(--text-2)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {link.text || <em style={{ color: "var(--text-4)" }}>(no text)</em>}
                          </td>
                          <td style={{ padding: "9px 20px" }}>
                            <a
                              href={link.href}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="mono"
                              style={{ fontSize: 11, color: "var(--accent-hi)", wordBreak: "break-all" }}
                            >
                              {link.href}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* TABLES */}
            {tab === "tables" && (
              <div style={{ padding: "20px 24px" }}>
                {result.tables.length === 0 ? (
                  <Empty message="No tables found on this page." />
                ) : (
                  result.tables.map((tbl, ti) => (
                    <div key={ti} style={{ marginBottom: 24 }}>
                      <div style={{ fontSize: 11, color: "var(--text-4)", marginBottom: 8 }}>Table {ti + 1}</div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                          {tbl.headers.length > 0 && (
                            <thead>
                              <tr style={{ background: "var(--surface-2)" }}>
                                {tbl.headers.map((h, i) => (
                                  <th key={i} style={{ padding: "8px 12px", textAlign: "left", color: "var(--text-2)", fontWeight: 600, borderBottom: "1px solid var(--border)" }}>
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                          )}
                          <tbody>
                            {tbl.rows.map((row, ri) => (
                              <tr key={ri} style={{ borderBottom: "1px solid var(--border)" }}>
                                {row.map((cell, ci) => (
                                  <td key={ci} style={{ padding: "7px 12px", color: "var(--text-3)" }}>{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* IMAGES */}
            {tab === "images" && (
              <div style={{ padding: "20px 24px" }}>
                {result.images.length === 0 ? (
                  <Empty message="No images found on this page." />
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                    {result.images.map((img, i) => (
                      <div key={i} style={{
                        background: "var(--surface-2)",
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        overflow: "hidden",
                      }}>
                        <div style={{ height: 120, background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                          <img
                            src={img.src}
                            alt={img.alt}
                            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        </div>
                        <div style={{ padding: "8px 10px" }}>
                          <div style={{ fontSize: 10, color: "var(--text-4)", marginBottom: 2 }}>Alt text</div>
                          <div style={{ fontSize: 11, color: "var(--text-3)", wordBreak: "break-word" }}>
                            {img.alt || <em style={{ color: "var(--text-4)" }}>(none)</em>}
                          </div>
                          <a
                            href={img.src}
                            target="_blank"
                            rel="noreferrer"
                            className="mono"
                            style={{ fontSize: 9, color: "var(--accent-hi)", display: "block", marginTop: 4, wordBreak: "break-all" }}
                          >
                            {img.src.slice(0, 60)}{img.src.length > 60 ? "…" : ""}
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* META */}
            {tab === "meta" && (
              <div>
                {Object.keys(result.meta).length === 0 ? (
                  <div style={{ padding: "20px 24px" }}>
                    <Empty message="No meta tags found on this page." />
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                        <th style={{ padding: "10px 20px", textAlign: "left", color: "var(--text-4)", fontWeight: 600, width: "35%" }}>Name / Property</th>
                        <th style={{ padding: "10px 20px", textAlign: "left", color: "var(--text-4)", fontWeight: 600 }}>Content</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.meta).map(([k, v], i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td className="mono" style={{ padding: "9px 20px", color: "var(--accent-hi)", fontSize: 11 }}>{k}</td>
                          <td style={{ padding: "9px 20px", color: "var(--text-2)", wordBreak: "break-word" }}>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* RAW TEXT */}
            {tab === "raw" && (
              <div style={{ padding: "20px 24px" }}>
                <div style={{ fontSize: 11, color: "var(--text-4)", marginBottom: 8 }}>
                  First 1 000 characters of extracted plain text
                </div>
                <pre style={{
                  fontSize: 11,
                  color: "var(--text-3)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "14px 16px",
                  margin: 0,
                  fontFamily: "var(--font-mono, monospace)",
                  lineHeight: 1.6,
                }}>
                  {result.rawTextPreview}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Spin animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Small sub-components ─────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontWeight: 700 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-4)", fontSize: 13 }}>
      {message}
    </div>
  );
}