"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/features/frontend-migration/api";
import { InjectiveProofView, type NetworkStatus, type Phase } from "./InjectiveProofView";
import {
  buildProofCalldata,
  canonicalizeReport,
  INJECTIVE_CHAIN_ID_HEX,
  INJECTIVE_EXPLORER_URL,
  INJECTIVE_RPC_URL,
  loadInjectiveProofDraft,
  sha256Hex,
  type InjectiveProofDraft,
} from "@/lib/injective-proof";

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

type Receipt = { status?: string; blockNumber?: string };

const EXAMPLE_REPORT = `Money Whisperer AI 投资建议摘要

当前组合风险集中度偏高，建议降低单一行业暴露，保留必要现金缓冲，并通过分批调整控制执行风险。

本报告用于研究、解释和模拟，不构成投资建议。`;

function getProvider(): EthereumProvider | null {
  return (window as Window & { ethereum?: EthereumProvider }).ethereum ?? null;
}

function getErrorCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "number") {
    return (error as { code: number }).code;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  if (getErrorCode(error) === 4001) return "你取消了钱包操作，没有产生交易。";
  const message = error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : String(error);
  if (message === "NO_WALLET") return "未检测到 EVM 钱包。请先安装 MetaMask，再刷新页面。";
  if (message === "NO_TEST_INJ" || message.toLowerCase().includes("insufficient funds")) return "钱包中没有足够的测试网 INJ 支付 Gas，请先从 Faucet 领取。";
  return message || "Injective 存证失败，请稍后重试。";
}

async function ensureInjectiveTestnet(provider: EthereumProvider) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: INJECTIVE_CHAIN_ID_HEX }] });
  } catch (error) {
    if (getErrorCode(error) !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: INJECTIVE_CHAIN_ID_HEX,
        chainName: "Injective EVM Testnet",
        nativeCurrency: { name: "Injective", symbol: "INJ", decimals: 18 },
        rpcUrls: [INJECTIVE_RPC_URL],
        blockExplorerUrls: [INJECTIVE_EXPLORER_URL],
      }],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: INJECTIVE_CHAIN_ID_HEX }] });
  }
  const chainId = await provider.request({ method: "eth_chainId" });
  if (chainId !== INJECTIVE_CHAIN_ID_HEX) throw new Error("钱包未切换到 Injective EVM Testnet");
}

async function waitForReceipt(provider: EthereumProvider, transactionHash: string): Promise<Receipt | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [transactionHash] }) as Receipt | null;
      if (receipt) return receipt;
    } catch {
      // RPC propagation can briefly lag behind the wallet; keep polling.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
  }
  return null;
}

export default function InjectiveProofClient() {
  const [report, setReport] = useState("");
  const [source, setSource] = useState<InjectiveProofDraft | null>(null);
  const [proofHash, setProofHash] = useState("");
  const [hashing, setHashing] = useState(false);
  const [network, setNetwork] = useState<NetworkStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [wallet, setWallet] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [confirmedBlock, setConfirmedBlock] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"hash" | "transaction" | null>(null);

  useEffect(() => {
    const draft = loadInjectiveProofDraft();
    if (!draft) return;
    setSource(draft);
    setReport(draft.content);
  }, []);

  useEffect(() => {
    let active = true;
    void apiGet<NetworkStatus>("/api/v1/injective/status")
      .then((value) => { if (active) setNetwork(value); })
      .catch(() => { if (active) setNetwork({ ok: false, network: "Injective EVM Testnet", message: "暂时无法读取网络状态" }); });
    return () => { active = false; };
  }, []);

  const canonicalReport = useMemo(() => canonicalizeReport(report), [report]);

  useEffect(() => {
    let active = true;
    if (!canonicalReport) {
      setProofHash("");
      setHashing(false);
      return;
    }
    setHashing(true);
    void sha256Hex(canonicalReport).then((value) => {
      if (active) setProofHash(value);
    }).finally(() => {
      if (active) setHashing(false);
    });
    return () => { active = false; };
  }, [canonicalReport]);

  const busy = ["connecting", "switching", "signing", "confirming"].includes(phase);

  function changeReport(value: string) {
    setReport(value);
    if (transactionHash) {
      setTransactionHash("");
      setConfirmedBlock(null);
      setWallet("");
      setPhase("idle");
    }
    setError("");
  }

  async function copy(value: string, target: "hash" | "transaction") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(() => setCopied(null), 1_600);
    } catch {
      setError("浏览器不允许访问剪贴板，请手动复制。 ");
    }
  }

  async function anchorReport() {
    setError("");
    if (!canonicalReport) {
      setError("请先输入需要存证的 AI 报告。 ");
      return;
    }

    try {
      const provider = getProvider();
      if (!provider) throw new Error("NO_WALLET");
      setPhase("connecting");
      const requestedAccounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      if (!Array.isArray(requestedAccounts) || !requestedAccounts[0]) throw new Error("钱包没有返回可用账户");

      setPhase("switching");
      await ensureInjectiveTestnet(provider);
      const accounts = await provider.request({ method: "eth_accounts" }) as string[];
      const account = accounts?.[0] ?? requestedAccounts[0];
      setWallet(account);

      const hash = await sha256Hex(canonicalReport);
      setProofHash(hash);
      const balance = await provider.request({ method: "eth_getBalance", params: [account, "latest"] });
      if (typeof balance !== "string" || !/^0x[\da-f]+$/iu.test(balance) || BigInt(balance) === BigInt(0)) throw new Error("NO_TEST_INJ");

      setPhase("signing");
      const result = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: account, value: "0x0", data: buildProofCalldata(hash) }],
      });
      if (typeof result !== "string") throw new Error("钱包没有返回交易哈希");
      setTransactionHash(result);
      setPhase("confirming");

      const receipt = await waitForReceipt(provider, result);
      if (!receipt) {
        setPhase("submitted");
        return;
      }
      if (receipt.status !== "0x1") {
        setPhase("failed");
        setError("交易已上链，但 EVM 执行状态为失败。 ");
        return;
      }
      setConfirmedBlock(receipt.blockNumber ? Number.parseInt(receipt.blockNumber, 16) : null);
      setPhase("confirmed");
    } catch (caught) {
      setPhase("idle");
      setError(errorMessage(caught));
    }
  }

  return (
    <InjectiveProofView
      report={report}
      source={source}
      proofHash={proofHash}
      hashing={hashing}
      network={network}
      phase={phase}
      wallet={wallet}
      transactionHash={transactionHash}
      confirmedBlock={confirmedBlock}
      error={error}
      copied={copied}
      busy={busy}
      characterCount={canonicalReport.length}
      exampleReport={EXAMPLE_REPORT}
      onReportChange={changeReport}
      onCopy={(value, target) => void copy(value, target)}
      onAnchor={() => void anchorReport()}
    />
  );
}
