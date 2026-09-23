import argon2 from "argon2";
import crypto from "node:crypto";

// ─── Passwords ───────────────────────────────────────────────────────────
// Argon2id: OWASP's current recommendation (ahead of bcrypt/scrypt) —
// resistant to both GPU cracking and side-channel timing attacks. The
// tuning below (19 MiB memory, 2 iterations) is argon2's own recommended
// minimum for interactive login (RFC 9106 §4) — enough to be expensive
// for an attacker running millions of guesses, cheap enough that a login
// request doesn't feel slow to a real user.
const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTS);
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain).catch(() => false);
}

// ─── Session tokens ──────────────────────────────────────────────────────
// The raw token is what goes in the cookie and never touches the DB. What
// gets stored (Session.tokenHash) is a SHA-256 hash of it — a fast hash is
// fine here (unlike passwords) because the token itself already has 256
// bits of entropy; there's nothing to brute-force, this hash only exists
// so a database leak doesn't hand out directly-usable session tokens.
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ─── Session lifetime ────────────────────────────────────────────────────
// Two limits, not one: ABSOLUTE_TTL_MS is a hard cap from login regardless
// of activity (forces re-auth eventually even if the tab is left open
// forever); IDLE_TTL_MS is the shorter "logged out if untouched" window,
// checked against lastActiveAt on every authenticated request.
export const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const SESSION_IDLE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export const SESSION_COOKIE_NAME = "nexus_sid";

// SameSite=Lax is enough here even though the frontend (localhost:5173)
// and API (localhost:4000) are different origins in dev — "site" for
// SameSite purposes is scheme + registrable domain, ignoring port, and
// both are "localhost". Same logic covers production as long as the
// frontend and API share a registrable domain (e.g. app.example.com +
// api.example.com) — SameSite=None would only be needed if they were on
// genuinely unrelated domains, which also drags in extra CSRF exposure
// that's better avoided than mitigated. secure:true (HTTPS-only) is
// still required in production regardless — browsers won't send a
// Secure-flagged cookie back over plain HTTP.
export function sessionCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    maxAge: SESSION_ABSOLUTE_TTL_MS,
    path: "/",
  };
}

// ─── Login lockout ───────────────────────────────────────────────────────
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
