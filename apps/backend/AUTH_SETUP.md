# Auth setup — what changed and what you need to do

## 0. Rotate the leaked keys — do this first, independent of everything else

`.env.example` had real, working keys committed in it (Gemini, OpenAI, Groq,
and `INGEST_SECRET_KEY`). A committed key is compromised the moment it's
committed, whether the repo is public or not. Rotate all four at their
respective providers, then put the new values only in your real `.env`
(never `.env.example`).

## 1. Install new dependencies

```
npm install argon2 cookie-parser express-rate-limit
npm install -D @types/cookie-parser
```

## 2. ⚠ `prisma/seed.ts` will break — you'll need to patch it

`User.passwordHash` is now a **required** field. I don't have your
`prisma/seed.ts`, so I couldn't update it — if it creates `User` rows, add
a hash to each one, e.g.:

```ts
import { hashPassword } from "../src/lib/auth.js";
// ...
passwordHash: await hashPassword("some-temporary-seed-password"),
```

If you run `npm run db:seed` before fixing this, it will fail on the
first `User` create with a Prisma validation error.

## 3. Run the migration

```
npm run db:migrate
```

This adds `passwordHash`, `failedLoginAttempts`, `lockedUntil` to `User`,
and creates the `Session` table. If you already have `User` rows in a dev
database and don't want to touch `seed.ts` right now, the fastest path is
`npm run db:reset` (drops and recreates the dev DB) instead — **don't run
that against anything with real data**.

## 4. Create the first admin account

```
ADMIN_EMAIL="you@example.com" ADMIN_NAME="Your Name" npm run db:seed-admin
```

Prints a one-time generated password if you don't set `ADMIN_PASSWORD`
yourself. Save it — it's not stored anywhere and can't be recovered, only
reset by creating a new admin the same way or adding a password-reset
route (not built yet — see below).

## 5. Start both servers as usual

Backend and frontend both need to be running; log in with the admin
account from step 4 at the login screen (the "Investigator ID" field is
the email).

## What's now enforced

- Login: `POST /api/auth/login`, Argon2id password verification, 5 failed
  attempts locks the account for 15 minutes, login endpoint itself is
  rate-limited (20 attempts / 15 min / IP) on top of that.
- Sessions: DB-backed, `httpOnly`/`Secure` (prod)/`SameSite=Lax` cookie,
  12-hour idle timeout, 7-day absolute cap. Revocable instantly (logout,
  or an admin using `POST /api/users/:id/revoke-sessions`).
- Every `/api/*` route except `/api/health`, `/api/auth/login`, and
  `/api/ingest/*` (separate shared-secret auth, unchanged) now requires a
  valid session.
- `/api/audit-log`, `/api/sources`, `/api/users` additionally require the
  `ADMINISTRATOR` role — matches the permission matrix already drawn in
  `AdminScreen.tsx`.
- Frontend: `Layout.tsx` hides the Admin nav item and Audit Logs nav item
  for non-admins; `App.tsx` also blocks direct navigation to `admin`/
  `audit` for non-admins (UI-level guard — the real enforcement is the
  backend `requireRole` above, this just avoids a confusing 403 render).

## What I did NOT build — worth doing next, in rough priority order

1. **Method-level permissions inside `investigations.ts` / `evidence.ts`
   etc.** The permission matrix implies Analysts can view but not create/
   edit cases ("Manage Cases" = Admin + Investigator only). I gated whole
   routers (audit-log, sources, users) since those files were self-
   contained, but I don't have `investigations.ts` etc. to add
   `requireRole` to specific POST/PATCH/DELETE handlers inside them
   without guessing at their structure. Send those files if you want this
   tightened further.
2. **Password reset / forgot-password flow.** Right now, a locked-out
   password can only be fixed by another admin. Needs an email-sending
   dependency (none currently in `package.json`) to do properly.
3. **CSRF protection.** Cookie-based sessions are the right call here, but
   they do mean a CSRF token (or `SameSite=Strict` on state-changing
   routes specifically) is worth adding before this handles anything more
   sensitive than it already does. Skipped for now to keep this PR-sized,
   not because it's optional forever.
4. **Audit logging the auth events themselves** (login success/failure,
   role changes) into your existing `AuditLogEntry` model — you have the
   table already, just nothing writes login/logout/role-change events to
   it yet.
