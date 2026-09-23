import { useState } from "react";
import { riskColorLight } from "../data";
import { RiskBadge } from "../components/shared";
import { apiGet } from "../lib/api";

type ResultKind = "Entities" | "Wallets" | "Intelligence Records" | "Investigations";

export function SearchScreen({ navigate }: { navigate:(s:string,d?:any)=>void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"All"|ResultKind>("All");
  const [results, setResults] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const chips: ("All"|ResultKind)[] = ["All","Entities","Wallets","Intelligence Records","Investigations"];

  const search = () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    apiGet<any>(`/api/search?q=${encodeURIComponent(query.trim())}`)
      .then(data => { setResults(data); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  const totalCount = results
    ? results.entities.length + results.wallets.length + results.listings.length + results.investigations.length
    : 0;

  const showEntities = filter === "All" || filter === "Entities";
  const showWallets = filter === "All" || filter === "Wallets";
  const showListings = filter === "All" || filter === "Intelligence Records";
  const showInvestigations = filter === "All" || filter === "Investigations";

  return (
    <div style={{padding:"26px 28px"}}>
      <div style={{marginBottom:22}}>
        <h1 className="section-head">Intelligence Search</h1>
        <p className="page-sub">Search across threat actors, wallets, intelligence records, and investigations.</p>
      </div>

      <div style={{position:"relative",marginBottom:14}}>
        <span style={{position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",fontSize:18,color:"var(--text-4)"}}>⌕</span>
        <input className="input" style={{paddingLeft:46,paddingRight:16,paddingTop:13,paddingBottom:13,fontSize:14,borderRadius:10}}
          placeholder="Search actor alias, wallet, PGP key, onion service, case ID, keyword…"
          value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search()}/>
        <button className="btn btn-primary" style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)"}} onClick={search} disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      <div style={{display:"flex",gap:7,marginBottom:18,flexWrap:"wrap"}}>
        {chips.map(c=>(
          <div key={c} className={`chip ${filter===c?"active":""}`} onClick={()=>setFilter(c)}>{c}</div>
        ))}
      </div>

      {error && <p className="page-sub" style={{marginBottom:14,color:"var(--high-light)"}}>Couldn't reach the API ({error}).</p>}

      {!searched && !error && (
        <div style={{textAlign:"center",padding:"70px 0",color:"var(--text-4)"}}>
          <div style={{fontSize:44,marginBottom:14,opacity:0.4}}>⌕</div>
          <div style={{fontSize:14}}>Enter a search term and press Enter or click Search</div>
          <div style={{fontSize:12,marginTop:6,color:"var(--text-4)"}}>Searches across threat actors, wallets, intelligence records, and investigations</div>
        </div>
      )}

      {searched && !loading && !error && results && (
        totalCount === 0 ? (
          <div style={{textAlign:"center",padding:"70px 0",color:"var(--text-4)"}}>
            <div style={{fontSize:14}}>No results for "<span style={{color:"var(--text-2)"}}>{results.query}</span>"</div>
          </div>
        ) : (
          <div>
            <div style={{fontSize:12,color:"var(--text-3)",marginBottom:14}}>
              Found <span style={{color:"var(--accent-hi)",fontWeight:600}}>{totalCount}</span> results for "<span style={{color:"var(--text-1)"}}>{results.query}</span>"
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:11}}>
              {showEntities && results.entities.map((e:any,i:number)=>(
                <div key={e.id} className={`card card-hover anim-fade-up delay-${Math.min(i+1,5)}`} style={{padding:"18px 20px"}}>
                  <div style={{display:"flex",gap:18,alignItems:"flex-start"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                        <span style={{fontSize:9,color:"var(--accent-hi)",textTransform:"uppercase",letterSpacing:"0.1em",background:"var(--accent-dim)",padding:"2px 7px",borderRadius:3,fontWeight:600}}>ACTOR</span>
                        <span className="display" style={{fontSize:17,fontWeight:700,color:"var(--text-1)"}}>{e.alias}</span>
                        <RiskBadge score={e.risk}/>
                      </div>
                      <div style={{display:"flex",gap:16,fontSize:12,color:"var(--text-3)"}}>
                        <span>Risk: <span style={{color:riskColorLight(e.risk),fontWeight:700}}>{e.risk}/100</span></span>
                        <span>Confidence: <span style={{color:"var(--text-2)"}}>{e.confidence}%</span></span>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:7,flexShrink:0}}>
                      <button className="btn btn-primary btn-sm" onClick={()=>navigate("entity",{ id: e.displayId, displayId: e.displayId })}>View Actor</button>
                      <button className="btn btn-ghost btn-sm" onClick={()=>navigate("graph")}>View Graph</button>
                    </div>
                  </div>
                </div>
              ))}

              {showWallets && results.wallets.map((w:any)=>(
                <div key={w.id} className="card card-hover" style={{padding:"18px 20px"}}>
                  <div style={{display:"flex",gap:18,alignItems:"flex-start"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                        <span style={{fontSize:9,color:"var(--cyan)",textTransform:"uppercase",letterSpacing:"0.1em",background:"rgba(6,182,212,0.1)",padding:"2px 7px",borderRadius:3,fontWeight:600}}>WALLET</span>
                        <span className="mono" style={{fontSize:15,fontWeight:700,color:"var(--text-1)"}}>{w.displayId}</span>
                        <RiskBadge score={w.risk}/>
                      </div>
                      <div style={{fontSize:12,color:"var(--text-3)"}}>Cluster: <span style={{color:"var(--text-2)"}}>{w.cluster ?? "—"}</span></div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={()=>navigate("blockchain")}>View Wallet</button>
                  </div>
                </div>
              ))}

              {showListings && results.listings.map((l:any)=>(
                <div key={l.id} className="card card-hover" style={{padding:"18px 20px"}}>
                  <div style={{display:"flex",gap:18,alignItems:"flex-start"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                        <span style={{fontSize:9,color:"var(--medium-light)",textTransform:"uppercase",letterSpacing:"0.1em",background:"rgba(217,119,6,0.1)",padding:"2px 7px",borderRadius:3,fontWeight:600}}>INTEL</span>
                        <span style={{fontSize:14,fontWeight:600,color:"var(--text-1)"}}>{l.title}</span>
                      </div>
                      <div style={{fontSize:12,color:"var(--text-3)"}}>Actor: <span style={{color:"var(--text-2)"}}>{l.vendorAlias}</span> · {l.marketplace}</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={()=>navigate("listings")}>View Record</button>
                  </div>
                </div>
              ))}

              {showInvestigations && results.investigations.map((inv:any)=>(
                <div key={inv.id} className="card card-hover" style={{padding:"18px 20px"}}>
                  <div style={{display:"flex",gap:18,alignItems:"flex-start"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                        <span style={{fontSize:9,color:"var(--purple)",textTransform:"uppercase",letterSpacing:"0.1em",background:"rgba(139,92,246,0.1)",padding:"2px 7px",borderRadius:3,fontWeight:600}}>CASE</span>
                        <span className="mono" style={{fontSize:14,fontWeight:700,color:"var(--accent-hi)"}}>{inv.displayId}</span>
                        <span style={{fontSize:14,color:"var(--text-1)"}}>{inv.title}</span>
                      </div>
                      <div style={{fontSize:12,color:"var(--text-3)"}}>{inv.status} · {inv.priority} priority</div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={()=>navigate("workspace", inv.displayId)}>Open Case</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}
