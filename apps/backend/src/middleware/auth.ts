import type { Request, Response, NextFunction } from "express";
import { PrismaClient, Role } from "@prisma/client";
import {
  SESSION_COOKIE_NAME,
  SESSION_IDLE_TTL_MS,
  hashSessionToken,
} from "../lib/auth.js";

const prisma = new PrismaClient();

// Augment Express's Request type so req.user is typed everywhere it's used,
// instead of every route casting `(req as any).user`.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; name: string; email: string; role: Role };
    }
  }
}

/**
 * Reads the session cookie, validates it against the DB (not just "cookie
 * present" — the session must exist, be unexpired, and be within its idle
 * window), and attaches req.user. Responds 401 and stops the chain on any
 * failure, so routes behind this never need to re-check auth themselves.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "Not authenticated." });
  }

  const tokenHash = hashSessionToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  const now = Date.now();
  const expired = !session || session.expiresAt.getTime() < now;
  const idledOut = session && now - session.lastActiveAt.getTime() > SESSION_IDLE_TTL_MS;

  if (!session || expired || idledOut) {
    // Clean up a dead session row rather than leaving it to expire on its
    // own — keeps the table from accumulating stale rows under load.
    if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }

  // Sliding idle window: touch lastActiveAt so an active user's session
  // doesn't idle-time-out mid-use, without changing the absolute expiresAt
  // cap set at login.
  await prisma.session
    .update({ where: { id: session.id }, data: { lastActiveAt: new Date() } })
    .catch(() => {});

  req.user = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
  };
  next();
}

/**
 * Use after requireAuth on routes that should only work for specific
 * roles — e.g. requireRole("ADMINISTRATOR") on user-management routes.
 * A 403 (not 401) here since the person IS authenticated, just not
 * authorized for this specific action.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated." });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have permission to do that." });
    }
    next();
  };
}
