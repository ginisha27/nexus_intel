import { Router } from "express";
import crypto from "node:crypto";

import { prisma } from "../lib/prisma.js";

import {
  scoreListings,
  signalsToDisplayStrings,
  type ListingInput,
} from "../lib/riskEngine.js";

import {
  scoreAllWallets,
  walletSignalsToContributors,
  type WalletTransactionInput,
} from "../lib/walletRisk.js";

import {
  logAudit,
  ipFromRequest,
} from "../lib/audit.js";

import { asyncHandler } from "../lib/asyncHandler.js";
import { extractTextFromImage } from "../lib/ocr.js";
import { extractImageMetadata } from "../lib/imageMetadata.js";
import { analyzeOcrText } from "../lib/ocrSentiment.js";
import { DEFAULT_MODEL, type SupportedModel } from "../lib/llmClient.js";

export const evidenceRouter = Router();

export const walletsRouter = Router();

export const listingsRouter = Router();

export const auditRouter = Router();

export const sourcesRouter = Router();

evidenceRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.evidenceRecord.findMany({
        include: {
          source: true,
          investigation: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      })
    );
  })
);

// POST /api/evidence — actually computes a SHA-256 hash of the submitted
// content, so the "chain of custody" claim is real, not decorative.
evidenceRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const {
      type,
      content,
      // Optional: a base64-encoded image (screenshot, photo). When
      // present, the hash is computed over the actual decoded image
      // bytes (chain-of-custody stays about what was really submitted),
      // and OCR runs against those same bytes to populate ocrText.
      imageBase64,
      // Optional free-text context/metadata (was already a column on
      // EvidenceRecord, previously never read from the request body).
      notes,
      uploadedBy,
      investigationId,
      sourceId,
    } = req.body;

    const hasContent = content && String(content).trim();
    const hasImage = imageBase64 && String(imageBase64).trim();

    if (!hasContent && !hasImage) {
      return res.status(400).json({
        error: "content or imageBase64 is required — one of them is what gets hashed",
      });
    }

    if (!investigationId) {
      return res.status(400).json({
        error: "investigationId is required",
      });
    }

    const allowedEvidenceTypes = new Set([
      "Intelligence Record",
      "Wallet Transaction Log",
      "Communication Record",
      "Network Analysis Report",
      "Listing Capture",
    ]);

    if (!allowedEvidenceTypes.has(String(type).trim())) {
      return res.status(400).json({
        error: "Unsupported evidence type",
        allowedTypes: Array.from(allowedEvidenceTypes),
      });
    }

    const investigation = await prisma.investigation.findUnique({ where: { id: investigationId } });
    if (!investigation) {
      return res.status(404).json({ error: "Investigation not found" });
    }

    let imageBuffer: Buffer | null = null;
    if (hasImage) {
      try {
        // Accept either a raw base64 string or a data: URL
        // ("data:image/png;base64,...") — strip the prefix if present.
        const raw = String(imageBase64).replace(/^data:image\/\w+;base64,/, "");
        imageBuffer = Buffer.from(raw, "base64");
      } catch {
        return res.status(400).json({ error: "imageBase64 could not be decoded" });
      }
    }

    const hash = crypto
      .createHash("sha256")
      .update(imageBuffer ?? content ?? "")
      .digest("hex")
      .toUpperCase();

    // Best-effort — never blocks evidence creation if OCR fails.
    const ocrResult = imageBuffer ? await extractTextFromImage(imageBuffer) : null;

    // Best-effort — EXIF/GPS/dimension metadata read off the same decoded
    // bytes the hash and OCR ran against. Never null-and-throw: a corrupt
    // or metadata-stripped image just yields a mostly-empty result.
    const imageMetadata = imageBuffer ? await extractImageMetadata(imageBuffer) : null;

    // Best-effort — suspicion score + sentiment computed from whatever OCR
    // actually found. Skipped entirely (not run against empty text) when
    // there's nothing to analyze.
    const ocrSentiment = ocrResult?.text ? await analyzeOcrText(ocrResult.text) : null;

const existingEvidence = await prisma.evidenceRecord.findMany({
  select: {
    displayId: true,
  },
});

const maxEvidenceNumber = existingEvidence.reduce((max, evidence) => {
  const match = /^EV-(\d+)$/.exec(evidence.displayId);

  if (!match) return max;

  return Math.max(max, Number(match[1]));
}, 999);

