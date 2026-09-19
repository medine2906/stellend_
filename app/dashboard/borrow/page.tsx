import { BorrowFlow } from "@/components/BorrowFlow";
import { CollateralHealth } from "@/components/CollateralHealth";

export default function BorrowDashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-fg">Get Cash Advance</h1>
        <p className="mt-1 text-fg-soft">
          Lock crypto as collateral to borrow instant TRY, without selling your position.
        </p>
      </div>
      <BorrowFlow />
      <CollateralHealth />
    </div>
  );
}
