import { useState, useEffect, useRef } from "react";
import {
  AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { riskColor, riskColorLight } from "../data";
import {
  Sparkline, CustomTooltip, PulseIndicator, RiskBadge,
} from "../components/shared";
import { getSocket, EVENT_META } from "../lib/socket";
import { apiGet } from "../lib/api";

export function OverviewScreen({ navigate }: { navigate:(s:string,d?:any)=>void }) {
  const [liveNetworks, setLiveNetworks] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any[]>([]);
  const [activityTimeline, setActivityTimeline] = useState<any[]>([]);
  const [riskDistribution, setRiskDistribution] = useState<any[]>([]);

  // ── Wallet activity state ────────────────────────────────────────────────
  // Independent of loadDashboard() above — refreshed on mount and again
  // every time a wallet_updated socket event lands, so the card below
  // always reflects the freshly computed risk from the latest transaction
  // evidence rather than a stale snapshot.
  const [walletRows, setWalletRows] = useState<any[]>([]);
  const [walletsUpdatedAt, setWalletsUpdatedAt] = useState<Date | null>(null);

  // ── Live feed state ──────────────────────────────────────────────────────
  const [feedEvents, setFeedEvents] = useState<any[]>([]);
  const [connected, setConnected]   = useState(false);
  // Whether the UI is currently accepting/processing incoming live-feed
  // events. The producer (see /producer) runs as its own independent
  // process — the frontend has no way to actually start/stop it — so this
  // toggle controls whether THIS screen applies incoming events, and the
  // separate connection badge above still reflects the real socket
  // connected/disconnected state regardless of this toggle.
  const [liveFeedOn, setLiveFeedOn] = useState(true);
  const liveFeedOnRef = useRef(true);
  useEffect(() => { liveFeedOnRef.current = liveFeedOn; }, [liveFeedOn]);
  const feedRef = useRef<HTMLDivElement>(null);

  // ── Fetch initial networks + KPIs + analytics ────────────────────────────
  const loadDashboard = () => {
    apiGet<any[]>("/api/networks")
      .then(data => {
        const normalised = data.map((n: any) => ({
          ...n,
          id: n.displayId ?? n.id,
          risk: n.risk ?? 0,
          change: n.riskDelta ?? n.change ?? 0,
          entities: n._count?.entities ?? n.entities ?? 0,
          last: n.updatedAt ? new Date(n.updatedAt).toLocaleDateString() : n.last ?? "—",
        }));
        setLiveNetworks(normalised);
      })
      .catch(() => {});
    apiGet<any>("/api/dashboard/kpis")
      .then(data => setKpis(data.kpis ?? []))
      .catch(() => {});
    apiGet<any>("/api/analytics/overview")
      .then(data => {
        setActivityTimeline(data.activityTimeline ?? []);
        setRiskDistribution(data.riskDistribution ?? []);
      })
      .catch(() => {});
  };

  // ── Fetch wallet risk (highest-risk wallets, for the Wallet Activity
  // card) — same /api/wallets endpoint BlockchainScreen.tsx uses, just a
  // lighter normalisation since this card only needs id + risk.
  const loadWallets = () => {
    apiGet<any[]>("/api/wallets")
      .then(data => {
        const normalised = data
          .map((w: any) => ({ ...w, id: w.displayId ?? w.id, risk: w.risk ?? 0 }))
          .sort((a, b) => b.risk - a.risk);
        setWalletRows(normalised);
        setWalletsUpdatedAt(new Date());
      })
      .catch(() => {});
  };

  useEffect(() => { loadDashboard(); loadWallets(); }, []);

  // ── Socket.IO subscription ───────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();

    const onConnect    = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onEvent      = (evt: any) => {
      if (!liveFeedOnRef.current) return; // live feed paused — ignore incoming events

      const now = new Date();
      const meta = EVENT_META[evt.type] ?? { label: evt.type, icon:"◎", color:"var(--text-3)" };

      // Build human-readable description from payload
      let detail = "";
      if (evt.type === "event_detected")  detail = evt.payload?.description ?? "";
      if (evt.type === "correlation")     detail = `${evt.payload?.entity ?? "Entity"} matched at ${evt.payload?.confidence ?? "?"}% confidence`;
      if (evt.type === "risk_updated")    detail = `${evt.payload?.network}: ${evt.payload?.from} → ${evt.payload?.to}`;
      if (evt.type === "alert_generated") detail = evt.payload?.title ?? "New alert created";
      if (evt.type === "wallet_updated")  detail = `${evt.payload?.wallet ?? "Wallet"}: ${evt.payload?.direction === "OUTBOUND" ? "-" : "+"}${evt.payload?.amountBtcEq ?? "?"} BTC-eq (${evt.payload?.entity ?? "entity"})`;

      // alert_generated payload is the freshly created Alert row itself
      // (see intelligencePipeline.ts's emit("alert_generated", alert)), so
      // its displayId is what AlertsScreen matches on to jump to/highlight
      // this exact alert when the feed item is clicked below.
      const alertId = evt.type === "alert_generated" ? (evt.payload?.displayId ?? null) : null;

      // wallet_updated always carries a real Wallet.displayId — jump
      // straight to that wallet in Blockchain Intelligence.
      const walletId = evt.type === "wallet_updated" ? (evt.payload?.wallet ?? null) : null;

      // correlation always carries the real correlated Entity's
      // displayId (see intelligencePipeline.ts) — used to fetch the full
      // entity record before navigating (EntityScreen needs the whole
      // object, not just an id).
      const entityDisplayId = evt.type === "correlation" ? (evt.payload?.entityDisplayId ?? null) : null;

      // event_detected now carries a real Listing.displayId when this
      // vendor has existing listing evidence to attribute it to (see
      // intelligencePipeline.ts) — honestly null otherwise, in which
      // case the feed item just isn't clickable.
      const listingId = evt.type === "event_detected" ? (evt.payload?.listingId ?? null) : null;

      setFeedEvents(prev => [{
        id: `${evt.type}-${now.getTime()}`,
        type: evt.type,
        meta,
        detail,
        alertId,
        walletId,
        entityDisplayId,
        listingId,
        time: now.toLocaleTimeString(),
      }, ...prev].slice(0, 50)); // keep last 50

      // If a risk_updated or alert arrived, refresh networks + KPIs +
      // analytics so the whole dashboard reflects the new state live,
      // not just the feed list.
      if (evt.type === "risk_updated" || evt.type === "alert_generated") {
        loadDashboard();
      }

      // New transaction evidence landed — refetch wallets so the Wallet
      // Activity card shows the freshly computed risk immediately, rather
      // than waiting for the next full dashboard refresh.
      if (evt.type === "wallet_updated") {
        loadWallets();
      }
    };

    if (socket.connected) setConnected(true);
    socket.on("connect",             onConnect);
    socket.on("disconnect",          onDisconnect);
    socket.on("intelligence-event",  onEvent);

    return () => {
      socket.off("connect",            onConnect);
      socket.off("disconnect",         onDisconnect);
      socket.off("intelligence-event", onEvent);
    };
  }, []);

  // Auto-scroll feed to top when new events arrive
  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [feedEvents.length]);

  // ── Live feed toggle ──────────────────────────────────────────────────────
  // Purely a local pause/resume for this screen's handling of incoming
  // socket events (see the liveFeedOnRef check in onEvent above). Does NOT
  // start or stop the producer process itself — that runs independently
  // and keeps posting to the backend either way.
  const toggleLiveFeed = () => setLiveFeedOn(v => !v);

  // ── Live feed click-through ─────────────────────────────────────────────
  // Each feed item type carries a different kind of real target (see the
  // payload fields captured in onEvent above): alerts and wallets carry an
  // id the destination screen can select directly; a correlated entity
  // only carries a displayId, and EntityScreen needs the FULL entity
  // record (see navigate("entity", row) elsewhere in the app), so that
  // one is fetched first.
  const handleFeedClick = (evt: any) => {
    if (evt.alertId) { navigate("alerts", { displayId: evt.alertId }); return; }
    if (evt.walletId) { navigate("blockchain", { displayId: evt.walletId }); return; }
    if (evt.listingId) { navigate("listings", { displayId: evt.listingId }); return; }
    if (evt.entityDisplayId) {
      apiGet<any>(`/api/entities/${encodeURIComponent(evt.entityDisplayId)}`)
        .then(entity => navigate("entity", entity))
        .catch(() => {}); // entity may since have been removed — just no-op rather than navigating with stale/partial data
    }
  };

  const feedClickTarget = (evt: any): boolean =>
    !!(evt.alertId || evt.walletId || evt.listingId || evt.entityDisplayId);

  return (
    <div style={{padding:"26px 28px"}} className="anim-fade-up">
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:22}}>
        <div>
          <h1 className="section-head">Threat Actor Intelligence Overview</h1>
          <p className="page-sub">Monitor threat actors, cross-source correlations, infrastructure indicators, and active investigations.</p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {/* Connection badge */}
          <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:6,
            background:connected?"rgba(22,163,74,0.08)":"rgba(100,100,100,0.08)",
            border:connected?"1px solid rgba(22,163,74,0.2)":"1px solid rgba(100,100,100,0.2)"}}>
            <PulseIndicator color={connected?"#16a34a":"#6b7280"}/>
            <span style={{fontSize:10.5,fontWeight:600,color:connected?"var(--low-light)":"var(--text-4)"}}>
              {connected?"Live":"Offline"}
            </span>
          </div>
          <button
            className={`btn btn-sm ${liveFeedOn?"btn-primary":"btn-ghost"}`}
            onClick={toggleLiveFeed}
            style={{minWidth:200,justifyContent:"center"}}>
            {liveFeedOn
              ? <>⏸ Stop Live Feed</>
              : <>▶ Start Live Feed</>}
          </button>
          <button className="btn btn-primary btn-sm" onClick={()=>navigate("investigations",{openNew:true})}>+ New Investigation</button>
        </div>
      </div>

      {/* KPI row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:13,marginBottom:22}}>
        {kpis.map((k,i)=>(
          <div key={k.label} className={`card card-hover anim-fade-up delay-${i+1}`} style={{padding:"16px 18px",position:"relative"}}>
            <div style={{fontSize:10,color:"var(--text-3)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10}}>{k.label}</div>
            <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between"}}>
              <div className="display" style={{fontSize:28,fontWeight:700,color:"var(--text-1)",lineHeight:1}}>{k.value}</div>
              <Sparkline data={k.spark} color={k.accent}/>
            </div>
            <div style={{position:"absolute",top:14,right:14,width:5,height:5,borderRadius:"50%",background:k.accent,boxShadow:`0 0 8px ${k.accent}80`}}/>
          </div>
        ))}
      </div>

      {/* Main charts row */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:16,marginBottom:16}}>
        {/* Timeline */}
        <div className="card" style={{padding:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:"var(--text-1)"}}>Threat Actor Activity Timeline</div>
              <div style={{fontSize:11,color:"var(--text-3)"}}>Correlation and attribution signals — last 30 days</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              {["7D","14D","30D"].map(t=>(
                <button key={t} className={`tab ${t==="30D"?"active":""}`} style={{padding:"3px 9px",fontSize:11}}>{t}</button>
              ))}
            </div>
          </div>
          {activityTimeline.length === 0 ? (
            <div style={{padding:"60px 0",textAlign:"center",color:"var(--text-4)",fontSize:12}}>No activity data yet.</div>
          ) : (
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={activityTimeline}>
              <defs>
                <linearGradient id="tl-risk" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.28"/>
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02"/>
                </linearGradient>
                <linearGradient id="tl-alert" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#dc2626" stopOpacity="0.18"/>
                  <stop offset="100%" stopColor="#dc2626" stopOpacity="0.01"/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
              <XAxis dataKey="day" tick={{fill:"var(--text-4)",fontSize:10}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fill:"var(--text-4)",fontSize:10}} axisLine={false} tickLine={false}/>
              <Tooltip content={<CustomTooltip/>}/>
              <Area type="monotone" dataKey="risk" stroke="#818cf8" strokeWidth={2} fill="url(#tl-risk)" name="Risk Score"/>
              <Area type="monotone" dataKey="alerts" stroke="#f87171" strokeWidth={1.5} fill="url(#tl-alert)" name="Alerts"/>
            </AreaChart>
          </ResponsiveContainer>
          )}
        </div>

        {/* Risk donut */}
        <div className="card" style={{padding:20}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--text-1)",marginBottom:4}}>Risk Distribution</div>
          <div style={{fontSize:11,color:"var(--text-3)",marginBottom:12}}>Entities by risk level</div>
          {riskDistribution.every(d=>d.value===0) ? (
            <div style={{padding:"40px 0",textAlign:"center",color:"var(--text-4)",fontSize:12}}>No entities recorded yet.</div>
          ) : (
          <ResponsiveContainer width="100%" height={170}>
            <PieChart>
              <Pie data={riskDistribution} cx="50%" cy="50%" innerRadius={52} outerRadius={76} paddingAngle={3} dataKey="value">
                {riskDistribution.map((e,i)=>(
                  <Cell key={i} fill={e.color} stroke="transparent" opacity={0.9}/>
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip/>}/>
            </PieChart>
          </ResponsiveContainer>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:4}}>
            {riskDistribution.map(d=>(
              <div key={d.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:11.5}}>
                <div style={{display:"flex",alignItems:"center",gap:7,color:"var(--text-2)"}}>
                  <div style={{width:8,height:8,borderRadius:2,background:d.color,flexShrink:0}}/>
                  {d.name}
                </div>
                <span style={{color:"var(--text-3)"}}>{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:16}}>
        {/* Emerging threats */}
        <div className="card" style={{padding:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:"var(--text-1)"}}>Emerging Threats</div>
              <div style={{fontSize:11,color:"var(--text-3)"}}>Networks with fastest-rising risk scores</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={()=>navigate("alerts")}>All Alerts</button>
          </div>
          {liveNetworks.length === 0 ? (
            <div style={{padding:"20px 0",textAlign:"center",color:"var(--text-4)",fontSize:12}}>No networks tracked yet.</div>
          ) : (
          <table className="data-table">
            <thead><tr><th>Network ID</th><th>Risk</th><th>Change</th><th>Entities</th><th>Last Activity</th></tr></thead>
            <tbody>
              {liveNetworks.map(n=>(
                <tr key={n.id} onClick={()=>navigate("network-risk", n.id)}>
                  <td><span className="mono" style={{color:"var(--accent-hi)",fontSize:12}}>{n.id}</span></td>
                  <td>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontWeight:700,color:riskColorLight(n.risk),fontFamily:"Manrope,sans-serif",fontSize:15}}>{n.risk}</span>
                      <div className="risk-track" style={{width:44}}>
                        <div className="risk-fill" style={{width:`${n.risk}%`,background:riskColor(n.risk)}}/>
                      </div>
                    </div>
                  </td>
                  <td><span style={{color:"var(--low-light)",fontSize:12}}>▲ +{n.change}</span></td>
                  <td><span>{n.entities}</span></td>
                  <td><span style={{color:"var(--text-4)",fontSize:11}}>{n.last}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>

        {/* Live Intelligence Feed */}
        <div className="card" style={{padding:20,display:"flex",flexDirection:"column"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:"var(--text-1)"}}>Live Intelligence Feed</div>
              <div style={{fontSize:10.5,color:"var(--text-3)",marginTop:1}}>
                {!liveFeedOn
                  ? <><span style={{color:"var(--text-4)"}}>⏸</span> Paused</>
                  : connected
                  ? <><span style={{color:"var(--low-light)"}}>●</span> Real-time events</>
                  : <><span style={{color:"var(--text-4)"}}>○</span> Connecting…</>}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={()=>navigate("alerts")}>All Alerts</button>
          </div>

          {/* Event stream */}
          <div
            ref={feedRef}
            style={{display:"flex",flexDirection:"column",gap:8,overflowY:"auto",maxHeight:340,
              scrollbarWidth:"thin",scrollbarColor:"rgba(255,255,255,0.08) transparent"}}>

            {feedEvents.length === 0 && (
              <div style={{textAlign:"center",padding:"32px 0",color:"var(--text-4)"}}>
                <div style={{fontSize:22,marginBottom:8,opacity:0.3}}>◎</div>
                <div style={{fontSize:12}}>
                  {liveFeedOn ? "Waiting for live events…" : "Live feed stopped"}
                </div>
                <div style={{fontSize:11,marginTop:4,color:"var(--text-4)"}}>
                  {liveFeedOn
                    ? "Events from the producer will appear here as they're ingested"
                    : <>Click <span style={{color:"var(--accent-hi)"}}>Start Live Feed</span> to resume</>}
                </div>
              </div>
            )}

            {feedEvents.map((evt, i) => (
              <div
                key={evt.id}
                onClick={feedClickTarget(evt) ? () => handleFeedClick(evt) : undefined}
                title={feedClickTarget(evt) ? "Jump to this record" : undefined}
                style={{
                  display:"flex",gap:10,alignItems:"flex-start",
                  padding:"10px 12px",borderRadius:9,
                  background: i === 0
                    ? `${evt.meta.color}10`
                    : "rgba(255,255,255,0.025)",
                  border: i === 0
                    ? `1px solid ${evt.meta.color}30`
                    : "1px solid var(--border)",
                  transition:"all 0.3s",
                  animation: i === 0 ? "anim-alert 0.35s ease-out" : "none",
                  cursor: feedClickTarget(evt) ? "pointer" : "default",
                }}>
                {/* Icon */}
                <div style={{
                  width:28,height:28,borderRadius:7,flexShrink:0,
                  background:`${evt.meta.color}18`,
                  border:`1px solid ${evt.meta.color}35`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:12,color:evt.meta.color,
                  ...(i===0 ? {boxShadow:`0 0 10px ${evt.meta.color}25`} : {}),
                }}>
                  {evt.meta.icon}
                </div>

                {/* Body */}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:2}}>
                    <span style={{fontSize:10,fontWeight:700,color:evt.meta.color,
                      textTransform:"uppercase",letterSpacing:"0.07em"}}>
                      {evt.meta.label}
                    </span>
                    {i === 0 && (
                      <span style={{fontSize:9,padding:"1px 5px",borderRadius:3,
                        background:`${evt.meta.color}22`,color:evt.meta.color,fontWeight:600}}>
                        NEW
                      </span>
                    )}
                  </div>
                  <div style={{fontSize:11.5,color:"var(--text-2)",lineHeight:1.4,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {evt.detail || "—"}
                  </div>
                </div>

                {/* Time */}
                <div className="mono" style={{fontSize:10,color:"var(--text-4)",flexShrink:0,marginTop:1}}>
                  {evt.time}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Wallet Activity — kept separate from the KPI/network refresh above
          since it hits its own endpoint (GET /api/wallets) and refetches
          specifically on wallet_updated, the moment new transaction
          evidence lands (see lib/walletUpdate.ts / intelligencePipeline.ts
          on the backend). */}
      <div className="card" style={{padding:20,marginTop:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:"var(--text-1)"}}>Wallet Activity</div>
            <div style={{fontSize:11,color:"var(--text-3)"}}>
              {walletsUpdatedAt ? `Updated ${walletsUpdatedAt.toLocaleTimeString()}` : "Highest-risk tracked wallets"}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={()=>navigate("blockchain")}>All Wallets</button>
        </div>
        {walletRows.length === 0 ? (
          <div style={{padding:"20px 0",textAlign:"center",color:"var(--text-4)",fontSize:12}}>No wallets tracked yet.</div>
        ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
          {walletRows.slice(0,4).map(w=>(
            <div key={w.id} style={{padding:"12px 14px",borderRadius:9,background:"rgba(255,255,255,0.025)",border:"1px solid var(--border)"}}>
              <div className="mono" style={{fontSize:11.5,color:"var(--cyan)",marginBottom:6}}>{w.id}</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontWeight:700,fontSize:16,color:riskColorLight(w.risk)}}>{w.risk}</span>
                <RiskBadge score={w.risk}/>
              </div>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}