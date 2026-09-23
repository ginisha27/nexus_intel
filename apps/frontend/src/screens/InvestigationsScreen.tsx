import { useState, useEffect } from "react";
import {
  riskColor, riskColorLight, riskLabel, riskBg, riskBorder,
  activityTimeline, riskDistribution, networkRiskEvolution,
  alertsByDay, entityTypeDist, sourceContrib, walletClusterData,
  kpis, entities as mockEntities, alerts, emergingNetworks, listings, wallets,
  investigations, evidenceRecords, graphNodes, graphEdges,
  auditLog, flagContributions, networkSignals, caseTimeline,
  type Entity, type Alert, type Investigation, type EvidenceRecord,
} from "../data";
import {
  Sparkline, RingScore, RiskBadge, CustomTooltip, Section,
  PulseIndicator, BarContrib, TimelineView,
} from "../components/shared";
import { getSocket, EVENT_META } from "../lib/socket";
import { apiGet, apiDelete, apiPost } from "../lib/api";

const entities = mockEntities;

// ─── Custom styled select dropdown ───────────────────────────────────────────
function StyledSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; color?: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <div style={{ position: "relative" }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }} tabIndex={-1}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 12px",
          background: open ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${open ? "rgba(99,102,241,0.45)" : "rgba(255,255,255,0.09)"}`,
          borderRadius: 8,
          cursor: "pointer",
          transition: "border-color 0.15s, background 0.15s",
          textAlign: "left",
          outline: "none",
        }}
      >
        {selected?.color && (
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: selected.color, flexShrink: 0 }} />
        )}
        <span style={{ flex: 1, fontSize: 13, color: selected ? "var(--text-1)" : "var(--text-4)", fontFamily: "Inter,sans-serif" }}>
          {selected?.label ?? placeholder ?? "Select…"}
        </span>
        <span style={{ fontSize: 9, color: "var(--text-4)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0, right: 0,
          background: "var(--elevated, #141a27)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 9,
          boxShadow: "0 10px 36px rgba(0,0,0,0.55)",
          zIndex: 200,
          overflow: "hidden",
        }}>
          {options.map(opt => {
            const isActive = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "9px 13px",
                  background: isActive ? "rgba(99,102,241,0.14)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                {opt.color && <span style={{ width: 8, height: 8, borderRadius: "50%", background: opt.color, flexShrink: 0 }} />}
                <span style={{ fontSize: 13, color: isActive ? "var(--accent-hi)" : "var(--text-1)", fontWeight: isActive ? 600 : 400, flex: 1 }}>
                  {opt.label}
                </span>
                {isActive && <span style={{ fontSize: 10, color: "var(--accent-hi)" }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── New Investigation Modal ──────────────────────────────────────────────────
function NewInvestigationModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (inv: any) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [status, setStatus] = useState("UNDER_INVESTIGATION");
  const [assignee, setAssignee] = useState("Investigator A");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priorityOptions = [
    { value: "CRITICAL", label: "Critical", color: "#f87171" },
    { value: "HIGH",     label: "High",     color: "#fb923c" },
    { value: "MEDIUM",   label: "Medium",   color: "#fbbf24" },
    { value: "LOW",      label: "Low",      color: "#4ade80" },
  ];

  const statusOptions = [
    { value: "UNDER_INVESTIGATION", label: "Under Investigation", color: "#fbbf24" },
    { value: "UNDER_REVIEW",        label: "Under Review",        color: "#818cf8" },
    { value: "MONITORING",          label: "Monitoring",          color: "#22d3ee" },
    { value: "CLOSED",              label: "Closed",              color: "#3a4a5c" },
  ];

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiPost("/api/investigations", {
        title: title.trim(),
        description: description.trim(),
        priority,
        status,
        assignee: assignee.trim(),
      });
      onCreated(created);
      onClose();
    } catch (err: any) {
      setError(err.message ?? "Failed to create investigation");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(7,9,16,0.8)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--card, #0f1420)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: 14,
        padding: 28,
        width: 500,
        maxWidth: "calc(100vw - 32px)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div>
            <div className="display" style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}>New Investigation</div>
            <div style={{ fontSize: 12, color: "var(--text-4)", marginTop: 3 }}>Create a new case to track and investigate</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "2px 6px" }}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 6, letterSpacing: "0.04em" }}>Title</div>
            <input
              className="input"
              placeholder="e.g. Suspicious Wallet Cluster — Network A"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 6, letterSpacing: "0.04em" }}>Description</div>
            <textarea
              className="input"
              style={{ minHeight: 80, resize: "vertical", fontSize: 12.5 }}
              placeholder="Brief summary of the investigation scope and initial findings…"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 6, letterSpacing: "0.04em" }}>Priority</div>
              <StyledSelect value={priority} onChange={setPriority} options={priorityOptions} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 6, letterSpacing: "0.04em" }}>Status</div>
              <StyledSelect value={status} onChange={setStatus} options={statusOptions} />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 6, letterSpacing: "0.04em" }}>Assign To</div>
            <input
              className="input"
              placeholder="Investigator name"
              value={assignee}
              onChange={e => setAssignee(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div style={{ fontSize: 11.5, color: "var(--critical-light)", marginTop: 14, padding: "8px 12px", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 7 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button
            className="btn btn-primary"
            style={{ flex: 1, justifyContent: "center" }}
            onClick={handleSubmit}
            disabled={submitting || !title.trim() || !description.trim()}
          >
            {submitting ? "Creating…" : "Create Investigation"}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Delete Modal ─────────────────────────────────────────────────────
function ConfirmDeleteModal({
  inv,
  onClose,
  onDeleted,
}: {
  inv: any;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await apiDelete(`/api/investigations/${inv.id}`);
      onDeleted(inv.id);
      onClose();
    } catch (err: any) {
      setError(err.message ?? "Failed to delete investigation");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1001, background: "rgba(7,9,16,0.85)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "var(--card, #0f1420)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 14, padding: 28, width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 8 }}>Delete Investigation</div>
        <div style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.6, marginBottom: 20 }}>
          Are you sure you want to permanently delete <strong style={{ color: "var(--text-2)" }}>{inv.title}</strong>? This action cannot be undone.
        </div>
        {error && <div style={{ fontSize: 11.5, color: "var(--critical-light)", marginBottom: 14 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-danger" style={{ flex: 1, justifyContent: "center" }} onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete Investigation"}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={deleting}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function InvestigationsScreen({ navigate, autoOpenNew }: { navigate:(s:string,d?:any)=>void; autoOpenNew?: boolean }) {
  const statusColor: Record<string,string> = {
    "UNDER INVESTIGATION":"var(--medium-light)",
    "UNDER REVIEW":"var(--accent-hi)",
    "MONITORING":"#22d3ee",
    "CLOSED":"var(--text-4)",
  };
  const [invRows, setInvRows] = useState<any[]>(investigations);
  const [invLoading, setInvLoading] = useState(true);
  const [invError, setInvError] = useState<string|null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  // Auto-open the "New Investigation" modal when navigated here with that intent
  // (e.g. clicking "+ New Investigation" from the Overview screen).
  useEffect(() => {
    if (autoOpenNew) setShowNewModal(true);
  }, [autoOpenNew]);

  useEffect(() => {
    apiGet<any[]>("/api/investigations")
      .then(data => {
        const normalised = data.map((inv: any) => ({
          ...inv,
          id: inv.displayId ?? inv.id,
          entities: inv._count?.entities ?? inv.entities ?? 0,
          evidence: inv._count?.evidence ?? inv.evidence ?? 0,
          status: (inv.status ?? "UNDER_INVESTIGATION").replace(/_/g, " "),
          priority: inv.priority ?? "MEDIUM",
          assignee: inv.assignee ?? "Unassigned",
          updated: inv.updatedAt ? new Date(inv.updatedAt).toLocaleDateString() : inv.updated ?? "",
          description: inv.description ?? "",
        }));
        setInvRows(normalised);
        setInvError(null);
      })
      .catch(err => setInvError(err.message))
      .finally(() => setInvLoading(false));
  }, []);

  const handleCreated = (created: any) => {
    const normalised = {
      ...created,
      id: created.displayId ?? created.id,
      entities: 0,
      evidence: 0,
      status: (created.status ?? "UNDER_INVESTIGATION").replace(/_/g, " "),
      priority: created.priority ?? "MEDIUM",
      assignee: created.assignee ?? "Unassigned",
      updated: new Date(created.updatedAt ?? Date.now()).toLocaleDateString(),
      description: created.description ?? "",
    };
    setInvRows(prev => [normalised, ...prev]);
  };

  const handleDeleted = (id: string) => {
    setInvRows(prev => prev.filter(r => r.id !== id));
  };

  return (
    <div style={{padding:"26px 28px"}}>
      {showNewModal && (
        <NewInvestigationModal
          onClose={() => setShowNewModal(false)}
          onCreated={handleCreated}
        />
      )}
      {deleteTarget && (
        <ConfirmDeleteModal
          inv={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
        <div>
          <h1 className="section-head">Investigations</h1>
          <p className="page-sub">Active and historical investigation case management.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>+ New Investigation</button>
      </div>
      {invLoading && <p className="page-sub" style={{marginBottom:12}}>Loading investigations…</p>}
      {invError && <p className="page-sub" style={{marginBottom:12,color:"var(--high-light)"}}>Couldn't reach the API ({invError}) — showing demo data.</p>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14}}>
        {invRows.map((inv,i)=>(
          <div key={inv.id} className={`card card-hover anim-fade-up delay-${i+1} inv-card`} style={{padding:20,position:"relative",cursor:"pointer"}} onClick={()=>navigate("workspace",inv.id)}>
            {/* Delete button */}
            <button
              className="inv-delete-btn"
              onClick={e => { e.stopPropagation(); setDeleteTarget(inv); }}
              title="Delete investigation"
            >
              <svg width="11" height="12" viewBox="0 0 11 12" fill="none"><path d="M1 3h9M3.5 3V2a1 1 0 011-1h2a1 1 0 011 1v1M4.5 5.5v3M6.5 5.5v3M2 3l.6 6.5a1 1 0 001 .9h3.8a1 1 0 001-.9L9 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,paddingRight:28}}>
              <span className="mono-sm" style={{color:"var(--accent-hi)"}}>{inv.id}</span>
              <span className={`badge ${inv.priority==="CRITICAL"?"badge-critical":inv.priority==="HIGH"?"badge-high":inv.priority==="MEDIUM"?"badge-medium":"badge-low"}`}>{inv.priority}</span>
            </div>
            <div className="display" style={{fontSize:15,fontWeight:700,color:"var(--text-1)",marginBottom:8,lineHeight:1.35}}>{inv.title}</div>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:14}}>
              <PulseIndicator color={statusColor[inv.status]||"var(--text-4)"}/>
              <span style={{fontSize:11,color:statusColor[inv.status]||"var(--text-4)",fontWeight:600}}>{inv.status}</span>
            </div>
            <div style={{fontSize:12,color:"var(--text-3)",lineHeight:1.5,marginBottom:14}}>{inv.description.slice(0,100)}…</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
              {[{l:"Entities",v:inv.entities},{l:"Evidence",v:inv.evidence}].map(item=>(
                <div key={item.l} style={{textAlign:"center",background:"rgba(255,255,255,0.03)",borderRadius:7,padding:"9px 0"}}>
                  <div className="display" style={{fontSize:20,fontWeight:700,color:"var(--text-1)"}}>{item.v}</div>
                  <div style={{fontSize:10,color:"var(--text-4)"}}>{item.l}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text-4)"}}>
              <span>{inv.assignee}</span>
              <span>{inv.updated}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}