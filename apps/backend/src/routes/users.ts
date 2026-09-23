import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { hashPassword } from "../lib/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const prisma = new PrismaClient();
export const usersRouter = Router();

// Every route here requires a logged-in Administrator — no self-registration
// on an investigative platform; accounts are provisioned by an admin.
usersRouter.use(requireAuth, requireRole("ADMINISTRATOR"));

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true, lockedUntil: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(users);
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.nativeEnum(Role),
});

// Creates the account with a random temporary password, returned ONCE in
// the response body for the admin to relay out-of-band — it's never
// stored or logged in plaintext, and can't be retrieved again after this.
// A proper "email an invite/reset link" flow is the better long-term
// answer (see AUTH_SETUP.md follow-ups); this unblocks account creation
// without adding an email-sending dependency right now.
usersRouter.post("/", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Name, a valid email, and role are required." });
  }
  const { name, email, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    return res.status(409).json({ error: "A user with that email already exists." });
  }

  const tempPassword = crypto.randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);

  const user = await prisma.user.create({
    data: { name, email: email.toLowerCase(), role, passwordHash },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  res.status(201).json({ user, tempPassword });
});

const updateRoleSchema = z.object({ role: z.nativeEnum(Role) });

usersRouter.patch("/:id/role", async (req, res) => {
  const parsed = updateRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "A valid role is required." });
  }
  const user = await prisma.user
    .update({
      where: { id: req.params.id },
      data: { role: parsed.data.role },
      select: { id: true, name: true, email: true, role: true },
    })
    .catch(() => null);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json(user);
});

// Revokes every active session for a user — for a compromised or
// off-boarded account, instead of waiting out the natural expiry.
usersRouter.post("/:id/revoke-sessions", async (req, res) => {
  await prisma.session.deleteMany({ where: { userId: req.params.id } });
  res.status(204).end();
});

// Admin-initiated password reset — the counterpart to a user's own
// POST /api/auth/change-password (see routes/auth.ts), for the case that
// route can't cover: the user has forgotten their password (so can't
// supply "current password") or is locked out and needs an admin to
// unblock them. Same shape/convention as user creation: a fresh random
// temp password is generated, hashed, and returned ONCE in this response
// — never stored or logged in plaintext, and not retrievable again after
// this. Also clears any active lockout and revokes every existing session
// for the account, since the whole point is "the old credential/session
// is no longer trusted."
usersRouter.post("/:id/reset-password", async (req, res) => {
  const tempPassword = crypto.randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);

  const user = await prisma.user
    .update({
      where: { id: req.params.id },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      select: { id: true, email: true },
    })
    .catch(() => null);
  if (!user) return res.status(404).json({ error: "User not found." });

  await prisma.session.deleteMany({ where: { userId: user.id } });

  res.json({ user, tempPassword });
});
