// src/lib/walletUpdate.ts
//
// Turns one incoming listing (real data, correlated to a vendor/entity)
// into the blockchain-intelligence side of the picture: an upserted
// Wallet + a new, real WalletTransaction row.
//
// IMPORTANT — this file deliberately does NOT compute or persist a wallet
// risk score. Per the existing convention (see lib/walletRisk.ts and
// routes/misc.ts's GET /api/wallets), Wallet.risk/txnCount/totalVolume
// stored on the row are treated as "legacy" and are never trusted —
// risk is always computed live, at read time, from the full population
// of real WalletTransaction rows (scoreAllWallets() needs >= 3 wallets
// with evidence to produce relative signals, so scoring one wallet in
// isolation here would be both wrong and redundant with what the route
// layer already does correctly). This module's only job is to write the
// real evidence (the transaction); scoring reads that evidence back out
// later, same as it already does for every other wallet in the system.
//
// Called from the intelligence pipeline once a listing has been
// correlated to an entity — see lib/intelligencePipeline.ts.

import type { Wallet, WalletTransaction } from "@prisma/client";
import { prisma } from "./prisma.js";
import { deriveWalletDisplayId } from "./walletDerivation.js";

// Fixed, documented, non-live conversion — same convention as
// EUR_TO_USD in prisma/importDatadump.ts (a fixed approximate rate, not
// a live FX/exchange call). Adjust here if a different reference price
// is wanted; nothing downstream re-derives this independently.
const USD_TO_BTC_EQ = 1 / 20000; // ~$20,000/BTC-eq assumption

export interface ProcessWalletInput {
  vendorAlias: string;
  entityId: string | null;
  networkId: string | null;
  priceUsd: number | null;
  occurredAt?: Date;
}

export interface ProcessWalletResult {
  wallet: Wallet;
  transaction: WalletTransaction;
}

export async function processWalletForListing(
  input: ProcessWalletInput
): Promise<ProcessWalletResult> {
  const { vendorAlias, entityId, networkId, priceUsd } = input;
  const occurredAt = input.occurredAt ?? new Date();

  const displayId = deriveWalletDisplayId(vendorAlias);

  // Same wallet every time for this vendor: create it on first sighting,
  // otherwise just bump lastSeen. risk/txnCount/totalVolume are
  // intentionally left alone here — see file header.
  const wallet = await prisma.wallet.upsert({
    where: { displayId },
    update: { lastSeen: occurredAt },
    create: {
      displayId,
      risk: 0, // legacy placeholder only — never read as authoritative, see header
      firstSeen: occurredAt,
      lastSeen: occurredAt,
      flagged: false,
    },
  });

  // A sale on a marketplace is money flowing IN to the vendor's wallet.
  // priceUsd can be null for a small number of source rows with no
  // parsed price — recorded as 0 BTC-eq rather than dropping the
  // transaction, so the wallet's real transaction COUNT still reflects
  // every real event even when the amount itself is unknown.
  const amountBtcEq =
    priceUsd !== null ? Math.round(priceUsd * USD_TO_BTC_EQ * 1e8) / 1e8 : 0;

  const transaction = await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      entityId: entityId ?? undefined,
      networkId: networkId ?? undefined,
      direction: "INBOUND",
      amountBtcEq,
      occurredAt,
    },
  });

  return { wallet, transaction };
}
