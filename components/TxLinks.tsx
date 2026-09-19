export interface TxRecord {
  label: string;
  hash: string;
}

export const txUrl = (hash: string) =>
  `https://stellar.expert/explorer/${process.env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC" ? "public" : "testnet"}/tx/${hash}`;

/** Lists the on-chain transactions a flow has submitted so far, each linking to the block explorer. */
export function TxLinks({ txs }: { txs: TxRecord[] }) {
  if (txs.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 inset p-3 text-xs">
      <p className="font-medium text-fg-soft">Transactions</p>
      <ul className="flex flex-col gap-1">
        {txs.map((tx) => (
          <li key={tx.hash} className="flex items-center justify-between gap-3">
            <span className="text-muted">{tx.label}</span>
            <a href={txUrl(tx.hash)} target="_blank" rel="noopener noreferrer" className="font-mono text-fg underline">
              {tx.hash.slice(0, 8)}…{tx.hash.slice(-6)} ↗
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
