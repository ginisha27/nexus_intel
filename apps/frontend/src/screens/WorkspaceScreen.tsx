import { useState, useEffect } from "react";
import { RingScore, RiskBadge, PulseIndicator } from "../components/shared";
import { apiGet, apiPost, apiPatch, apiDelete } from "../lib/api";

// -- Model options (keep in sync with backend/src/lib/llmClient.ts) ----------
// llama-3.3-70b-versatile and llama-3.1-8b-instant were decommissioned by
// Groq on 2026-08-16 (deprecated 2026-06-17) — see
// https://console.groq.com/docs/deprecations. Requests using them 404.
// Replaced here with Groq's recommended migrations: openai/gpt-oss-20b and
// qwen/qwen3.6-27b.
type SupportedModel =
  | "openai/gpt-oss-120b"
  | "openai/gpt-oss-20b"
  | "qwen/qwen3.6-27b"
  | "gemini-flash-2.5-lite"
  | "gemini-flash-2.5"
  | "gemini-flash-3.1-lite";

interface ModelOption {
  value: SupportedModel;
  label: string;
  group: string;
  note: string;
  badge: "groq" | "gemini";
}

const MODEL_OPTIONS: ModelOption[] = [
  { value: "openai/gpt-oss-120b",     label: "GPT-OSS 120B",          group: "Grok",   note: "~500 t/s · best quality",          badge: "groq"   },
  { value: "openai/gpt-oss-20b",      label: "GPT-OSS 20B",           group: "Grok",   note: "~1000 t/s · fastest",               badge: "groq"   },
  { value: "qwen/qwen3.6-27b",        label: "Qwen 3.6 27B",          group: "Qwen",   note: "Groq's Llama 3.3 70B replacement",  badge: "groq"   },
  { value: "gemini-flash-2.5-lite",   label: "Gemini Flash 2.5 Lite", group: "Gemini", note: "free tier",               badge: "gemini" },
  { value: "gemini-flash-2.5",        label: "Gemini Flash 2.5",      group: "Gemini", note: "free tier",               badge: "gemini" },
  { value: "gemini-flash-3.1-lite",   label: "Gemini Flash 3.1 Lite", group: "Gemini", note: "stable GA",               badge: "gemini" },
];

const DEFAULT_MODEL: SupportedModel = "openai/gpt-oss-120b";

