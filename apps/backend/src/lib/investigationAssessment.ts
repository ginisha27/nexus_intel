// apps/backend/src/lib/investigationAssessment.ts
//
// AI Assessment pipeline for a single investigation:
//
//   structured risk signals (deterministic, computed from real DB rows)
//     -> LLM turns the signals into a plain-English explanation + next
//        steps (never the other way around — the score is never derived
//        from the LLM's output)
//     -> caller stores the result as an AiAssessment row, always alongside
//        the signals that produced it, so the explanation stays traceable
//        back to real numbers
//
// This mirrors the "no faked numbers" philosophy in riskEngine.ts: the
// score and signals are pure functions of the investigation's related rows.
// Only the natural-language explanation/next-steps come from the LLM, and
// even that call degrades to a deterministic templated summary if the
// selected model is unavailable or misconfigured, rather than failing the
// whole request.

import { callLlmForJson, LlmError, SupportedModel, DEFAULT_MODEL } from "./llmClient.js";
import { prisma } from "./prisma.js";

export interface AssessmentSignal {
  label: string;
  value: number; // points this signal contributed to the final score
}

export interface AssessmentInput {
  displayId: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  entities: { alias: string; risk: number; confidence: number; riskChange: number }[];
  evidence: { status: string }[];
  timeline: { type: string }[];
  network: { displayId: string; risk: number; change: number; status: string } | null;
}

export interface AssessmentResult {
  riskScore: number;
  signals: AssessmentSignal[];
  explanation: string;
  recommendedNext: string[];
  aiGenerated: boolean; // false when the LLM failed/was unconfigured and a fallback template was used
  modelUsed: string;    // which model produced this result (or "fallback")
}

// Max contribution per feature — sums to 100, same convention as
// riskEngine.ts's WEIGHTS table.
const WEIGHTS = {
  relatedEntityRisk: 35,
  peakEntityConfidence: 15,
  networkRisk: 25,
  escalationActivity: 15,
  verifiedEvidence: 10,
} as const;

const ESCALATION_TYPES = new Set(["ESCALATION", "WARNING", "ALERT"]);

/**
 * Deterministic, explainable scorer — pure function of the investigation's
 * related entities/network/evidence/timeline. Same inputs always produce
 * the same score; no randomness, no LLM involvement.
 */
