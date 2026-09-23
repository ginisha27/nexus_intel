import { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { riskColorLight } from "../data";
import { RingScore, PulseIndicator, CustomTooltip } from "../components/shared";
import { getSocket } from "../lib/socket";

const STATUS_COLOR: Record<string,string> = {
  CRITICAL: "#dc2626", HIGH: "#ea580c", MEDIUM: "#d97706", LOW: "#16a34a",
};

export function NetworkRiskScreen({ navigate, displayId }: { navigate:(s:string,d?:any)=>void; displayId?: string | null }) {
  // If no network was explicitly selected (e.g. navigated here without
  // picking one from a table row), resolve a sensible default from the
  // live networks list rather than hardcoding any particular network id.
  const [resolvedId, setResolvedId] = useState<string | null>(displayId ?? null);
  const [network, setNetwork] = useState<any | null>(null);
  const [riskPoints, setRiskPoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcNote, setRecalcNote] = useState<string | null>(null);

  useEffect(() => {
    if (displayId) { setResolvedId(displayId); return; }
    fetch("http://localhost:4000/api/networks")
      .then(res => { if (!res.ok) throw new Error(`API ${res.status}`); return res.json(); })
      .then((data: any[]) => {
        const first = data?.[0]?.displayId ?? data?.[0]?.id;
        if (first) setResolvedId(first);
        else setError("No networks available");
      })
      .catch(err => setError(err.message));
  }, [displayId]);

  const load = useCallback(() => {
    if (!resolvedId) return;
    setLoading(true);
    Promise.all([
      fetch(`http://localhost:4000/api/networks/${encodeURIComponent(resolvedId)}`)
        .then(res => { if (!res.ok) throw new Error(`API ${res.status}`); return res.json(); }),
      fetch(`http://localhost:4000/api/networks/${encodeURIComponent(resolvedId)}/trajectory`)
        .then(res => { if (!res.ok) throw new Error(`API ${res.status}`); return res.json(); }),
    ])
      .then(([net, traj]) => {
        setNetwork(net);
        setRiskPoints(traj?.riskPoints ?? []);
        setError(null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [resolvedId]);

  useEffect(() => { load(); }, [load]);

  // Refresh on the real pipeline events instead of fabricating local state —
  // covers both incremental simulate-driven risk changes and new alerts.
  useEffect(() => {
    const socket = getSocket();
    const onEvent = (evt: any) => {
      if (!resolvedId) return;
      if (evt.type === "risk_updated" && evt.payload?.network === resolvedId) load();
      if (evt.type === "alert_generated") load();
    };
    socket.on("intelligence-event", onEvent);
    return () => { socket.off("intelligence-event", onEvent); };
  }, [resolvedId, load]);

  const handleRecalculate = async () => {
    if (!resolvedId) return;
    setRecalculating(true);
    setRecalcNote(null);
    try {
      const res = await fetch(`http://localhost:4000/api/networks/${encodeURIComponent(resolvedId)}/recalculate`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `API ${res.status}`);
      }
      setRecalcNote("Recalculated from current entity evidence.");
      load();
    } catch (err: any) {
      setRecalcNote(`Recalculate failed: ${err.message}`);
    } finally {
      setRecalculating(false);
    }
  };

  const status: string | null = network?.status ?? null;
  const statusColor = status ? (STATUS_COLOR[status] ?? "#6366f1") : "#6b7280";
  const persistedRisk: number | null = network?.risk ?? null;
  const baseline = network?.computed?.computedBaselineRisk ?? null;
  const change: number | null = network?.change ?? null;

  const chartData = riskPoints.map(p => ({
    day: p.label ?? (p.recordedAt ? new Date(p.recordedAt).toLocaleDateString() : "—"),
    score: p.score,
  }));

  // Zip network.entities with the parallel entityRiskBreakdown array
  // (same order, same source computation — see routes/networks.ts) so we
  // can show each entity's alias next to its authoritative computed risk.
  const breakdown = (network?.entities ?? []).map((e: any, i: number) => ({
    alias: e.alias,
    displayId: e.displayId,
    ...(network?.entityRiskBreakdown?.[i] ?? {}),
  }));

  return (
    <div style={{padding:"26px 28px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:22}}>
        <div>
          <div style={{fontSize:10.5,color:"var(--accent-hi)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>Network Analysis</div>
          <h1 className="section-head display" style={{fontSize:22}}>Emerging Network Detection</h1>
          <div style={{fontSize:12,color:"var(--text-3)",marginTop:3}}>
            Network ID: <span className="mono" style={{color:"var(--accent-hi)"}}>{resolvedId ?? "—"}</span>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-ghost btn-lg" onClick={handleRecalculate} disabled={recalculating || !resolvedId}>
            {recalculating ? "Recalculating…" : "Recalculate Baseline"}
          </button>
          <button className="btn btn-primary btn-lg" onClick={()=>navigate("workspace")}>Create Investigation</button>
        </div>
      </div>

      {loading && <p className="page-sub" style={{marginBottom:14}}>Loading network…</p>}
      {error && <p className="page-sub" style={{marginBottom:14,color:"var(--high-light)"}}>Couldn't reach the API ({error}).</p>}
      {recalcNote && <p className="page-sub" style={{marginBottom:14,color: recalcNote.startsWith("Recalculate failed") ? "var(--high-light)" : "var(--low-light)"}}>{recalcNote}</p>}

      {network && (
        <>
          {/* Status banner */}
          <div style={{background:`${statusColor}12`,border:`1px solid ${statusColor}38`,borderRadius:12,padding:"16px 20px",marginBottom:22,display:"flex",alignItems:"center",gap:16}}>
            <div style={{width:42,height:42,borderRadius:"50%",background:`${statusColor}20`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <PulseIndicator color={statusColor}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:700,color:statusColor,marginBottom:3}}>
                {status === "CRITICAL" || status === "HIGH" ? "Early Warning — Elevated Network Risk" : "Network Status"}
              </div>
              <div style={{fontSize:12,color:"var(--text-2)",lineHeight:1.5}}>
                Persisted risk is <strong style={{color:statusColor}}>{persistedRisk ?? "—"}</strong> ({status ?? "—"})
                {change != null && <> — changed <strong style={{color:statusColor}}>{change >= 0 ? `+${change}` : change}</strong> pts on the last pipeline event</>}.
                {baseline != null && baseline !== persistedRisk && <> Computed baseline from current entity evidence is <strong>{baseline}</strong> — click Recalculate to bring the persisted risk in line.</>}
              </div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:10,color:"var(--text-4)",marginBottom:2}}>Last Activity</div>
              <div className="mono" style={{fontSize:12,color:"var(--text-2)"}}>{network.lastActivity ? new Date(network.lastActivity).toLocaleString() : "—"}</div>
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"240px 1fr",gap:18,marginBottom:18}}>
            {/* Big score */}
            <div className="card" style={{padding:24,textAlign:"center",border:`1px solid ${statusColor}33`,boxShadow:`0 0 28px ${statusColor}10`}}>
              <div style={{fontSize:10.5,color:"var(--text-4)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:16}}>Persisted Network Risk</div>
              <div style={{display:"flex",justifyContent:"center",marginBottom:12}}>
                {persistedRisk != null ? <RingScore score={persistedRisk} size={150}/> : <div style={{width:150,height:150,borderRadius:"50%",border:"1px dashed var(--border)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-4)",fontSize:12}}>—</div>}
              </div>
              <span className="badge" style={{fontSize:11,background:`${statusColor}20`,color:statusColor,border:`1px solid ${statusColor}40`}}>{status ?? "UNKNOWN"} — {resolvedId}</span>
              <div style={{marginTop:14,padding:"8px 12px",background:`${statusColor}10`,borderRadius:8}}>
                <div style={{fontSize:11,color:statusColor}}>
                  Computed baseline (from current entity evidence): {baseline != null ? baseline : "Not calculated"}
                </div>
              </div>
            </div>

            {/* Risk evolution */}
            <div className="card" style={{padding:20}}>
              <div style={{fontSize:13,fontWeight:600,color:"var(--text-1)",marginBottom:4}}>Risk Evolution</div>
              <div style={{fontSize:11,color:"var(--text-3)",marginBottom:16}}>Persisted network risk over recorded history (simulate/recalculate events)</div>
              {chartData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={196}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="nr-g" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={statusColor} stopOpacity="0.28"/>
                          <stop offset="100%" stopColor={statusColor} stopOpacity="0.02"/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
                      <XAxis dataKey="day" tick={{fill:"var(--text-4)",fontSize:10}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fill:"var(--text-4)",fontSize:10}} axisLine={false} tickLine={false} domain={[0,100]}/>
                      <Tooltip content={<CustomTooltip/>}/>
                      <Area type="monotone" dataKey="score" stroke={statusColor} strokeWidth={2.5} fill="url(#nr-g)" name="Risk Score"
                        dot={{fill:statusColor,r:5,stroke:"var(--card)",strokeWidth:2}}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <div style={{textAlign:"center",padding:"40px 0",color:"var(--text-4)",fontSize:12}}>No historical risk data available yet.</div>
              )}
            </div>
          </div>

          {/* Baseline evidence stats */}
          <div className="card" style={{padding:22,marginBottom:18}}>
            <div style={{fontSize:13,fontWeight:600,color:"var(--text-1)",marginBottom:6}}>Computed Baseline Evidence</div>
            <div style={{fontSize:11,color:"var(--text-3)",marginBottom:16}}>{network.computed?.explanation ?? "—"}</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12}}>
              {[
                {label:"Entities Considered", val: network.computed?.entitiesConsidered},
                {label:"Excluded (No Evidence)", val: network.computed?.entitiesExcludedNoEvidence},
                {label:"Max Entity Risk", val: network.computed?.maxEntityRisk ?? "—"},
                {label:"Avg Entity Risk", val: network.computed?.averageEntityRisk ?? "—"},
                {label:"High-Risk Entities", val: network.computed?.highRiskEntityCount},
              ].map((s,i)=>(
                <div key={i} style={{background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"16px 14px",borderTop:`3px solid ${statusColor}`}}>
                  <div className="display" style={{fontSize:24,fontWeight:700,color:statusColor,marginBottom:6}}>{s.val ?? "—"}</div>
                  <div style={{fontSize:11,color:"var(--text-3)",lineHeight:1.4}}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
            {/* Entity risk breakdown */}
            <div className="card" style={{padding:20}}>
              <div style={{fontSize:13,fontWeight:600,color:"var(--text-1)",marginBottom:14}}>Entity Risk Breakdown</div>
              <table className="data-table">
                <thead><tr><th>Entity</th><th>Risk</th><th>Confidence</th><th>Correlation</th></tr></thead>
                <tbody>
                  {breakdown.length === 0 && <tr><td colSpan={4} style={{color:"var(--text-4)",fontSize:12}}>No entities in this network.</td></tr>}
                  {breakdown.map((e: any) => (
                    <tr key={e.displayId ?? e.alias} onClick={()=>navigate("entity", e)} style={{cursor:"pointer"}}>
                      <td style={{fontSize:12,color:"var(--text-1)"}}>{e.alias}</td>
                      <td>{e.risk != null ? <span style={{fontWeight:700,color:riskColorLight(e.risk)}}>{e.risk}</span> : <span style={{color:"var(--text-4)"}}>Not calculated</span>}</td>
                      <td style={{fontSize:12}}>{e.confidence != null ? `${e.confidence}%` : "—"}</td>
                      <td style={{fontSize:11,color:"var(--text-3)"}}>{e.correlationMethod ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Network alerts */}
            <div className="card" style={{padding:20}}>
              <div style={{fontSize:13,fontWeight:600,color:"var(--text-1)",marginBottom:14}}>Network Alerts</div>
              {(!network.alerts || network.alerts.length === 0) && <div style={{fontSize:12,color:"var(--text-4)"}}>No alerts recorded for this network.</div>}
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {(network.alerts ?? []).map((a: any) => (
                  <div key={a.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderRadius:8,background:"rgba(255,255,255,0.03)"}}>
                    <div>
                      <div style={{fontSize:12,color:"var(--text-1)",fontWeight:500}}>{a.title}</div>
                      <div className="mono-sm" style={{color:"var(--text-4)"}}>{a.displayId ?? a.id} · {a.status}</div>
                    </div>
                    <span style={{fontWeight:700,color:riskColorLight(a.severity)}}>{a.severity}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}