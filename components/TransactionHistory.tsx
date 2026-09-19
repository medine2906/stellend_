"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import { txUrl } from "./TxLinks";

interface HistoryEntry {
  kind: "deposit" | "withdrawal" | "loan";
  id: string;
  try_amount: number;
  status: string;
  created_at: string;
}

const KIND_LABEL: Record<HistoryEntry["kind"], string> = {
  deposit: "Added Funds",
  withdrawal: "Cash Sent to Bank",
  loan: "Cash Advance",
};

interface ChainTx {
  id: string;
  kind: string;
  hash: string;
  created_at: string;
}

const TX_LABEL: Record<string, string> = {
  restore: "Restore expired data",
  trustline: "USDC trustline",
  collateral: "Lock collateral",
  borrow: "Borrow USDC",
  payout: "Send USDC to anchor",
  repay: "Repay loan",
  collateral_release: "Release collateral",
  supply: "Supply to pool",
  pool_withdraw: "Withdraw from pool",
};

export function TransactionHistory() {
  const { authenticated } = useWallet();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [chainTxs, setChainTxs] = useState<ChainTx[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    fetch("/api/history")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setEntries(data.entries);
        setChainTxs(data.transactions ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load history"));
  }, [authenticated]);

  if (!authenticated) return null;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!entries) return <p className="text-sm text-muted">Loading history...</p>;

  if (entries.length === 0 && chainTxs.length === 0) {
    return (
      <div className="card">
        <h3 className="text-sm font-medium text-fg-soft">Activity</h3>
        <p className="mt-2 text-sm text-muted">No activity yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 card">
      <h3 className="text-sm font-medium text-fg-soft">Activity</h3>
      <ul className="flex flex-col divide-y divide-line">
        {entries.map((entry) => (
          <li key={`${entry.kind}-${entry.id}`} className="flex items-center justify-between py-3 text-sm">
            <div>
              <p className="font-medium text-fg">{KIND_LABEL[entry.kind]}</p>
              <p className="text-xs text-muted">{new Date(entry.created_at).toLocaleString()}</p>
            </div>
            <div className="text-right">
              <p className="font-medium text-fg">{entry.try_amount.toFixed(2)} TRY</p>
              <p className="text-xs capitalize text-muted">{entry.status}</p>
            </div>
          </li>
        ))}
      </ul>
      {chainTxs.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-fg-soft">On-chain transactions</h3>
          <ul className="flex flex-col divide-y divide-line">
            {chainTxs.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <p className="font-medium text-fg">{TX_LABEL[tx.kind] ?? tx.kind}</p>
                  <p className="text-xs text-muted">{new Date(tx.created_at).toLocaleString()}</p>
                </div>
                <a href={txUrl(tx.hash)} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-fg underline">
                  {tx.hash.slice(0, 8)}…{tx.hash.slice(-6)} ↗
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
