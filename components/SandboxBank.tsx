"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import type { LoanStatus } from "@/lib/database.types";
import { formatIban } from "@/lib/iban";
import { closeSandboxAccount, fetchSandboxAccount, fetchSandboxSpends, openSandboxAccount, spendFromSandbox, type MockAccount, type SandboxSpend } from "@/lib/sandboxAccount";

interface Loan {
  id: string;
  try_amount: number;
  status: LoanStatus;
  created_at: string;
  due_at: string | null;
}


const tryFmt = (v: number) => `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} TRY`;
const dateFmt = (v: string) => new Date(v).toLocaleDateString();

/** Mock sandbox bank: a fake TRY account that receives the cash advances the user borrows. */
export function SandboxBank() {
  const { authenticated, publicKey } = useWallet();
  const [account, setAccount] = useState<MockAccount | null>(null);
  const [ready, setReady] = useState(false);
  const [holder, setHolder] = useState("");
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spends, setSpends] = useState<SandboxSpend[]>([]);
  const [spendAmount, setSpendAmount] = useState("");
  const [spendNote, setSpendNote] = useState("");
  const [spendError, setSpendError] = useState<string | null>(null);
  const [spending, setSpending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Signed out there is nothing to fetch, and the signed-in wallet's rows must not
    // stay on screen — so the reset runs through the same callback path as the load.
    const load = authenticated ? fetchSandboxSpends() : Promise.resolve([]);
    load.then((rows) => { if (!cancelled) setSpends(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, [authenticated, publicKey]);

  useEffect(() => {
    let cancelled = false;
    const load = authenticated ? fetchSandboxAccount() : Promise.resolve(null);
    load.then((acc) => { if (!cancelled) { setAccount(acc); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load account"); })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [authenticated, publicKey]);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    fetch("/api/profile", { signal: controller.signal, cache: "no-store" }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLoans(data.loans as Loan[]);
      setError(null);
    }).catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Failed to load loans"); });
    return () => controller.abort();
  }, [authenticated]);

  async function createAccount() {
    try { setAccount(await openSandboxAccount(holder.trim())); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to open account"); }
  }

  async function closeAccount() {
    try { setAccount(await closeSandboxAccount()); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to close account"); }
  }

  async function spend() {
    setSpending(true); setSpendError(null);
    try {
      await spendFromSandbox(Number(spendAmount), spendNote.trim());
      setSpends(await fetchSandboxSpends());
      setSpendAmount(""); setSpendNote("");
    } catch (err) { setSpendError(err instanceof Error ? err.message : "Failed to spend"); }
    finally { setSpending(false); }
  }

  if (!ready) return null;

  // Every advance that got past "pending" has been paid out to the bank account.
  const received = (loans ?? []).filter((l) => l.status !== "pending");
  // Usable balance: what reached the account minus what was spent. Not the dashboard's "Outstanding debt",
  // which is what is still owed to the pool, with interest.
  const balance = received.reduce((s, l) => s + l.try_amount, 0) - spends.reduce((s, r) => s + Number(r.amount), 0);
  const amountNum = Number(spendAmount);
  const canSpend = !spending && amountNum > 0 && amountNum <= balance + 0.005;

  return (
    <div className="page-width dashboard-content flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-fg">Sandbox</h1>
        <p className="mt-1 text-fg-soft">A mock bank for testing. Cash advances you borrow show up here as incoming TRY transfers.</p>
      </div>

      {!account ? (
        <div className="card flex flex-col gap-3">
          <p className="text-sm text-muted">You don&apos;t have a sandbox bank account yet.</p>
          <input aria-label="Account holder name" placeholder="Account holder name" value={holder} onChange={(e) => setHolder(e.target.value)} className="inset p-3 text-sm" />
          <button className="ui-button ui-button-primary" onClick={() => void createAccount()}>Create bank account</button>
        </div>
      ) : (
        <>
          <div className="card flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">{account.holder}</span>
              <span className="text-xs text-muted">Sandbox · opened {dateFmt(account.createdAt)}</span>
            </div>
            <p className="font-mono text-sm text-fg-soft">{formatIban(account.iban)}</p>
            <span className="text-xs text-muted">Available balance</span>
            <strong className="text-2xl text-fg">{tryFmt(balance)}</strong>
            <button className="ui-button ui-button-sm self-start" onClick={() => void closeAccount()}>Close account</button>
          </div>

          <div className="card flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-fg">Spend from this account</h2>
            <div className="flex flex-wrap gap-3">
              <input aria-label="Amount in TRY" type="number" min="0" step="0.01" placeholder="Amount (TRY)" value={spendAmount} onChange={(e) => setSpendAmount(e.target.value)} className="inset p-3 text-sm" />
              <input aria-label="Description" placeholder="What is it for? (optional)" value={spendNote} onChange={(e) => setSpendNote(e.target.value)} className="inset min-w-0 flex-1 p-3 text-sm" />
              <button className="ui-button ui-button-primary" disabled={!canSpend} onClick={() => void spend()}>{spending ? "Processing..." : "Spend"}</button>
            </div>
            {spendError && <p className="text-sm text-danger">{spendError}</p>}
            <p className="text-xs text-muted">Sandbox only: this just lowers the balance above. No real money moves.</p>
          </div>

          {spends.length > 0 && (
            <div className="card flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-fg">Outgoing payments</h2>
              <ul className="flex flex-col gap-3">
                {spends.map((s) => (
                  <li key={s.id} className="inset flex items-center justify-between p-4 text-sm">
                    <span>
                      <span className="block font-medium text-fg">{s.description || "Payment"}</span>
                      <span className="block text-xs text-muted">{dateFmt(s.created_at)}</span>
                    </span>
                    <strong className="text-fg">-{tryFmt(Number(s.amount))}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-fg">Incoming transfers</h2>
            {!authenticated ? <p className="text-sm text-muted">Connect and sign in with your wallet to see your borrowed loans.</p>
              : error ? <p className="text-sm text-danger">{error}</p>
              : !loans ? <p className="text-sm text-muted">Loading...</p>
              : received.length === 0 ? <p className="text-sm text-muted">No borrowed loans yet.</p>
              : <ul className="flex flex-col gap-3">
                {received.map((loan) => (
                  <li key={loan.id} className="inset flex items-center justify-between p-4 text-sm">
                    <span>
                      <span className="block font-medium text-fg">Cash advance</span>
                      <span className="block text-xs text-muted">{dateFmt(loan.created_at)} · {loan.status}{loan.due_at ? ` · due ${dateFmt(loan.due_at)}` : ""}</span>
                    </span>
                    <strong className="text-fg">+{tryFmt(loan.try_amount)}</strong>
                  </li>
                ))}
              </ul>}
          </div>
        </>
      )}
    </div>
  );
}
