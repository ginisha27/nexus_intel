import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
  SESSION_ABSOLUTE_TTL_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,
} from "../lib/auth.js";
import { requireAuth } from "../middleware/auth.js";

const prisma = new PrismaClient();
export const authRouter = Router();

const isProduction = process.env.NODE_ENV === "production";

// Scoped to this router only — protects the login endpoint specifically
// without rate-limiting the rest of the API. Keyed by IP by default; a
// determined attacker rotating IPs is also slowed by the per-account
// lockout below, which is keyed by email instead.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid email or password format." });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  // Deliberately identical error message + a dummy hash verify on the
  // "user doesn't exist" path, so response timing and wording don't leak
  // which emails are registered.
  const DUMMY_HASH =
    "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$YmFkYmFkYmFkYmFkYmFkYmFkYmFkYmFk";

  if (!user) {
    await verifyPassword(DUMMY_HASH, password);
    return res.status(401).json({ error: "Invalid email or password." });
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return res.status(423).json({
      error: `Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`,
    });
  }

    if (!user.passwordHash) {
    await verifyPassword(DUMMY_HASH, password);
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const valid = await verifyPassword(user.passwordHash, password);

  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    const lockingOut = attempts >= MAX_FAILED_LOGIN_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: lockingOut ? 0 : attempts,
        lockedUntil: lockingOut ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
      },
    });
    return res.status(401).json({ error: "Invalid email or password." });
  }

  // Success — reset lockout state, issue a new session.
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });

  const token = generateSessionToken();
  await prisma.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_TTL_MS),
      ip: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    },
  });

  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(isProduction));
  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  }
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  res.status(204).end();
});

// Used on app load to check "is there already a valid session" (real
// replacement for App.tsx's `useState(false)` loggedIn flag).
authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  // Same floor as an admin-issued temp password would realistically need
  // to clear — not tied to tempPassword's actual generated length, just a
  // sane minimum so this can't be set to "a" or "".
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

// Self-service password change for the CURRENT logged-in user — the
// counterpart to POST /api/users/:id/reset-password (admin-initiated, see
// routes/users.ts). Requires the current password (not just an active
// session) so a walked-away/left-open session can't be used to lock the
// real owner out. On success, every existing session for this user is
// revoked and replaced with a fresh one for the device making this
// request — so a stolen session elsewhere is invalidated by the same
// action that fixes the password, without logging the user out of their
// own request that just succeeded.
authRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
  }
  const { currentPassword, newPassword } = parsed.data;

  // req.user (from requireAuth) intentionally doesn't carry passwordHash —
  // fetch it fresh rather than widening what the middleware exposes app-wide.
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(401).json({ error: "Not authenticated." });

    if (!user.passwordHash) {
    return res.status(401).json({ error: "No password is configured for this account." });
  }

  const valid = await verifyPassword(user.passwordHash, currentPassword);
  if (!valid) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
  });

  // Revoke every session (including this one) then issue a brand-new one,
  // rather than leaving the current session row as-is — a password change
  // is exactly the moment to guarantee no other lingering session survives.
  await prisma.session.deleteMany({ where: { userId: user.id } });

  const token = generateSessionToken();
  await prisma.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_TTL_MS),
      ip: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    },
  });

  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(isProduction));
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});
