"use client";

import {
  ArrowRight,
  Check,
  CircleCheck,
  Copy,
  ExternalLink,
  FileLock2,
  Fingerprint,
  LoaderCircle,
  Radio,
  RotateCcw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/features/frontend-migration/api";
import {
  buildProofCalldata,
  canonicalizeReport,
  INJECTIVE_CHAIN_ID,
  INJECTIVE_CHAIN_ID_HEX,
  INJECTIVE_EXPLORER_URL,
  INJECTIVE_FAUCET_URL,
  INJECTIVE_RPC_URL,
  loadInjectiveProofDraft,
  sha256Hex,
  type InjectiveProofDraft,
} from "@/lib/injective-proof";

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

type NetworkStatus = {
  ok: boolean;
  network: string;
  chainId?: number;
  latestBlock?: number;
  checkedAt?: string;
  message?: string;
};

type Receipt = { status?: string; blockNumber?: string };
type Phase = "idle" | "connecting" | "switching" | "signing" | "confirming" | "submitted" | "confirmed" | "failed";

const EXAMPLE_REPORT = `Money Whisperer AI 投资建议摘要

当前组合风险集中度偏高，建议降低单一行业暴露，保留必要现金缓冲，并通过分批调整控制执行风险。

本报告用于研究、解释和模拟，不构成投资建议。`;

const PHASE_LABELS: Record<Phase, string> = {
  idle: "等待存证",
  connecting: "连接钱包",
  switching: "切换网络",
  signing: "等待签名",
  confirming: "链上确认中",
  submitted: "已提交",
  confirmed: "存证完成",
  failed: "执行失败",
};

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
      if (typeof balance !== "string" || !/^0x[\da-f]+$/iu.test(balance) || BigInt(balance) === 0n) throw new Error("NO_TEST_INJ");

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
    <div className="mx-auto max-w-6xl">
      <section className="relative isolate overflow-hidden border border-neutral-800 bg-[#07100f] px-6 py-7 text-white shadow-[0_30px_80px_rgba(6,18,18,0.18)] md:px-10 md:py-10">
        <div className="absolute inset-0 -z-10 opacity-60" style={{ backgroundImage: "linear-gradient(rgba(61,236,218,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(61,236,218,.06) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
        <div className="absolute -right-20 -top-28 -z-10 size-80 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="grid items-end gap-8 lg:grid-cols-[1fr_310px]">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-300">
              <Fingerprint className="size-4" /> Money Whisperer × Injective
            </div>
            <h1 className="mt-5 max-w-3xl font-serif text-4xl leading-[1.05] tracking-[-0.035em] md:text-6xl">给 AI 报告一枚<br /><span className="text-cyan-300">不可篡改的时间戳</span></h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-neutral-300">报告原文留在浏览器，只把 32 字节 SHA-256 指纹写入 Injective EVM Testnet。任何人都能验证完整性，却无法从链上读出你的报告。</p>
          </div>
          <div className="border-l border-cyan-300/20 pl-5 font-mono text-xs text-neutral-400">
            <p className="text-cyan-300">NOTARY NETWORK</p>
            <div className="mt-4 flex items-center justify-between"><span>CHAIN</span><b className="text-white">INJECTIVE / {INJECTIVE_CHAIN_ID}</b></div>
            <div className="mt-3 flex items-center justify-between"><span>STATUS</span><b className={network?.ok ? "text-emerald-300" : network ? "text-amber-300" : "text-neutral-300"}>{network?.ok ? "LIVE" : network ? "DEGRADED" : "CHECKING"}</b></div>
            <div className="mt-3 flex items-center justify-between"><span>BLOCK</span><b className="text-white">{network?.latestBlock?.toLocaleString() ?? "—"}</b></div>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
        <section className="paper-card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 md:px-7">
            <div>
              <p className="eyebrow"><FileLock2 className="size-3.5" /> 待存证文档</p>
              <h2 className="mt-1 text-lg font-semibold">{source?.sourceLabel ?? "AI 报告正文"}</h2>
            </div>
            {source ? <div className="text-right text-[11px] leading-5 text-muted-foreground"><p>已从平台安全带入</p><p>{new Date(source.capturedAt).toLocaleString("zh-CN")}</p></div> : null}
          </div>

          <div className="p-5 md:p-7">
            <label htmlFor="injective-report" className="sr-only">需要存证的 AI 报告</label>
            <textarea
              id="injective-report"
              value={report}
              onChange={(event) => changeReport(event.target.value)}
              placeholder="粘贴 Money Whisperer 生成的报告，或从 Advisor 回答下方的存证入口自动带入…"
              className="min-h-72 w-full resize-y border border-border bg-white/55 p-4 font-mono text-sm leading-7 text-foreground outline-none transition focus:border-cyan-700 focus:ring-2 focus:ring-cyan-700/10"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{canonicalReport.length.toLocaleString()} 字符 · UTF-8 标准化</span>
              {!report ? <button type="button" onClick={() => changeReport(EXAMPLE_REPORT)} className="inline-flex items-center gap-1.5 font-medium text-cyan-800 hover:text-cyan-600"><RotateCcw className="size-3.5" />载入演示报告</button> : null}
            </div>

            <div className="mt-6 border border-cyan-900/15 bg-cyan-950/[0.035] p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-900">SHA-256 Fingerprint</span>
                {proofHash ? <button type="button" onClick={() => void copy(proofHash, "hash")} className="grid size-8 place-items-center border border-border bg-background text-muted-foreground transition hover:border-cyan-700 hover:text-cyan-800" aria-label="复制报告哈希">{copied === "hash" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</button> : null}
              </div>
              <p className="mt-3 min-h-10 break-all font-mono text-xs leading-5 text-foreground">{hashing ? "正在本地计算…" : proofHash || "输入报告后自动生成指纹"}</p>
            </div>

            {error ? <div role="alert" className="mt-4 border border-red-300 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">{error}</div> : null}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void anchorReport()} disabled={busy || hashing || !proofHash} className="group inline-flex min-h-12 items-center gap-3 bg-[#07100f] px-5 text-sm font-semibold text-white transition hover:bg-cyan-950 disabled:cursor-not-allowed disabled:opacity-45">
                {busy ? <LoaderCircle className="size-4 animate-spin text-cyan-300" /> : phase === "confirmed" ? <CircleCheck className="size-4 text-cyan-300" /> : <Wallet className="size-4 text-cyan-300" />}
                {busy ? PHASE_LABELS[phase] : phase === "confirmed" ? "重新存证" : "连接钱包并存证"}
                {!busy ? <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /> : null}
              </button>
              <a href={INJECTIVE_FAUCET_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center gap-2 border border-border px-4 text-sm font-medium transition hover:border-cyan-800 hover:text-cyan-800">领取测试 INJ <ExternalLink className="size-3.5" /></a>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="border border-neutral-800 bg-neutral-950 p-5 text-neutral-100 shadow-[8px_8px_0_rgba(8,145,139,0.12)] md:p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Proof receipt</p>
              <span className={`size-2 rounded-full ${phase === "confirmed" ? "bg-emerald-400 shadow-[0_0_14px_#34d399]" : busy ? "animate-pulse bg-cyan-300" : "bg-neutral-600"}`} />
            </div>
            <h2 className="mt-3 text-xl font-semibold">{PHASE_LABELS[phase]}</h2>
            <div className="mt-6 space-y-5 border-t border-neutral-800 pt-5 font-mono text-[11px] leading-5">
              <ReceiptRow label="WALLET" value={wallet || "—"} />
              <ReceiptRow label="PAYLOAD" value={proofHash ? `MWP1 · ${proofHash.slice(0, 12)}…${proofHash.slice(-8)}` : "—"} />
              <ReceiptRow label="VALUE" value="0 INJ" />
              <ReceiptRow label="BLOCK" value={confirmedBlock?.toLocaleString() ?? "—"} />
            </div>
            {transactionHash ? (
              <div className="mt-6 border-t border-neutral-800 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="break-all font-mono text-[11px] leading-5 text-neutral-400">{transactionHash}</p>
                  <button type="button" onClick={() => void copy(transactionHash, "transaction")} className="shrink-0 text-neutral-400 hover:text-cyan-300" aria-label="复制交易哈希">{copied === "transaction" ? <Check className="size-4" /> : <Copy className="size-4" />}</button>
                </div>
                <a href={`${INJECTIVE_EXPLORER_URL}/tx/${transactionHash}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200">在 Blockscout 核验 <ExternalLink className="size-3.5" /></a>
              </div>
            ) : null}
          </section>

          <section className="paper-card p-5 md:p-6">
            <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-cyan-800" /><p className="eyebrow">隐私边界</p></div>
            <ol className="mt-5 space-y-4 text-sm leading-6">
              <Step number="01" title="本地生成指纹" detail="原文不离开浏览器" />
              <Step number="02" title="钱包签名" detail="确认网络与 0 INJ 交易" />
              <Step number="03" title="公开核验" detail="Blockscout 留下时间与哈希" />
            </ol>
            <div className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-xs leading-5 text-muted-foreground"><Radio className="mt-0.5 size-3.5 shrink-0 text-cyan-800" /><span>区块链交易不可撤销。仅使用测试网，正文、持仓和身份信息不会写入链上。</span></div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return <div><p className="text-neutral-600">{label}</p><p className="mt-1 break-all text-neutral-200">{value}</p></div>;
}

function Step({ number, title, detail }: { number: string; title: string; detail: string }) {
  return <li className="grid grid-cols-[30px_1fr] gap-3"><span className="font-mono text-xs text-cyan-800">{number}</span><div><p className="font-semibold text-foreground">{title}</p><p className="text-xs text-muted-foreground">{detail}</p></div></li>;
}
