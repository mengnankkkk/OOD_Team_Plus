import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("GET /api/v1/injective/status", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the verified Injective testnet height", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const method = JSON.parse(String(init?.body)).method as string;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: method === "eth_chainId" ? "0x59f" : "0x2a" }), { status: 200 });
    }));

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ ok: true, chainId: 1439, latestBlock: 42 });
  });

  it("fails closed when RPC returns another chain", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const method = JSON.parse(String(init?.body)).method as string;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: method === "eth_chainId" ? "0x1" : "0x2a" }), { status: 200 });
    }));

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.data).toEqual(expect.objectContaining({ ok: false }));
    expect(JSON.stringify(body)).not.toContain("Unexpected");
  });
});
