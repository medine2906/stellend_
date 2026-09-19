"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { initWalletsKit } from "./wallets-kit";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface WalletContextValue {
  publicKey: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<string | null>;
  disconnect: () => Promise<void>;
  signTransaction: (xdr: string, networkPassphrase?: string) => Promise<string>;
  authenticated: boolean;
  authenticating: boolean;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);

  // Initialize the kit as soon as the app mounts rather than on first click —
  // browser wallet extensions (e.g. Freighter) inject their API into the page
  // asynchronously, so calling this too late can make the very first connect
  // attempt fail even though the extension is installed.
  useEffect(() => {
    initWalletsKit();
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const kit = initWalletsKit();
      // Skip the wallet-picker modal (and its "install" prompt): Freighter is the only wallet.
      kit.setWallet(FREIGHTER_ID);
      let address: string;
      try {
        ({ address } = await kit.fetchAddress());
      } catch {
        // Retry once: the extension may not have injected its API yet.
        await delay(300);
        ({ address } = await kit.fetchAddress());
      }
      setPublicKey(address);
      return address;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
      return null;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const kit = initWalletsKit();
    await kit.disconnect();
    setPublicKey(null);
    setAuthenticated(false);
  }, []);

  const signWith = useCallback(async (address: string | null, xdr: string, networkPassphrase?: string) => {
    if (!address) throw new Error("No wallet connected");
    const kit = initWalletsKit();
    const { signedTxXdr } = await kit.signTransaction(xdr, { address, networkPassphrase });
    return signedTxXdr;
  }, []);

  const signTransaction = useCallback(
    (xdr: string, networkPassphrase?: string) => signWith(publicKey, xdr, networkPassphrase),
    [publicKey, signWith],
  );

  const signIn = useCallback(async () => {
    const address = publicKey ?? (await connect());
    if (!address) return false;

    setAuthenticating(true);
    setError(null);
    try {
      const challengeRes = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: address }),
      });
      const challengeData = await challengeRes.json();
      if (!challengeRes.ok) throw new Error(challengeData.error ?? "Challenge request failed");
      const { transaction, network_passphrase } = challengeData;

      const signedXdr = await signWith(address, transaction, network_passphrase);

      const tokenRes = await fetch("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: signedXdr, publicKey: address }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenData.error ?? "Token exchange failed");

      setAuthenticated(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      return false;
    } finally {
      setAuthenticating(false);
    }
  }, [publicKey, connect, signWith]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
  }, []);

  const value = useMemo(
    () => ({
      publicKey,
      connecting,
      error,
      connect,
      disconnect,
      signTransaction,
      authenticated,
      authenticating,
      signIn,
      signOut,
    }),
    [publicKey, connecting, error, connect, disconnect, signTransaction, authenticated, authenticating, signIn, signOut],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
