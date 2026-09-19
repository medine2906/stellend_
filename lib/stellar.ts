import { Networks } from "@creit.tech/stellar-wallets-kit";
import { env } from "./env";

export const STELLAR_NETWORK =
  env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC" ? Networks.PUBLIC : Networks.TESTNET;

export const HORIZON_URL = env.NEXT_PUBLIC_HORIZON_URL;
