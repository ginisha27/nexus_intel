import { prisma } from "./prisma.js";

// CaseTimelineEvent.type is a free-form string column in the DB (see
// schema.prisma), but every writer in this codebase should only ever use
// one of these — TimelineScreen.tsx's TYPE_COLORS map (and its "unknown
// type" fallback) is keyed on exactly this set.
export type TimelineEventType =
  | "DETECTION"
  | "ALERT"
  | "DISCOVERY"
  | "ESCALATION"
  | "WARNING"
  | "ACTION"
  | "EVIDENCE";

export interface AddTimelineEventInput {
  investigationId: string; // Investigation.id (the internal cuid, not displayId)
  type: TimelineEventType;
  label: string;
  source: string;
  agent: string;
  description: string;
  /**
   * Defaults to "now". Only override this for events that are being
   * recorded slightly after the fact and need to reflect when the
   * underlying action actually happened (none of the current call sites
   * need this, but it keeps the helper honest rather than hardcoding
   * `new Date()` at every call site).
   */
  occurredAt?: Date;
}

// A single, reusable place to create CaseTimelineEvent rows so callers
// (investigation creation, entity/evidence linking, AI assessments, notes,
// status changes, report generation, ...) don't each hand-roll their own
// prisma.caseTimelineEvent.create({...}) block.
//
// Deliberately swallows/never throws on its own — a failed timeline write
// should never take down the primary action it's describing (e.g. an
// investigation should still get created even if, hypothetically, the
// timeline insert failed for some unrelated reason). Errors are logged so
// they're not silently invisible either.
export async function addTimelineEvent(
  input: AddTimelineEventInput
) {
  try {
    return await prisma.caseTimelineEvent.create({
      data: {
        investigationId: input.investigationId,
        type: input.type,
        label: input.label,
        source: input.source,
        agent: input.agent,
        description: input.description,
        occurredAt: input.occurredAt ?? new Date(),
      },
    });
  } catch (err) {
    console.error(
      `[timeline] failed to record "${input.label}" for investigation ${input.investigationId}:`,
      err
    );
    return null;
  }
}