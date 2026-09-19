import type { Metadata } from "next";
import { WalletProvider } from "@/lib/wallet-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stellend | Stellar lending",
  description: "Supply assets and earn yield on Stellar, or borrow TRY against your crypto.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en" className="h-full antialiased"><body className="min-h-full flex flex-col"><WalletProvider>{children}</WalletProvider></body></html>;
}
