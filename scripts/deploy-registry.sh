#!/usr/bin/env bash
# Deploy the advance-registry contract to Stellar Testnet and print the contract id.
#
# Prerequisites:
#   - stellar-cli installed (verified against 28.0)
#   - cargo on PATH — `stellar contract build` shells out to it. On Windows/Git Bash
#     the Rust installer does not always add it:
#       export PATH="$PATH:$HOME/.cargo/bin"
#   - The wasm32v1-none target: rustup target add wasm32v1-none
#   - A funded testnet account; set STELLAR_ACCOUNT to its identity name (stellar keys ls)
#   - STELLAR_RPC_URL and STELLAR_NETWORK_PASSPHRASE exported, or rely on defaults below
#
# After deploying, put the printed contract id in .env.local:
#   NEXT_PUBLIC_ADVANCE_REGISTRY_ID=<id>
# Then restart the dev server — lib/env.ts reads the environment once, on first import.
#
# Usage:
#   chmod +x scripts/deploy-registry.sh
#   STELLAR_ACCOUNT=mykey ./scripts/deploy-registry.sh

set -euo pipefail

ACCOUNT="${STELLAR_ACCOUNT:-}"
if [[ -z "$ACCOUNT" ]]; then
  echo "Error: STELLAR_ACCOUNT must be set to a stellar-cli identity name." >&2
  echo "  List identities: stellar keys ls" >&2
  echo "  Create one:      stellar keys generate mykey --network testnet" >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Error: cargo is not on PATH, and 'stellar contract build' needs it." >&2
  echo "  It fails with: failed to start \`cargo metadata\`: program not found" >&2
  echo "  Try: export PATH=\"\$PATH:\$HOME/.cargo/bin\"" >&2
  exit 1
fi

RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

# The Cargo workspace is contracts/, not the repo root — there is no Cargo.toml above it.
# Both the build and the target/ directory live here.
WORKSPACE_DIR="$(cd "$(dirname "$0")/../contracts" && pwd)"
WASM_PATH="$WORKSPACE_DIR/target/wasm32v1-none/release/advance_registry.wasm"

echo "==> Building advance-registry …"
(cd "$WORKSPACE_DIR" && stellar contract build --package advance-registry)

if [[ ! -f "$WASM_PATH" ]]; then
  WASM_PATH="$(find "$WORKSPACE_DIR/target" -name "advance_registry.wasm" -not -path "*/deps/*" | head -1)"
fi
if [[ ! -f "$WASM_PATH" ]]; then
  echo "Error: no advance_registry.wasm found under $WORKSPACE_DIR/target after building." >&2
  exit 1
fi

# A stale artifact once got deployed with the pre-namespacing ABI: advances were keyed by
# id alone, so any account could squat another borrower's id. It cost a deploy to notice,
# because nothing here looked at what was actually in the wasm. Check before spending fees.
echo "==> Verifying built ABI …"
INTERFACE="$(stellar contract info interface --wasm "$WASM_PATH")"
for FN in open mark_repaid get is_overdue; do
  if ! echo "$INTERFACE" | grep -A 5 "fn $FN" | grep -q "borrower"; then
    echo "Error: '$FN' in the built wasm does not take a borrower argument." >&2
    echo "  The artifact predates the per-borrower storage key and must not be deployed." >&2
    echo "  Rebuild from a clean target: rm -rf '$WORKSPACE_DIR/target' && rerun this script." >&2
    exit 1
  fi
done
echo "    ok — every entry point is scoped to a borrower"

echo "==> Uploading wasm …"
WASM_HASH=$(stellar contract upload \
  --source "$ACCOUNT" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --wasm "$WASM_PATH")
echo "    wasm hash: $WASM_HASH"

echo "==> Deploying contract …"
CONTRACT_ID=$(stellar contract deploy \
  --source "$ACCOUNT" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --wasm-hash "$WASM_HASH")

echo ""
echo "Deployed advance-registry:"
echo "  NEXT_PUBLIC_ADVANCE_REGISTRY_ID=$CONTRACT_ID"
echo ""
echo "Put that line in .env.local, then restart the dev server."
