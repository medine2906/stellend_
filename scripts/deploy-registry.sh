#!/usr/bin/env bash
# Deploy the advance-registry contract to Stellar Testnet and print the contract id.
#
# Prerequisites:
#   - stellar-cli 25.2+ installed  (brew install stellar/tap/stellar-cli or cargo install stellar-cli)
#   - A funded testnet account; set STELLAR_ACCOUNT to its identity name (stellar keys ls)
#   - STELLAR_RPC_URL and STELLAR_NETWORK_PASSPHRASE exported, or rely on defaults below
#
# After deploying, copy the printed contract id into:
#   .env.local -> NEXT_PUBLIC_ADVANCE_REGISTRY_ID=<id>
#   .env.example already contains a placeholder value for documentation.
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

RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
CONTRACT_DIR="$(cd "$(dirname "$0")/../contracts/advance-registry" && pwd)"

echo "==> Building advance-registry …"
(cd "$CONTRACT_DIR/../.." && stellar contract build --package advance-registry)

WASM_PATH="$CONTRACT_DIR/../../target/wasm32v1-none/release/advance_registry.wasm"
if [[ ! -f "$WASM_PATH" ]]; then
  # stellar-cli 25.2+ puts the optimised artifact here after `stellar contract build`
  WASM_PATH="$(find "$CONTRACT_DIR/../../target" -name "advance_registry.wasm" -not -path "*/deps/*" | head -1)"
fi

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
echo "Add that line to .env.local to enable the feature."
