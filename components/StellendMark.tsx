/** Stellend mark: two interlocking rings (lender and borrower) with the shared overlap filled in. */
export function StellendMark({ className = "" }: { className?: string }) {
  return <svg className={`stellend-mark ${className}`} viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <circle cx="14" cy="20" r="10" stroke="currentColor" strokeWidth="3" />
    <circle cx="26" cy="20" r="10" stroke="currentColor" strokeWidth="3" />
    <path d="M20 12A10 10 0 0 1 20 28A10 10 0 0 1 20 12Z" fill="currentColor" />
  </svg>;
}
