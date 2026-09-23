// One-time bootstrap: creates the first Administrator account. There's no
// self-registration by design (an investigative platform shouldn't have
// open signup) — every subsequent user is created via an existing admin
// through POST /api/users (see src/routes/users.ts).
//
// Usage:
//   ADMIN_NAME="Investigator A" ADMIN_EMAIL="admin@nexus.local" tsx prisma/seedAdminUser.ts
//
// If ADMIN_PASSWORD isn't set, a random one is generated and printed once —
// it is never stored in plaintext or logged anywhere else, so save it now.

import { PrismaClient, Role } from "@prisma/client";
import crypto from "node:crypto";
import { hashPassword } from "../src/lib/auth.js";

const prisma = new PrismaClient();

async function main() {
  const name = process.env.ADMIN_NAME ?? "Administrator";
  const email = (process.env.ADMIN_EMAIL ?? "admin@nexus.local").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? crypto.randomBytes(9).toString("base64url");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`A user with email ${email} already exists — nothing to do.`);
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { name, email, role: Role.ADMINISTRATOR, passwordHash },
  });

  console.log(`Created admin user: ${user.email}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`Generated password (save this now, it will not be shown again): ${password}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
