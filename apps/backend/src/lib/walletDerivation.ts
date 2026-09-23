// src/lib/walletDerivation.ts
//
// Deterministic vendor-alias -> wallet-id mapping.
//
// Neither the Hansa nor the Valhalla dumps contain wallet addresses — this
// is derived data, not sourced data. The mapping must be:
//   - Deterministic: the same vendor always resolves to the same wallet,
//     every run, no Math.random() (matches the no-randomness convention
//     already used throughout importDatadump.ts and entityCorrelation.ts).
//   - Stable across formatting noise: "HappyEyes" and "Happy_Eyes" must
//     resolve to the same wallet, so the alias is normalized with the
//     SAME normalizeVendorAlias() used for entity correlation before
//     hashing — this file intentionally does not re-implement its own
//     normalization to avoid the two ever drifting apart.
//
// This module is pure (no DB, no I/O) so it's trivial to unit test in
// isolation before anything downstream (Wallet upsert, WalletTransaction
// creation) depends on it.

import { createHash } from "crypto";
import { normalizeVendorAlias } from "./entityCorrelation.js";

const WALLET_ID_HEX_LENGTH = 8;

// One normalized alias -> one wallet, always. If/when wallet *clusters*
// (multiple vendors sharing one wallet) are wanted, that's a deliberate
// many-to-one grouping layered on top of this function — not something
// this function should start guessing at on its own.
export function deriveWalletDisplayId(vendorAlias: string): string {
  const normalized = normalizeVendorAlias(vendorAlias);
  if (!normalized) {
    throw new Error(
      `deriveWalletDisplayId: vendorAlias "${vendorAlias}" normalized to empty string`
    );
  }

  const hash = createHash("sha256").update(normalized).digest("hex");
  return `WALLET-${hash.slice(0, WALLET_ID_HEX_LENGTH)}`;
}
