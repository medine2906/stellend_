import "server-only";
import { getSupabaseServiceClient } from "./supabase";

/** Looks up (or lazily creates) the off-chain profile row id for a Stellar public key. */
export async function getOrCreateProfileId(stellarPublicKey: string): Promise<string> {
  const supabase = getSupabaseServiceClient();

  const { data: existing, error: selectError } = await supabase
    .from("profiles")
    .select("id")
    .eq("stellar_public_key", stellarPublicKey)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing.id;

  const { data: inserted, error: insertError } = await supabase
    .from("profiles")
    .insert({ stellar_public_key: stellarPublicKey })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return inserted.id;
}
