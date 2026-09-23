// apps/backend/src/lib/audit.ts
//
// Single helper every route calls to write a REAL AuditLogEntry row.
// Previously the AuditLogEntry table only ever contained hand-seeded rows —
// nothing in the app wrote to it live, so "Audit Logs" was a static prop,
// not a trail of what actually happened. This closes that gap: every
// write-ish action (evidence added, AI assessment generated/reviewed,
// simulation run, alert status changed, report generated, notes
// added/edited/deleted) now calls logAudit() at the point it happens.
//
// No auth system exists yet (see routes comments elsewhere), so `user` is
// whatever the caller identifies as the actor (falls back to "System" for
// automated/pipeline actions) and `ip` is best-effort from the request.
// This is intentionally simple — a real system would pull user/ip from a
// session/auth middleware — but every field is populated from a real
// action, not invented.

import type { Request } from "express";
import { prisma } from "./prisma.js";

export type AuditType = "read" | "write" | "export" | "admin" | "search" | "system";

export interface AuditInput {
  user: string;
  action: string;
  resource: string;
  type: AuditType;
  status?: string;
  ip?: string;
}

export function ipFromRequest(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) return forwarded.split(",")[0].trim();
  return req.ip ?? req.socket.remoteAddress ?? "Internal";
}

/**
 * Fire-and-forget audit write. Never throws into the caller — an audit
 * logging failure should never break the primary action it's describing,
 * but it is logged loudly to the console so a broken audit pipeline is
 * still noticed during development.
 */
export async function logAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLogEntry.create({
      data: {
        user: input.user,
        action: input.action,
        resource: input.resource,
        ip: input.ip ?? "Internal",
        status: input.status ?? "Success",
        type: input.type,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log entry:", (err as Error).message);
  }
}
