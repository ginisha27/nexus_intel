import { useState, useEffect } from "react";
import { riskColorLight, riskBg, riskBorder } from "../data";
import { RingScore, RiskBadge } from "../components/shared";
import { apiGet } from "../lib/api";

export function ListingsScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<any|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);

  useEffect(() => {
    apiGet<any[]>("/api/listings")
      .then(data => { setRows(data); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const fmtDate = (v:any) => {
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
  };
  const signalsList = (v:any): string[] => Array.isArray(v) ? v : [];
  const signalsLabel = (v:any) => Array.isArray(v) ? (v.length ? v.join(", ") : "—") : (v!=null ? `${v} detected` : "—");
  const priceLabel = (v:any) => v!=null ? `$${Number(v).toFixed(2)}` : "—";

  return (
    <div style={{padding:"26px 28px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
        <div>
          <h1 className="section-head">Dark Web Intelligence</h1>
          <p className="page-sub">Collected dark-web intelligence records used for threat-actor correlation. Demo records are synthetic.</p>
        </div>
      </div>
      {loading && <p className="page-sub" style={{marginBottom:12}}>Loading listings…</p>}
      {error && <p className="page-sub" style={{marginBottom:12,color:"var(--high-light)"}}>Couldn't reach the API ({error}).</p>}
      {!loading && !error && rows.length === 0 && <p className="page-sub" style={{marginBottom:12}}>No listings recorded yet.</p>}
      <div style={{display:"grid",gridTemplateColumns:sel?"minmax(0, 1fr) minmax(300px, 360px)":"minmax(0, 1fr)",gap:16,transition:"all 0.25s",alignItems:"start"}}>
        <div className="card" style={{minWidth:0,overflowX:"auto"}}>
          <table className="data-table" style={{minWidth:1080}}>
            <thead><tr><th>Record ID</th><th>Source</th><th>Threat Actor</th><th>Intelligence</th><th>Indicator Type</th><th>Confidence</th><th>Signals</th><th>First Seen</th><th>Last Seen</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map(l=>(
                <tr key={l.id} className={sel?.id===l.id?"selected":""} onClick={()=>setSel(l.id===sel?.id?null:l)}>
                  <td><span className="mono" style={{color:"var(--accent-hi)",fontSize:12}}>{l.displayId ?? l.id}</span></td>
                  <td>{l.marketplace ?? (typeof l.source === "string" ? l.source : l.source?.name) ?? "—"}</td>
                  <td>{l.vendorAlias ?? "—"}</td>
                  <td style={{maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={l.title ?? undefined}>{l.title ?? "—"}</td>
                  <td><span className="badge badge-accent" style={{fontSize:9}}>{l.category}</span></td>
                  <td>
                    <div style={{display:"flex",alignItems:"center",gap:7}}>
                      <span style={{fontWeight:700,color:riskColorLight(l.risk)}}>{l.risk}</span>
                      <RiskBadge score={l.risk}/>
                    </div>
                  </td>
                  <td>{signalsList(l.signals).length}</td>
                  <td>{fmtDate(l.firstSeen ?? l.first)}</td>
                  <td>{fmtDate(l.lastSeen ?? l.last)}</td>
                  <td>
                    <span style={{fontSize:11,padding:"2px 8px",borderRadius:4,background:l.status==="Flagged"||l.status==="flagged"?riskBg(80):l.status==="Under Review"?riskBg(60):l.status==="Monitoring"?riskBg(40):"rgba(255,255,255,0.04)",color:l.status==="Flagged"||l.status==="flagged"?riskColorLight(80):l.status==="Under Review"?riskColorLight(60):l.status==="Monitoring"?riskColorLight(40):"var(--text-3)",border:`1px solid ${l.status==="Flagged"||l.status==="flagged"?riskBorder(80):l.status==="Under Review"?riskBorder(60):l.status==="Monitoring"?riskBorder(40):"var(--border)"}`}}>{l.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sel && (
          <div className="card anim-slide-r" style={{padding:20,minWidth:0,width:"100%",boxSizing:"border-box",height:"fit-content",maxHeight:"calc(100vh - 120px)",overflowY:"auto",position:"sticky",top:16}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:600,color:"var(--text-1)"}}>Intelligence Record</div>
              <button onClick={()=>setSel(null)} style={{background:"none",border:"none",color:"var(--text-4)",cursor:"pointer",fontSize:20,lineHeight:1}}>×</button>
            </div>
            <div className="mono" style={{fontSize:11,color:"var(--accent-hi)",marginBottom:4}}>{sel.displayId ?? sel.id}</div>
            {sel.title && <div style={{fontSize:13,color:"var(--text-1)",marginBottom:12}}>{sel.title}</div>}
            <div style={{display:"flex",justifyContent:"center",marginBottom:16}}><RingScore score={sel.risk} size={100}/></div>

            {[
              {l:"Source",v:sel.marketplace ?? (typeof sel.source === "string" ? sel.source : sel.source?.name) ?? "—"},
              {l:"Threat Actor",v:sel.vendorAlias ?? "—"},
              {l:"Category",v:sel.category},
              {l:"Risk Score",v:`${sel.risk} / 100`},
              {l:"Confidence",v:`${sel.risk ?? 0} / 100`},
              {l:"Record Type",v:sel.category ?? "Threat Actor Intelligence"},
              {l:"First Seen",v:fmtDate(sel.firstSeen ?? sel.first)},{l:"Last Seen",v:fmtDate(sel.lastSeen ?? sel.last)},{l:"Status",v:sel.status},
            ].map(item=>(
              <div key={item.l} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
                <span style={{fontSize:11,color:"var(--text-4)"}}>{item.l}</span>
                <span style={{fontSize:12,color:"var(--text-2)",textAlign:"right",overflowWrap:"anywhere",maxWidth:"62%"}}>{item.v}</span>
              </div>
            ))}

            {(sel.patterns ?? signalsList(sel.signals)).length>0 && (
              <div style={{marginTop:14}}>
                <div style={{fontSize:11,color:"var(--text-4)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Correlation Signals</div>
                {(sel.patterns ?? signalsList(sel.signals)).map((p:string)=>(
                  <div key={p} style={{display:"flex",gap:7,alignItems:"center",marginBottom:6}}>
                    <div style={{width:5,height:5,borderRadius:"50%",background:"var(--accent)",flexShrink:0}}/>
                    <span style={{fontSize:12,color:"var(--text-2)"}}>{p}</span>
                  </div>
                ))}
              </div>
            )}

            {(sel.entities ?? []).length>0 && (
              <div style={{marginTop:12}}>
                <div style={{fontSize:11,color:"var(--text-4)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Related Threat Actors</div>
                {sel.entities.map((e:string)=>(
                  <span key={e} className="mono-sm" style={{display:"inline-block",margin:"0 6px 6px 0",background:"var(--accent-dim)",border:"1px solid rgba(99,102,241,0.22)",borderRadius:4,padding:"2px 8px",color:"var(--accent-hi)"}}>{e}</span>
                ))}
              </div>
            )}

            <button className="btn btn-primary" style={{width:"100%",justifyContent:"center",marginTop:16}}>Add to Investigation</button>
          </div>
        )}
      </div>
    </div>
  );
}