// Custom model picker — groups by provider, shows speed/tier notes inline.
function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: SupportedModel;
  onChange: (m: SupportedModel) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = { current: null as HTMLDivElement | null };
  const selected = MODEL_OPTIONS.find(m => m.value === value) ?? MODEL_OPTIONS[0];

  // Close on outside click
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
  };

  const groups = ["Grok", "Llama", "Gemini"];
  const BADGE_COLORS: Record<string, { bg: string; color: string; dot: string }> = {
    groq:   { bg: "rgba(99,102,241,0.15)",  color: "var(--accent-hi)",    dot: "var(--accent-hi)"    },
    gemini: { bg: "rgba(16,185,129,0.15)",  color: "#10b981",             dot: "#10b981"             },
  };

  const bc = BADGE_COLORS[selected.badge];

  return (
    <div
      style={{ position: "relative" }}
      onBlur={handleBlur}
      tabIndex={-1}
    >
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          background: open ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${open ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 8,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          transition: "border-color 0.15s, background 0.15s",
          textAlign: "left",
        }}
      >
        {/* Provider dot */}
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: bc.dot, flexShrink: 0, boxShadow: `0 0 5px ${bc.dot}` }} />
        {/* Label */}
        <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: "var(--text-1)", fontFamily: "JetBrains Mono,monospace" }}>
          {selected.label}
        </span>
        {/* Speed note */}
        <span style={{ fontSize: 10.5, color: "var(--text-4)", flexShrink: 0 }}>{selected.note}</span>
        {/* Chevron */}
        <span style={{ fontSize: 9, color: "var(--text-4)", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▼</span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--surface, #16181d)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            zIndex: 50,
            overflow: "hidden",
          }}
        >
          {groups.map((group, gi) => {
            const opts = MODEL_OPTIONS.filter(m => m.group === group);
            if (!opts.length) return null;
            return (
              <div key={group}>
                {/* Group header */}
                <div style={{
                  padding: "7px 12px 4px",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: "var(--text-4)",
                  textTransform: "uppercase",
                  borderTop: gi > 0 ? "1px solid var(--border)" : "none",
                  background: "rgba(255,255,255,0.02)",
                }}>
                  {group}
                </div>
                {/* Options */}
                {opts.map(opt => {
                  const bc2 = BADGE_COLORS[opt.badge];
                  const isActive = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      tabIndex={0}
                      onClick={() => { onChange(opt.value); setOpen(false); }}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        padding: "8px 12px",
                        background: isActive ? "rgba(99,102,241,0.12)" : "transparent",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
                      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: bc2.dot, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 12, color: isActive ? "var(--accent-hi)" : "var(--text-1)", fontFamily: "JetBrains Mono,monospace", fontWeight: isActive ? 600 : 400 }}>
                        {opt.label}
                      </span>
                      <span style={{ fontSize: 10.5, color: "var(--text-4)" }}>{opt.note}</span>
                      {isActive && <span style={{ fontSize: 10, color: "var(--accent-hi)" }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}



export function WorkspaceScreen({
  navigate,
  displayId,
}: {
  navigate: (s: string, d?: any) => void;
  displayId?: string | null;
}) {
  // ─── Investigator notes (multiple, editable, self-auditing) ─────────────
  // No real auth in this app yet — mirrors the hardcoded "Investigator A"
  // shown in the sidebar (components/Layout.tsx). Swap this for the real
  // logged-in user once auth exists.
  const CURRENT_USER = "Investigator A";

  const [notes, setNotes] = useState<any[]>([]);
  const [newNoteText, setNewNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [addNoteError, setAddNoteError] = useState<string | null>(null);

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState("");
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [noteActionError, setNoteActionError] = useState<string | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  // ─── Real investigation data ────────────────────────────────────────────
  const [inv, setInv] = useState<any>(null);
  const [invLoading, setInvLoading] = useState(true);
  const [invError, setInvError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInvLoading(true);
    setInvError(null);

    const load = async () => {
      let targetId = displayId;
      if (!targetId) {
        const list = await apiGet<any[]>("/api/investigations");
        targetId = list[0]?.displayId;
        if (!targetId) throw new Error("No investigations found");
      }

      const data = await apiGet<any>(`/api/investigations/${targetId}`);
      if (cancelled) return;

      setInv({
        ...data,
        id: data.displayId,
        entities: data.entities?.length ?? data._count?.entities ?? 0,
        evidence: data.evidence?.length ?? data._count?.evidence ?? 0,
        status: (data.status ?? "UNDER_INVESTIGATION").replace(/_/g, " "),
        priority: data.priority ?? "MEDIUM",
        assignee: data.assignee ?? "Unassigned",
        updated: data.updatedAt ? new Date(data.updatedAt).toLocaleString() : data.updated ?? "",
        description: data.description ?? "",
        relatedEntities: (data.entities ?? []).map((e: any) => ({
          ...e,
          _rawId: e.id, // prisma UUID — needed for DELETE /entities/:entityId
        })),
        // Real evidence rows for THIS investigation, normalised to the shape
        // the Evidence panel renders.
        evidenceItems: (data.evidence ?? []).map((ev: any) => ({
          _rawId: ev.id,             // prisma UUID — needed for DELETE
          id: ev.displayId ?? ev.id, // display string shown in UI
          type: ev.type,
          hash: ev.hash,
          status: ev.status,
          uploadedBy: ev.uploadedBy,
          createdAt: ev.createdAt,
        })),
        addedEvidence: Array.isArray(data.evidence) ? data.evidence : [],
        // entityRiskContributors is now computed by GET /:displayId itself
        // (recomputed from current Entity/Listing data via the same
        // computeEntityRisk() used elsewhere — see routes/investigations.ts)
        // so it's attached to latestAssessment here and survives a page
        // refresh, instead of only existing right after a fresh POST.
        latestAssessment: data.aiAssessments?.[0]
          ? { ...data.aiAssessments[0], entityRiskContributors: data.entityRiskContributors ?? [] }
          : null,
        // Full history (not just the latest) — additive, kept only so the
        // "why did this change?" panel below can show a real previous ->
        // current delta from persisted AiAssessment rows. Nothing here is
        // computed/estimated; it's the same array the API already returned.
        assessmentHistory: Array.isArray(data.aiAssessments) ? data.aiAssessments : [],
      });

      if (!cancelled) {
        setNotes(Array.isArray(data.notes) ? data.notes : []);
      }
    };

    load()
      .catch((err) => { if (!cancelled) setInvError(err.message); })
      .finally(() => { if (!cancelled) setInvLoading(false); });

    return () => { cancelled = true; };
  }, [displayId]);

  // ─── AI Assessment ───────────────────────────────────────────────────────
  const [assessment, setAssessment] = useState<any>(null);
  const [assessLoading, setAssessLoading] = useState(false);
  const [assessError, setAssessError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<SupportedModel>(DEFAULT_MODEL);

  useEffect(() => {
    setAssessment(inv?.latestAssessment ?? null);
  }, [inv?.latestAssessment]);

  const runAiAssessment = async () => {
    if (!inv?.id) return;
    setAssessLoading(true);
    setAssessError(null);
    try {
      const data = await apiPost(`/api/investigations/${inv.id}/ai-assessment`, { model: selectedModel });
      setAssessment(data);
      setShowModifyForm(false);
      setShowRejectForm(false);
      setReviewError(null);
    } catch (err: any) {
      setAssessError(err.message ?? "Failed to generate AI assessment");
    } finally {
      setAssessLoading(false);
    }
  };

  const addNote = async () => {
    if (!inv?.id || !newNoteText.trim()) return;
    setAddingNote(true);
    setAddNoteError(null);
    try {
      const created = await apiPost(`/api/investigations/${inv.id}/notes`, { content: newNoteText.trim(), author: CURRENT_USER });
      setNotes((prev) => [created, ...prev]);
      setNewNoteText("");
    } catch (err: any) {
      setAddNoteError(err.message ?? "Failed to add note");
    } finally {
      setAddingNote(false);
    }
  };

  const startEditNote = (n: any) => {
    setEditingNoteId(n.id);
    setEditNoteText(n.content);
    setNoteActionError(null);
  };

  const saveNoteEdit = async (noteId: string) => {
    if (!inv?.id || !editNoteText.trim()) return;
    setSavingNoteId(noteId);
    setNoteActionError(null);
    try {
      const updated = await apiPatch(`/api/investigations/${inv.id}/notes/${noteId}`, { content: editNoteText.trim(), author: CURRENT_USER });
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      setEditingNoteId(null);
    } catch (err: any) {
      setNoteActionError(err.message ?? "Failed to save changes");
    } finally {
      setSavingNoteId(null);
    }
  };

  const deleteNote = async (noteId: string) => {
    if (!inv?.id) return;
    setDeletingNoteId(noteId);
    setNoteActionError(null);
    try {
      await apiDelete(`/api/investigations/${inv.id}/notes/${noteId}`);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      setConfirmDeleteId(null);
    } catch (err: any) {
      setNoteActionError(err.message ?? "Failed to delete note");
    } finally {
      setDeletingNoteId(null);
    }
  };

  // ─── Action button modals ────────────────────────────────────────────────
  const [showAddEvidence, setShowAddEvidence] = useState(false);
  const [showAddEntity, setShowAddEntity] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showCloseCase, setShowCloseCase] = useState(false);

  // ─── Attach Existing Evidence (NOT a creation form) ──────────────────────
  // This picker only searches and selects records that already exist in
  // the Evidence Repository (GET /api/evidence?search=) and links them to
  // this investigation (POST /api/investigations/:displayId/evidence with
  // { evidenceIds }). It never creates a new EvidenceRecord — new evidence
  // can only be created from the Evidence Repository screen itself.
  const [evidenceSearch, setEvidenceSearch] = useState("");
  const [evidenceResults, setEvidenceResults] = useState<any[]>([]);
  const [evidenceSearching, setEvidenceSearching] = useState(false);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<Set<string>>(new Set());
  const [addingEvidence, setAddingEvidence] = useState(false);
  const [addEvidenceError, setAddEvidenceError] = useState<string | null>(null);
  const [addEvidenceSuccess, setAddEvidenceSuccess] = useState(false);
  const evidenceSearchSeq = { current: 0 } as { current: number };

  const searchEvidence = async (q: string) => {
    setEvidenceSearching(true);
    const seq = ++evidenceSearchSeq.current;
    try {
      const data = await apiGet<any[]>(`/api/evidence${q.trim() ? `?search=${encodeURIComponent(q)}` : ""}`);
      if (seq === evidenceSearchSeq.current) setEvidenceResults(data.slice(0, 30));
    } catch {
      if (seq === evidenceSearchSeq.current) setEvidenceResults([]);
    } finally {
      if (seq === evidenceSearchSeq.current) setEvidenceSearching(false);
    }
  };

  const toggleSelectEvidence = (id: string) => {
    setSelectedEvidenceIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const alreadyAttachedIds = new Set((inv?.evidenceItems ?? []).map((e: any) => e._rawId));

  const submitAddEvidence = async () => {
    if (!inv?.id || selectedEvidenceIds.size === 0) return;
    setAddingEvidence(true);
    setAddEvidenceError(null);
    setAddEvidenceSuccess(false);
    try {
      const result = await apiPost<any>(`/api/investigations/${inv.id}/evidence`, {
        evidenceIds: Array.from(selectedEvidenceIds),
      });
      const linked = result?.linked ?? [];
      setAddEvidenceSuccess(true);
      setInv((prev: any) => prev ? {
        ...prev,
        addedEvidence: [...(prev.addedEvidence ?? []), ...linked],
        evidenceItems: [
          ...(prev.evidenceItems ?? []),
          ...linked.map((created: any) => ({
            _rawId: created.id,
            id: created.displayId ?? created.id,
            type: created.type,
            hash: created.hash,
            status: created.status,
            uploadedBy: created.uploadedBy,
            createdAt: created.createdAt,
          })),
        ],
      } : prev);
      setSelectedEvidenceIds(new Set());
      setTimeout(() => { setShowAddEvidence(false); setAddEvidenceSuccess(false); setEvidenceSearch(""); setEvidenceResults([]); }, 900);
    } catch (err: any) {
      setAddEvidenceError(err.message ?? "Failed to attach evidence");
    } finally {
      setAddingEvidence(false);
    }
  };

  const [removingEvidenceId, setRemovingEvidenceId] = useState<string | null>(null);
  const removeEvidence = async (rawId: string) => {
    if (!inv?.id) return;
    setRemovingEvidenceId(rawId);
    try {
      await apiDelete(`/api/investigations/${inv.id}/evidence/${rawId}`);
      setInv((prev: any) => prev ? {
        ...prev,
        addedEvidence: (prev.addedEvidence ?? []).filter((e: any) => e.id !== rawId),
        evidenceItems: (prev.evidenceItems ?? []).filter((e: any) => e._rawId !== rawId),
      } : prev);
    } catch { /* silent */ } finally {
      setRemovingEvidenceId(null);
    }
  };

  const [removingEntityId, setRemovingEntityId] = useState<string | null>(null);
  const removeEntity = async (rawId: string) => {
    if (!inv?.id) return;
    setRemovingEntityId(rawId);
    try {
      await apiDelete(`/api/investigations/${inv.id}/entities/${rawId}`);
      setInv((prev: any) => prev ? {
        ...prev,
        relatedEntities: (prev.relatedEntities ?? []).filter((e: any) => e._rawId !== rawId),
      } : prev);
    } catch { /* silent */ } finally {
      setRemovingEntityId(null);
    }
  };

  // Add Entity form state
  const [entitySearch, setEntitySearch] = useState("");
  const [entityResults, setEntityResults] = useState<any[]>([]);
  const [entitySearching, setEntitySearching] = useState(false);
  const [addingEntityId, setAddingEntityId] = useState<string | null>(null);
  const [addEntityError, setAddEntityError] = useState<string | null>(null);

  const searchEntities = async (q: string) => {
    if (!q.trim()) { setEntityResults([]); return; }
    setEntitySearching(true);
    try {
      const data = await apiGet<any>(`/api/entities?search=${encodeURIComponent(q)}`);
      setEntityResults((data.entities ?? data).slice(0, 8));
    } catch {
      setEntityResults([]);
    } finally {
      setEntitySearching(false);
    }
  };

  const addEntityToInvestigation = async (entityId: string) => {
    if (!inv?.id) return;
    setAddingEntityId(entityId);
    setAddEntityError(null);
    try {
      await apiPost(`/api/investigations/${inv.id}/entities`, { entityId });
      // Add the entity to the displayed list
      const addedEntity = entityResults.find(e => e.id === entityId);
      if (addedEntity) {
        setInv((prev: any) => prev ? {
          ...prev,
          relatedEntities: [...(prev.relatedEntities ?? []), addedEntity],
          entities: (prev.entities || 0) + 1,
        } : prev);
      }
      setEntityResults(prev => prev.filter(e => e.id !== entityId));
    } catch (err: any) {
      setAddEntityError(err.message ?? "Failed to add entity");
    } finally {
      setAddingEntityId(null);
    }
  };

  // Assign form state
  const [assigneeName, setAssigneeName] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const submitAssign = async () => {
    if (!inv?.id || !assigneeName.trim()) return;
    setAssigning(true);
    setAssignError(null);
    try {
      await apiPatch(`/api/investigations/${inv.id}`, { assignee: assigneeName.trim() });
      setInv((prev: any) => prev ? { ...prev, assignee: assigneeName.trim() } : prev);
      setShowAssign(false);
      setAssigneeName("");
    } catch (err: any) {
      setAssignError(err.message ?? "Failed to reassign");
    } finally {
      setAssigning(false);
    }
  };

  // Close case state
  const [closingCase, setClosingCase] = useState(false);
  const [closeCaseError, setCloseCaseError] = useState<string | null>(null);

  const submitCloseCase = async () => {
    if (!inv?.id) return;
    setClosingCase(true);
    setCloseCaseError(null);
    try {
      await apiPatch(`/api/investigations/${inv.id}`, { status: "CLOSED" });
      setInv((prev: any) => prev ? { ...prev, status: "CLOSED" } : prev);
      setShowCloseCase(false);
    } catch (err: any) {
      setCloseCaseError(err.message ?? "Failed to close case");
    } finally {
      setClosingCase(false);
    }
  };

  // Add Note quick-focus helper
  const focusAddNote = () => {
    const el = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Add a note…"]');
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.focus(); }
  };

  // ─── AI Assessment review (Accept / Modify / Reject) ────────────────────
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [showModifyForm, setShowModifyForm] = useState(false);
  const [modifyExplanation, setModifyExplanation] = useState("");
  const [modifyNextSteps, setModifyNextSteps] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const submitReview = async (action: "ACCEPT" | "MODIFY" | "REJECT" | "RESET", extra: Record<string, any> = {}) => {
    if (!inv?.id || !assessment?.id) return;
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const data = await apiPatch(
        `/api/investigations/${inv.id}/ai-assessment/${assessment.id}/review`,
        { action, reviewedBy: inv.assignee, ...extra }
      );
      setAssessment((prev: any) => ({ ...prev, ...data }));
      setShowModifyForm(false);
      setShowRejectForm(false);
    } catch (err: any) {
      setReviewError(err.message ?? "Failed to record decision");
    } finally {
      setReviewSubmitting(false);
    }
  };

  const openModifyForm = () => {
    setModifyExplanation(assessment?.editedExplanation ?? assessment?.explanation ?? "");
    let seedSteps: string[] = [];
    try {
      seedSteps = assessment?.editedRecommendedNext
        ? JSON.parse(assessment.editedRecommendedNext)
        : assessment?.recommendedNext
        ? JSON.parse(assessment.recommendedNext)
        : [];
    } catch {
      seedSteps = [];
    }
    setModifyNextSteps(seedSteps.join("\n"));
    setShowRejectForm(false);
    setShowModifyForm(true);
  };

  const submitModify = () => {
    if (!modifyExplanation.trim()) return;
    const editedRecommendedNext = modifyNextSteps
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    submitReview("MODIFY", { editedExplanation: modifyExplanation.trim(), editedRecommendedNext });
  };

  // When an investigator has MODIFIED the assessment, their edited next
  // steps are the ones to display — the original AI text is preserved
  // underneath but is no longer what's shown as "current".
  const displayExplanation: string =
    assessment?.reviewStatus === "MODIFIED" && assessment?.editedExplanation
      ? assessment.editedExplanation
      : assessment?.explanation ?? "";

  // ─── "Why did the score change?" (Person 2 / item H) ────────────────────
  // Finds the immediately-previous persisted AiAssessment by createdAt,
  // sorted explicitly here rather than trusting the API's return order
  // (the backend does order by createdAt desc today, but this shouldn't
  // silently break if that ever changes).
  const sortedAssessmentHistory: any[] = [...(inv?.assessmentHistory ?? [])].sort(
    (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const currentIndexInHistory = sortedAssessmentHistory.findIndex((a: any) => a.id === assessment?.id);
  const previousAssessment: any =
    currentIndexInHistory !== -1
      ? sortedAssessmentHistory[currentIndexInHistory + 1] ?? null
      : sortedAssessmentHistory[0] ?? null;
  const riskDelta: number | null =
    assessment?.riskScore != null && previousAssessment?.riskScore != null
      ? assessment.riskScore - previousAssessment.riskScore
      : null;

  const recommendations: string[] = (() => {
    const raw =
      assessment?.reviewStatus === "MODIFIED" && assessment?.editedRecommendedNext
        ? assessment.editedRecommendedNext
        : assessment?.recommendedNext;

    if (!raw) {
      return assessment
        ? []
        : [
            "Expand network analysis to include second-degree connections of Alias_Y",
            "Request blockchain transaction records for Wallet_W1 and Wallet_W2",
            "Cross-reference communication identifiers with Source Gamma dataset",
            "Review temporal correlation between listing activity spikes and wallet transactions",
          ];
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [raw];
    } catch {
      return [raw];
    }
  })();

  if (invLoading && !inv) {
    return <div style={{ padding: "26px 28px" }}><p className="page-sub">Loading case…</p></div>;
  }
  if (invError && !inv) {
    return (
      <div style={{ padding: "26px 28px" }}>
        <p className="page-sub" style={{ color: "var(--high-light)" }}>Couldn't reach the API ({invError}).</p>
      </div>
    );
  }
  if (!inv) {
    return <div style={{ padding: "26px 28px" }}><p className="page-sub">No investigation to show.</p></div>;
  }

  return (
    <div style={{ padding: "26px 28px" }}>
      {/* ── Assign Modal ──────────────────────────────────────────────── */}
      {showAssign && (
        <div style={{ position:"fixed",inset:0,zIndex:1000,background:"rgba(7,9,16,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center" }}
          onClick={e => { if (e.target===e.currentTarget) setShowAssign(false); }}>
          <div style={{ background:"var(--card,#0f1420)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:14,padding:28,width:400,boxShadow:"0 20px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18 }}>
              <div className="display" style={{ fontSize:15,fontWeight:700,color:"var(--text-1)" }}>Reassign Investigation</div>
              <button onClick={() => setShowAssign(false)} style={{ background:"none",border:"none",color:"var(--text-3)",cursor:"pointer",fontSize:17 }}>✕</button>
            </div>
            <div style={{ fontSize:12,color:"var(--text-3)",marginBottom:14 }}>
              Currently assigned to <strong style={{ color:"var(--text-2)" }}>{inv.assignee}</strong>
            </div>
            <div style={{ marginBottom:13 }}>
              <div style={{ fontSize:11,fontWeight:600,color:"var(--text-3)",marginBottom:6 }}>New Assignee</div>
              <input className="input" placeholder="Investigator name…" value={assigneeName} onChange={e => setAssigneeName(e.target.value)} />
            </div>
            {["Investigator A","Investigator B","Investigator C","Senior Analyst"].map(name => (
              <button key={name} onClick={() => setAssigneeName(name)}
                style={{ display:"inline-block",margin:"0 6px 6px 0",padding:"4px 10px",fontSize:11.5,background:assigneeName===name?"rgba(99,102,241,0.15)":"rgba(255,255,255,0.04)",border:`1px solid ${assigneeName===name?"rgba(99,102,241,0.4)":"rgba(255,255,255,0.08)"}`,borderRadius:6,color:assigneeName===name?"var(--accent-hi)":"var(--text-3)",cursor:"pointer",transition:"all 0.13s" }}>
                {name}
              </button>
            ))}
            {assignError && <div style={{ fontSize:11.5,color:"var(--critical-light)",marginTop:10 }}>{assignError}</div>}
            <div style={{ display:"flex",gap:8,marginTop:18 }}>
              <button className="btn btn-primary" style={{ flex:1,justifyContent:"center" }} onClick={submitAssign} disabled={assigning||!assigneeName.trim()}>
                {assigning ? "Assigning…" : "Reassign"}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowAssign(false)} disabled={assigning}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Close Case Modal ──────────────────────────────────────────── */}
      {showCloseCase && (
        <div style={{ position:"fixed",inset:0,zIndex:1000,background:"rgba(7,9,16,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center" }}
          onClick={e => { if (e.target===e.currentTarget) setShowCloseCase(false); }}>
          <div style={{ background:"var(--card,#0f1420)",border:"1px solid rgba(220,38,38,0.25)",borderRadius:14,padding:28,width:420,boxShadow:"0 20px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ fontSize:15,fontWeight:700,color:"var(--text-1)",marginBottom:8 }}>Close Case</div>
            <div style={{ fontSize:12.5,color:"var(--text-3)",lineHeight:1.65,marginBottom:20 }}>
              Mark <strong style={{ color:"var(--text-2)" }}>{inv.title}</strong> as closed. The case will be archived and marked inactive. You can re-open it later if needed.
            </div>
            {closeCaseError && <div style={{ fontSize:11.5,color:"var(--critical-light)",marginBottom:14 }}>{closeCaseError}</div>}
            <div style={{ display:"flex",gap:8 }}>
              <button className="btn btn-danger" style={{ flex:1,justifyContent:"center" }} onClick={submitCloseCase} disabled={closingCase}>
                {closingCase ? "Closing…" : "Close Case"}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowCloseCase(false)} disabled={closingCase}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {invLoading && <p className="page-sub" style={{ marginBottom: 12 }}>Refreshing case…</p>}
      {invError && (
        <p className="page-sub" style={{ marginBottom: 12, color: "var(--high-light)" }}>
          Couldn't refresh from the API ({invError}) — showing the last loaded version of this case.
        </p>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <button onClick={() => navigate("investigations")} style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", fontSize: 12, padding: 0 }}>← Investigations</button>
            <span style={{ color: "var(--text-4)" }}>/</span>
            <span className="mono-sm" style={{ color: "var(--accent-hi)" }}>{inv.id}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <h1 className="section-head display" style={{ fontSize: 20 }}>{inv.title}</h1>
            <span className={`badge ${inv.status === "CLOSED" ? "badge-low" : "badge-pending"}`}>{inv.status}</span>
            <span className={`badge ${inv.priority === "CRITICAL" ? "badge-critical" : inv.priority === "HIGH" ? "badge-high" : inv.priority === "MEDIUM" ? "badge-medium" : "badge-low"}`}>{inv.priority}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>Assigned to <span style={{ color: "var(--text-2)" }}>{inv.assignee}</span> · Updated {inv.updated}</div>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="btn btn-ghost btn-sm" onClick={focusAddNote}>Add Note</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setAssigneeName(inv.assignee ?? ""); setShowAssign(true); }}>Assign</button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate("reports", inv.id)}>Generate Report</button>
          <button className="btn btn-danger btn-sm" onClick={() => setShowCloseCase(true)} disabled={inv.status === "CLOSED"}>
            {inv.status === "CLOSED" ? "Closed" : "Close Case"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 310px", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Summary */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 10 }}>Case Summary</div>
            <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.7 }}>{inv.description}</div>
          </div>

          {/* Entities */}
          <div className="card" style={{ padding: 20, position: "relative" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                Related Entities {(inv.relatedEntities ?? []).length > 0 && <span style={{ color: "var(--text-4)", fontWeight: 400 }}>({(inv.relatedEntities ?? []).length})</span>}
              </div>
              <div style={{ display: "flex", gap: 6, position: "relative" }}>
                <div style={{ position: "relative" }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setShowAddEntity(o => !o); setShowAddEvidence(false); }}
                    style={{ display: "flex", alignItems: "center", gap: 5 }}
                  >
                    + Add Entity
                    <span style={{ fontSize: 8, opacity: 0.6, transform: showAddEntity ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▼</span>
                  </button>

                  {showAddEntity && (
                    <div style={{
                      position: "absolute", top: "calc(100% + 6px)", right: 0,
                      width: 360, background: "var(--elevated, #141a27)",
                      border: "1px solid rgba(255,255,255,0.1)", borderRadius: 11,
                      boxShadow: "0 12px 40px rgba(0,0,0,0.6)", zIndex: 100,
                      overflow: "hidden",
                    }}>
                      {/* Header */}
                      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 8 }}>Add Related Entity</div>
                        <input
                          className="input"
                          style={{ fontSize: 12.5 }}
                          placeholder="Search by alias or ID…"
                          value={entitySearch}
                          autoFocus
                          onChange={e => { setEntitySearch(e.target.value); searchEntities(e.target.value); }}
                        />
                      </div>

                      {/* Results */}
                      <div style={{ maxHeight: 240, overflowY: "auto" }}>
                        {!entitySearch.trim() && (
                          <div style={{ padding: "14px 14px", fontSize: 12, color: "var(--text-4)", textAlign: "center" }}>
                            Type to search entities…
                          </div>
                        )}
                        {entitySearching && (
                          <div style={{ padding: "14px", fontSize: 12, color: "var(--text-4)", textAlign: "center" }}>Searching…</div>
                        )}
                        {!entitySearching && entitySearch.trim() && entityResults.length === 0 && (
                          <div style={{ padding: "14px", fontSize: 12, color: "var(--text-4)", textAlign: "center" }}>No entities found</div>
                        )}
                        {entityResults.map(e => (
                          <div
                            key={e.id}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)", transition: "background 0.1s", cursor: "default" }}
                            onMouseEnter={el => (el.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"}
                            onMouseLeave={el => (el.currentTarget as HTMLElement).style.background = "transparent"}
                          >
                            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(99,102,241,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--accent-hi)", flexShrink: 0 }}>◈</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.alias}</div>
                              <div className="mono-sm" style={{ color: "var(--text-4)" }}>{e.displayId ?? e.id}</div>
                            </div>
                            <button
                              className="btn btn-primary btn-sm"
                              style={{ flexShrink: 0, fontSize: 10.5 }}
                              onClick={() => addEntityToInvestigation(e.id)}
                              disabled={addingEntityId === e.id}
                            >
                              {addingEntityId === e.id ? "Adding…" : "+ Add"}
                            </button>
                          </div>
                        ))}
                      </div>

                      {addEntityError && (
                        <div style={{ padding: "8px 14px", fontSize: 11.5, color: "var(--critical-light)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>{addEntityError}</div>
                      )}

                      <div style={{ padding: "8px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", textAlign: "right" }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setShowAddEntity(false); setEntitySearch(""); setEntityResults([]); }}>Done</button>
                      </div>
                    </div>
                  )}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate("entities")}>View All</button>
              </div>
            </div>

            {/* Entity list — real data only, no hardcoded fallback */}
            {(inv.relatedEntities ?? []).length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "22px 0", gap: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "var(--text-4)" }}>◈</div>
                <div style={{ fontSize: 12.5, color: "var(--text-4)" }}>No entities linked yet</div>
                <div style={{ fontSize: 11.5, color: "var(--text-4)", opacity: 0.7 }}>Use "+ Add Entity" to link related subjects</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(inv.relatedEntities ?? []).map((e: any) => (
                  <div key={e.displayId ?? e.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, cursor: "pointer", transition: "background 0.13s" }}
                    onMouseEnter={el => { (el.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
                    onMouseLeave={el => { (el.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(99,102,241,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--accent-hi)", flexShrink: 0 }}>◈</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>{e.alias}</div>
                      <div className="mono-sm" style={{ color: "var(--text-4)" }}>{e.displayId ?? e.id}</div>
                    </div>
                    <RiskBadge score={e.risk} />
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate("entity", { id: e.displayId ?? e.id, displayId: e.displayId ?? e.id })}>View</button>
                    <button
                      className="icon-btn danger"
                      style={{ fontSize: 10, padding: "2px 6px", flexShrink: 0 }}
                      onClick={() => removeEntity(e._rawId ?? e.id)}
                      disabled={removingEntityId === (e._rawId ?? e.id)}
                      title="Remove entity"
                    >
                      {removingEntityId === e.id ? "…" : "✕"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Evidence */}
          <div className="card" style={{ padding: 20, position: "relative" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                Evidence {(inv.evidenceItems ?? []).length > 0 && <span style={{ color: "var(--text-4)", fontWeight: 400 }}>({(inv.evidenceItems ?? []).length})</span>}
              </div>
              <div style={{ display: "flex", gap: 6, position: "relative" }}>
                <div style={{ position: "relative" }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setShowAddEvidence(o => {
                        const next = !o;
                        if (next) searchEvidence(evidenceSearch);
                        return next;
                      });
                      setShowAddEntity(false);
                    }}
                    style={{ display: "flex", alignItems: "center", gap: 5 }}
                  >
                    + Add Evidence
                    <span style={{ fontSize: 8, opacity: 0.6, transform: showAddEvidence ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▼</span>
                  </button>

                  {showAddEvidence && (
                    <div style={{
                      position: "absolute", top: "calc(100% + 6px)", right: 0,
                      width: 400, background: "var(--elevated, #141a27)",
                      border: "1px solid rgba(255,255,255,0.1)", borderRadius: 11,
                      boxShadow: "0 12px 40px rgba(0,0,0,0.6)", zIndex: 100,
                      overflow: "hidden",
                    }}>
                      {/* Header — this attaches EXISTING evidence only. New evidence
                          records can only be created from the Evidence Repository
                          screen (navigate("evidence")). */}
                      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 2 }}>Attach Existing Evidence</div>
                        <div style={{ fontSize: 10.5, color: "var(--text-4)", marginBottom: 10 }}>
                          Selects from the Evidence Repository — doesn't create a new record.
                        </div>
                        <input
                          className="input"
                          style={{ fontSize: 12.5 }}
                          placeholder="Search evidence by ID, type, source, notes…"
                          value={evidenceSearch}
                          autoFocus
                          onChange={e => { setEvidenceSearch(e.target.value); searchEvidence(e.target.value); }}
                        />
                      </div>

                      {/* Results — real EvidenceRecord rows from the repository */}
                      <div style={{ maxHeight: 280, overflowY: "auto" }}>
                        {evidenceSearching && (
                          <div style={{ padding: "14px", fontSize: 12, color: "var(--text-4)", textAlign: "center" }}>Searching…</div>
                        )}
                        {!evidenceSearching && evidenceResults.length === 0 && (
                          <div style={{ padding: "14px", fontSize: 12, color: "var(--text-4)", textAlign: "center" }}>
                            {evidenceSearch.trim() ? "No evidence found" : "No evidence in the repository yet"}
                          </div>
                        )}
                        {evidenceResults.map(ev => {
                          const rawId = ev.id;
                          const isAttached = alreadyAttachedIds.has(rawId);
                          const isSelected = selectedEvidenceIds.has(rawId);
                          return (
                            <div
                              key={rawId}
                              style={{
                                display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                                borderBottom: "1px solid rgba(255,255,255,0.04)",
                                opacity: isAttached ? 0.5 : 1,
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                  <span className="mono-sm" style={{ color: "var(--accent-hi)" }}>{ev.displayId ?? ev.id}</span>
                                  <span className={`badge ${ev.status === "VERIFIED" ? "badge-verified" : ev.status === "REJECTED" ? "badge-critical" : "badge-pending"}`} style={{ fontSize: 9 }}>{ev.status}</span>
                                </div>
                                <div style={{ fontSize: 12, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{ev.type}</div>
                                <div style={{ fontSize: 10.5, color: "var(--text-4)", marginTop: 1 }}>
                                  {ev.source?.name ? `${ev.source.name} · ` : ""}{ev.createdAt ? new Date(ev.createdAt).toLocaleDateString() : "—"}
                                </div>
                              </div>
                              <button
                                type="button"
                                className={`btn btn-sm ${isSelected ? "btn-primary" : "btn-ghost"}`}
                                style={{ flexShrink: 0, fontSize: 10.5 }}
                                disabled={isAttached}
                                onClick={() => toggleSelectEvidence(rawId)}
                              >
                                {isAttached ? "Already Added" : isSelected ? "✓ Selected" : "Select"}
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      {addEvidenceError && (
                        <div style={{ padding: "8px 14px", fontSize: 11.5, color: "var(--critical-light)" }}>{addEvidenceError}</div>
                      )}
                      {addEvidenceSuccess && (
                        <div style={{ padding: "8px 14px", fontSize: 11.5, color: "#4ade80" }}>✓ Evidence attached</div>
                      )}

                      <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ flex: 1, justifyContent: "center" }}
                          onClick={submitAddEvidence}
                          disabled={addingEvidence || selectedEvidenceIds.size === 0}
                        >
                          {addingEvidence ? "Attaching…" : `Add Selected${selectedEvidenceIds.size ? ` (${selectedEvidenceIds.size})` : ""}`}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setShowAddEvidence(false); setEvidenceSearch(""); setEvidenceResults([]); setSelectedEvidenceIds(new Set()); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate("evidence")}>View All</button>
              </div>
            </div>

            {/* Evidence list — real data only, no hardcoded fallback */}
            {(inv.evidenceItems ?? []).length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "22px 0", gap: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "var(--text-4)" }}>⊟</div>
                <div style={{ fontSize: 12.5, color: "var(--text-4)" }}>No evidence added yet</div>
                <div style={{ fontSize: 11.5, color: "var(--text-4)", opacity: 0.7 }}>Use "+ Add Evidence" to attach records</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {(inv.evidenceItems ?? []).map((ev: any) => (
                  <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 7 }}>
                    <span className="mono-sm" style={{ color: "var(--accent-hi)", flexShrink: 0, minWidth: 76 }}>{ev.id}</span>
                    <span style={{ flex: 1, fontSize: 12, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.type}</span>
                    <span style={{ fontSize: 11, color: "var(--text-4)", flexShrink: 0 }}>{ev.createdAt ? new Date(ev.createdAt).toLocaleDateString() : "—"}</span>
                    <span className={`badge ${ev.status === "VERIFIED" || ev.status === "Verified" ? "badge-verified" : "badge-pending"}`} style={{ flexShrink: 0 }}>{ev.status}</span>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ flexShrink: 0, fontSize: 10.5, padding: "3px 8px" }}
                      onClick={() => navigate("evidence", { selectedId: ev.id })}
                      title="Open in Evidence Repository"
                    >
                      View
                    </button>
                    <button
                      className="icon-btn danger"
                      style={{ fontSize: 10, padding: "2px 6px", flexShrink: 0 }}
                      onClick={() => removeEvidence(ev._rawId ?? ev.id)}
                      disabled={removingEvidenceId === (ev._rawId ?? ev.id)}
                      title="Remove evidence"
                    >
                      {removingEvidenceId === (ev._rawId ?? ev.id) ? "…" : "✕"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 12 }}>Investigator Notes</div>

            {/* Add new note */}
            <textarea
              className="input"
              style={{ minHeight: 70, resize: "vertical", fontSize: 12.5 }}
              placeholder="Add a note…"
              value={newNoteText}
              onChange={e => setNewNoteText(e.target.value)}
            />
            {addNoteError && (
              <div style={{ fontSize: 11, color: "var(--critical-light)", marginTop: 6 }}>Couldn't add note ({addNoteError}).</div>
            )}
            <button
              className="btn btn-primary btn-sm"
              style={{ marginTop: 8 }}
              onClick={addNote}
              disabled={addingNote || !newNoteText.trim()}
            >
              {addingNote ? "Adding…" : "Add Note"}
            </button>

            {noteActionError && (
              <div style={{ fontSize: 11, color: "var(--critical-light)", marginTop: 10 }}>{noteActionError}</div>
            )}

            {/* Note list — newest first, each its own little audit trail */}
            {notes.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
                {notes.map((n) => {
                  const revisions = n.revisions ?? [];
                  const isEditing = editingNoteId === n.id;
                  const isConfirmingDelete = confirmDeleteId === n.id;
                  const isHistoryOpen = expandedHistoryId === n.id;

                  return (
                    <div key={n.id} className="note-item">
                      {isEditing ? (
                        <>
                          <textarea
                            className="input"
                            style={{ minHeight: 60, resize: "vertical", fontSize: 12.5 }}
                            value={editNoteText}
                            onChange={e => setEditNoteText(e.target.value)}
                            autoFocus
                          />
                          <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => saveNoteEdit(n.id)}
                              disabled={savingNoteId === n.id || !editNoteText.trim()}
                            >
                              {savingNoteId === n.id ? "Saving…" : "Save"}
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setEditingNoteId(null)}
                              disabled={savingNoteId === n.id}
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="note-content">{n.content}</div>

                          <div className="note-meta-row">
                            <div className="note-meta">
                              Added by {n.createdBy} · {new Date(n.createdAt).toLocaleString()}
                              {n.updatedBy && (
                                <div className="edited-tag">
                                  Edited by {n.updatedBy} · {new Date(n.updatedAt).toLocaleString()}
                                </div>
                              )}
                            </div>

                            {isConfirmingDelete ? (
                              <div className="note-actions">
                                <button
                                  className="icon-btn danger"
                                  onClick={() => deleteNote(n.id)}
                                  disabled={deletingNoteId === n.id}
                                >
                                  {deletingNoteId === n.id ? "Deleting…" : "✓ Confirm"}
                                </button>
                                <button className="icon-btn" onClick={() => setConfirmDeleteId(null)}>
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="note-actions">
                                {revisions.length > 0 && (
                                  <button
                                    className={`icon-btn accent${isHistoryOpen ? " active" : ""}`}
                                    onClick={() => setExpandedHistoryId(isHistoryOpen ? null : n.id)}
                                  >
                                    🕘 {isHistoryOpen ? "Hide" : "History"} ({revisions.length})
                                  </button>
                                )}
                                <button className="icon-btn" onClick={() => startEditNote(n)}>✎ Edit</button>
                                <button className="icon-btn danger" onClick={() => setConfirmDeleteId(n.id)}>🗑 Delete</button>
                              </div>
                            )}
                          </div>

                          {isHistoryOpen && revisions.length > 0 && (
                            <div className="note-history">
                              {revisions.map((rev: any) => (
                                <div key={rev.id} className="note-history-item">
                                  <div className="rev-content">{rev.content}</div>
                                  <div className="rev-meta">
                                    Written by {rev.author} · {new Date(rev.versionAt).toLocaleString()}
                                    {" · replaced "}{new Date(rev.supersededAt).toLocaleString()}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right rail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* AI Assessment */}
          <div className="card card-glow-accent" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <PulseIndicator color="var(--accent)" />
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>AI Assessment</div>
                {assessment && <RiskBadge score={assessment.riskScore} />}
              </div>
              {assessment && (
                <button className="btn btn-ghost btn-sm" disabled={assessLoading} onClick={runAiAssessment}>
                  {assessLoading ? "Running…" : "Re-run"}
                </button>
              )}
            </div>

            {/* Model picker */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10.5, color: "var(--text-4)", marginBottom: 5, letterSpacing: "0.04em" }}>MODEL</div>
              <ModelPicker value={selectedModel} onChange={setSelectedModel} disabled={assessLoading} />
            </div>

            {!assessment && (
              <>
                <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.65, marginBottom: 14 }}>
                  Generate an AI-assisted assessment from the investigation's current evidence, entities, risk signals, and network activity.
                </div>

                {assessError && (
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--critical-light)",
                      marginBottom: 12,
                      padding: "8px 10px",
                      background: "rgba(220,38,38,0.08)",
                      borderRadius: 6,
                      border: "1px solid rgba(220,38,38,0.2)",
                    }}
                  >
                    Couldn't reach the API ({assessError}).
                  </div>
                )}

                <button
                  className="btn btn-primary"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={runAiAssessment}
                  disabled={assessLoading}
                >
                  {assessLoading ? "Running AI Assessment…" : "Run AI Assessment"}
                </button>
              </>
            )}

            {assessment && (
              <>
                {/* Model used badge */}
                {assessment.modelUsed && assessment.modelUsed !== "fallback" && (
                  <div style={{ fontSize: 10.5, color: "var(--text-4)", marginBottom: 10 }}>
                    Generated by <span style={{ color: "var(--accent-hi)", fontFamily: "JetBrains Mono,monospace" }}>{assessment.modelUsed}</span>
                  </div>
                )}

                {/* What changed — previous vs current, from persisted AiAssessment rows only */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
                  padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 7,
                }}>
                  {previousAssessment ? (
                    <>
                      <span className="mono-sm" style={{ color: "var(--text-4)" }}>{previousAssessment.riskScore}</span>
                      <span style={{ color: "var(--text-4)", fontSize: 11 }}>→</span>
                      <span className="mono-sm" style={{ color: "var(--text-1)", fontWeight: 700 }}>{assessment.riskScore}</span>
                      {riskDelta !== null && riskDelta !== 0 && (
                        <span className="mono-sm" style={{ color: riskDelta > 0 ? "var(--critical-light, #f87171)" : "#10b981", marginLeft: 2 }}>
                          {riskDelta > 0 ? "▲" : "▼"} {riskDelta > 0 ? "+" : ""}{riskDelta}
                        </span>
                      )}
                      <span style={{ fontSize: 10.5, color: "var(--text-4)", marginLeft: "auto" }}>
                        since {previousAssessment.createdAt ? new Date(previousAssessment.createdAt).toLocaleDateString() : "last assessment"}
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--text-4)" }}>
                      This is the first recorded AI assessment for this investigation — no prior score to compare against.
                    </span>
                  )}
                </div>

                {assessment.reviewStatus === "MODIFIED" && assessment.editedExplanation && (
                  <div style={{ fontSize: 10, color: "var(--accent-hi)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Edited by investigator
                  </div>
                )}
                <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.65, marginBottom: 12 }}>
                  {displayExplanation}
                </div>

                {assessment.aiGenerated === false && (
                  <div style={{ fontSize: 10.5, color: "var(--text-4)", marginBottom: 12 }}>
                    The selected model was unreachable — showing a deterministic fallback summary instead of a generated narrative.
                  </div>
                )}

                <div className="ai-strip" style={{ marginBottom: 14 }}>
                  <span style={{ color: "var(--medium-light)", fontSize: 14, flexShrink: 0 }}>⚠</span>
                  <div style={{ fontSize: 10.5, color: "var(--medium-light)" }}>
                    AI-generated — all conclusions require investigator review. This assessment does not constitute a criminal determination.
                  </div>
                </div>

                {assessment.signals?.length > 0 && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 10 }}>Risk Signals</div>
                    {assessment.signals.map((signal: any, i: number) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 9px", marginBottom: 6, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
                        <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>{signal.label}</span>
                        <span className="mono-sm" style={{ color: "var(--accent-hi)" }}>+{signal.value}</span>
                      </div>
                    ))}
                  </>
                )}

                {/* Per-entity contributor breakdown — real riskEngine factors,
                    via computeEntityRisk. Present on both a freshly-run
                    assessment (from the POST response) and one loaded from
                    history on page load (GET /:displayId now recomputes the
                    same breakdown from current Entity/Listing data — see
                    routes/investigations.ts). Only genuinely empty when the
                    investigation has no linked entities at all. */}
                {Array.isArray(assessment.entityRiskContributors) && assessment.entityRiskContributors.length > 0 ? (
                  <>
                    <div className="divider" style={{ margin: "14px 0" }} />
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 10 }}>
                      Which Entities Contributed
                    </div>
                    {assessment.entityRiskContributors.map((ec: any) => (
                      <div key={ec.displayId ?? ec.alias} style={{ padding: "8px 9px", marginBottom: 6, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ec.contributors?.length ? 6 : 0 }}>
                          <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500 }}>{ec.alias}</span>
                          {ec.risk != null && <RiskBadge score={ec.risk} />}
                        </div>
                        {Array.isArray(ec.contributors) && ec.contributors.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            {ec.contributors.map((c: any, i: number) => (
                              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--text-4)" }}>
                                <span>{c.label}</span>
                                <span className="mono-sm">+{c.contribution}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {!ec.correlated && (
                          <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 4, fontStyle: "italic" }}>
                            {ec.explanation ?? "No correlated listing evidence for this entity yet."}
                          </div>
                        )}
                      </div>
                    ))}
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
                      onClick={() => navigate("graph", inv.id)}
                    >
                      View Relationships in Graph
                    </button>
                    {/* Honest limitation, not a fabricated link: there's no
                        persisted column tying a specific risk contributor to
                        a specific EvidenceRecord/timeline entry, so this
                        points at the existing sections on this same screen
                        rather than inventing a per-signal citation. */}
                    <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 8, lineHeight: 1.5 }}>
                      For supporting evidence and events, see this investigation's
                      Evidence and Timeline sections — the contributors above aren't
                      yet linked to a specific evidence record.
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 10.5, color: "var(--text-4)", marginBottom: 4, fontStyle: "italic" }}>
                    No entities are linked to this investigation yet, so no per-entity contributor breakdown is available.
                  </div>
                )}

                {recommendations.length > 0 && (
                  <>
                    <div className="divider" style={{ margin: "14px 0" }} />
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 10 }}>Recommended Next Steps</div>
                    {recommendations.map((r, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 7 }}>
                        <span style={{ color: "var(--accent-hi)", fontSize: 11, flexShrink: 0, fontWeight: 700, minWidth: 14 }}>{i + 1}.</span>
                        <span style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5 }}>{r}</span>
                      </div>
                    ))}
                  </>
                )}

                <div className="divider" style={{ margin: "14px 0" }} />

                <div style={{ fontSize: 11, color: "var(--text-4)", marginBottom: 8 }}>Investigator Decision</div>

                {reviewError && (
                  <div style={{ fontSize: 11, color: "var(--critical-light)", marginBottom: 8 }}>
                    Couldn't save decision ({reviewError}).
                  </div>
                )}

                {(!assessment.reviewStatus || assessment.reviewStatus === "PENDING") && !showModifyForm && !showRejectForm && (
                  <div style={{ display: "flex", gap: 7 }}>
                    <button
                      className="btn btn-primary"
                      style={{ flex: 1, justifyContent: "center", fontSize: 11 }}
                      onClick={() => submitReview("ACCEPT")}
                      disabled={reviewSubmitting}
                    >
                      Accept
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ flex: 1, justifyContent: "center", fontSize: 11 }}
                      onClick={openModifyForm}
                      disabled={reviewSubmitting}
                    >
                      Modify
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ flex: 1, justifyContent: "center", fontSize: 11 }}
                      onClick={() => { setShowRejectForm(true); setShowModifyForm(false); }}
                      disabled={reviewSubmitting}
                    >
                      Reject
                    </button>
                  </div>
                )}

                {showModifyForm && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 10.5, color: "var(--text-4)" }}>Explanation</div>
                    <textarea
                      className="input"
                      style={{ minHeight: 70, resize: "vertical", fontSize: 12 }}
                      value={modifyExplanation}
                      onChange={e => setModifyExplanation(e.target.value)}
                    />
                    <div style={{ fontSize: 10.5, color: "var(--text-4)" }}>Recommended next steps (one per line)</div>
                    <textarea
                      className="input"
                      style={{ minHeight: 70, resize: "vertical", fontSize: 12 }}
                      value={modifyNextSteps}
                      onChange={e => setModifyNextSteps(e.target.value)}
                    />
                    <div style={{ display: "flex", gap: 7 }}>
                      <button
                        className="btn btn-primary"
                        style={{ flex: 1, justifyContent: "center", fontSize: 11 }}
                        onClick={submitModify}
                        disabled={reviewSubmitting || !modifyExplanation.trim()}
                      >
                        {reviewSubmitting ? "Saving…" : "Save Changes"}
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ flex: 1, justifyContent: "center", fontSize: 11 }}
                        onClick={() => setShowModifyForm(false)}
                        disabled={reviewSubmitting}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {showRejectForm && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea
                      className="input"
                      style={{ minHeight: 60, resize: "vertical", fontSize: 12 }}
                      placeholder="Reason for rejecting this assessment (optional)…"
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                    />
                    <div style={{ display: "flex", gap: 7 }}>
                      <button
                        className="btn btn-danger"
                        style={{ flex: 1, justifyContent: "center", fontSize: 11 }}
                        onClick={() => submitReview("REJECT", { reviewNote: rejectReason.trim() })}
                        disabled={reviewSubmitting}
                      >
                        {reviewSubmitting ? "Saving…" : "Confirm Reject"}
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ flex: 1, justifyContent: "center", fontSize: 11 }}
                        onClick={() => setShowRejectForm(false)}
                        disabled={reviewSubmitting}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {assessment.reviewStatus && assessment.reviewStatus !== "PENDING" && !showModifyForm && !showRejectForm && (
                  <>
                    {assessment.reviewStatus === "ACCEPTED" && (
                      <div className="integrity-banner">
                        <span>✓</span> Accepted{assessment.reviewedBy ? ` by ${assessment.reviewedBy}` : ""}
                      </div>
                    )}
                    {assessment.reviewStatus === "MODIFIED" && (
                      <div className="integrity-banner">
                        <span>✎</span> Modified{assessment.reviewedBy ? ` by ${assessment.reviewedBy}` : ""}
                      </div>
                    )}
                    {assessment.reviewStatus === "REJECTED" && (
                      <div style={{ padding: "8px 10px", borderRadius: 7, background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)" }}>
                        <div style={{ fontSize: 11.5, color: "var(--critical-light)", display: "flex", alignItems: "center", gap: 6 }}>
                          <span>✕</span> Rejected{assessment.reviewedBy ? ` by ${assessment.reviewedBy}` : ""}
                        </div>
                        {assessment.reviewNote && (
                          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{assessment.reviewNote}</div>
                        )}
                      </div>
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: 8, width: "100%", justifyContent: "center" }}
                      onClick={() => submitReview("RESET")}
                      disabled={reviewSubmitting}
                    >
                      Change decision
                    </button>
                  </>
                )}
              </>
            )}
          </div>

          {/* Case meta */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 12 }}>Case Information</div>
            {[
              { l: "Case ID", v: inv.id, mono: true },
              { l: "Assigned To", v: inv.assignee },
              { l: "Status", v: inv.status },
              { l: "Priority", v: inv.priority },
              { l: "Entities", v: inv.entities },
              { l: "Evidence", v: inv.evidence },
              { l: "Last Updated", v: inv.updated },
            ].map(item => (
              <div key={item.l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 11, color: "var(--text-4)" }}>{item.l}</span>
                <span style={{ fontSize: 11, color: "var(--text-2)", fontFamily: item.mono ? "JetBrains Mono,monospace" : "inherit" }}>{item.v}</span>
              </div>
            ))}
          </div>

          <button className="btn btn-ghost" style={{ justifyContent: "center" }} onClick={() => navigate("timeline", inv.id)}>
            View Investigation Timeline
          </button>
          {/* Was navigate("graph") with no id, which always opened the
              GLOBAL graph even from inside a specific investigation.
              GraphScreen/App.tsx already support an investigation-scoped
              graph (GET /api/investigations/:displayId/graph) — this just
              passes the id through so this button actually opens THIS
              investigation's subgraph instead of the unrelated global one. */}
          <button className="btn btn-ghost" style={{ justifyContent: "center" }} onClick={() => navigate("graph", inv.id)}>
            View Network Graph
          </button>
        </div>
      </div>
    </div>
  );
}