export function computeInvestigationSignals(inv: AssessmentInput): { score: number; signals: AssessmentSignal[] } {
  const signals: AssessmentSignal[] = [];

  if (inv.entities.length > 0) {
    const avgRisk = inv.entities.reduce((sum, e) => sum + e.risk, 0) / inv.entities.length;
    const riskValue = Math.round((avgRisk / 100) * WEIGHTS.relatedEntityRisk);
    if (riskValue > 0) {
      signals.push({
        label: `Average related-entity risk: ${avgRisk.toFixed(0)}/100 across ${inv.entities.length} entit${inv.entities.length === 1 ? "y" : "ies"}`,
        value: riskValue,
      });
    }

    const peakConfidence = Math.max(...inv.entities.map((e) => e.confidence));
    const confValue = Math.round((peakConfidence / 100) * WEIGHTS.peakEntityConfidence);
    if (confValue > 0) {
      signals.push({ label: `Highest entity resolution confidence: ${peakConfidence}%`, value: confValue });
    }
  }

  if (inv.network) {
    const netValue = Math.round((inv.network.risk / 100) * WEIGHTS.networkRisk);
    if (netValue > 0) {
      signals.push({
        label: `Linked network ${inv.network.displayId} risk: ${inv.network.risk}/100 (${inv.network.status})`,
        value: netValue,
      });
    }
  }

  const escalationCount = inv.timeline.filter((t) => ESCALATION_TYPES.has(t.type)).length;
  if (escalationCount > 0) {
    signals.push({
      label: `${escalationCount} escalation/warning/alert event(s) in the case timeline`,
      value: Math.min(WEIGHTS.escalationActivity, escalationCount * 5),
    });
  }

  if (inv.evidence.length > 0) {
    const verified = inv.evidence.filter((e) => e.status === "VERIFIED").length;
    const ratio = verified / inv.evidence.length;
    const evValue = Math.round(ratio * WEIGHTS.verifiedEvidence);
    if (evValue > 0) {
      signals.push({ label: `${verified}/${inv.evidence.length} evidence record(s) verified`, value: evValue });
    }
  }

  const rawScore = signals.reduce((sum, s) => sum + s.value, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  return { score, signals };
}

// Used only when the LLM is unconfigured/unreachable, so the endpoint still
// returns something useful instead of a 500. Clearly labeled as a fallback
// (see `aiGenerated: false`) rather than passed off as a real AI narrative.
function fallbackNarrative(
  inv: AssessmentInput,
  score: number,
  signals: AssessmentSignal[]
): { explanation: string; recommendedNext: string[] } {
  const top = [...signals].sort((a, b) => b.value - a.value)[0];
  const explanation =
    `Computed risk score ${score}/100 for ${inv.displayId} from ${signals.length} contributing signal(s)` +
    (top ? `, the largest being "${top.label}" (+${top.value}).` : ".") +
    ` AI narrative generation is currently unavailable — this is a deterministic fallback summary, not an AI-generated explanation.`;
  const recommendedNext = [
    "Review the underlying signals above against current case evidence",
    "Confirm related-entity risk and confidence scores are up to date before escalating",
    "Re-run the AI assessment once a model is reachable",
  ];
  return { explanation, recommendedNext };
}

// PromptTemplate.key used to look up the AI Assessment prompt in the DB.
// See prisma/seed.ts for the seeded default row.
const PROMPT_TEMPLATE_KEY = "ai_assessment";

// Used ONLY if the `ai_assessment` row is missing from PromptTemplate (e.g.
// a fresh DB that hasn't been seeded yet) — mirrors the fallback philosophy
// used elsewhere in this file: a DB miss should never fail the whole
// request, but it should be loud in the logs so it gets fixed.
const DEFAULT_SYSTEM_INSTRUCTION =
  "You are a criminal intelligence analysis assistant. Always respond with valid JSON only.";
const DEFAULT_TEMPLATE = `You are assisting a criminal-intelligence investigator reviewing case {{displayId}} ("{{title}}").

Case summary: {{description}}
Status: {{status}} · Priority: {{priority}}
Computed risk score: {{score}}/100 — this was derived deterministically from the signals below; do not recompute, restate as different, or contradict this number.

Contributing signals:
{{signalLines}}

Return a JSON object with exactly two fields:
1. "explanation": a concise (3-5 sentence) plain-English assessment of why this case scored {{score}}/100, grounded ONLY in the signals and case summary above. Do not invent entities, wallets, or facts not present above.
2. "recommendedNext": an array of 3-5 concrete, specific next investigative steps, grounded in the entities/network/evidence referenced above.

This is a decision-support tool only — conclusions require investigator review and do not constitute a criminal determination.`;

/**
 * Fetches the AI Assessment prompt (system instruction + template) from the
 * PromptTemplate table. This is what makes the prompt editable as data
 * instead of a string baked into application code. Falls back to the
 * built-in default above (with a console.warn) if the row doesn't exist,
 * so a missing/un-seeded row degrades gracefully rather than 500ing.
 */
async function getAssessmentPrompt(): Promise<{ systemInstruction: string; template: string }> {
  try {
    const row = await prisma.promptTemplate.findUnique({ where: { key: PROMPT_TEMPLATE_KEY } });
    if (row?.template) {
      return { systemInstruction: row.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION, template: row.template };
    }
    console.warn(`[ai-assessment] No PromptTemplate row found for key "${PROMPT_TEMPLATE_KEY}" — using built-in default prompt. Run the seed script to fix this.`);
  } catch (err) {
    console.error(`[ai-assessment] Failed to fetch prompt template from DB, using built-in default:`, (err as Error).message);
  }
  return { systemInstruction: DEFAULT_SYSTEM_INSTRUCTION, template: DEFAULT_TEMPLATE };
}

// Fills {{placeholder}} tokens in the DB-fetched (or fallback) template.
// Deliberately simple string substitution — no templating engine/eval, so
// a stored template can never execute arbitrary code.
function renderPrompt(template: string, inv: AssessmentInput, score: number, signals: AssessmentSignal[]): string {
  const signalLines =
    signals.map((s) => `- ${s.label} (contributed ${s.value} pts)`).join("\n") || "- No contributing signals found";

  const values: Record<string, string> = {
    displayId: inv.displayId,
    title: inv.title,
    description: inv.description,
    status: inv.status,
    priority: inv.priority,
    score: String(score),
    signalLines,
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? `{{${key}}}`);
}

/**
 * Full pipeline: compute deterministic signals, ask the selected LLM to turn
 * them into a narrative + next steps, and gracefully fall back to a templated
 * summary if the LLM is unavailable. Never throws — always resolves to an
 * AssessmentResult so the route can persist and return it unconditionally.
 */
export async function generateInvestigationAssessment(
  inv: AssessmentInput,
  model: SupportedModel = DEFAULT_MODEL
): Promise<AssessmentResult> {
  const { score, signals } = computeInvestigationSignals(inv);
  const { systemInstruction, template } = await getAssessmentPrompt();

  try {
    const parsed = await callLlmForJson<{ explanation: string; recommendedNext: string[] }>({
      model,
      prompt: renderPrompt(template, inv, score, signals),
      systemInstruction,
    });
    if (!parsed?.explanation || !Array.isArray(parsed.recommendedNext) || parsed.recommendedNext.length === 0) {
      throw new LlmError("LLM response was missing required fields");
    }
    return {
      riskScore: score,
      signals,
      explanation: parsed.explanation,
      recommendedNext: parsed.recommendedNext,
      aiGenerated: true,
      modelUsed: model,
    };
  } catch (err) {
    console.error(
      `[ai-assessment] LLM call failed for ${inv.displayId} (model: ${model}), using fallback narrative:`,
      (err as Error).message
    );
    const fallback = fallbackNarrative(inv, score, signals);
    return { riskScore: score, signals, ...fallback, aiGenerated: false, modelUsed: "fallback" };
  }
}