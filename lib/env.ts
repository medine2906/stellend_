import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  NEXT_PUBLIC_STELLAR_NETWORK: z.enum(["TESTNET", "PUBLIC"]).default("TESTNET"),
  NEXT_PUBLIC_HORIZON_URL: z.string().default("https://horizon-testnet.stellar.org"),
  NEXT_PUBLIC_ANCHOR_URL: z.string().default("https://tr-mock-anchor.fly.dev"),
  NEXT_PUBLIC_SOROBAN_RPC_URL: z.string().default("https://soroban-testnet.stellar.org"),
  NEXT_PUBLIC_BLEND_POOL_ID: z.string().optional(),
  NEXT_PUBLIC_USDC_CONTRACT_ID: z.string().optional(),
  /** Advance registry contract. When absent the registry feature is disabled. */
  NEXT_PUBLIC_ADVANCE_REGISTRY_ID: z.string().optional(),
  SESSION_COOKIE_SECRET: z.string().default("change-me-in-production"),
  CRON_SECRET: z.string().optional(),
});

// Parsed lazily so a missing Supabase/anchor config doesn't crash `next build` or
// `next dev` — only the code paths that actually need a given value fail, with a
// clear error, at the point of use.
let _env: z.infer<typeof envSchema> | null = null;

export const env: z.infer<typeof envSchema> = new Proxy({} as z.infer<typeof envSchema>, {
  get(_target, prop) {
    if (!_env) {
      _env = envSchema.parse({
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK || "TESTNET",
        NEXT_PUBLIC_HORIZON_URL: process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org",
        NEXT_PUBLIC_ANCHOR_URL: process.env.NEXT_PUBLIC_ANCHOR_URL || "https://tr-mock-anchor.fly.dev",
        NEXT_PUBLIC_SOROBAN_RPC_URL: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org",
        NEXT_PUBLIC_BLEND_POOL_ID: process.env.NEXT_PUBLIC_BLEND_POOL_ID,
        NEXT_PUBLIC_USDC_CONTRACT_ID: process.env.NEXT_PUBLIC_USDC_CONTRACT_ID,
        NEXT_PUBLIC_ADVANCE_REGISTRY_ID: process.env.NEXT_PUBLIC_ADVANCE_REGISTRY_ID,
        SESSION_COOKIE_SECRET: process.env.SESSION_COOKIE_SECRET || "change-me-in-production",
        CRON_SECRET: process.env.CRON_SECRET,
      });
    }
    return _env[prop as keyof typeof _env];
  },
});

export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value as NonNullable<(typeof env)[K]>;
}
