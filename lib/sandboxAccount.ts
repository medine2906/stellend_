export interface MockAccount { holder: string; iban: string; createdAt: string }

async function call(method: "GET" | "POST" | "DELETE", body?: unknown): Promise<MockAccount | null> {
  const res = await fetch("/api/sandbox-account", {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data.account as MockAccount | null;
}

/** The sandbox bank account stored on the server for the signed-in wallet. */
export const fetchSandboxAccount = () => call("GET");
export const openSandboxAccount = (holder: string) => call("POST", { holder });
export const closeSandboxAccount = () => call("DELETE");

export interface SandboxSpend { id: string; amount: number; description: string; created_at: string }

export async function fetchSandboxSpends(): Promise<SandboxSpend[]> {
  const res = await fetch("/api/sandbox-account/spend", { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data.spends as SandboxSpend[];
}

export async function spendFromSandbox(amount: number, description: string): Promise<void> {
  const res = await fetch("/api/sandbox-account/spend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, description }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
}
