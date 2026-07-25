import { NextResponse } from "next/server";

import { INJECTIVE_CHAIN_ID, INJECTIVE_RPC_URL } from "@/lib/injective-proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRpcResponse = {
  result?: string;
  error?: { message?: string };
};

async function callRpc(method: "eth_chainId" | "eth_blockNumber"): Promise<string> {
  const response = await fetch(INJECTIVE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
    cache: "no-store",
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error(`Injective RPC HTTP ${response.status}`);
  const body = (await response.json()) as JsonRpcResponse;
  if (body.error || typeof body.result !== "string") throw new Error(body.error?.message ?? "Injective RPC response is invalid");
  return body.result;
}

export async function GET() {
  try {
    const [chainIdHex, blockNumberHex] = await Promise.all([
      callRpc("eth_chainId"),
      callRpc("eth_blockNumber"),
    ]);
    const chainId = Number.parseInt(chainIdHex, 16);
    const latestBlock = Number.parseInt(blockNumberHex, 16);
    if (chainId !== INJECTIVE_CHAIN_ID || !Number.isSafeInteger(latestBlock)) throw new Error("Unexpected Injective network response");

    return NextResponse.json({
      data: {
        ok: true,
        network: "Injective EVM Testnet",
        chainId,
        latestBlock,
        checkedAt: new Date().toISOString(),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({
      data: {
        ok: false,
        network: "Injective EVM Testnet",
        message: "Injective 测试网暂时不可达",
      },
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
