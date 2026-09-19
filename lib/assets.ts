// Asset identifiers used across anchor (SEP-6/38) calls.
// USDC issuer is the TR Mock Anchor's own testnet issuing account. SEP-38
// requires the full `stellar:<code>:<issuer>` form, not the code alone —
// confirmed against the live anchor's quote error, which names this issuer.
export const USDC_ASSET_CODE = "USDC";
export const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const TRY_SEP38_ASSET = "iso4217:TRY";
/** Minimum per-deposit amount in TRY; there is no upper bound of our own. */
export const MIN_DEPOSIT_TRY = 50;

export function usdcSep38Asset(issuer: string = USDC_ISSUER) {
  return `stellar:${USDC_ASSET_CODE}:${issuer}`;
}
