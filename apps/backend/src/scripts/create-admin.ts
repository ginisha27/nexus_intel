/**
 * One-off script to create (or reset) an Administrator account directly
 * against the database — for exactly the situation where the DB was reset
 * (e.g. by `prisma migrate dev` accepting a reset prompt) and there's no
 * user left to log in with and provision further users through the UI.
 *
 * Reuses the app's own hashPassword() so the resulting hash is guaranteed
 * compatible with verifyPassword() on login — no guessing at the hashing
 * scheme.
 *
 * Place this file at: apps/backend/src/scripts/create-admin.ts
 * (the relative import below assumes that location)
 *
 * Run from repo root:
 *   pnpm --filter ./apps/backend exec tsx src/scripts/create-admin.ts <email> <password> ["Full Name"]
 *
 * Example:
 *   pnpm --filter ./apps/backend exec tsx src/scripts/create-admin.ts admin@nexus.local "ChangeMe123!" "Admin"
 *
 * Safe to run more than once with the same email — it upserts, so re-running
 * with a new password acts as a reset for that account, and also clears any
 * lockout state.
 */
import { PrismaClient, Role } from "@prisma/client";
import { hashPassword } from "../lib/auth.js";

const prisma = new PrismaClient();

async function main() {
  const [, , email, password, name] = process.argv;

  if (!email || !password) {
    console.error(
      'Usage: tsx src/scripts/create-admin.ts <email> <password> ["Full Name"]'
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const normalizedEmail = email.toLowerCase();

  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: {
      passwordHash,
      role: Role.ADMINISTRATOR,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
    create: {
      name: name ?? "Administrator",
      email: normalizedEmail,
      role: Role.ADMINISTRATOR,
      passwordHash,
    },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  console.log("✅ Administrator account ready:");
  console.log(user);
  console.log(`\nLog in with:\n  email:    ${user.email}\n  password: ${password}`);
}

main()
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
