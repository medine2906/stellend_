"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import type { DepositRow, LoanRow } from "@/lib/database.types";
import type { ProfileSummary as Summary } from "@/lib/profile";

interface ProfileData {
  publicKey: string;
  summary: Summary;
  deposits: DepositRow[];
  loans: LoanRow[];
}

const usdc = (n: number) => `${n.toFixed(4)} USDC`;
const tryOrUsdc = (t: number | null, u: number) => (t == null ? usdc(u) : `${t.toFixed(2)} TRY`);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="inset p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-fg">{value}</p>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function ProfileSummary() {
  const { authenticated } = useWallet();
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    fetch("/api/profile")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        setData(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load profile"));
  }, [authenticated]);

  if (!authenticated) return <p className="text-sm text-muted">Sign in with your wallet to see your profile.</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading your profile...</p>;

  const { summary: s } = data;
  return (
    <div className="flex flex-col gap-6">
      <p className="break-all font-mono text-xs text-muted">{data.publicKey}</p>

      <section className="flex flex-col gap-3 card">
        <h2 className="text-lg font-semibold">Your savings</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="Total added" value={`${s.depositedTry.toFixed(2)} TRY`} hint="Completed deposits" />
          <Stat label="Lent out (principal)" value={tryOrUsdc(s.suppliedPrincipalTry, s.suppliedPrincipalUsdc)} />
          <Stat label="Worth now" value={tryOrUsdc(s.poolBalanceTry, s.poolBalanceUsdc)} hint="Includes interest earned so far" />
          <Stat label="Interest earned" value={tryOrUsdc(s.earnedTry, s.earnedUsdc)} hint="Approximate" />
        </div>
      </section>

      <section className="flex flex-col gap-3 card">
        <h2 className="text-lg font-semibold">Your cash advances</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="Open advances" value={String(s.openLoans)} />
          <Stat label="Borrowed" value={tryOrUsdc(s.borrowedPrincipalTry, s.borrowedPrincipalUsdc)} />
          <Stat label="You owe now" value={tryOrUsdc(s.owedTry, s.owedUsdc)} hint="Includes interest" />
          <Stat label="Interest added" value={tryOrUsdc(s.interestOwedTry, s.interestOwedUsdc)} />
        </div>
      </section>

      <section className="flex flex-col gap-3 card">
        <h2 className="text-lg font-semibold">Deposits</h2>
        {data.deposits.length === 0 ? (
          <p className="text-sm text-muted">No deposits yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {data.deposits.map((d) => (
              <li key={d.id} className="flex items-center justify-between inset px-4 py-3">
                <span>
                  {d.try_amount.toFixed(2)} TRY
                  <span className="ml-2 text-xs text-faint">{new Date(d.created_at).toLocaleDateString()}</span>
                </span>
                <span className="text-xs text-fg-soft">
                  {d.status}
                  {d.status === "completed" && (d.supplied ? " · lent out" : " · not lent out yet")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
