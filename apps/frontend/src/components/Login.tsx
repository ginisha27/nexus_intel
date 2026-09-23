import { useState } from "react";
import { apiPost, ApiError } from "../lib/api";

export type AuthedUser = { id: string; name: string; email: string; role: string };

function LoginNetworkViz() {
  const nodes = [
    {x:200,y:180,r:7,t:"entity"},{x:360,y:120,r:9,t:"market"},{x:480,y:240,r:6,t:"wallet"},
    {x:310,y:320,r:8,t:"entity"},{x:160,y:370,r:5,t:"comm"},{x:450,y:400,r:7,t:"wallet"},
    {x:560,y:160,r:5,t:"listing"},{x:250,y:250,r:5,t:"listing"},{x:390,y:480,r:4,t:"comm"},
    {x:130,y:500,r:3,t:"market"},{x:600,y:340,r:6,t:"entity"},{x:520,y:70,r:4,t:"wallet"},
  ];
  const edges = [[0,1],[1,2],[2,5],[1,3],[3,4],[3,5],[1,6],[0,7],[5,8],[4,9],[2,10],[6,11],[10,5]];
  const colors: Record<string,string> = {entity:"#6366f1",market:"#8b5cf6",wallet:"#06b6d4",comm:"#16a34a",listing:"#d97706"};

  return (
    <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:0.75}} viewBox="0 0 680 600" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="lv-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.08"/>
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0"/>
        </radialGradient>
        {Object.entries(colors).map(([k,v])=>(
          <radialGradient key={k} id={`lv-n-${k}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={v} stopOpacity="0.3"/>
            <stop offset="100%" stopColor={v} stopOpacity="0"/>
          </radialGradient>
        ))}
      </defs>
      <ellipse cx="340" cy="300" rx="240" ry="210" fill="url(#lv-glow)"/>
      {edges.map(([a,b],i)=>(
        <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
          stroke="rgba(99,102,241,0.18)" strokeWidth="1" strokeDasharray="5 4"
          style={{animation:`dash-flow ${7+i*0.4}s linear infinite`}}/>
      ))}
      {nodes.map((n,i)=>(
        <g key={i} style={{cursor:"default"}}>
          <circle cx={n.x} cy={n.y} r={n.r+9} fill={`url(#lv-n-${n.t})`} style={{animation:`node-glow ${2.5+i*0.25}s ease-in-out infinite`}}/>
          <circle cx={n.x} cy={n.y} r={n.r} fill={colors[n.t]} opacity="0.9" style={{filter:`drop-shadow(0 0 5px ${colors[n.t]}90)`}}/>
        </g>
      ))}
    </svg>
  );
}

export function LoginScreen({ onLogin }: { onLogin: (user: AuthedUser) => void }) {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim() || !pw) return;
    setLoading(true);
    setError(null);
    try {
      // "Investigator ID" in the UI is the account's email — kept as one
      // field rather than adding a separate email input, matching what
      // was already there.
      const { user } = await apiPost<{ user: AuthedUser }>("/api/auth/login", {
        email: id.trim(),
        password: pw,
      });
      onLogin(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-root">
      {/* Left */}
      <div className="login-left">
        <LoginNetworkViz />
        <div className="scan-line" />
        <div style={{position:"absolute",bottom:40,left:44,zIndex:2}}>
          <div style={{fontSize:10,color:"var(--text-4)",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6}}>Intelligence Platform</div>
          <div className="display grad-text" style={{fontSize:32,fontWeight:800,letterSpacing:"-0.03em"}}>NEXUS</div>
          <div style={{fontSize:12,color:"var(--text-3)",marginTop:4}}>From signals to intelligence.</div>
        </div>
        {/* Corner grid decoration */}
        <div style={{position:"absolute",top:0,right:0,width:200,height:200,opacity:0.04,backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 23px,rgba(99,102,241,1) 23px,rgba(99,102,241,1) 24px),repeating-linear-gradient(90deg,transparent,transparent 23px,rgba(99,102,241,1) 23px,rgba(99,102,241,1) 24px)"}}/>
      </div>

      {/* Right */}
      <div className="login-right">
        <div style={{width:"100%",maxWidth:340}}>
          <div style={{textAlign:"center",marginBottom:40}}>
            <div className="display" style={{fontSize:24,fontWeight:800,letterSpacing:"-0.03em",marginBottom:4}}>
              <span className="grad-text">NEXUS</span>
              <span style={{color:"var(--text-1)"}}> INTEL</span>
            </div>
            <div style={{fontSize:12.5,color:"var(--text-3)"}}>Secure Investigative Intelligence</div>
          </div>

          <form onSubmit={submit} autoComplete="off">
            <div style={{marginBottom:14}}>
              <label style={{display:"block",fontSize:10.5,color:"var(--text-3)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Investigator ID</label>
              <input
                className="input"
                placeholder="Enter investigator ID"
                value={id}
                onChange={e=>setId(e.target.value)}
                autoComplete="off"
                readOnly
                onFocus={e => e.currentTarget.removeAttribute("readonly")}
              />
            </div>
            <div style={{marginBottom:22}}>
              <label style={{display:"block",fontSize:10.5,color:"var(--text-3)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Password</label>
              <input
                className="input"
                type="password"
                placeholder="••••••••••••"
                value={pw}
                onChange={e=>setPw(e.target.value)}
                autoComplete="new-password"
                readOnly
                onFocus={e => e.currentTarget.removeAttribute("readonly")}
              />
            </div>
            {error && (
              <div style={{marginBottom:14,padding:"9px 12px",background:"rgba(220,38,38,0.08)",border:"1px solid rgba(220,38,38,0.2)",borderRadius:7,fontSize:12,color:"var(--critical-light)"}}>
                {error}
              </div>
            )}
            <button type="submit" className="btn btn-primary btn-lg" style={{width:"100%",justifyContent:"center",marginBottom:16}} disabled={loading}>
              {loading
                ? <><span style={{width:14,height:14,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin 0.7s linear infinite",display:"inline-block"}}/> Authenticating…</>
                : "Sign In Securely"}
            </button>
          </form>

          <div style={{textAlign:"center",marginBottom:28}}>
            <span style={{fontSize:10.5,color:"var(--text-4)",letterSpacing:"0.06em",textTransform:"uppercase"}}>Authorised Personnel Only</span>
          </div>

          <div style={{display:"flex",gap:10}}>
            {[
              {icon:"⚿",label:"Encrypted Connection"},
              {icon:"☰",label:"Audit Logging"},
              {icon:"⊕",label:"Access Controlled"},
            ].map(item=>(
              <div key={item.label} style={{flex:1,background:"rgba(255,255,255,0.03)",border:"1px solid var(--border)",borderRadius:8,padding:"9px 6px",textAlign:"center"}}>
                <div style={{fontSize:15,marginBottom:4,color:"var(--text-3)"}}>{item.icon}</div>
                <div style={{fontSize:9,color:"var(--text-4)",lineHeight:1.4,letterSpacing:"0.03em"}}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
