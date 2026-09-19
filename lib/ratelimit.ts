/**
 * Fixed-window rate limiter held in process memory. It is enough to stop a script
 * hammering the anchor or the RPC from one browser; a multi-instance deployment needs
 * a shared store (Redis, Upstash) behind the same interface.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry; 0 while the request is allowed. */
  retryAfter: number;
}

export function rateLimit(bucket: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const existing = windows.get(bucket);

  if (!existing || existing.resetAt <= now) {
    windows.set(bucket, { count: 1, resetAt: now + windowMs });
    // Old buckets are only ever dropped here, which keeps the map from growing without bound.
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    }
    return { allowed: true, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/** Test seam: forgets every window. */
export function resetRateLimits() {
  windows.clear();
}
