"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import { txUrl } from "./TxLinks";

interface HistoryEntry { kind: "deposit" | "withdrawal" | "loan"; id: string; try_amount: number; status: string; created_at: string }
interface ChainTx { id: string; kind: string; hash: string; created_at: string }
interface Row { key: string; label: string; date: string; amount?: string; status?: string; hash?: string }

const KIND_LABEL: Record<HistoryEntry["kind"], string> = { deposit: "Added Funds", withdrawal: "Cash Sent to Bank", loan: "Cash Advance" };
const TX_LABEL: Record<string, string> = {
  restore: "Restore expired data", trustline: "USDC trustline", collateral: "Lock collateral", borrow: "Borrow USDC",
  payout: "Send USDC to anchor", repay: "Repay loan", collateral_release: "Release collateral", supply: "Supply to pool", pool_withdraw: "Withdraw from pool",
};

export function TransactionHistoryPage() {
  const { authenticated } = useWallet();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [chainTxs, setChainTxs] = useState<ChainTx[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    fetch("/api/history", { signal: controller.signal }).then(async res => {
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      setEntries(data.entries); setChainTxs(data.transactions ?? []); setError("");
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Failed to load history"); });
    return () => controller.abort();
  }, [authenticated]);

  const rows = useMemo<Row[]>(() => [
    ...(entries ?? []).map(e => ({ key: `${e.kind}-${e.id}`, label: KIND_LABEL[e.kind], date: e.created_at, amount: `${e.try_amount.toFixed(2)} TRY`, status: e.status })),
    ...chainTxs.map(t => ({ key: `tx-${t.id}`, label: TX_LABEL[t.kind] ?? t.kind, date: t.created_at, hash: t.hash })),
  ].sort((a, b) => +new Date(b.date) - +new Date(a.date)), [entries, chainTxs]);

  const q = search.toLowerCase();
  const visible = rows.filter(r => (filter === "all" || (filter === "onchain" ? !!r.hash : !r.hash)) && (!q || `${r.label} ${r.hash ?? ""}`.toLowerCase().includes(q)));

  return <>
    <section className="market-hero"><div className="page-width hero-inner"><div className="market-intro">
      <p>Transaction history</p><h1>Stellar</h1><p>This list may not include all your transactions.</p>
    </div></div></section>
    <div className="page-width dashboard-content">
      <div className="market-toolbar">
        <label className="search-field"><span>⌕</span><input aria-label="Search transactions" placeholder="Search transactions" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <select aria-label="Transaction type" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All transactions</option><option value="onchain">On-chain</option><option value="account">Account activity</option></select>
      </div>
      {error && <div className="data-notice" role="alert">{error}</div>}
      <section className="panel market-table">
        {!authenticated ? <div className="empty-position">Connect and sign in with your wallet to view transactions.</div>
          : !entries && !error ? <div className="empty-position">Loading transactions...</div>
          : visible.length === 0 ? <div className="empty-position"><strong>No transactions yet</strong><br />Your supplies, borrows and repayments will show up here.</div>
          : <div className="table-scroll"><table><thead><tr><th>Transaction</th><th>Date</th><th>Amount</th><th>Status</th><th>Transaction link</th></tr></thead><tbody>
            {visible.map(r => <tr key={r.key}>
              <td>{r.hash ? <a href={txUrl(r.hash)} target="_blank" rel="noopener noreferrer">{r.label}</a> : r.label}</td><td className="muted">{new Date(r.date).toLocaleString()}</td><td>{r.amount ?? "—"}</td><td className="muted">{r.status ?? (r.hash ? "confirmed" : "—")}</td>
              <td>{r.hash ? <a href={txUrl(r.hash)} target="_blank" rel="noopener noreferrer">View {r.hash.slice(0, 6)}…{r.hash.slice(-4)} ↗</a> : "—"}</td>
            </tr>)}
          </tbody></table></div>}
      </section>
    </div>
  </>;
}
