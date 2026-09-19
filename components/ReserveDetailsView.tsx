"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { ReserveDetails } from "@/lib/market-types";
import { useWallet } from "@/lib/wallet-context";
import { SupplyModal } from "./SupplyModal";
import { WalletConnect } from "./WalletConnect";

const number = (n: number | undefined | null) =>
  n == null
    ? "—"
    : n >= 1e15
      ? n.toExponential(2)
      : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, notation: "compact" }).format(n);

const percent = (n: number | undefined | null) =>
  n == null ? "—" : n > 0 && n < 0.0001 ? "< 0.01%" : `${(n * 100).toFixed(2)}%`;

const usd = (n: number | undefined | null) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(n);

const isMainnet = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC";
const explorer = (id: string) =>
  `https://stellar.expert/explorer/${isMainnet ? "public" : "testnet"}/contract/${id}`;

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="reserve-metric">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="reserve-section">
      <h3>{title}</h3>
      <div className="reserve-section-body">{children}</div>
    </section>
  );
}

function Ring({ value, orange = false }: { value: number | null; orange?: boolean }) {
  const fill = Math.max(0, Math.min(1, value ?? 0));
  return (
    <div className={`reserve-ring ${orange ? "orange" : ""}`}>
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r="35" />
        <circle cx="40" cy="40" r="35" strokeDasharray={`${fill * 220} 220`} />
      </svg>
      <span>{percent(value)}</span>
    </div>
  );
}

function History({ borrow = false }: { borrow?: boolean }) {
  return (
    <div className={`reserve-history ${borrow ? "orange" : ""}`}>
      <div className="reserve-chart-heading">
        <span>
          <i />
          {borrow ? "Borrow APR, variable" : "Supply APR"}
        </span>
        <span className="reserve-periods" aria-label="Historical periods unavailable">
          1w　 1m　 6m　 1y
        </span>
      </div>
      <div className="reserve-chart-empty">
        <span>Historical rates unavailable</span>
        <p>A historical rate source is not connected for this pool.</p>
      </div>
    </div>
  );
}

/** Plot area of the rate curve, in the SVG's own viewBox coordinates. */
const PLOT = { left: 48, width: 640, top: 28, bottom: 180, height: 145 };

function RateModel({ market }: { market: ReserveDetails }) {
  const max = Math.max(...market.rateCurve.map((p) => p.apr), 0.01);
  const x = (utilization: number) => PLOT.left + utilization * PLOT.width;
  const y = (apr: number) => PLOT.bottom - (apr / max) * PLOT.height;
  const path = market.rateCurve.map((p, i) => `${i ? "L" : "M"}${x(p.utilization)},${y(p.apr)}`).join(" ");
  const currentX = x(Math.min(1, market.utilization));

  return (
    <>
      <div className="reserve-chart-heading">
        <Metric label="Utilization rate">{percent(market.utilization)}</Metric>
        <a className="ui-button" href={explorer(market.poolId)} target="_blank" rel="noreferrer">
          Pool contract ↗
        </a>
      </div>
      <p className="reserve-legend">
        ● Borrow APR, variable <span>● Current utilization</span>
      </p>
      <svg
        className="reserve-model"
        viewBox="0 0 720 225"
        role="img"
        aria-label="Borrow APR curve calculated from current on-chain Blend parameters"
      >
        <title>Current interest rate model</title>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line
              x1={PLOT.left}
              x2={688}
              y1={PLOT.bottom - v * PLOT.height}
              y2={PLOT.bottom - v * PLOT.height}
              stroke="#343437"
              strokeDasharray="3 4"
            />
            <text x="0" y={PLOT.bottom + 4 - v * PLOT.height}>
              {(max * v * 100).toFixed(1)}%
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#cc61b9" strokeWidth="2" />
        <line x1={currentX} x2={currentX} y1={PLOT.top} y2={PLOT.bottom} stroke="#489ef3" strokeDasharray="4 4" />
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <text key={v} x={x(v)} y="207" textAnchor="middle">
            {v * 100}%
          </text>
        ))}
      </svg>
      <p className="reserve-help">
        Target utilization: {percent(market.targetUtilization)}. Calculated from the pool&rsquo;s current parameters and
        interest rate modifier; this is not historical performance.
      </p>
    </>
  );
}

