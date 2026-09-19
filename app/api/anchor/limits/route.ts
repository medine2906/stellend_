import { NextResponse } from "next/server";
import { getSep6Info } from "@/lib/anchor";
import { getErrorMessage } from "@/lib/errors";

/** Public: the anchor's declared min/max TRY amounts for deposit/withdraw, for UI hints. */
export async function GET() {
  try {
    const info = await getSep6Info();
    return NextResponse.json({
      deposit: info.deposit?.USDC ?? null,
      withdraw: info.withdraw?.USDC ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to fetch anchor limits") },
      { status: 502 },
    );
  }
}
