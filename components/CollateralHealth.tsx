"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import { dropUntilLiquidation, positionRisk } from "@/lib/liquidity";

interface Health {
  totalBorrowed: number;
  totalSupplied: number;
  totalEffectiveLiabilities: number;
  totalEffectiveCollateral: number;
  borrowLimit: number;
}

/**
 * How far the collateral can fall before the pool sells it. That distance — not a date, and
 * not an abstract "health percentage" — is the only thing that decides whether a borrower
 * keeps their collateral, so it is what this leads with.
 */
export function CollateralHealth() {
  const { authenticated } = useWallet();
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    fetch("/api/loans/self/health")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setHealth(data.health);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load collateral health"));
  }, [authenticated]);

  if (!authenticated) return null;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!health) return <p className="text-sm text-muted">Loading collateral health...</p>;

  const risk = positionRisk(health.totalEffectiveCollateral, health.totalEffectiveLiabilities);
  const margin = dropUntilLiquidation(health.totalEffectiveCollateral, health.totalEffectiveLiabilities);

  if (risk === "no-debt" || margin == null) {
    return (
      <div className="flex flex-col gap-2 card">
        <h3 className="text-sm font-medium text-fg-soft">Collateral</h3>
        <p className="text-sm text-muted">
          {risk === "liquidated"
            ? "Your collateral was sold to cover what you owed."
            : "Nothing borrowed, so nothing at risk."}
        </p>
      </div>
    );
  }

  const marginPercent = Math.round(margin * 100);
  const atRisk = risk === "at-risk";
  const barColor = marginPercent > 50 ? "bg-ok-strong" : marginPercent > 20 ? "bg-warn-strong" : "bg-danger-strong";

  return (
    <div className="flex flex-col gap-2 card">
      <h3 className="text-sm font-medium text-fg-soft">Collateral</h3>
      <div className="h-2 w-full overflow-hidden rounded-full bg-panel-3">
        <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, marginPercent)}%` }} />
      </div>
      <p className="text-2xl font-semibold text-fg">{marginPercent}%</p>
      <p className="text-xs text-muted">
        Your collateral can lose {marginPercent}% of its value before the pool sells it.{" "}
        {health.totalEffectiveCollateral.toFixed(2)} of collateral against {health.totalEffectiveLiabilities.toFixed(2)}{" "}
        of debt.
      </p>
      {atRisk && (
        <p className="text-sm text-warn">
          That margin is narrow. Repay part of the debt or add collateral. When it reaches zero, anyone can put your
          collateral up for auction — it is sold to whoever bids, at whatever the auction reaches, and you do not get to
          choose the moment.
        </p>
      )}
    </div>
  );
}
