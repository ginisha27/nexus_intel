// apps/backend/src/routes/vendors.ts

import { Router } from "express";

import { prisma } from "../lib/prisma.js";

import { computeVendorRisk } from "../lib/vendorRisk.js";

import { normalizeVendorAlias } from "../lib/entityCorrelation.js";

import type { ListingInput } from "../lib/riskEngine.js";

import { logAudit, ipFromRequest } from "../lib/audit.js";

export const vendorsRouter = Router();

async function loadListingInputs(): Promise<ListingInput[]> {
  const listings = await prisma.listing.findMany();

  return listings.map((l) => ({
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
}

// GET /api/vendors
//
// Vendor-level intelligence, derived at request time from Listing rows.
//
// There is no stored/cached vendor table. The riskEngine-backed computation
// remains the single source of truth through computeVendorRisk().
//
// vendorAlias is used as a correlation key after normalization.
//
// IMPORTANT:
// This is ALIAS CORRELATION, not identity resolution.
// A normalized alias match does not prove that two listings belong to the
// same real-world person or organization.
vendorsRouter.get("/", async (req, res) => {
  const inputs = await loadListingInputs();

  const vendors = Array.from(
    computeVendorRisk(inputs).values(),
  ).sort((a, b) => b.risk - a.risk);

  await logAudit({
    user: "System",
    action: "Viewed Vendors List",
    resource: `${vendors.length} vendors`,
    type: "read",
    ip: ipFromRequest(req),
  });

  res.json(vendors);
});

// GET /api/vendors/:vendorAlias
//
// Single vendor profile.
//
// The route parameter is normalized before lookup because
// computeVendorRisk() returns a Map keyed by normalized vendor alias.
//
// Therefore:
//
//   /api/vendors/HappyEyes
//   /api/vendors/happyeyes
//   /api/vendors/ HappyEyes
//
// can resolve to the same normalized vendor group when
// normalizeVendorAlias() considers them equivalent.
vendorsRouter.get("/:vendorAlias", async (req, res) => {
  const inputs = await loadListingInputs();

  const normalizedAlias = normalizeVendorAlias(
    req.params.vendorAlias,
  );

  const vendor = computeVendorRisk(inputs).get(
    normalizedAlias,
  );

  if (!vendor) {
    return res
      .status(404)
      .json({ error: "Vendor not found" });
  }

  await logAudit({
    user: "System",
    action: "Viewed Vendor",
    resource: vendor.vendorAlias,
    type: "read",
    ip: ipFromRequest(req),
  });

  res.json(vendor);
});