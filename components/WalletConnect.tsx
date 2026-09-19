"use client";

import { useWallet } from "@/lib/wallet-context";

function shortenKey(key: string) {
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function WalletConnect() {
  const { publicKey, connecting, authenticated, authenticating, error, disconnect, signIn, signOut } =
    useWallet();

  if (publicKey && authenticated) {
    return (
      <div className="flex items-center gap-3">
        <span className="wallet-chip">
          {shortenKey(publicKey)}
        </span>
        <button onClick={() => void signOut()} className="link-button text-sm">
          Sign out
        </button>
      </div>
    );
  }

  if (publicKey) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={() => void signIn()}
          disabled={authenticating}
          className="ui-button ui-button-primary"
        >
          {authenticating ? "Signing in..." : "Sign in with wallet"}
        </button>
        <button onClick={() => void disconnect()} className="link-button text-xs">
          Disconnect
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() => void signIn()}
        disabled={connecting || authenticating}
        className="ui-button ui-button-primary"
      >
        {connecting || authenticating ? "Connecting..." : "Connect Wallet"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
