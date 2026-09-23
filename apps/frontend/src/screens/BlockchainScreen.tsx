import { useState, useEffect, Fragment } from "react";
import { riskColorLight } from "../data";
import { RingScore, RiskBadge, PulseIndicator } from "../components/shared";
import { apiGet } from "../lib/api";

export function BlockchainScreen() {
  const [walletRows, setWalletRows] = useState<any[]>([]);
  const [walletsLoading, setWalletsLoading] = useState(true);
  const [walletsError, setWalletsError] = useState<string|null>(null);
  const [sel, setSel] = useState<any>(null);

  useEffect(() => {
    apiGet<any[]>("/api/wallets")
      .then(data => {
        const normalised = data.map((w: any) => ({
          ...w,
          txns: w.txns ?? w.txnCount ?? 0,
          entities: w.entities ?? w.entityCount ?? 0,
          cluster: w.cluster ?? w.clusterId ?? "—",
          totalVol: w.totalVol ?? w.totalVolume ?? "—",
          first: w.first ?? (w.firstSeen ? new Date(w.firstSeen).toLocaleDateString() : "—"),
          last: w.last ?? (w.lastSeen ? new Date(w.lastSeen).toLocaleDateString() : "—"),
          flagged: w.flagged ?? w.risk >= 70,
          // `computed`/`dataQuality`/`legacy` come straight from /api/wallets
          // (see lib/walletRisk.ts) — real transaction-derived risk, kept
          // separate from the seeded demo `legacy` numbers rather than
          // silently blended together.
          computed: w.computed ?? null,
          dataQuality: w.dataQuality ?? null,
          legacy: w.legacy ?? null,
        }));
        setWalletRows(normalised);
        if (normalised.length > 0) setSel(normalised[0]);
        setWalletsError(null);
      })
      .catch(err => setWalletsError(err.message))
      .finally(() => setWalletsLoading(false));
  }, []);

  // Derived from walletRows once the /api/wallets fetch resolves — real
  // numbers, computed here rather than a separately-maintained hardcoded KPI set.
  const totalTxns = walletRows.reduce((sum, w) => sum + (w.txns ?? 0), 0);
  const blockKpis = [
    {label:"Tracked Wallets",val:String(walletRows.length),color:"#6366f1"},
    {label:"High-Risk Wallets",val:String(walletRows.filter(w=>w.risk>=70).length),color:"var(--critical)"},
    {label:"Transactions Analysed",val: totalTxns>=1000 ? `${(totalTxns/1000).toFixed(1)}K` : String(totalTxns), color:"var(--cyan)"},
    {label:"Emerging Clusters",val:String(new Set(walletRows.map(w=>w.cluster)).size),color:"var(--purple)"},
  ];

  return (
    <div style={{padding:"26px 28px"}}>
      <div style={{marginBottom:22}}>
        <h1 className="section-head">Blockchain Intelligence</h1>
        <p className="page-sub">Wallet analytics and transaction pattern analysis.</p>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:13,marginBottom:20}}>
        {blockKpis.map(k=>(
          <div key={k.label} className="card" style={{padding:"16px 18px"}}>
            <div style={{fontSize:10,color:"var(--text-4)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>{k.label}</div>
            <div className="display" style={{fontSize:28,fontWeight:700,color:k.color}}>{k.val}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:16}}>
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {/* Wallet table */}
          {walletsLoading && <p className="page-sub" style={{marginBottom:8,paddingLeft:16}}>Loading wallets…</p>}
          {walletsError && <p className="page-sub" style={{marginBottom:8,paddingLeft:16,color:"var(--high-light)"}}>Couldn't reach the API ({walletsError}).</p>}
          {!walletsLoading && !walletsError && walletRows.length === 0 && <p className="page-sub" style={{marginBottom:8,paddingLeft:16}}>No wallets tracked yet.</p>}
          <div className="card">
            <table className="data-table">
              <thead><tr><th>Wallet ID</th><th>Risk</th><th>Transactions</th><th>Entities</th><th>Cluster</th><th>Volume</th><th>Last Active</th></tr></thead>
              <tbody>
                {walletRows.map(w=>{
                  const isOpen = sel?.id === w.id;
                  return (
                  <Fragment key={w.id}>
                    <tr className={isOpen?"selected":""} onClick={()=>setSel(isOpen?null:w)} style={{cursor:"pointer"}}>
                      <td>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:9,color:"var(--text-4)",display:"inline-block",width:10,transition:"transform 0.15s",transform:isOpen?"rotate(90deg)":"rotate(0deg)"}}>▸</span>
                          {w.flagged&&<div style={{width:6,height:6,borderRadius:"50%",background:"var(--critical)",boxShadow:"0 0 5px var(--critical-glow)",flexShrink:0}}/>}
                          <span className="mono" style={{color:"var(--cyan)",fontSize:12}}>{w.id}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{display:"flex",alignItems:"center",gap:7}}>
                          <span style={{fontWeight:700,color:riskColorLight(w.risk)}}>{w.risk}</span>
                          <RiskBadge score={w.risk}/>
                          {w.dataQuality === "no_transaction_data" && (
                            <span title="No WalletTransaction records — score not calculable" className="mono-sm" style={{fontSize:9,color:"var(--text-4)"}}>N/A</span>
                          )}
                        </div>
                      </td>
                      <td>{w.txns}</td>
                      <td>{w.entities}</td>
                      <td><span className="mono-sm" style={{color:"var(--accent-hi)"}}>{w.cluster}</span></td>
                      <td><span className="mono-sm" style={{color:"var(--text-3)"}}>{w.totalVol}</span></td>
                      <td><span style={{fontSize:11}}>{w.last.split(",")[0]}</span></td>
                    </tr>

                    {/* Dropdown detail row — expands directly under the wallet
                        that was clicked instead of a summary rendered after
                        the entire (often long) table, so opening a row near
                        the top no longer pushes its own detail dozens of rows
                        down the page. Same Wallet Summary + Risk Explanation
                        content as before, just relocated and laid out side by
                        side since the expanded row has the table's full width
                        to work with. */}
                    {isOpen && (
                      <tr>
                        <td colSpan={7} style={{padding:0,background:"rgba(255,255,255,0.025)",borderBottom:"1px solid var(--border)"}}>
                          <div style={{padding:"18px 22px",display:"grid",gridTemplateColumns:"220px 1fr",gap:24}}>
                            {/* Wallet summary — no per-day transaction volume exists
                                in the schema (Wallet has no time-series data), so
                                this shows real aggregate fields instead of a
                                fabricated bar chart. */}
                            <div>
                              <div style={{fontSize:10,color:"var(--text-4)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:12}}>Wallet Summary</div>
                              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                                <div>
                                  <div style={{fontSize:9.5,color:"var(--text-4)"}}>Total Volume</div>
                                  <div className="mono" style={{fontSize:16,fontWeight:700,color:"var(--text-1)"}}>{w.totalVol}</div>
                                </div>
                                <div>
                                  <div style={{fontSize:9.5,color:"var(--text-4)"}}>Transactions</div>
                                  <div className="mono" style={{fontSize:16,fontWeight:700,color:"var(--text-1)"}}>{w.txns}</div>
                                </div>
                                <div>
                                  <div style={{fontSize:9.5,color:"var(--text-4)"}}>Linked Entities</div>
                                  <div className="mono" style={{fontSize:16,fontWeight:700,color:"var(--text-1)"}}>{w.entities}</div>
                                </div>
                                <div>
                                  <div style={{fontSize:9.5,color:"var(--text-4)"}}>Active Window</div>
                                  <div className="mono" style={{fontSize:12.5,fontWeight:600,color:"var(--text-2)"}}>{w.first} – {w.last}</div>
                                </div>
                              </div>
                            </div>

                            {/* Wallet risk explanation — every number here comes
                                straight from lib/walletRisk.ts's computed signals
                                for THIS wallet: real WalletTransaction rows in, a
                                deterministic score out. Signals the current data
                                can't support are shown as "Not available" rather
                                than a guessed number. */}
                            <div>
                              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                                <div style={{fontSize:10,color:"var(--text-4)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Risk Explanation</div>
                                {w.computed && (
                                  <span
                                    className="mono-sm"
                                    style={{
                                      fontSize:10,
                                      padding:"2px 8px",
                                      borderRadius:5,
                                      textTransform:"uppercase",
                                      letterSpacing:"0.05em",
                                      color: w.dataQuality === "real_transaction_data" ? "var(--cyan)" : "var(--text-4)",
                                      border: `1px solid ${w.dataQuality === "real_transaction_data" ? "var(--cyan)" : "var(--border)"}`,
                                    }}
                                  >
                                    {w.dataQuality === "real_transaction_data" ? "Computed from transactions" : "No transaction data"}
                                  </span>
                                )}
                              </div>

                              {!w.computed && (
                                <p style={{fontSize:11.5,color:"var(--text-4)"}}>No risk explanation available for this wallet yet.</p>
                              )}

                              {w.computed && (
                                <>
                                  <div style={{fontSize:11,color:"var(--text-3)",marginBottom:12,lineHeight:1.55}}>{w.computed.explanation}</div>

                                  {w.computed.calculable ? (
                                    <div style={{display:"flex",flexDirection:"column",gap:7}}>
                                      {w.computed.signals.map((s:any, i:number)=>(
                                        <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,padding:"6px 0",borderBottom:"1px solid var(--border)"}}>
                                          <span style={{fontSize:11.5,color: s.available ? "var(--text-2)" : "var(--text-4)",lineHeight:1.5}}>
                                            {s.available ? s.label : `${s.label} — Not available`}
                                            {!s.available && <span style={{display:"block",fontSize:10,color:"var(--text-4)",marginTop:2}}>{s.reason}</span>}
                                          </span>
                                          {s.available ? (
                                            <span className="mono-sm" style={{fontSize:11.5,fontWeight:700,color: s.value>0?"var(--high-light)":"var(--text-4)",whiteSpace:"nowrap"}}>+{s.value}</span>
                                          ) : (
                                            <span className="mono-sm" style={{fontSize:11,color:"var(--text-4)",whiteSpace:"nowrap"}}>—</span>
                                          )}
                                        </div>
                                      ))}
                                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:9,marginTop:1}}>
                                        <span style={{fontSize:12,fontWeight:600,color:"var(--text-1)"}}>Final calculated score</span>
                                        <span className="mono" style={{fontSize:16,fontWeight:700,color:riskColorLight(w.computed.score)}}>{w.computed.score}</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <p style={{fontSize:11.5,color:"var(--text-4)"}}>
                                      This wallet has no recorded WalletTransaction history, so a risk score cannot be honestly calculated. The value shown in the table is the seeded placeholder — see below.
                                    </p>
                                  )}

                                  {w.legacy && (
                                    <div style={{marginTop:12,paddingTop:10,borderTop:"1px dashed var(--border)"}}>
                                      <div style={{fontSize:10,color:"var(--text-4)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Seeded / Synthetic Demo Data</div>
                                      <div style={{fontSize:11,color:"var(--text-4)",lineHeight:1.55}}>
                                        Stored demo value: risk {w.legacy.risk}, {w.legacy.txnCount} txns, {w.legacy.entityCount} entities, {w.legacy.totalVolume ?? "—"} volume. {w.legacy.note}
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Wallet detail */}
        {sel && (
        <div className="card" style={{padding:20,height:"fit-content"}}>
          <div style={{fontSize:10.5,color:"var(--text-4)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Selected Wallet</div>
          <div className="mono" style={{fontSize:14,fontWeight:600,color:"var(--cyan)",marginBottom:8}}>{sel.id}</div>
          <RiskBadge score={sel.risk}/>
          <div style={{display:"flex",justifyContent:"center",margin:"18px 0"}}><RingScore score={sel.risk} size={110}/></div>

          {sel.flagged && (
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"rgba(220,38,38,0.07)",border:"1px solid rgba(220,38,38,0.2)",borderRadius:7,marginBottom:14}}>
              <PulseIndicator color="var(--critical)"/>
              <span style={{fontSize:11.5,color:"var(--critical-light)",fontWeight:600}}>Network association detected</span>
            </div>
          )}

          {[
            {l:"Transactions",v:sel.txns},{l:"Connected Entities",v:sel.entities},
            {l:"Cluster",v:sel.cluster},{l:"Total Volume",v:sel.totalVol},
            {l:"First Observed",v:sel.first},{l:"Last Observed",v:sel.last},
          ].map(item=>(
            <div key={item.l} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:11,color:"var(--text-4)"}}>{item.l}</span>
              <span style={{fontSize:12,color:"var(--text-2)",fontFamily:typeof item.v==="string"&&item.v.includes("Cluster")?"JetBrains Mono,monospace":"Inter,sans-serif"}}>{item.v}</span>
            </div>
          ))}
          <button className="btn btn-primary" style={{width:"100%",justifyContent:"center",marginTop:16}}>Add to Investigation</button>
        </div>
        )}
      </div>
    </div>
  );
}
