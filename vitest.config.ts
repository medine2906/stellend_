import { defineConfig } from "vitest/config";
import path from "node:path";

// Only pure, network-independent logic is unit-tested here (see test/).
// The "server-only" package unconditionally throws when imported outside a
// bundler that special-cases it (Next.js does; plain Node under Vitest
// doesn't), so it's aliased to a no-op stub for the modules under test.
export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // `lib/env.ts` validates the environment once, when it is first imported, so these
    // have to be in place before the module graph loads — not set from inside a test.
    // They are syntactically real testnet ids so transaction building behaves as it does
    // in the app; nothing here reaches the network.
    env: {
      NEXT_PUBLIC_STELLAR_NETWORK: "TESTNET",
      NEXT_PUBLIC_BLEND_POOL_ID: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
      NEXT_PUBLIC_USDC_CONTRACT_ID: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
      SESSION_COOKIE_SECRET: "test-secret-that-is-long-enough-to-pass",
      CRON_SECRET: "test-cron-secret",
    },
  },
});
