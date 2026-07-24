export interface SimulationCandidate {
  sequenceNo: number;
  label: string;
  description: string;
  trades: Array<{
    instrumentId: string;
    action: "BUY" | "SELL";
    quantity: string;
    price?: string;
  }>;
}

export interface PriceManifest {
  prices: Record<string, string>;
  sha256: string;
  capturedAt: string;
}

/**
 * Stub for DeepSeek candidate generation and PandaData pricing.
 * TODO: wire the external services in Wave 6.
 */
export async function generateCandidates(
  objective: string,
  portfolioSnapshotId: string,
): Promise<{ candidates: SimulationCandidate[]; priceManifest: PriceManifest }> {
  void objective;
  void portfolioSnapshotId;

  return {
    candidates: [
      { sequenceNo: 0, label: "Option A", description: "Conservative rebalance", trades: [] },
      { sequenceNo: 1, label: "Option B", description: "Moderate rebalance", trades: [] },
      { sequenceNo: 2, label: "Option C", description: "Aggressive rebalance", trades: [] },
    ],
    priceManifest: {
      prices: {},
      sha256: "mock-sha256",
      capturedAt: new Date().toISOString(),
    },
  };
}
