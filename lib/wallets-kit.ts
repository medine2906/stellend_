"use client";

import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { STELLAR_NETWORK } from "./stellar";

let initialized = false;

/** Initializes the (client-only, singleton) Stellar Wallets Kit. Safe to call repeatedly. */
export function initWalletsKit(): typeof StellarWalletsKit {
  if (!initialized) {
    StellarWalletsKit.init({
      network: STELLAR_NETWORK,
      modules: [new FreighterModule()],
    });
    initialized = true;
  }
  return StellarWalletsKit;
}
