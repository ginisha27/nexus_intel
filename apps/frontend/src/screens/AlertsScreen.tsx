import { useState, useEffect, useRef } from "react";
import { riskColor, riskColorLight, riskBg, riskBorder } from "../data";
import { RiskBadge, PulseIndicator } from "../components/shared";
import { getSocket } from "../lib/socket";
import { apiGet, apiPatch } from "../lib/api";

export function AlertsScreen({ navigate, highlightId }: { navigate:(s:string,d?:any)=>void; highlightId?: string | null }) {
  const [tab, setTab] = useState("All");
  const tabs = ["All","Critical","High","Medium","Resolved"];
  const [alertRows, setAlertRows] = useState<any[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState<string|null>(null);
  const [updatingId, setUpdatingId] = useState<string|null>(null);
  const [sortBy, setSortBy] = useState<"newest"|"risk">("newest");
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const loadAlerts = () => {
    apiGet<any[]>("/api/alerts")
      .then(data => {
        // normalise DB rows to match the shape the UI expects. Note:
        // a.severity is the historical value at alert-creation time and is
        // NEVER replaced with a linked entity's current computed risk —
        // only the per-entity display (below) uses the live number.
        const normalised = data.map((a: any) => ({
          ...a,
          severity: a.severity ?? 50,
          status: (a.status ?? "NEW").toLowerCase(),
          time: a.createdAt ? new Date(a.createdAt).toLocaleString() : a.time ?? "",
          network: a.network?.displayId ?? a.network ?? null,
          entities: (a.entities ?? []).map((ae: any) => ({
            alias: ae.entity?.alias ?? ae.entity?.displayId ?? String(ae),
            currentRisk: ae.entity?.risk ?? null,
          })),
          title: a.title ?? a.type ?? "Alert",
          reason: a.reason ?? a.description ?? "",
        }));
        setAlertRows(normalised);
        setAlertsError(null);
      })
      .catch(err => setAlertsError(err.message))
      .finally(() => setAlertsLoading(false));
  };

  useEffect(() => { loadAlerts(); }, []);

  // Deep-link from elsewhere (e.g. Overview's Live Intelligence Feed):
  // make sure the target alert isn't hidden by whatever tab filter was
  // last selected, then scroll to and briefly highlight it once it's
  // actually in the DOM.
  useEffect(() => { if (highlightId) setTab("All"); }, [highlightId]);

  useEffect(() => {
    if (!highlightId) return;
    const el = cardRefs.current[highlightId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, alertRows]);

  // Live pipeline events can create new alerts or change entity risk — never
  // fabricate/duplicate an alert locally, just re-pull the authoritative list.
  useEffect(() => {
    const socket = getSocket();
    const onEvent = (evt: any) => {
      if (evt.type === "alert_generated" || evt.type === "risk_updated") loadAlerts();
    };
    socket.on("intelligence-event", onEvent);
    return () => { socket.off("intelligence-event", onEvent); };
  }, []);

  const filtered = alertRows.filter(a=>{
    if(tab==="All") return true;
    if(tab==="Resolved") return a.status==="resolved";
    if(tab==="Critical") return a.severity>=80&&a.status!=="resolved";
    if(tab==="High") return a.severity>=60&&a.severity<80&&a.status!=="resolved";
    if(tab==="Medium") return a.severity>=40&&a.severity<60&&a.status!=="resolved";
    return true;
  }).sort((a,b)=>{
    if(sortBy==="risk") return b.severity-a.severity;
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bt-at;
  });

  const updateStatus = async (displayId: string, status: "REVIEWED" | "RESOLVED") => {
    setUpdatingId(displayId);
    try {
      await apiPatch(`/api/alerts/${encodeURIComponent(displayId)}/status`, { status });
      loadAlerts();
    } catch {
      // loadAlerts() failing to update is surfaced via the normal error banner on next load
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div style={{padding:"26px 28px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
        <div>
          <h1 className="section-head">Alert Center</h1>
          <p className="page-sub">Monitor and triage intelligence alerts by severity and status.</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <select className="input" style={{width:"auto",padding:"7px 12px",fontSize:12}} value={sortBy} onChange={e=>setSortBy(e.target.value as "newest"|"risk")}>
            <option style={{background:"#0f1420"}} value="newest">Sort: Newest First</option>
            <option style={{background:"#0f1420"}} value="risk">Sort: Risk High→Low</option>
          </select>
        </div>
      </div>

      {alertsLoading && <p className="page-sub" style={{marginBottom:12}}>Loading alerts…</p>}
      {alertsError && <p className="page-sub" style={{marginBottom:12,color:"var(--high-light)"}}>Couldn't reach the API ({alertsError}).</p>}
      {!alertsLoading && !alertsError && alertRows.length === 0 && <p className="page-sub" style={{marginBottom:12}}>No alerts recorded yet.</p>}
      <div className="tab-strip" style={{marginBottom:18}}>
        {tabs.map(t=>{
          const count = t==="All"?alertRows.length:t==="Resolved"?alertRows.filter(a=>a.status==="resolved").length:t==="Critical"?alertRows.filter(a=>a.severity>=80&&a.status!=="resolved").length:t==="High"?alertRows.filter(a=>a.severity>=60&&a.severity<80&&a.status!=="resolved").length:alertRows.filter(a=>a.severity>=40&&a.severity<60&&a.status!=="resolved").length;
          return (
            <button key={t} className={`tab ${tab===t?"active":""}`} onClick={()=>setTab(t)}>
              {t} <span style={{marginLeft:4,fontSize:10,opacity:0.7}}>({count})</span>
            </button>
          );
        })}
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:11}}>
        {filtered.map((a,i)=>{
          const isHighlighted = !!highlightId && (a.displayId === highlightId || a.id === highlightId);
          return (
          <div key={a.id}
            ref={el => { cardRefs.current[a.displayId ?? a.id] = el; }}
            className={`card anim-alert delay-${Math.min(i+1,5)}`}
            style={{padding:"18px 20px",transition:"border-color 0.13s,box-shadow 0.13s",cursor:"pointer",
              ...(isHighlighted ? {
                borderColor: riskColor(a.severity),
                boxShadow: `0 0 0 1px ${riskColor(a.severity)}, 0 4px 24px ${riskColor(a.severity)}30`,
              } : {})}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor=`${riskColor(a.severity)}35`;(e.currentTarget as HTMLElement).style.boxShadow=`0 4px 20px ${riskColor(a.severity)}0a`;}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=isHighlighted?riskColor(a.severity):"var(--border)";(e.currentTarget as HTMLElement).style.boxShadow=isHighlighted?`0 0 0 1px ${riskColor(a.severity)}, 0 4px 24px ${riskColor(a.severity)}30`:"none";}}>
            <div style={{display:"flex",gap:16,alignItems:"flex-start"}}>
              {/* Severity icon */}
              <div style={{width:44,height:44,borderRadius:10,background:riskBg(a.severity),border:`1px solid ${riskBorder(a.severity)}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <PulseIndicator color={riskColor(a.severity)}/>
              </div>

              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:6}}>
                  <RiskBadge score={a.severity}/>
                  <span className="mono-sm" style={{color:"var(--text-4)"}}>{a.id}</span>
                  {a.status==="resolved"&&<span className="badge badge-low">RESOLVED</span>}
                  {a.network&&<span className="badge badge-accent">{a.network}</span>}
                  {isHighlighted&&<span className="badge badge-accent" style={{background:`${riskColor(a.severity)}22`,color:riskColor(a.severity)}}>JUMPED HERE</span>}
                </div>
                <div style={{fontSize:14,fontWeight:600,color:"var(--text-1)",marginBottom:6}}>{a.title}</div>
                <div style={{fontSize:12,color:"var(--text-3)",lineHeight:1.5,marginBottom:10}}>{a.reason}</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {a.entities.map((e: any, idx: number)=>{
                    const alias = typeof e === "string" ? e : e.alias;
                    const currentRisk = typeof e === "string" ? null : e.currentRisk;
                    return (
                      <span key={`${alias}-${idx}`} className="mono-sm" style={{background:"rgba(99,102,241,0.09)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:4,padding:"2px 8px",color:"var(--accent-hi)"}}>
                        {alias}{currentRisk != null && <span style={{color:"var(--text-4)"}}> · current risk {currentRisk}</span>}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8,flexShrink:0}}>
                <div style={{textAlign:"right"}}>
                  <div className="display" style={{fontSize:22,fontWeight:700,color:riskColorLight(a.severity)}}>{a.severity}</div>
                  <div style={{fontSize:10,color:"var(--text-4)"}}>Risk Score</div>
                </div>
                <div style={{fontSize:11,color:"var(--text-4)"}}>{a.time}</div>
                <div style={{display:"flex",gap:6}}>
                  <button className="btn btn-primary btn-sm" onClick={()=>a.network ? navigate("network-risk", a.network) : navigate("entities")}>Investigate</button>
                  <button className="btn btn-ghost btn-sm" onClick={()=>navigate("graph")}>View Graph</button>
                  {a.status!=="resolved" && (
                    <button className="btn btn-ghost btn-sm" disabled={updatingId===a.displayId} onClick={()=>updateStatus(a.displayId, "RESOLVED")}>
                      {updatingId===a.displayId ? "…" : "Dismiss"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}