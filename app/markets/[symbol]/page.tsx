import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ReserveDetailsView } from "@/components/ReserveDetailsView";

export default async function ReservePage({ params }: { params: Promise<{ symbol: string }> }) {
  const symbol = (await params).symbol.toUpperCase();
  if (symbol !== "USDC") notFound();
  return <AppShell><ReserveDetailsView symbol={symbol} /></AppShell>;
}
