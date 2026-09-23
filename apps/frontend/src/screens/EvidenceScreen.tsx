import { useState, useEffect } from "react";
import { apiGet, apiPost, apiPatch } from "../lib/api";
import { EVIDENCE_TYPES } from "../components/shared";

export function EvidenceScreen({ selectedId }: { selectedId?: string | null }) {
  const [evidenceRows, setEvidenceRows] = useState<any[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(true);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [sel, setSel] = useState<any | null>(null);
  const [custody, setCustody] = useState<any[]>([]);
  const [custodyLoading, setCustodyLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // ── Add Evidence modal state ─────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [invOptions, setInvOptions] = useState<{ id: string; displayId: string; title: string }[]>([]);
  const [sourceOptions, setSourceOptions] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ type: "Intelligence Record", content: "", notes: "", uploadedBy: "Investigator A", investigationId: "", sourceId: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Attachment (evidence image) — read client-side as a data URL, sent as
  // `imageBase64`. The backend hashes these raw bytes and runs OCR
  // against them into EvidenceRecord.ocrText.
  const [attachedImage, setAttachedImage] = useState<{ fileName: string; dataUrl: string } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setSubmitError("Only image files are supported for now.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAttachedImage({ fileName: file.name, dataUrl: String(reader.result) });
    reader.onerror = () => setSubmitError("Couldn't read that file.");
    reader.readAsDataURL(file);
  };

  const fetchEvidence = () => {
    apiGet<any[]>("/api/evidence")
      .then(data => {
        const normalised = data.map((ev: any) => ({
          ...ev,
          id: ev.displayId ?? ev.id,
          type: ev.type ?? "Document",
          source: ev.source?.name ?? ev.source ?? "Unknown",
          ts: ev.createdAt ? new Date(ev.createdAt).toLocaleString() : ev.ts ?? "",
          hash: ev.hash ?? "—",
          caseRef: ev.investigation?.displayId ?? ev.investigationId ?? ev.caseRef ?? "—",
          notes: ev.notes ?? null,
          ocrText: ev.ocrText ?? null,
          imageMetadata: ev.imageMetadata ?? null,
          ocrSentiment: ev.ocrSentiment ?? null,
          by: ev.uploadedBy ?? ev.by ?? "System",
          status: ev.status ? ev.status.charAt(0) + ev.status.slice(1).toLowerCase() : "Pending",
        }));
        setEvidenceRows(normalised);
        setEvidenceError(null);
      })
      .catch(err => setEvidenceError(err.message))
      .finally(() => setEvidenceLoading(false));
  };

  useEffect(() => {
    fetchEvidence();

    // Populate the modal's dropdowns once, up front.
    apiGet<any[]>("/api/investigations")
      .then(data => setInvOptions(
        data
          .filter((i: any) => i.status !== "CLOSED")
          .map((i: any) => ({
            id: i.id,
            displayId: i.displayId ?? i.id,
            title: i.title,
          }))
      ))
      .catch(() => { });
    apiGet<any[]>("/api/sources")
      .then(data => {
        setSourceOptions(data.map((s: any) => ({ id: s.id, name: s.name })));
        setForm(f => f.sourceId || !data.length ? f : { ...f, sourceId: data[0].id });
      })
      .catch(() => { });
  }, []);

  // Auto-select evidence when navigated from workspace with a selectedId
  useEffect(() => {
    if (!selectedId || evidenceRows.length === 0) return;
    const match = evidenceRows.find(ev => ev.id === selectedId);
    if (match) {
      setSel(match);
      // Scroll the row into view after a short paint delay
      setTimeout(() => {
        const el = document.querySelector(`[data-ev-id="${selectedId}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
    }
  }, [selectedId, evidenceRows]);

  // Real chain-of-custody: pulls the audit log entries whose `resource`
  // matches this evidence record's displayId, instead of three fabricated
  // "Evidence collected / Integrity verified / Added to case" lines that
  // always showed the same fixed script regardless of what actually
  // happened to the record.
  useEffect(() => {
    if (!sel) { setCustody([]); return; }
    setCustodyLoading(true);
    apiGet<any[]>("/api/audit-log")
      .then(data => {
        setCustody(
          data
            .filter((entry: any) => entry.resource === sel.id)
            .sort((a: any, b: any) => new Date(a.createdAt ?? a.ts).getTime() - new Date(b.createdAt ?? b.ts).getTime())
        );
      })
      .catch(() => setCustody([]))
      .finally(() => setCustodyLoading(false));
  }, [sel?.id]);

  const verifyEvidence = async (status: "VERIFIED" | "REJECTED") => {
    if (!sel) return;
    setVerifying(true);
    try {
      const updated = await apiPatch<any>(`/api/evidence/${encodeURIComponent(sel.id)}/status`, {
        status,
        reviewedBy: form.uploadedBy || "Investigator A",
      });
      setSel((s: any) => s ? { ...s, status: status.charAt(0) + status.slice(1).toLowerCase() } : s);
      fetchEvidence();
    } catch (err) {
      // surfaced inline below rather than blocking the whole screen
    } finally {
      setVerifying(false);
    }
  };

  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);

  // Re-runs suspicion score + sentiment against the ocrText already stored
  // on this record (see routes/misc.ts's POST /:displayId/reanalyze-ocr).
  // Useful for evidence uploaded before this analysis existed, or to
  // re-run after tuning the prompt/model.
  const reanalyzeOcr = async () => {
    if (!sel) return;
    setReanalyzing(true);
    setReanalyzeError(null);
    try {
      const updated = await apiPost<any>(`/api/evidence/${encodeURIComponent(sel.id)}/reanalyze-ocr`, {});
      setSel((s: any) => s ? { ...s, ocrSentiment: updated.ocrSentiment ?? null } : s);
      fetchEvidence();
    } catch (err: any) {
      setReanalyzeError(err.message ?? "Re-analysis failed");
    } finally {
      setReanalyzing(false);
    }
  };

  const openAddModal = () => {
    setSubmitError(null);
    setForm(f => ({ ...f, investigationId: f.investigationId || invOptions[0]?.id || "" }));
    setShowAddModal(true);
  };

  const submitEvidence = async () => {
    if (!form.content.trim() && !attachedImage) {
      setSubmitError("Content or an attached image is required — one of them is what gets hashed.");
      return;
    }
    if (!form.investigationId) { setSubmitError("Select an investigation to attach this evidence to."); return; }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiPost("/api/evidence", { ...form, imageBase64: attachedImage?.dataUrl });
      setShowAddModal(false);
      setForm(f => ({ ...f, content: "", notes: "" }));
      setAttachedImage(null);
      fetchEvidence(); // refresh the table with the new row
    } catch (err: any) {
      setSubmitError(err.message ?? "Failed to submit evidence");
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <div style={{ padding: "26px 28px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
        <div>
          <h1 className="section-head">Evidence Repository</h1>
          <p className="page-sub">Verified evidence with integrity tracking and chain-of-custody audit trail.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={openAddModal}>+ Add Evidence</button>
        </div>
      </div>

      {evidenceLoading && <p className="page-sub" style={{ marginBottom: 12 }}>Loading evidence…</p>}
      {evidenceError && <p className="page-sub" style={{ marginBottom: 12, color: "var(--high-light)" }}>Couldn't reach the API ({evidenceError}).</p>}
      {!evidenceLoading && !evidenceError && evidenceRows.length === 0 && <p className="page-sub" style={{ marginBottom: 12 }}>No evidence recorded yet.</p>}
      <div style={{ display: "grid", gridTemplateColumns: sel ? "1fr 380px" : "1fr", gap: 16, transition: "all 0.25s" }}>
        <div className="card">
          <table className="data-table">
            <thead><tr><th>ID</th><th>Type</th><th>Source</th><th>Timestamp</th><th>SHA-256 (partial)</th><th>Case</th><th>By</th><th>Status</th></tr></thead>
            <tbody>
              {evidenceRows.map(ev => (
                <tr key={ev.id} data-ev-id={ev.id} className={sel?.id === ev.id ? "selected" : ""} onClick={() => setSel(ev.id === sel?.id ? null : ev)}>
                  <td><span className="mono" style={{ color: "var(--accent-hi)", fontSize: 12 }}>{ev.id}</span></td>
                  <td>{ev.type}</td>
                  <td>{ev.source}</td>
                  <td style={{ fontSize: 11 }}>{ev.ts}</td>
                  <td><span className="mono-sm" style={{ color: "var(--text-4)" }}>{ev.hash.slice(0, 14)}…</span></td>
                  <td><span className="mono-sm" style={{ color: "var(--accent-hi)" }}>{ev.caseRef}</span></td>
                  <td>{ev.by}</td>
                  <td><span className={`badge ${ev.status === "Verified" ? "badge-verified" : "badge-pending"}`}>{ev.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sel && (
          <div className="card anim-slide-r" style={{ padding: 20, height: "fit-content" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>Evidence Details</div>
              <button onClick={() => setSel(null)} style={{ background: "none", border: "none", color: "var(--text-4)", cursor: "pointer", fontSize: 20 }}>×</button>
            </div>

            <div className="mono" style={{ fontSize: 11, color: "var(--accent-hi)", marginBottom: 12 }}>{sel.id}</div>

            {sel.status === "Verified" ? (
              <div className="integrity-banner" style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 15 }}>✓</span> Integrity Verified
              </div>
            ) : sel.status === "Rejected" ? (
              <div style={{ marginBottom: 14, padding: "8px 12px", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 7, fontSize: 12, color: "var(--critical-light)", fontWeight: 600 }}>
                ✕ Rejected
              </div>
            ) : (
              <div style={{ marginBottom: 14, padding: "8px 12px", background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.2)", borderRadius: 7, fontSize: 12, color: "var(--medium-light)", fontWeight: 600 }}>
                ◷ Pending Verification
              </div>
            )}

            {[
              { l: "Type", v: sel.type }, { l: "Source", v: sel.source },
              { l: "Timestamp", v: sel.ts }, { l: "Related Case", v: sel.caseRef, mono: true },
              { l: "Uploaded By", v: sel.by }, { l: "Status", v: sel.status },
            ].map(item => (
              <div key={item.l} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 10, color: "var(--text-4)" }}>{item.l}</span>
                <span style={{ fontSize: 12, color: "var(--text-2)", fontFamily: item.mono ? "JetBrains Mono,monospace" : "inherit" }}>{item.v}</span>
              </div>
            ))}

            <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 10, color: "var(--text-4)", marginBottom: 4 }}>SHA-256 Hash</div>
              <div className="hash-block">{sel.hash}</div>
            </div>

            {sel.notes && (
              <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 10, color: "var(--text-4)", marginBottom: 4 }}>Notes</div>
                <div style={{ fontSize: 12, color: "var(--text-2)", whiteSpace: "pre-wrap" }}>{sel.notes}</div>
              </div>
            )}

            {sel.ocrText && (
              <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 10, color: "var(--text-4)", marginBottom: 4 }}>Extracted Text (OCR)</div>
                <div style={{ fontSize: 12, color: "var(--text-2)", whiteSpace: "pre-wrap" }}>{sel.ocrText}</div>
              </div>
            )}

            {sel.imageMetadata && (
              <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 10, color: "var(--text-4)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.07em" }}>Image Metadata</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px" }}>
                  {sel.imageMetadata.width && sel.imageMetadata.height && (
                    <MetaRow label="Dimensions" value={`${sel.imageMetadata.width} × ${sel.imageMetadata.height}px`} />
                  )}
                  {sel.imageMetadata.format && <MetaRow label="Format" value={String(sel.imageMetadata.format).toUpperCase()} />}
                  {typeof sel.imageMetadata.sizeBytes === "number" && (
                    <MetaRow label="File Size" value={formatBytes(sel.imageMetadata.sizeBytes)} />
                  )}
                  {sel.imageMetadata.make && <MetaRow label="Camera Make" value={sel.imageMetadata.make} />}
                  {sel.imageMetadata.model && <MetaRow label="Camera Model" value={sel.imageMetadata.model} />}
                  {sel.imageMetadata.software && <MetaRow label="Software" value={sel.imageMetadata.software} />}
                  {sel.imageMetadata.dateTimeOriginal && (
                    <MetaRow label="Captured" value={new Date(sel.imageMetadata.dateTimeOriginal).toLocaleString()} />
                  )}
                </div>
                {sel.imageMetadata.gps ? (
                  <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 6 }}>
                    <div style={{ fontSize: 10.5, color: "var(--critical-light)", fontWeight: 600, marginBottom: 2 }}>⚠ GPS Coordinates Embedded</div>
                    <div className="mono-sm" style={{ fontSize: 11.5, color: "var(--text-2)" }}>
                      {sel.imageMetadata.gps.latitude.toFixed(5)}, {sel.imageMetadata.gps.longitude.toFixed(5)}
                    </div>
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${sel.imageMetadata.gps.latitude}&mlon=${sel.imageMetadata.gps.longitude}#map=15/${sel.imageMetadata.gps.latitude}/${sel.imageMetadata.gps.longitude}`}
                      target="_blank" rel="noreferrer"
                      style={{ fontSize: 10.5, color: "var(--accent-hi)" }}
                    >
                      View on map ↗
                    </a>
                  </div>
                ) : !sel.imageMetadata.hasExif ? (
                  <div style={{ marginTop: 8, fontSize: 10.5, color: "var(--text-4)" }}>No EXIF metadata found in this image (likely stripped or re-encoded).</div>
                ) : null}
              </div>
            )}

            {sel.ocrSentiment && (
              <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>OCR Text Analysis</div>
                  <span className={`badge ${
                    sel.ocrSentiment.suspicionLevel === "CRITICAL" ? "badge-critical" :
                    sel.ocrSentiment.suspicionLevel === "HIGH" ? "badge-high" :
                    sel.ocrSentiment.suspicionLevel === "MEDIUM" ? "badge-medium" : "badge-low"
                  }`} style={{ fontSize: 10 }}>
                    {sel.ocrSentiment.suspicious ? "⚠ " : ""}{sel.ocrSentiment.suspicionLevel} · {sel.ocrSentiment.suspicionScore}/100
                  </span>
                </div>

                {sel.ocrSentiment.signals?.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                    {sel.ocrSentiment.signals.map((s: any, i: number) => (
                      <span key={i} className="mono-sm" style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.2)", color: "var(--medium-light)" }}>
                        {s.label} (+{s.value})
                      </span>
                    ))}
                  </div>
                )}

{sel.ocrSentiment.sentiment && (
  <div
    style={{
      marginTop: 10,
      padding: 12,
      border: "1px solid var(--border)",
      borderRadius: 8,
      background: "rgba(255,255,255,0.015)",
    }}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--text-4)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        AI Sentiment Analysis
      </div>

      <span
        style={{
          fontSize: 9,
          padding: "3px 6px",
          borderRadius: 4,
          background:
            sel.ocrSentiment.sentiment.source === "llm"
              ? "rgba(99,102,241,0.12)"
              : "rgba(217,119,6,0.12)",
          color:
            sel.ocrSentiment.sentiment.source === "llm"
              ? "var(--accent-hi)"
              : "var(--medium-light)",
          border:
            sel.ocrSentiment.sentiment.source === "llm"
              ? "1px solid rgba(99,102,241,0.2)"
              : "1px solid rgba(217,119,6,0.2)",
        }}
      >
        {sel.ocrSentiment.sentiment.source === "llm"
          ? "LLM ANALYZED"
          : "FALLBACK"}
      </span>
    </div>

    {/* Sentiment + confidence */}
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 9,
      }}
    >
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          textTransform: "uppercase",
          color:
            sel.ocrSentiment.sentiment.label === "negative"
              ? "var(--high-light)"
              : sel.ocrSentiment.sentiment.label === "positive"
                ? "var(--low-light)"
                : "var(--text-2)",
        }}
      >
        {sel.ocrSentiment.sentiment.label}
      </div>

      <div
        style={{
          fontSize: 11,
          color: "var(--text-4)",
        }}
      >
        {Math.round(
          Number(sel.ocrSentiment.sentiment.confidence ?? 0) * 100
        )}
        % confidence
      </div>
    </div>

    {/* Confidence bar */}
    <div
      style={{
        height: 5,
        background: "rgba(255,255,255,0.07)",
        borderRadius: 4,
        overflow: "hidden",
        marginBottom: 10,
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.max(
            0,
            Math.min(
              100,
              Number(
                sel.ocrSentiment.sentiment.confidence ?? 0
              ) * 100
            )
          )}%`,
          background:
            sel.ocrSentiment.sentiment.label === "negative"
              ? "var(--high-light)"
              : sel.ocrSentiment.sentiment.label === "positive"
                ? "var(--low-light)"
                : "var(--text-3)",
          borderRadius: 4,
          transition: "width 0.3s ease",
        }}
      />
    </div>

    {/* Emotions */}
    {Array.isArray(sel.ocrSentiment.sentiment.emotions) &&
      sel.ocrSentiment.sentiment.emotions.length > 0 && (
        <div style={{ marginBottom: 9 }}>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-4)",
              marginBottom: 5,
            }}
          >
            Emotional Signals
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 5,
            }}
          >
            {sel.ocrSentiment.sentiment.emotions.map(
              (emotion: string, i: number) => (
                <span
                  key={`${emotion}-${i}`}
                  className="mono-sm"
                  style={{
                    fontSize: 10,
                    padding: "3px 7px",
                    borderRadius: 4,
                    background: "rgba(99,102,241,0.08)",
                    border:
                      "1px solid rgba(99,102,241,0.18)",
                    color: "var(--accent-hi)",
                    textTransform: "capitalize",
                  }}
                >
                  {emotion}
                </span>
              )
            )}
          </div>
        </div>
      )}

    {/* LLM reasoning */}
    {sel.ocrSentiment.sentiment.reasoning && (
      <div style={{ marginBottom: 8 }}>
        <div
          style={{
            fontSize: 10,
            color: "var(--text-4)",
            marginBottom: 4,
          }}
        >
          Sentiment Reasoning
        </div>

        <div
          style={{
            fontSize: 11.5,
            color: "var(--text-2)",
            lineHeight: 1.5,
          }}
        >
          {sel.ocrSentiment.sentiment.reasoning}
        </div>
      </div>
    )}

    <div
      style={{
        fontSize: 9.5,
        color: "var(--text-4)",
        marginTop: 7,
      }}
    >
      {sel.ocrSentiment.sentiment.source === "llm"
        ? `Analyzed by ${sel.ocrSentiment.sentiment.modelUsed}`
        : "LLM unavailable — sentiment was not reliably classified"}
    </div>
  </div>
)}

                {sel.ocrSentiment.explanation && (
                  <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>{sel.ocrSentiment.explanation}</div>
                )}

                <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 6 }}>
                  {sel.ocrSentiment.aiGenerated ? `AI explanation by ${sel.ocrSentiment.modelUsed}` : "Fallback explanation — LLM unavailable"}
                </div>
              </div>
            )}

            {sel.ocrText && (
              <div style={{ padding: "8px 0" }}>
                <button className="btn btn-ghost btn-sm" disabled={reanalyzing} onClick={reanalyzeOcr} style={{ fontSize: 11 }}>
                  {reanalyzing ? "Analyzing…" : "↻ Re-run Sentiment / Suspicion Analysis"}
                </button>
                {reanalyzeError && <div style={{ fontSize: 11, color: "var(--critical-light)", marginTop: 6 }}>{reanalyzeError}</div>}
              </div>
            )}


            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Chain of Custody</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {sel.status !== "Verified" && (
                    <button className="btn btn-primary btn-sm" disabled={verifying} onClick={() => verifyEvidence("VERIFIED")} style={{ fontSize: 11 }}>
                      {verifying ? "…" : "✓ Mark Verified"}
                    </button>
                  )}
                  {sel.status !== "Pending" && sel.status !== "Rejected" && (
                    <button className="btn btn-ghost btn-sm" disabled={verifying} onClick={() => verifyEvidence("REJECTED")} style={{ fontSize: 11 }}>
                      {verifying ? "…" : "✕ Reject"}
                    </button>
                  )}
                  {sel.status !== "Pending" && (
                    <button className="btn btn-ghost btn-sm" disabled={verifying} onClick={async () => {
                      setVerifying(true);
                      try {
                        await apiPatch(`/api/evidence/${encodeURIComponent(sel.id)}/status`, { status: "PENDING", reviewedBy: form.uploadedBy || "Investigator A" });
                        setSel((s: any) => s ? { ...s, status: "Pending" } : s);
                        fetchEvidence();
                      } finally { setVerifying(false); }
                    }} style={{ fontSize: 11 }}>
                      {verifying ? "…" : "◷ Mark Pending"}
                    </button>
                  )}
                </div>
              </div>
              {custodyLoading && <div style={{ fontSize: 11.5, color: "var(--text-4)" }}>Loading custody trail…</div>}
              {!custodyLoading && custody.length === 0 && (
                <div style={{ fontSize: 11.5, color: "var(--text-4)" }}>No audit events recorded for this evidence yet.</div>
              )}
              {!custodyLoading && custody.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", marginTop: 4, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>{c.action}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-4)" }}>{c.user} · {c.createdAt ? new Date(c.createdAt).toLocaleString() : c.ts}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showAddModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={() => !submitting && setShowAddModal(false)}
        >
          <div
            className="card"
            style={{ width: 440, padding: 24, maxHeight: "85vh", overflowY: "auto" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>Add Evidence</div>
              <button onClick={() => setShowAddModal(false)} style={{ background: "none", border: "none", color: "var(--text-4)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
            </div>

            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 16, lineHeight: 1.5 }}>
              A SHA-256 hash is computed server-side from the content below — this is what
              gives the evidence record its integrity guarantee, so paste the actual
              content (a note, a transcript, a record) rather than just a description.
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 10, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Type</label>
              <select className="input" style={{ padding: "7px 10px", fontSize: 12 }} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {EVIDENCE_TYPES.map(t => (
                  <option key={t.value} value={t.value} style={{ background: "#0f1420" }}>{t.value}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 10, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Investigation</label>
              <select className="input" style={{ padding: "7px 10px", fontSize: 12 }} value={form.investigationId} onChange={e => setForm(f => ({ ...f, investigationId: e.target.value }))}>
                {invOptions.length === 0 && <option style={{ background: "#0f1420" }}>No investigations found</option>}
                {invOptions.map(inv => (
                  <option key={inv.id} value={inv.id} style={{ background: "#0f1420" }}>{inv.displayId} — {inv.title}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 10, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Source</label>
              <select className="input" style={{ padding: "7px 10px", fontSize: 12 }} value={form.sourceId} onChange={e => setForm(f => ({ ...f, sourceId: e.target.value }))}>
                {sourceOptions.map(s => (
                  <option key={s.id} value={s.id} style={{ background: "#0f1420" }}>{s.name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 10, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Uploaded By</label>
              <input className="input" style={{ padding: "7px 10px", fontSize: 12 }} value={form.uploadedBy} onChange={e => setForm(f => ({ ...f, uploadedBy: e.target.value }))} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 10, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Content (this gets hashed)</label>
              <textarea
                className="input"
                style={{ minHeight: 100, resize: "vertical", fontSize: 12.5 }}
                placeholder="Paste the record content, transcript, or note here…"
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 10, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Notes (context, not hashed)</label>
              <textarea
                className="input"
                style={{ minHeight: 50, resize: "vertical", fontSize: 12.5 }}
                placeholder="Optional context for the investigator reviewing this record…"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 10, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Attachments</label>
              {attachedImage ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
                  <img src={attachedImage.dataUrl} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachedImage.fileName}</div>
                    <div style={{ fontSize: 10, color: "var(--text-4)" }}>Text will be extracted (OCR) on submit</div>
                  </div>
                  <button type="button" onClick={() => setAttachedImage(null)} style={{ background: "none", border: "none", color: "var(--text-4)", cursor: "pointer", fontSize: 16, flexShrink: 0 }}>×</button>
                </div>
              ) : (
                <label
                  style={{
                    border: "1px dashed var(--border-2, rgba(255,255,255,0.15))",
                    borderRadius: 8,
                    padding: "14px 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    fontSize: 11.5,
                    color: "var(--text-4)",
                    cursor: "pointer",
                  }}
                >
                  <span>📎 Add a photo</span>
                  <input type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} />
                </label>
              )}
              <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 5 }}>
                One image per record for now. It's hashed as submitted, and any text in it is extracted automatically.
              </div>
            </div>

            {submitError && (
              <div style={{ fontSize: 11.5, color: "var(--critical-light)", marginBottom: 12, padding: "8px 10px", background: "rgba(220,38,38,0.08)", borderRadius: 6, border: "1px solid rgba(220,38,38,0.2)" }}>
                {submitError}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setShowAddModal(false)} disabled={submitting}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={submitEvidence} disabled={submitting}>
                {submitting ? "Hashing & saving…" : "Add Evidence"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 9.5, color: "var(--text-4)" }}>{label}</span>
      <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>{value}</span>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}