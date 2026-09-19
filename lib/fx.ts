import "server-only";

/** Live USD→TRY market rate (USDC is treated as 1 USD). Returns null when the rate cannot be fetched — callers must show "—", never a guess. */
export async function getUsdTryRate(): Promise<number | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { next: { revalidate: 300 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const rate = Number((await res.json())?.rates?.TRY);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}
