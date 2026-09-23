// seedEvidence.js
//
// Adds a couple of real EvidenceRecord rows to every non-CLOSED investigation
// that currently has zero evidence. Uses the same SHA-256 hashing scheme as
// the real POST /:displayId/evidence route, so these records are
// indistinguishable from ones added through the UI.
//
// USAGE (from backend/backend, where prisma is already configured):
//   node seedEvidence.js
//
// Requires: @prisma/client already generated (it will be, if you've run the
// app before). No new dependencies needed.

const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");

const prisma = new PrismaClient();

// Feel free to edit these — type + notes pairs that get attached round-robin
// to each investigation missing evidence.
const SAMPLE_EVIDENCE = [
  { type: "Transaction Record", notes: "On-chain transfer pattern matching flagged wallet cluster." },
  { type: "Intelligence Record", notes: "Marketplace listing snapshot corroborating vendor alias." },
  { type: "Communication Log", notes: "Correlated messaging metadata from linked account." },
];

function makeHash(type, notes) {
  return crypto
    .createHash("sha256")
    .update(`${type}|${notes ?? ""}|${Date.now()}|${Math.random()}`)
    .digest("hex")
    .toUpperCase();
}

async function main() {
  const investigations = await prisma.investigation.findMany({
    where: { status: { not: "CLOSED" } },
    include: { _count: { select: { evidence: true } } },
  });

  const targets = investigations.filter((inv) => inv._count.evidence === 0);

  if (targets.length === 0) {
    console.log("Every active investigation already has evidence — nothing to do.");
    return;
  }

  console.log(`Seeding evidence for ${targets.length} investigation(s)...`);

  for (const inv of targets) {
    // How many pieces of evidence to add for this case (1-2, varied so it
    // doesn't look uniformly seeded).
    const howMany = 1 + (targets.indexOf(inv) % 2);

    for (let i = 0; i < howMany; i++) {
      const sample = SAMPLE_EVIDENCE[(targets.indexOf(inv) + i) % SAMPLE_EVIDENCE.length];

      const existingCount = await prisma.evidenceRecord.count({
        where: { investigationId: inv.id },
      });
      const displayId = `EV-${String(existingCount + 1).padStart(4, "0")}`;

      const evidence = await prisma.evidenceRecord.create({
        data: {
          displayId,
          investigationId: inv.id,
          type: sample.type,
          notes: sample.notes,
          uploadedBy: "Investigator A",
          status: "PENDING",
          hash: makeHash(sample.type, sample.notes),
        },
      });

      console.log(`  + ${evidence.displayId} -> ${inv.displayId} (${sample.type})`);
    }
  }

  console.log("Done. Refresh the Investigations page to see updated counts.");
}

main()
  .catch((err) => {
    console.error("Failed to seed evidence:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
