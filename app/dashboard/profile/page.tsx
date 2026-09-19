import { LoansList } from "@/components/LoansList";
import { ProfileSummary } from "@/components/ProfileSummary";

export default function ProfilePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-fg">My Profile</h1>
        <p className="mt-1 text-fg-soft">What you added, what it earned, and what you owe.</p>
      </div>
      <ProfileSummary />
      <LoansList />
    </div>
  );
}
