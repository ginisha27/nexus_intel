import "dotenv/config";

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import { Server } from "socket.io";

import { setIo } from "./sockets/io.js";
import { requireAuth, requireRole } from "./middleware/auth.js";

import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";

import { entitiesRouter } from "./routes/entities.js";
import { alertsRouter } from "./routes/alerts.js";
import { networksRouter } from "./routes/networks.js";
import { investigationsRouter } from "./routes/investigations.js";
import { graphRouter } from "./routes/graph.js";
import { reportsRouter } from "./routes/reports.js";
import { simulateRouter } from "./routes/simulate.js";
import { ingestRouter } from "./routes/ingest.js";
import { vendorsRouter } from "./routes/vendors.js";
import { attributionRouter } from "./routes/attribution.js";
import { infrastructureRouter } from "./routes/infrastructure.js";
import { scrapeRouter } from "./routes/scrape.js";

import { dashboardRouter, analyticsRouter } from "./routes/dashboard.js";
import { searchRouter } from "./routes/search.js";

import {
  evidenceRouter,
  walletsRouter,
  listingsRouter,
  auditRouter,
  sourcesRouter,
} from "./routes/misc.js";

const PORT = process.env.PORT ?? 4000;

const FRONTEND_URL =
  process.env.FRONTEND_URL ?? "http://localhost:5173";

const app = express();

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_req, res) =>
  res.json({
    status: "ok",
    service: "nexus-intel-backend",
  })
);

// ── Auth (public — these routes enforce their own requirements
// internally: /login is open, /logout and /me require an existing
// session via requireAuth applied inside auth.ts) ──────────────────────
app.use("/api/auth", authRouter);

// ── Ingest keeps its existing shared-secret (x-ingest-key) auth — it's
// called by a producer script, not a logged-in investigator, so it's
// intentionally NOT behind requireAuth/session cookies. ─────────────────
app.use("/api/ingest", ingestRouter);

app.use("/api/evidence", requireAuth, evidenceRouter);
app.use("/api/wallets", requireAuth, walletsRouter);
app.use("/api/listings", requireAuth, listingsRouter);
app.use("/api/vendors", requireAuth, vendorsRouter);
app.use("/api/attribution", requireAuth, attributionRouter);
app.use("/api/infrastructure", requireAuth, infrastructureRouter);
app.use("/api/audit-log", requireAuth, requireRole("ADMINISTRATOR"), auditRouter);
app.use("/api/sources", requireAuth, requireRole("ADMINISTRATOR"), sourcesRouter);

app.use("/api/users", requireAuth, requireRole("ADMINISTRATOR"), usersRouter);

app.use("/api/entities", requireAuth, entitiesRouter);
app.use("/api/alerts", requireAuth, alertsRouter);
app.use("/api/networks", requireAuth, networksRouter);
app.use("/api/investigations", requireAuth, investigationsRouter);
app.use("/api/graph", requireAuth, graphRouter);
app.use("/api/reports", requireAuth, reportsRouter);
app.use("/api/simulate", requireAuth, simulateRouter);
app.use("/api/scrape", requireAuth, scrapeRouter);

app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/api/analytics", requireAuth, analyticsRouter);
app.use("/api/search", requireAuth, searchRouter);

// Global error handler — without this, an unhandled exception in any route
// (e.g. a DB outage, a bad Prisma query) crashes out to Express's bare
// default handler, which sends an HTML stack trace instead of the JSON
// error shape every frontend fetch() call already expects and handles.
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("[error]", err);

    if (res.headersSent) return;

    res.status(500).json({
      error: "Internal server error. Please try again.",
    });
  }
);

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_URL,
    credentials: true,
  },
});

setIo(io);

io.on("connection", (socket) => {
  console.log(`[socket] client connected: ${socket.id}`);

  socket.on("disconnect", () =>
    console.log(`[socket] client disconnected: ${socket.id}`)
  );
});

httpServer.listen(PORT, () => {
  console.log(
    `NEXUS INTEL backend running on http://localhost:${PORT}`
  );

  console.log(
    `Socket.IO ready — Live Intelligence Feed will broadcast on "intelligence-event"`
  );
});