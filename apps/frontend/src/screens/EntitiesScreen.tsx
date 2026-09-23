import { useState, useEffect } from "react";
import { riskColorLight } from "../data";
import { RiskBadge } from "../components/shared";
import { apiGet } from "../lib/api";
import { getSocket } from "../lib/socket";

export function EntitiesScreen({ navigate }: { navigate:(s:string,d?:any)=>void }) {
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);

  const loadEntities = () => {
    apiGet<any[]>("/api/entities")
      .then(data => { setEntities(data); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadEntities(); }, []);

  // Live pipeline events can shift an entity's correlation/computed risk
  // (new wallet evidence, a fresh correlation pass) — re-pull the
  // authoritative list rather than letting this screen go stale until
  // the next manual reload.
  useEffect(() => {
    const socket = getSocket();
    const onEvent = (evt: any) => {
      if (evt.type === "correlation" || evt.type === "risk_updated" || evt.type === "wallet_updated") loadEntities();
    };
    socket.on("intelligence-event", onEvent);
    return () => { socket.off("intelligence-event", onEvent); };
  }, []);

  return (
    <div style={{padding:"26px 28px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
        <div>
          <h1 className="section-head">Threat Actors</h1>
          <p className="page-sub">All resolved intelligence threat actors with cross-source correlation.</p>
        </div>
      </div>
      {loading && <p className="page-sub" style={{marginBottom:12}}>Loading threat actors…</p>}
      {error && <p className="page-sub" style={{marginBottom:12,color:"var(--high-light)"}}>Couldn't reach the API ({error}).</p>}
      {!loading && !error && entities.length === 0 && <p className="page-sub" style={{marginBottom:12}}>No threat actors recorded yet.</p>}
      <div className="card">
        <table className="data-table">
          <thead>
            <tr><th>Threat Actor</th><th>Risk Score</th><th>Confidence</th><th>Sources</th><th>First Seen</th><th>Last Seen</th><th>Risk Δ</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {entities.map(e=>(
              <tr key={e.id} onClick={()=>navigate("entity",e)}>
                <td>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:32,height:32,borderRadius:"50%",background:"rgba(99,102,241,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"var(--accent-hi)",flexShrink:0}}>◈</div>
                    <div>
                      <div style={{fontSize:13,color:"var(--text-1)",fontWeight:500}}>{e.alias}</div>
                      <div className="mono-sm" style={{color:"var(--text-4)"}}>{e.displayId ?? e.id}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div style={{display:"flex",alignItems:"center",gap:9}}>
                    <span className="display" style={{fontWeight:700,color:riskColorLight(e.risk),fontSize:16}}>{e.risk}</span>
                    <RiskBadge score={e.risk}/>
                  </div>
                </td>
                <td>{e.confidence != null ? `${e.confidence}%` : "—"}</td>
                <td>
                  <div style={{display:"flex",flexDirection:"column",gap:2}}>
                    <span style={{fontSize:11,color:"var(--text-3)"}}>{e.identifiers?.length ?? 0} identifiers</span>
                    {e.correlation?.confidence > 0 && (
                      <span style={{fontSize:10,color:"var(--accent-hi)"}}>Correlated · {e.correlation.confidence}% conf.</span>
                    )}
                  </div>
                </td>
                <td>{e.firstSeen ? new Date(e.firstSeen).toLocaleDateString() : "—"}</td>
                <td>{e.lastSeen ? new Date(e.lastSeen).toLocaleDateString() : "—"}</td>
                <td>{e.riskChange != null ? <span style={{color:"var(--low-light)",fontWeight:600}}>+{e.riskChange}</span> : <span style={{color:"var(--text-4)"}}>—</span>}</td>
                <td onClick={ev=>ev.stopPropagation()}>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn btn-primary btn-sm" onClick={()=>navigate("entity",e)}>Profile</button>
                    <button className="btn btn-ghost btn-sm" onClick={()=>navigate("graph")}>Relationship Graph</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}