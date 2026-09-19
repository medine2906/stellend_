"use client";

import { useEffect, useState } from "react";

interface AssetLimits {
  enabled: boolean;
  min_amount?: number;
  max_amount?: number;
}

interface AnchorLimits {
  deposit: AssetLimits | null;
  withdraw: AssetLimits | null;
}

/** Fetches the anchor's declared min/max TRY amounts once, for inline UI hints/validation. */
export function useAnchorLimits() {
  const [limits, setLimits] = useState<AnchorLimits | null>(null);

  useEffect(() => {
    fetch("/api/anchor/limits")
      .then(async (res) => (res.ok ? setLimits(await res.json()) : setLimits(null)))
      .catch(() => setLimits(null));
  }, []);

  return limits;
}

export function limitsHint(assetLimits: AssetLimits | null | undefined): string | null {
  if (!assetLimits) return null;
  const { min_amount } = assetLimits;
  if (min_amount != null) return `Minimum ${min_amount} TRY`;
  return null;
}

export function amountOutOfRange(assetLimits: AssetLimits | null | undefined, amount: number): boolean {
  if (!assetLimits) return false;
  if (assetLimits.min_amount != null && amount < assetLimits.min_amount) return true;
  return false;
}
