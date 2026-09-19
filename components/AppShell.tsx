"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletConnect } from "./WalletConnect";
import { StellendMark } from "./StellendMark";
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const overview = pathname === "/dashboard" || pathname === "/dashboard/history" || pathname.startsWith("/markets") || pathname.startsWith("/sandbox");
  return <div className="stellend-app">
    <header className="app-header"><div className="header-inner">
      <Link href="/dashboard" className="wordmark" aria-label="Stellend home"><StellendMark className="brand-symbol" />stellend</Link>
      <nav className="main-nav" aria-label="Main navigation">
        <Link href="/dashboard" aria-current={pathname.startsWith("/dashboard") ? "page" : undefined}>Dashboard</Link>
        <Link href="/markets" aria-current={pathname.startsWith("/markets") ? "page" : undefined}>Markets</Link>
        <Link href="/sandbox" aria-current={pathname.startsWith("/sandbox") ? "page" : undefined}>Sandbox</Link>
      </nav>
      <div className="header-wallet"><WalletConnect /><Link className="profile-button" href="/dashboard/profile" aria-label="Your profile">⚙</Link></div>
    </div></header>
    <main className={overview ? "overview-main" : "flow-main"}>{!overview && <Link className="back-link" href="/dashboard">← Back to dashboard</Link>}{children}</main>
    <footer className="app-footer"><span>Stellend <span className="footer-description">Lending, built on Stellar.</span></span><span className="network-status"><i /> Stellar {process.env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC" ? "Mainnet" : "Testnet"}</span></footer>
  </div>;
}

