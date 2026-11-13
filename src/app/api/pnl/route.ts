import { connection, type NextRequest } from "next/server"
import { isSolanaAddress, loadWallet } from "@/lib/collectorcrypt"

export async function GET(request: NextRequest) {
  await connection()
  const wallet = request.nextUrl.searchParams.get("wallet")?.trim() ?? ""
  if (!isSolanaAddress(wallet)) {
    return Response.json(
      { error: "Enter a valid Solana wallet address." },
      { status: 400 },
    )
  }

  try {
    const report = await loadWallet(wallet)
    return Response.json(report)
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load Collector Crypt activity."
    return Response.json({ error: message }, { status: 502 })
  }
}
