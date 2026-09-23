// apps/backend/src/routes/reports.ts
//
// Structured, not pre-rendered: this returns JSON (GeneratedReport), never
// HTML/PDF markup, so ReportsScreen.tsx stays in control of layout/styling
// and this route stays reusable (e.g. for a future "email this report"
// job) without dragging a rendering concern into the backend.

import { Router } from "express";

import { generateReport, REPORT_SECTION_KEYS, type ReportSectionKey } from "../lib/reportGenerator.js";
import { logAudit, ipFromRequest } from "../lib/audit.js";

export const reportsRouter = Router();

// POST /api/reports/generate
// Body: { investigationId: string; reportType: string; classification: string; sections: Record<string, boolean> }
//
// `investigationId` is the investigation's displayId (e.g. "INV-2026-123")
// — same identifier ReportsScreen.tsx already uses for
// GET /api/investigations/:displayId, so no new lookup convention is
// introduced on the frontend.
reportsRouter.post("/generate", async (req, res) => {
  const { investigationId, reportType, classification, sections } = req.body ?? {};

  if (!investigationId || typeof investigationId !== "string") {
    return res.status(400).json({ error: "investigationId is required" });
  }
  if (!classification || typeof classification !== "string") {
    return res.status(400).json({ error: "classification is required" });
  }

  // Whitelist incoming section keys against the real set this generator
  // knows how to build — never trust the client to pass through anything
  // else into report content.
  const safeSections: Partial<Record<ReportSectionKey, boolean>> = {};
  if (sections && typeof sections === "object") {
    for (const key of REPORT_SECTION_KEYS) {
      if (key in sections) safeSections[key] = !!sections[key];
    }
  }

  try {
    const report = await generateReport({
      investigationDisplayId: investigationId,
      reportType: typeof reportType === "string" ? reportType : "Intelligence Assessment",
      classification,
      sections: safeSections,
    });

    if (!report) {
      return res.status(404).json({ error: `Investigation ${investigationId} not found` });
    }

    await logAudit({
      user: "System",
      action: "Generated Report",
      resource: `${report.investigation.displayId} — ${report.reportType} (${report.classification})`,
      type: "read",
      ip: ipFromRequest(req),
    });

    res.json(report);
  } catch (err) {
    console.error("Failed to generate report", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});
