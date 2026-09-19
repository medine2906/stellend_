"use client";

import { useEffect, useRef, useState } from "react";
import { DepositFlow } from "./DepositFlow";
import { WalletConnect } from "./WalletConnect";
import { useWallet } from "@/lib/wallet-context";
import { useAnchorLimits } from "@/lib/useAnchorLimits";

export function SupplyModal({ open, onClose, apr, asset = "USDC" }: { open: boolean; onClose: () => void; apr?: number; asset?: "USDC" | "TRY" }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"crypto" | "cash">("crypto");
  const [bankOpen, setBankOpen] = useState(false);
  const { authenticated } = useWallet();
  const limits = useAnchorLimits();
  // Only offer what the anchor's SEP-6 /info says it can do; null = still loading or anchor unreachable.
  const bankAvailable = limits?.deposit?.enabled !== false && limits?.deposit != null;
  function closeModal() {
    setTab("crypto");
    setBankOpen(false);
    onClose();
  }
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, [open]);
  const rate = apr === undefined ? "Rate unavailable" : `${apr > 0 && apr < 0.0001 ? "< 0.01" : (apr * 100).toFixed(2)}% APR`;
  return <dialog ref={dialogRef} className="supply-modal" aria-labelledby="supply-title" aria-describedby="supply-description" onCancel={closeModal} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeModal(); } }}>
    <div className="supply-modal-heading"><div><h2 id="supply-title">Supply {asset}</h2><p id="supply-description">{asset === "TRY" ? "Converted to USDC · Earn the USDC pool rate" : `${rate} · Stellar lending pool`}</p></div><button className="supply-close" aria-label="Close supply" onClick={closeModal}>×</button></div>
    <div className="supply-tabs" role="tablist" aria-label="Funding method">
      <button id="crypto-tab" role="tab" aria-selected={tab === "crypto"} aria-controls="crypto-panel" tabIndex={tab === "crypto" ? 0 : -1} onClick={() => setTab("crypto")} onKeyDown={e => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { setTab("cash"); document.getElementById("cash-tab")?.focus(); } }}><span>₿</span>Use Crypto</button>
      <button id="cash-tab" role="tab" aria-selected={tab === "cash"} aria-controls="cash-panel" tabIndex={tab === "cash" ? 0 : -1} onClick={() => setTab("cash")} onKeyDown={e => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { setTab("crypto"); document.getElementById("crypto-tab")?.focus(); } }}><span>$</span>Use Cash</button>
    </div>
    <div id="crypto-panel" role="tabpanel" aria-labelledby="crypto-tab" hidden={tab !== "crypto"}>
      <p className="supply-method-label">Supply with crypto</p>
      <button className="funding-option" disabled><span className="funding-icon">▦</span><span><strong>Transfer Crypto</strong><small>Direct crypto supply coming soon</small></span><span className="funding-token">$</span></button>
      <button className="funding-option" disabled><span className="funding-icon">⇄</span><span><strong>Connect Exchange</strong><small>Exchange connection coming soon</small></span></button>
      <p className="funding-hint">You can currently supply USDC using a TRY bank deposit. <button onClick={() => setTab("cash")}>Use Cash →</button></p>
    </div>
    <div id="cash-panel" role="tabpanel" aria-labelledby="cash-tab" hidden={tab !== "cash"}>
      <div hidden={bankOpen}>
        <p className="supply-method-label">Available via anchor</p>
        <button className="funding-option bank-option" disabled={!bankAvailable} onClick={() => setBankOpen(true)}><span className="payment-icon" aria-hidden="true">▤</span><span><strong>Bank transfer</strong><small>{limits === null ? "Checking anchor…" : bankAvailable ? "TRY → USDC · Stellar" : "Currently unavailable"}</small></span><span className="payment-chevron" aria-hidden="true">›</span></button>
      </div>
      <div className="cash-bank-flow" hidden={!bankOpen}>
        <button className="cash-back" onClick={() => setBankOpen(false)}>← Payment methods</button>
        <div className="cash-method"><span className="funding-icon">▤</span><div><strong>Bank transfer</strong><small>TRY → USDC · Stellar</small></div></div>
        {authenticated ? <DepositFlow supplyAsset={asset} /> : <div className="supply-wallet-prompt"><p>Connect and sign in with your wallet to supply USDC.</p><WalletConnect /></div>}
      </div>
    </div>
  </dialog>;
}


