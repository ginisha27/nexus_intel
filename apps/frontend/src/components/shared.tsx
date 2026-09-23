import { riskColor, riskColorLight, riskLabel, caseTimeline } from "../data";

// Small shared presentational components used across multiple screens.

// Canonical evidence types used everywhere an investigator can add evidence.
// Keeping this list in one place prevents the Investigation Workspace and the
// Evidence Repository from drifting apart or showing unsupported types.
export const EVIDENCE_TYPES = [
  { value: "Intelligence Record", icon: "🧠" },
  { value: "Wallet Transaction Log", icon: "◎" },
  { value: "Communication Record", icon: "💬" },
  { value: "Network Analysis Report", icon: "⚡" },
  { value: "Listing Capture", icon: "▣" },
] as const;

export function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
const pts = data.map((v, i) => `${(i / (data.length - 1)) * 56},${18 - (v / max) * 16}`).join(" ");
  return (
    <svg width={56} height={18} viewBox="0 0 56 18" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={pts} opacity="0.9" />
    </svg>
  );
}

export function RingScore({ score, size = 100, animate = true }: { score: number; size?: number; animate?: boolean }) {
  const r = (size - 20) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const col = riskColor(score);
  const colLight = riskColorLight(score);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <radialGradient id={`rg-${score}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={col} stopOpacity="0.15" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={size/2} cy={size/2} r={r+6} fill={`url(#rg-${score})`} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={7} />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={colLight} strokeWidth={7} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={animate ? { transition: "stroke-dashoffset 1.1s cubic-bezier(0.22,1,0.36,1)", filter: `drop-shadow(0 0 5px ${col}80)` } : { filter: `drop-shadow(0 0 5px ${col}80)` }}
      />
      <text x={size/2} y={size/2 + 6} textAnchor="middle" fill={colLight} fontSize={size > 90 ? 22 : 15} fontWeight="700" fontFamily="Manrope, sans-serif">{score}</text>
      <text x={size/2} y={size/2 + 18} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="Inter, sans-serif">/100</text>
    </svg>
  );
}

export function RiskBadge({ score }: { score: number }) {
  const label = riskLabel(score);
  const cls = label === "CRITICAL" ? "badge-critical" : label === "HIGH" ? "badge-high" : label === "MEDIUM" ? "badge-medium" : "badge-low";
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="c-tooltip">
      <div className="c-label">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="c-value" style={{ color: p.color }}>{p.name}: {p.value}</div>
      ))}
    </div>
  );
}

export function Section({ title, sub, children, action }: { title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{title}</div>
          {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function PulseIndicator({ color }: { color: string }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", width: 8, height: 8 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, animation: "pulse-dot 2s ease-in-out infinite", opacity: 0.6 }} />
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "block", boxShadow: `0 0 6px ${color}80` }} />
    </span>
  );
}

export function BarContrib({ label, value, max = 28, color }: { label: string; value: number; max?: number; color: string }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: 12 }}>
        <span style={{ color: "var(--text-2)" }}>{label}</span>
        <span style={{ color, fontWeight: 700 }}>+{value}</span>
      </div>
      <div className="risk-track">
        <div className="risk-fill" style={{ width: `${(value / max) * 100}%`, background: `linear-gradient(90deg, ${color}60, ${color})` }} />
      </div>
    </div>
  );
}

export type TimelineEvent = typeof caseTimeline[number];

export function TimelineView({ events = caseTimeline }: { events?: typeof caseTimeline }) {
  return (
    <div style={{maxWidth:680}}>
      {events.map((ev,i)=>(
        <div key={i} style={{display:"flex",gap:16,paddingBottom:i<events.length-1?0:0}}>
          {/* Left connector */}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",width:36,flexShrink:0}}>
            <div style={{width:34,height:34,borderRadius:"50%",background:`rgba(${ev.color.startsWith("var")?ev.color.includes("critical")?"220,38,38":ev.color.includes("medium")?"217,119,6":ev.color.includes("cyan")?"6,182,212":"99,102,241":"99,102,241"},0.14)`,border:`1.5px solid ${ev.color.startsWith("var")?ev.color:ev.color}40`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:ev.color.startsWith("var")?"var(--accent)":ev.color,boxShadow:`0 0 6px ${ev.color.startsWith("var")?"var(--accent-glow)":ev.color+"60"}`}}/>
            </div>
            {i<events.length-1&&<div style={{width:1,flex:1,background:"var(--border)",minHeight:32,margin:"4px 0"}}/>}
          </div>
          {/* Card */}
          <div className="card" style={{flex:1,padding:"13px 16px",marginBottom:i<events.length-1?10:0}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
              <div>
                <span style={{fontSize:9.5,color:ev.color.startsWith("var")?"var(--accent-hi)":ev.color,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:700}}>{ev.type}</span>
                <div style={{fontSize:13,color:"var(--text-1)",fontWeight:500,marginTop:2}}>{ev.desc}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                <div className="mono" style={{fontSize:11.5,color:"var(--text-3)"}}>{ev.date}</div>
                <div className="mono" style={{fontSize:10,color:"var(--text-4)"}}>{ev.time}</div>
              </div>
            </div>
            <div style={{display:"flex",gap:14,fontSize:11,color:"var(--text-4)"}}>
              <span>Source: <span style={{color:"var(--text-3)"}}>{ev.source}</span></span>
              <span>By: <span style={{color:"var(--text-3)"}}>{ev.agent}</span></span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
