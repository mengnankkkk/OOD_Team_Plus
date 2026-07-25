export const INJECTIVE_CHAIN_ID = 1439;
export const INJECTIVE_CHAIN_ID_HEX = "0x59f";
export const INJECTIVE_RPC_URL = "https://k8s.testnet.json-rpc.injective.network/";
export const INJECTIVE_EXPLORER_URL = "https://testnet.blockscout.injective.network";
export const INJECTIVE_FAUCET_URL = "https://testnet.faucet.injective.network/";
export const INJECTIVE_PROOF_PREFIX_HEX = "4d575031"; // ASCII: MWP1
export const INJECTIVE_PROOF_DRAFT_KEY = "money-whisperer:injective-proof-draft";

export type InjectiveProofDraft = {
  content: string;
  sourceId?: string;
  sourceLabel?: string;
  capturedAt: string;
};

export function canonicalizeReport(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

export async function sha256Hex(value: string): Promise<`0x${string}`> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function buildProofCalldata(hash: string): `0x${string}` {
  if (!/^0x[\da-f]{64}$/iu.test(hash)) throw new Error("报告哈希格式无效");
  return `0x${INJECTIVE_PROOF_PREFIX_HEX}${hash.slice(2).toLowerCase()}`;
}

export function saveInjectiveProofDraft(draft: Omit<InjectiveProofDraft, "capturedAt"> & { capturedAt?: string }): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(INJECTIVE_PROOF_DRAFT_KEY, JSON.stringify({
      ...draft,
      capturedAt: draft.capturedAt ?? new Date().toISOString(),
    } satisfies InjectiveProofDraft));
    return true;
  } catch {
    return false;
  }
}

export function loadInjectiveProofDraft(): InjectiveProofDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(INJECTIVE_PROOF_DRAFT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<InjectiveProofDraft>;
    if (typeof value.content !== "string" || typeof value.capturedAt !== "string") return null;
    return {
      content: value.content,
      capturedAt: value.capturedAt,
      sourceId: typeof value.sourceId === "string" ? value.sourceId : undefined,
      sourceLabel: typeof value.sourceLabel === "string" ? value.sourceLabel : undefined,
    };
  } catch {
    return null;
  }
}
