import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { depositCollateral, RestoreRequiredError } from "@/lib/blend";
import { getErrorMessage } from "@/lib/errors";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const asset = body?.asset as string | undefined;
  const amount = body?.amount as number | undefined;
  if (!asset || !amount || amount <= 0) {
    return NextResponse.json({ error: "Missing or invalid 'asset' or 'amount'" }, { status: 400 });
  }

  if (!/^C[A-Z2-7]{55}$/.test(asset)) {
    return NextResponse.json(
      { error: "Collateral must be an asset contract address (starts with C), not a wallet address (starts with G)" },
      { status: 400 },
    );
  }

  try {
    const unsignedXdr = await depositCollateral(session.publicKey, asset, amount, body?.decimals ?? 7);
    return NextResponse.json({ unsignedXdr });
  } catch (err) {
    if (err instanceof RestoreRequiredError) {
      return NextResponse.json({ needsRestore: true, restoreXdr: err.restoreXdr });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to prepare collateral transaction") },
      { status: 502 },
    );
  }
}
