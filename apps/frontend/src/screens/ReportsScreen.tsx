import { useState, useEffect } from "react";
import { apiGet, apiPost } from "../lib/api";

export function ReportsScreen({
  navigate,
  preselectedDisplayId,
}: {
  navigate?: (s: string, d?: any) => void;
  preselectedDisplayId?: string | null;
}) {
  const sections = ["Executive Summary","Risk Assessment","Entity Analysis","Network Analysis","Evidence Summary","Investigation Timeline","AI Explanation","Audit Information"];
  const [checked, setChecked] = useState<Record<string,boolean>>(Object.fromEntries(sections.map(s=>[s,true])));

  const [invOptions, setInvOptions] = useState<{ id: string; displayId: string; title: string }[]>([]);
  // Preselect whichever investigation the user came from (e.g. clicking
  // "Generate Report" from a specific case's Workspace) instead of always
  // defaulting to the first investigation in the list.
  const [selectedInvId, setSelectedInvId] = useState(preselectedDisplayId ?? "");
  const [reportType, setReportType] = useState("Intelligence Assessment");
  const [classification, setClassification] = useState("RESTRICTED");

  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string|null>(null);
  const [reportData, setReportData] = useState<any|null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date|null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string|null>(null);

  useEffect(() => {
    apiGet<any[]>("/api/investigations")
      .then(data => {
        const opts = data.map((i: any) => ({ id: i.displayId ?? i.id, displayId: i.displayId ?? i.id, title: i.title }));
        setInvOptions(opts);
        // Only default to the first investigation when nothing specific
        // was passed in — a case opened via "Generate Report" from its
        // Workspace must keep pointing at THAT case, not silently switch
        // to whatever happens to sort first.
        if (preselectedDisplayId && opts.some(o => o.id === preselectedDisplayId)) {
          setSelectedInvId(preselectedDisplayId);
        } else if (opts.length > 0 && !opts.some(o => o.id === selectedInvId)) {
          setSelectedInvId(opts[0].id);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedDisplayId]);

  // ── Generate the report ──────────────────────────────────────────────
  // Delegates ALL section-building to POST /api/reports/generate — the
  // backend pulls the real investigation (entities, network, evidence,
  // timeline, AI assessment) via Prisma and computes each section's
  // content live, branching depth by `reportType`. Every field we send
  // here (selectedInvId, reportType, classification, checked) is exactly
  // what changes the output, so switching any of them and clicking
  // "Generate Secure Report" again always re-fetches and re-renders —
  // nothing is cached from a previous generation.
  const generateReport = async () => {
    if (!selectedInvId) { setGenError("Select an investigation first."); return; }
    setGenerating(true);
    setGenError(null);
    try {
      const data = await apiPost<any>(`/api/reports/generate`, {
        investigationId: selectedInvId,
        reportType,
        classification,
        sections: checked,
      });
      setReportData(data);
      setGeneratedAt(new Date(data.generatedAt));
      setGenerated(true);
    } catch (err: any) {
      setGenError(err.message ?? "Failed to generate report — could not reach the API.");
      setGenerated(false);
    } finally {
      setGenerating(false);
    }
  };

  // ── Export the currently-generated report as a PDF ──────────────────────
  // Uses the browser's native print-to-PDF (no extra client-side PDF lib
  // available in this project), then records a real "export" audit event —
  // this is what makes it show up under Audit Logs, same pattern as the
  // report-generated event fired above.
  const exportPdf = async () => {
    if (!reportData || !generated) return;
    setExporting(true);
    setExportError(null);
    try {
      window.print();
      await apiPost(`/api/investigations/${selectedInvId}/report-exported`, {
        exportedBy: "Investigator A",
        format: "PDF",
        reportType,
        classification,
      });
    } catch (err: any) {
      setExportError(err.message ?? "Failed to record the export — the PDF dialog may still have opened.");
    } finally {
      setExporting(false);
    }
  };

  // Sections now arrive pre-built from POST /api/reports/generate — see
  // lib/reportGenerator.ts. Nothing is composed client-side anymore, so
  // there's no risk of the preview drifting from what the backend
  // actually computed (which is what let Risk Assessment go stale before).
  const reportSections: any[] = reportData?.sections ?? [];

  const selectedInv = invOptions.find(i => i.id === selectedInvId);

  return (
    <div style={{padding:"26px 28px"}}>
      {navigate && preselectedDisplayId && (
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
          <button onClick={()=>navigate("workspace", preselectedDisplayId)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer",fontSize:12,padding:0}}>← Case Workspace</button>
          <span style={{color:"var(--text-4)"}}>/</span>
          <span className="mono-sm" style={{color:"var(--accent-hi)"}}>{preselectedDisplayId}</span>
        </div>
      )}
      <div style={{marginBottom:22}}>
        <h1 className="section-head">Generate Intelligence Report</h1>
        <p className="page-sub">Compile and export a structured, auditable intelligence assessment.</p>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"360px 1fr",gap:24}}>
        {/* Config */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div className="card" style={{padding:20}}>
            <div style={{fontSize:13,fontWeight:600,color:"var(--text-1)",marginBottom:14}}>Report Configuration</div>

            <div style={{marginBottom:12}}>
              <label style={{display:"block",fontSize:10,color:"var(--text-4)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Investigation</label>
              <select className="input" style={{padding:"7px 10px",fontSize:12}} value={selectedInvId} onChange={e=>{ setSelectedInvId(e.target.value); setGenerated(false); }}>
                {invOptions.length === 0 && <option style={{background:"#0f1420"}}>No investigations found</option>}
                {invOptions.map(inv=>(
                  <option key={inv.id} value={inv.id} style={{background:"#0f1420"}}>{inv.displayId} — {inv.title}</option>
                ))}
              </select>
            </div>

            <div style={{marginBottom:12}}>
              <label style={{display:"block",fontSize:10,color:"var(--text-4)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Report Type</label>
              <select className="input" style={{padding:"7px 10px",fontSize:12}} value={reportType} onChange={e=>setReportType(e.target.value)}>
                {["Intelligence Assessment","Executive Summary","Technical Analysis"].map(o=><option key={o} style={{background:"#0f1420"}}>{o}</option>)}
              </select>
            </div>

            <div style={{marginBottom:12}}>
              <label style={{display:"block",fontSize:10,color:"var(--text-4)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Classification</label>
              <select className="input" style={{padding:"7px 10px",fontSize:12}} value={classification} onChange={e=>setClassification(e.target.value)}>
                {["RESTRICTED","CONFIDENTIAL","OFFICIAL"].map(o=><option key={o} style={{background:"#0f1420"}}>{o}</option>)}
              </select>
            </div>

            <div className="divider" style={{margin:"14px 0"}}/>
            <div style={{fontSize:11.5,fontWeight:600,color:"var(--text-1)",marginBottom:10}}>Include Sections</div>
            {sections.map(s=>(
              <label key={s} style={{display:"flex",alignItems:"center",gap:10,marginBottom:9,cursor:"pointer"}}>
                <div onClick={()=>setChecked(c=>({...c,[s]:!c[s]}))} style={{width:16,height:16,borderRadius:4,background:checked[s]?"var(--accent)":"rgba(255,255,255,0.05)",border:checked[s]?"none":"1px solid var(--border-mid)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer",transition:"all 0.13s"}}>
                  {checked[s]&&<span style={{color:"#fff",fontSize:10,lineHeight:1}}>✓</span>}
                </div>
                <span style={{fontSize:12,color:checked[s]?"var(--text-2)":"var(--text-4)",transition:"color 0.13s"}}>{s}</span>
              </label>
            ))}

            {genError && (
              <div style={{fontSize:11.5,color:"var(--critical-light)",marginTop:12,padding:"8px 10px",background:"rgba(220,38,38,0.08)",borderRadius:6,border:"1px solid rgba(220,38,38,0.2)"}}>
                {genError}
              </div>
            )}

            <button className="btn btn-primary btn-lg" style={{width:"100%",justifyContent:"center",marginTop:16}} onClick={generateReport} disabled={generating}>
              {generating ? "Compiling from live data…" : "Generate Secure Report"}
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="card" style={{padding:32}}>
          <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:12}}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={exportPdf}
              disabled={!generated || !reportData || exporting}
              title={!generated || !reportData ? "Generate a report first" : "Export as PDF"}
            >
              {exporting ? "Exporting…" : "Export PDF"}
            </button>
          </div>
          {exportError && (
            <div style={{fontSize:11.5,color:"var(--critical-light)",marginBottom:12,padding:"8px 10px",background:"rgba(220,38,38,0.08)",borderRadius:6,border:"1px solid rgba(220,38,38,0.2)"}}>
              {exportError}
            </div>
          )}
          <div style={{textAlign:"center",marginBottom:28,paddingBottom:22,borderBottom:"2px solid rgba(99,102,241,0.3)"}}>
            <div style={{fontSize:9.5,color:"var(--text-4)",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:8}}>NEXUS INTELLIGENCE PLATFORM</div>
            <div className="display" style={{fontSize:22,fontWeight:800,color:"var(--text-1)",letterSpacing:"-0.02em",marginBottom:6}}>{reportData?.reportTitle ?? "INTELLIGENCE ASSESSMENT REPORT"}</div>
            <div style={{display:"flex",justifyContent:"center",gap:22,fontSize:11,color:"var(--text-3)"}}>
              <span>Case: <span className="mono" style={{color:"var(--accent-hi)"}}>{reportData?.investigation?.displayId ?? selectedInv?.displayId ?? "—"}</span></span>
              <span>Risk: <span style={{color:reportData?.headerRisk ? "var(--critical-light)" : "var(--text-3)",fontWeight:600}}>{reportData?.headerRisk ? `${reportData.headerRisk.label} (${reportData.headerRisk.value}/100)${reportData.headerRisk.kind === "entity" ? " — top entity, no linked network" : ""}` : "—"}</span></span>
              <span>Generated: <span style={{color:"var(--text-2)"}}>{generatedAt ? generatedAt.toLocaleDateString() : "—"}</span></span>
            </div>
          </div>

          {generated && reportData ? (
            <div>
              {reportSections.map(s=>(
                <div key={s.title} style={{marginBottom:20}}>
                  <div style={{fontSize:10.5,fontWeight:700,color:"var(--accent-hi)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:7}}>{s.title}</div>

                  {s.kind === "ai" ? (
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:10}}>
                        <span className={`badge ${
                          s.tone === "accepted" ? "badge-low" :
                          s.tone === "rejected" ? "badge-critical" :
                          s.tone === "modified" ? "badge-accent" : "badge-pending"
                        }`}>{s.badgeLabel}</span>
                        {s.byline && <span style={{fontSize:11,color:"var(--text-4)"}}>{s.byline}</span>}
                      </div>

                      {s.body && (
                        <div style={{fontSize:12.5,color:"var(--text-2)",lineHeight:1.72,marginBottom:s.steps?.length?14:8}}>
                          {s.body}
                        </div>
                      )}

                      {s.steps && s.steps.length > 0 && (
                        <div style={{marginBottom:10}}>
                          <div style={{fontSize:11.5,fontWeight:700,color:"var(--text-1)",marginBottom:8}}>Recommended next steps:</div>
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            {s.steps.map((step: string, i: number)=>(
                              <div key={i} style={{display:"flex",gap:8,fontSize:12,color:"var(--text-2)",lineHeight:1.6}}>
                                <span style={{color:"var(--accent-hi)",fontWeight:700,flexShrink:0}}>{i+1}.</span>
                                <span>{step}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {s.footer && (
                        <div style={{fontSize:11,color:"var(--text-4)",lineHeight:1.6,fontStyle:"italic"}}>{s.footer}</div>
                      )}
                    </div>
                  ) : (
                    <div style={{fontSize:12.5,color:"var(--text-2)",lineHeight:1.72}}>{s.content}</div>
                  )}
                </div>
              ))}
              <div className="ai-strip" style={{marginTop:24}}>
                <span style={{color:"var(--medium-light)",fontSize:14,flexShrink:0}}>⚠</span>
                <div>
                  <div style={{fontSize:10,color:"var(--medium-light)",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em"}}>AI-Assisted Analysis Notice</div>
                  <div style={{fontSize:11,color:"var(--text-3)",marginTop:3}}>Portions of this report were generated with AI assistance. All conclusions and determinations are the responsibility of the assigned investigator. No AI assessment constitutes a criminal determination.</div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{textAlign:"center",padding:"60px 0",color:"var(--text-4)"}}>
              <div style={{fontSize:36,marginBottom:14,opacity:0.3}}>◫</div>
              <div style={{fontSize:14}}>Configure and generate a report to see preview</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}