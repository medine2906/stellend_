/**
 * Extracts a readable message from any thrown value. Supabase's query
 * errors (PostgrestError) aren't `Error` instances — they're plain objects
 * with a `message` field — so `err instanceof Error` alone silently drops
 * their message and falls back to a generic string.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return fallback;
}