const nextEvidenceNumber = maxEvidenceNumber + 1;

    let evidence;

    try {
      evidence = await prisma.evidenceRecord.create({
        data: {
          displayId: `EV-${nextEvidenceNumber}`,
          type,
          hash,
          uploadedBy,
          status: "PENDING",
          investigationId,
          sourceId,
          notes: notes ? String(notes).trim() : undefined,
          ocrText: ocrResult?.text,
          imageMetadata: imageMetadata ? JSON.parse(JSON.stringify(imageMetadata)) : undefined,
          ocrSentiment: ocrSentiment ? JSON.parse(JSON.stringify(ocrSentiment)) : undefined,
        },
      });
    } catch (err) {
      return res.status(400).json({
        error: `Could not create evidence record: ${
          (err as Error).message
        }`,
      });
    }

    await logAudit({
      user: uploadedBy || "System",
      action: "Added Evidence",
      resource: evidence.displayId,
      type: "write",
      ip: ipFromRequest(req),
    });

    res.status(201).json(evidence);
  })
);

// POST /api/evidence/:displayId/reanalyze-ocr — recomputes ocrSentiment
// (suspicion score + AFINN sentiment + LLM explanation) from the
// EvidenceRecord's already-stored ocrText.
//
// This exists because evidence uploaded before ocrSentiment was added
// only has ocrText, not the analysis derived from it — and because the
// raw image bytes are never persisted (only their SHA-256 hash), this is
// the only retroactive path for those older/no-analysis records. It also
// lets an investigator re-run with a different model (`model` in the
// body) without re-uploading the image.
evidenceRouter.post(
  "/:displayId/reanalyze-ocr",
  asyncHandler(async (req, res) => {
    const existing = await prisma.evidenceRecord.findUnique({
      where: { displayId: req.params.displayId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Evidence record not found" });
    }
    if (!existing.ocrText) {
      return res.status(400).json({
        error: "This evidence record has no OCR text to analyze (it was created without an attached image, or OCR found no text).",
      });
    }

    const { model } = req.body as { model?: SupportedModel };
    const ocrSentiment = await analyzeOcrText(existing.ocrText, model ?? DEFAULT_MODEL);

    const evidence = await prisma.evidenceRecord.update({
      where: { id: existing.id },
      data: { ocrSentiment: JSON.parse(JSON.stringify(ocrSentiment)) },
    });

    await logAudit({
      user: existing.uploadedBy || "System",
      action: `OCR text re-analyzed (suspicion: ${ocrSentiment.suspicionLevel})`,
      resource: evidence.displayId,
      type: "write",
      ip: ipFromRequest(req),
    });

    res.json(evidence);
  })
);

// PATCH /api/evidence/:displayId/status — investigator verification action.
//
// This is what makes EvidenceStatus (VERIFIED/PENDING/REJECTED) something an
// investigator can actually change, rather than a value only ever set once
// at creation/seed time.
evidenceRouter.patch(
  "/:displayId/status",
  asyncHandler(async (req, res) => {
    const {
      status,
      reviewedBy,
    } = req.body as {
      status?: string;
      reviewedBy?: string;
    };

    const VALID = [
      "VERIFIED",
      "PENDING",
      "REJECTED",
    ];

    if (!status || !VALID.includes(status)) {
      return res.status(400).json({
        error: `status must be one of ${VALID.join(", ")}`,
      });
    }

    const existing =
      await prisma.evidenceRecord.findUnique({
        where: {
          displayId: req.params.displayId,
        },
      });

    if (!existing) {
      return res.status(404).json({
        error: "Evidence record not found",
      });
    }

    const evidence =
      await prisma.evidenceRecord.update({
        where: {
          id: existing.id,
        },
        data: {
          status: status as any,
        },
      });

    await logAudit({
      user: reviewedBy || "System",
      action: `Evidence marked ${status}`,
      resource: evidence.displayId,
      type: "write",
      ip: ipFromRequest(req),
    });

    res.json(evidence);
  })
);

// GET /api/wallets — Blockchain Intelligence screen table.
//
// `risk` here used to be read straight off the stored Wallet.risk column,
// which is fake — see lib/walletRisk.ts header for exactly how (hand-typed
// for WALLET-W1..W5, seed-only jitter for WALLET-G1..G28). This now
// computes risk deterministically from real WalletTransaction rows via
// lib/walletRisk.ts, the blockchain-intelligence analogue of the listing
// risk engine. The response also distinguishes:
//   - `computed`   — the honest, transaction-derived risk + explanation
//   - `legacy`     — the untouched seed-time stored value, clearly labeled
//   - `dataQuality`— whether this wallet has ANY real transaction evidence
// so the frontend (and anyone reading the raw API) can never mistake
// seeded/synthetic demo numbers for a calculated result.
walletsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [wallets, transactions] = await Promise.all([
      prisma.wallet.findMany(),
      prisma.walletTransaction.findMany(),
    ]);

    const walletRiskById = scoreAllWallets(
      wallets.map((w) => w.id),
      transactions
    );

    const out = wallets
      .map((w) => {
        const computed = walletRiskById.get(w.id)!;
        return {
          ...w,

          // Authoritative for anything presented as a live/calculated
          // metric. Falls back to the legacy stored risk ONLY when there
          // is literally no transaction evidence to compute from — and
          // even then it's clearly flagged via dataQuality/computed.calculable,
          // never silently presented as equivalent to a real calculation.
          risk: computed.calculable ? computed.score : w.risk,

          computed: {
            score: computed.score,
            calculable: computed.calculable,
            signals: computed.signals,
            evidence: computed.evidence,
            explanation: computed.explanation,
            contributors: walletSignalsToContributors(computed.signals),
          },

          dataQuality: computed.calculable
            ? ("real_transaction_data" as const)
            : ("no_transaction_data" as const),

          legacy: {
            risk: w.risk,
            txnCount: w.txnCount,
            entityCount: w.entityCount,
            totalVolume: w.totalVolume,
            note: "Seed-time stored values — not derived from WalletTransaction evidence. Prefer `computed` for anything presented to a user as a live/calculated metric.",
          },
        };
      })
      .sort((a, b) => b.risk - a.risk);

    res.json(out);
  })
);

