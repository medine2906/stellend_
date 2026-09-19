"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import type { ProfileSummary } from "@/lib/profile";
import { LoansList } from "./LoansList";
import { SupplyModal } from "./SupplyModal";

interface MarketAsset { id: string; symbol: string; name: string; supplied: number; borrowed: number; supplyApr: number; borrowApr: number }
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const amount = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
const tryAmt = (value: number) => `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} TRY`;
const rate = (value?: number) => value === undefined ? "—" : value > 0 && value < 0.0001 ? "< 0.01%" : `${(value * 100).toFixed(2)}%`;
function Coin() { return <span className="coin-icon">$</span>; }
function Stat({ label, value }: { label: string; value: string }) { return <div className="market-stat"><span>{label}</span><strong>{value}</strong></div>; }

export function LendingDashboard({ markets = false }: { markets?: boolean }) {
  const { authenticated, publicKey } = useWallet();
  const [market, setMarket] = useState<MarketAsset | null>(null);
  const [marketError, setMarketError] = useState("");
  const [profile, setProfile] = useState<{ key: string; summary: ProfileSummary } | null>(null);
  const [profileError, setProfileError] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [networkSearch, setNetworkSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [hideSupply, setHideSupply] = useState(false);
  const [hideBorrow, setHideBorrow] = useState(false);

  const [supplyOpen, setSupplyOpen] = useState(false);
  const [supplyAsset, setSupplyAsset] = useState<"USDC" | "TRY">("USDC");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/markets", { signal: controller.signal }).then(async res => {
      const body = await res.json(); if (!res.ok) throw new Error(body.error);
      setMarket(body.assets[0]); setMarketError("");
    }).catch(error => { if (!controller.signal.aborted) setMarketError(error.message); });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    if (!authenticated || !publicKey) return;
    const controller = new AbortController();
    fetch("/api/profile", { signal: controller.signal }).then(async res => {
      const body = await res.json(); if (!res.ok) throw new Error(body.error);
      setProfile({ key: publicKey, summary: body.summary }); setProfileError("");
    }).catch(() => { if (!controller.signal.aborted) setProfileError("Your positions could not be loaded. Please retry."); });
    return () => controller.abort();
  }, [authenticated, publicKey, retry]);
  const summary = authenticated && profile?.key === publicKey ? profile.summary : null;
  const q = search.toLowerCase();
  const matches = (!search || `USD Coin USDC ${market?.id ?? ""}`.toLowerCase().includes(q)) && category !== "native";
  const net = summary ? summary.poolBalanceUsdc - summary.owedUsdc : null;
  return <>
    <SupplyModal key={supplyAsset} asset={supplyAsset} open={supplyOpen} onClose={() => { setSupplyOpen(false); setRetry(v => v + 1); }} apr={market?.supplyApr} />
    <section className="market-hero"><div className="page-width hero-inner">
      <div className="market-intro">
        <details className="market-picker"><summary><h1>Stellar</h1><span className="version-badge">{process.env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC" ? "Mainnet" : "Testnet"}</span><span className="chevrons">⌃<br />⌄</span></summary>
          <div className="market-menu"><input aria-label="Search markets" placeholder="Search markets..." value={networkSearch} onChange={e => setNetworkSearch(e.target.value)} /><p>STELLAR NETWORK</p>{"stellar".includes(networkSearch.toLowerCase()) ? <button onClick={e => e.currentTarget.closest("details")?.removeAttribute("open")}> Stellar <span className="selected-check">✓</span></button> : <p>No matching markets</p>}<small>Supply and borrow on Stellar.</small></div>
        </details>
        <p>Supply assets. Earn yield. Borrow without selling.</p>
      </div>
      <div className="hero-stats">{markets ? <><Stat label="Total market size" value={market ? money(market.supplied) : "—"} /><Stat label="Total available" value={market ? money(Math.max(0, market.supplied - market.borrowed)) : "—"} /><Stat label="Total borrows" value={market ? money(market.borrowed) : "—"} /></> : <><Stat label="Net supplied value" value={net === null ? "—" : summary?.poolBalanceTry != null && summary.trySupplyShare === 1 ? tryAmt(summary.poolBalanceTry - (summary.owedTry ?? 0)) : money(net)} /><Stat label="Interest earned" value={summary ? (summary.earnedTry != null && summary.trySupplyShare === 1 ? tryAmt(summary.earnedTry) : money(summary.earnedUsdc)) : "—"} /><Stat label="Outstanding debt" value={summary ? (summary.owedTry != null ? tryAmt(summary.owedTry) : money(summary.owedUsdc)) : "—"} /></>}</div>
    </div></section>
    <div className="page-width dashboard-content">
      {marketError && <div className="data-notice" role="status">{marketError}<button onClick={() => setRetry(v => v + 1)}>Retry ↻</button></div>}
      {!markets ? <>
        <div className="section-heading"><h2>Your Positions</h2><Link className="ui-button" href="/dashboard/history">View transactions <span>↗</span></Link></div>
        {authenticated && profileError && <div className="data-notice" role="alert">{profileError}<button onClick={() => setRetry(v => v + 1)}>Retry ↻</button></div>}
        <div className="two-columns positions-grid">
          <section className="panel"><div className="panel-heading"><h3>Your Supplies</h3><span className="subtle-icon">↙</span></div>{summary && summary.poolBalanceUsdc > 0 ? <>{summary.trySupplyShare < 1 && <div className="position-content"><div className="asset-name"><Coin /><div>USDC<small>USD Coin</small></div></div><strong>{amount(summary.poolBalanceUsdc * (1 - summary.trySupplyShare))}<small>USDC supplied</small></strong><Link className="ui-button" href="/dashboard/lend">Manage</Link></div>}{summary.trySupplyShare > 0 && <div className="position-content"><div className="asset-name"><span className="coin-icon try-coin">₺</span><div>TRY<small>Turkish Lira</small></div></div><strong>{summary.poolBalanceTry != null ? tryAmt(summary.poolBalanceTry * summary.trySupplyShare) : amount(summary.poolBalanceUsdc * summary.trySupplyShare)}<small>{summary.poolBalanceTry != null ? "supplied" : "USDC supplied"}</small></strong><Link className="ui-button" href="/dashboard/lend">Manage</Link></div>}</> : <div className="empty-position">{!authenticated ? "Connect your wallet to see your supplies." : !summary ? (profileError ? "Supplies unavailable. Retry above." : "Loading your supplies...") : "Nothing supplied yet"}</div>}</section>
          <section className="panel"><div className="panel-heading"><h3>Your Borrows</h3><span className="subtle-icon">↗</span></div>{summary && summary.owedUsdc > 0 ? <div className="position-content"><div className="asset-name">{summary.owedTry != null ? <span className="coin-icon try-coin">₺</span> : <Coin />}<div>{summary.owedTry != null ? "TRY" : "USDC"}<small>{summary.openLoans} open loans</small></div></div><strong>{summary.owedTry != null ? tryAmt(summary.owedTry) : amount(summary.owedUsdc)}<small>{summary.owedTry != null ? "borrowed" : "USDC borrowed"}</small></strong><Link className="ui-button" href="/dashboard/repay">Repay</Link></div> : <div className="empty-position">{!authenticated ? "Connect your wallet to see your borrows." : !summary ? (profileError ? "Borrows unavailable. Retry above." : "Loading your borrows...") : "Nothing borrowed yet"}</div>}</section>
        </div>
        <div className="two-columns asset-grids">
          <section className="panel"><div className="panel-heading"><h3>Assets To Supply</h3><button className="ui-button" onClick={() => setHideSupply(!hideSupply)} aria-expanded={!hideSupply}>{hideSupply ? "Show +" : "Hide −"}</button></div>{!hideSupply && <><div className="table-scroll"><table><thead><tr><th>Asset</th><th>Supply APR</th><th>Deposit via</th><th /></tr></thead><tbody><tr><td><span className="asset-name"><Coin />USDC</span></td><td>{rate(market?.supplyApr)}</td><td className="muted">TRY → USDC</td><td><button className="ui-button" onClick={() => { setSupplyAsset("USDC"); setSupplyOpen(true); }}>Supply</button></td></tr><tr><td><span className="asset-name"><span className="coin-icon try-coin">₺</span>TRY</span></td><td className="muted">USDC pool rate</td><td className="muted">Bank transfer</td><td><button className="ui-button" onClick={() => { setSupplyAsset("TRY"); setSupplyOpen(true); }}>Supply</button></td></tr></tbody></table></div><div className="panel-note">Deposit TRY from your bank and supply USDC to earn yield.</div></>}</section>
          <section className="panel"><div className="panel-heading"><h3>Assets To Borrow</h3><button className="ui-button" onClick={() => setHideBorrow(!hideBorrow)} aria-expanded={!hideBorrow}>{hideBorrow ? "Show +" : "Hide −"}</button></div>{!hideBorrow && <><div className="table-scroll"><table><thead><tr><th>Asset</th><th>Pool available</th><th>Borrow APR</th><th /></tr></thead><tbody><tr><td><span className="asset-name"><Coin />USDC</span></td><td>{market ? amount(Math.max(0, market.supplied - market.borrowed)) : "—"}</td><td>{rate(market?.borrowApr)}</td><td><Link className="ui-button" href="/dashboard/borrow">Borrow</Link></td></tr><tr><td><span className="asset-name"><span className="coin-icon try-coin">₺</span>TRY</span></td><td className="muted">Quoted on request</td><td className="muted">USDC pool rate</td><td><Link className="ui-button" href="/dashboard/borrow">Borrow</Link></td></tr></tbody></table></div><div className="panel-note">Use crypto as collateral and receive TRY in your bank account.</div></>}</section>
        </div>
        {authenticated && <section id="loan-management" className="loan-management"><LoansList /></section>}
        <div className="dashboard-bottom"><span><i className="status-dot" /> Powered by Stellar & Blend</span><Link href="/markets">Explore the market <span>↗</span></Link></div>
      </> : <>
        <section className="earn-banner"><div className="earn-symbol">$</div><div className="earn-copy"><h2>Put your USDC to work</h2><p>Supply on Stellar. Earn with every block.</p></div><Stat label="Total supplied" value={market ? money(market.supplied) : "—"} /><Stat label="Supply APR" value={rate(market?.supplyApr)} /><button className="ui-button" onClick={() => { setSupplyAsset("USDC"); setSupplyOpen(true); }}>Supply USDC ↗</button></section>
        <div className="market-toolbar"><label className="search-field"><span>⌕</span><input aria-label="Search assets" placeholder="Search asset name, symbol, or address" value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="Asset category" value={category} onChange={e => setCategory(e.target.value)}><option value="all">All Categories</option><option value="stable">Stablecoins</option><option value="native">Native assets</option></select></div>
        <section className="panel market-table"><div className="table-scroll"><table><thead><tr><th>Asset</th><th>Total supplied</th><th>Supply APR</th><th>Total borrowed</th><th>Borrow APR, variable</th><th /></tr></thead><tbody>{matches ? <tr><td><span className="asset-name"><Coin /><span>USD Coin<small>USDC</small></span></span></td><td>{market ? amount(market.supplied) : "—"}<small>USDC</small></td><td>{rate(market?.supplyApr)}</td><td>{market ? amount(market.borrowed) : "—"}<small>USDC</small></td><td>{rate(market?.borrowApr)}</td><td><Link className="ui-button" href="/markets/usdc">Details</Link></td></tr> : null}{!matches ? <tr><td colSpan={6} className="no-results">No assets match your filters.</td></tr> : null}</tbody></table></div></section>
        <p className="market-footnote">Showing assets supported by Stellend. Rates are variable and sourced from the Blend pool.</p>
      </>}
    </div>
  </>;
}