export function ReserveDetailsView({ symbol = "USDC" }: { symbol?: "USDC" | "TRY" }) {
  const { authenticated, publicKey } = useWallet();
  const [rawMarket, setMarket] = useState<ReserveDetails | null>(null);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState(false);
  const [wallet, setWallet] = useState<{ publicKey: string; balance: number; available: number } | null>(null);
  const [walletError, setWalletError] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function update() {
      try {
        const res = await fetch("/api/markets", { signal: controller.signal, cache: "no-store" });
        const body = await res.json();
        if (!res.ok || !body.assets?.[0]) throw new Error(body.error || "Reserve unavailable.");
        setMarket(body.assets[0]);
        setFxRate(body.tryRate ?? null);
        setError("");
      } catch (e) {
        if (!controller.signal.aborted) {
          setMarket(null);
          setError(e instanceof Error ? e.message : "Reserve unavailable.");
        }
      }
    }
    void update();
    const timer = setInterval(update, 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!authenticated || !publicKey) return;
    const controller = new AbortController();
    async function update() {
      try {
        const res = await fetch("/api/markets/wallet", { signal: controller.signal, cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        if (body.publicKey !== publicKey) throw new Error("Wallet session changed. Sign in again.");
        setWallet(body);
        setWalletError(null);
      } catch (e) {
        if (!controller.signal.aborted) {
          setWallet(null);
          setWalletError({ key: publicKey!, message: e instanceof Error ? e.message : "Wallet unavailable." });
        }
      }
    }
    void update();
    const timer = setInterval(update, 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [authenticated, publicKey, refresh]);

  const isTry = symbol === "TRY";
  // The pool is denominated in USDC; the TRY view is the same reserve at the live rate.
  const conv = isTry ? fxRate : 1;
  const fxMissing = isTry && fxRate === null;

  const market =
    rawMarket && conv !== null
      ? {
          ...rawMarket,
          supplied: rawMarket.supplied * conv,
          borrowed: rawMarket.borrowed * conv,
          supplyCap: rawMarket.supplyCap * conv,
          oraclePrice: isTry ? 1 / conv : rawMarket.oraclePrice,
        }
      : null;

  const rawPersonal = authenticated && wallet?.publicKey === publicKey ? wallet : null;
  const personal =
    rawPersonal && conv !== null
      ? { ...rawPersonal, balance: rawPersonal.balance * conv, available: rawPersonal.available * conv }
      : null;

  const supplyRatio = market && market.supplyCap > 0 ? market.supplied / market.supplyCap : null;
  const liquidity = market ? Math.max(0, market.supplied - market.borrowed) : null;

  const retry = (
    <button onClick={() => setRefresh((v) => v + 1)}>Retry ↻</button>
  );

  return (
    <>
      <SupplyModal
        asset={symbol}
        open={open}
        onClose={() => {
          setOpen(false);
          setRefresh((v) => v + 1);
        }}
        apr={market?.supplyApr}
      />

      <section className="market-hero">
        <div className="page-width reserve-hero">
          <Link className="reserve-back" href="/markets">
            ← Back
          </Link>
          <div className="reserve-hero-row">
            <div className="reserve-title">
              <span className={`coin-icon ${isTry ? "try-coin" : ""}`}>{isTry ? "₺" : "$"}</span>
              <div>
                <h1>
                  {isTry ? "Turkish Lira" : "USD Coin"} <span>{symbol}</span>
                </h1>
                <p>
                  on <span className="reserve-network">✦ Stellar</span> · {isMainnet ? "Mainnet" : "Testnet"}
                </p>
              </div>
            </div>
            <div className="reserve-top-stats">
              <Metric label="Reserve size">
                {number(market?.supplied)} <small>{symbol}</small>
              </Metric>
              <Metric label="Available liquidity">
                {number(liquidity)} <small>{symbol}</small>
              </Metric>
              <Metric label="Utilization rate">{percent(market?.utilization)}</Metric>
              <Metric label="Oracle price">{usd(market?.oraclePrice)}</Metric>
            </div>
          </div>
        </div>
      </section>

      <div className="page-width reserve-content">
        {error && (
          <div className="data-notice" role="alert">
            {error}
            {retry}
          </div>
        )}
        {fxMissing && rawMarket && (
          <div className="data-notice" role="alert">
            Live USD/TRY rate is temporarily unavailable.
            {retry}
          </div>
        )}
        {!market && !error && !fxMissing && (
          <p className="reserve-help" role="status">
            Loading live reserve data…
          </p>
        )}

        <div className="reserve-layout">
          <article className="panel reserve-config">
            <h2>Reserve status &amp; configuration</h2>

            <Section title="Supply info">
              <div className="reserve-summary">
                <Ring value={supplyRatio} />
                <Metric label="Total supplied">
                  {number(market?.supplied)}
                  {market && <> of {number(market.supplyCap)}</>}
                  <small>
                    {symbol}
                    {market ? " · supply cap" : ""}
                  </small>
                </Metric>
                <Metric label="APY, estimated">{percent(market?.supplyApy)}</Metric>
                <Metric label="APR">{percent(market?.supplyApr)}</Metric>
              </div>
              <History />
              <h4>
                Collateral usage{" "}
                <span className="reserve-positive">
                  {market ? (market.collateralFactor > 0 ? "✓ Can be collateral" : "Not collateral") : "—"}
                </span>
              </h4>
              <div className="reserve-boxes">
                <Metric label="Collateral factor">{percent(market?.collateralFactor)}</Metric>
                <Metric label="Liability factor">{percent(market?.liabilityFactor)}</Metric>
                <Metric label="Reserve status">{market ? (market.enabled ? "Enabled" : "Disabled") : "—"}</Metric>
              </div>
              <p className="reserve-help">
                Blend uses collateral and liability factors to assess positions. Aave LTV and liquidation penalty fields
                do not apply to this reserve.
              </p>
            </Section>

            <Section title="Borrow info">
              <div className="reserve-summary">
                <Ring value={market?.utilization ?? null} orange />
                <Metric label="Total borrowed">
                  {number(market?.borrowed)}
                  <small>{symbol}</small>
                </Metric>
                <Metric label="APY, estimated">{percent(market?.borrowApy)}</Metric>
                <Metric label="APR, variable">{percent(market?.borrowApr)}</Metric>
              </div>
              <History borrow />
              <h4>Backstop info</h4>
              <div className="reserve-boxes">
                <Metric label="Backstop take rate">{percent(market?.backstopRate)}</Metric>
                <Metric label="Backstop contract">
                  {market ? (
                    <a href={explorer(market.backstop)} target="_blank" rel="noreferrer">
                      View contract ↗
                    </a>
                  ) : (
                    "—"
                  )}
                </Metric>
                <Metric label="Maximum utilization">{percent(market?.maxUtilization)}</Metric>
              </div>
            </Section>

            <Section title="E-Mode info">
              <div className="reserve-unavailable">
                <span>Not supported on this market</span>
                <p>E-Mode is an Aave feature. This Stellar market uses Blend&rsquo;s collateral and liability factors.</p>
              </div>
            </Section>

            <Section title="Interest rate model">
              {market ? (
                <RateModel market={market} />
              ) : (
                <div className="reserve-chart-empty">{error ? "Live model unavailable" : "Loading current model…"}</div>
              )}
            </Section>
          </article>

          <aside className="panel reserve-personal">
            <h2>Your info</h2>
            <div className="reserve-wallet">
              <span className="reserve-wallet-icon">▣</span>
              <Metric label="Wallet balance">
                {number(personal?.balance)} {symbol}
              </Metric>
            </div>
            <div className="reserve-personal-row">
              <Metric label="Available in wallet">
                {number(personal?.available)} {symbol}
              </Metric>
              <button className="ui-button reserve-supply" onClick={() => setOpen(true)}>
                Supply
              </button>
            </div>
            <div className="reserve-personal-row">
              <Metric label="Available to borrow">
                Check quote
                <small>Based on your collateral</small>
              </Metric>
              <Link className="ui-button" href="/dashboard/borrow">
                Borrow
              </Link>
            </div>
            <p className="reserve-help">
              Supply through a TRY bank deposit. Your borrowing amount is calculated in the borrow flow.
            </p>
            {!authenticated ? (
              <div className="reserve-wallet-prompt">
                <p>Connect and sign in to view your wallet balance.</p>
                <WalletConnect />
              </div>
            ) : walletError?.key === publicKey ? (
              <div className="reserve-wallet-prompt" role="status">
                {walletError.message}
                {retry}
              </div>
            ) : !personal ? (
              <p className="reserve-help">Loading wallet balance…</p>
            ) : personal.balance === 0 ? (
              <div className="reserve-wallet-prompt">
                Your wallet has no {symbol}. You can fund a supply with a TRY bank deposit.
              </div>
            ) : null}
          </aside>
        </div>

        {market && (
          <p className="reserve-source">
            Live Blend data · Ledger {market.ledger} · Updated {new Date(market.fetchedAt).toLocaleTimeString()}
            <button onClick={() => setRefresh((v) => v + 1)}>Refresh ↻</button>
          </p>
        )}
      </div>
    </>
  );
}