// GET /api/wallets/:displayId — single wallet, full risk breakdown. Used
// by the Blockchain Intelligence screen's wallet detail panel to show the
// same explainable signals (transaction activity, transaction volume,
// linked entities, linked networks, final calculated score) that drove
// `computed.score` above — nothing here is recomputed differently, it's
// the same lib/walletRisk.ts output for just this one wallet.
walletsRouter.get(
  "/:displayId",
  asyncHandler(async (req, res) => {
    const wallet = await prisma.wallet.findUnique({
      where: { displayId: req.params.displayId },
    });
    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const transactions: WalletTransactionInput[] = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      include: { entity: true, network: true },
      orderBy: { occurredAt: "desc" },
    });

    const walletRiskById = scoreAllWallets([wallet.id], transactions);
    const computed = walletRiskById.get(wallet.id)!;

    res.json({
      ...wallet,
      risk: computed.calculable ? computed.score : wallet.risk,
      computed: {
        score: computed.score,
        calculable: computed.calculable,
        signals: computed.signals,
        evidence: computed.evidence,
        explanation: computed.explanation,
        contributors: walletSignalsToContributors(computed.signals),
      },
      dataQuality: computed.calculable ? ("real_transaction_data" as const) : ("no_transaction_data" as const),
      transactions: transactions.map((t: any) => ({
        id: t.id,
        direction: t.direction,
        amountBtcEq: t.amountBtcEq,
        occurredAt: t.occurredAt,
        entityAlias: t.entity?.alias ?? null,
        networkDisplayId: t.network?.displayId ?? null,
      })),
      legacy: {
        risk: wallet.risk,
        txnCount: wallet.txnCount,
        entityCount: wallet.entityCount,
        totalVolume: wallet.totalVolume,
        note: "Seed-time stored values — not derived from WalletTransaction evidence. Prefer `computed` for anything presented to a user as a live/calculated metric.",
      },
    });
  })
);

// GET /api/listings — risk/signals are NOT read from the stored columns.
//
// They're recomputed here, at request time, from riskEngine.ts against the
// current listing population, so the API can never drift from the scorer
// (the stored `risk`/`signals` columns are effectively a cache last written
// by prisma/seed.ts; this route treats riskEngine.ts as the source of truth
// instead of duplicating any scoring logic locally).
listingsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const listings =
      await prisma.listing.findMany({
        include: {
          source: true,
        },
      });

    const inputs: ListingInput[] =
      listings.map((l) => ({
        id: l.id,
        category: l.category,
        title: l.title,
        priceUsd: l.priceUsd,
        marketplace: l.marketplace,
        vendorAlias: l.vendorAlias,
        shipsFrom: l.shipsFrom,
        firstSeen: l.firstSeen,
        lastSeen: l.lastSeen,
      }));

    const scored = scoreListings(inputs);

    const withLiveRisk = listings
      .map((l) => {
        const result = scored.get(l.id);

        if (!result) {
          return l;
        }

        return {
          ...l,
          risk: result.score,
          signals: signalsToDisplayStrings(
            result.signals
          ),
        };
      })
      .sort((a, b) => b.risk - a.risk);

    res.json(withLiveRisk);
  })
);

auditRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.auditLogEntry.findMany({
        orderBy: {
          createdAt: "desc",
        },
        take: 100,
      })
    );
  })
);

sourcesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.source.findMany({
        include: {
          _count: {
            select: {
              listings: true,
            },
          },
        },
      })
    );
  })
);