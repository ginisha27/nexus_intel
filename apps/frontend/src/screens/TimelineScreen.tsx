import { useState, useEffect, useCallback } from "react";
import { TimelineView, type TimelineEvent } from "../components/shared";
import { apiGet } from "../lib/api";

// CaseTimelineEvent.type in the DB is an enum like "DETECTION" | "ALERT" |
// "DISCOVERY" | "ESCALATION" | "WARNING" | "ACTION" | "EVIDENCE" — color is
// purely presentational and doesn't come from the backend, so it's mapped
// here rather than invented per-event.
const TYPE_COLORS: Record<string, string> = {
  DETECTION: "#6366f1",
  ALERT: "#ea580c",
  DISCOVERY: "#06b6d4",
  ESCALATION: "#d97706",
  WARNING: "#dc2626",
  ACTION: "#8b5cf6",
  EVIDENCE: "#16a34a",
};

export function TimelineScreen({ navigate, displayId }: { navigate:(s:string,d?:any)=>void; displayId?: string | null }) {
  const [resolvedId, setResolvedId] = useState<string | null>(displayId ?? null);
  const [title, setTitle] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // If no investigation was passed in (e.g. navigated here without opening
  // a case first), resolve a sensible default from the live investigations
  // list rather than hardcoding any particular case id.
  useEffect(() => {
    if (displayId) { setResolvedId(displayId); return; }
    apiGet<any[]>("/api/investigations")
      .then((data) => {
        const first = data?.[0]?.displayId ?? data?.[0]?.id;
        if (first) setResolvedId(first);
        else setError("No investigations available");
      })
      .catch((err) => setError(err.message));
  }, [displayId]);

  const load = useCallback(() => {
    if (!resolvedId) return;
    setLoading(true);
    apiGet<any>(`/api/investigations/${encodeURIComponent(resolvedId)}/timeline`)
      .then((data) => {
        setTitle(data.displayId ?? resolvedId);
        setEvents(
          (data.timeline ?? []).map((ev: any) => ({
            date: new Date(ev.occurredAt).toLocaleDateString(),
            time: new Date(ev.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            label: ev.label ?? ev.type,
            type: ev.type,
            source: ev.source ?? "—",
            agent: ev.agent ?? "System",
            desc: ev.description ?? ev.label ?? "",
            color: TYPE_COLORS[ev.type] ?? "#6366f1",
          }))
        );
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [resolvedId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{padding:"26px 28px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <button onClick={()=>navigate("workspace", resolvedId)} style={{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer",fontSize:12,padding:0}}>← Case Workspace</button>
        <span style={{color:"var(--text-4)"}}>/</span>
        <span className="mono-sm" style={{color:"var(--accent-hi)"}}>{title ?? resolvedId ?? "—"}</span>
      </div>
      <h1 className="section-head" style={{marginBottom:22}}>Investigation Timeline</h1>
      {loading && <p className="page-sub" style={{marginBottom:14}}>Loading timeline…</p>}
      {error && <p className="page-sub" style={{marginBottom:14,color:"var(--high-light)"}}>Couldn't reach the API ({error}).</p>}
      {!loading && !error && events.length === 0 && (
        <p className="page-sub" style={{marginBottom:14}}>No timeline events recorded yet.</p>
      )}
      {!loading && !error && events.length > 0 && <TimelineView events={events}/>}
    </div>
  );
}