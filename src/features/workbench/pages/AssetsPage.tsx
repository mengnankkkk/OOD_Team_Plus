import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { PlusCircle, RefreshCw, Trash2, Upload } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useHoldings, useHoldingsInvalidator } from "@/hooks/useHoldings";
import { useUserGoals } from "@/hooks/useUserGoals";
import { bulkCreateHoldings, createHolding, deleteHolding, parseHoldingsCsv } from "@/services/holdingsService";
import { ASSET_CLASS_LABEL, type AssetClass, type HoldingInput } from "@/types/app/asset";
import { computeHealthMetrics } from "@/lib/financialHealth";
import AssetOverviewPanel from "@/components/desktop/AssetOverviewPanel";
import DrawdownChart from "@/components/desktop/DrawdownChart";
import AShareInstrumentPicker from "@/components/desktop/AShareInstrumentPicker";
import { apiPost } from "@/features/frontend-migration/api";
import { findAShareStock, normalizeAShareCode } from "@/lib/a-share-stocks";
import { ArtifactLibrary } from "@/features/workbench/components/ArtifactLibrary";

const CLASS_OPTIONS: AssetClass[] = ["cash", "money_market", "bond_fund", "equity_fund", "index_fund", "stock", "other"];

const AssetsPage = () => {
  const { user, profile } = useAuth();
  const { data: holdings = [], isLoading } = useHoldings();
  const { data: goals = [] } = useUserGoals();
  const invalidate = useHoldingsInvalidator();

  const metrics = useMemo(() => (holdings.length ? computeHealthMetrics(holdings, profile, goals) : null), [holdings, profile, goals]);

  const [addOpen, setAddOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvParsing, setCsvParsing] = useState(false);
  const [csvPreview, setCsvPreview] = useState<HoldingInput[] | null>(null);

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("equity_fund");
  const [industry, setIndustry] = useState("");
  const [quantity, setQuantity] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [goalId, setGoalId] = useState<string>("__none__");
  const [catalogSyncing, setCatalogSyncing] = useState(false);

  const resetForm = () => {
    setName(""); setSymbol(""); setAssetClass("equity_fund"); setIndustry("");
    setQuantity(""); setCurrentPrice(""); setCostBasis(""); setGoalId("__none__");
  };

  const handleAdd = async () => {
    if (!user) return;
    const matched = findAShareStock(symbol) ?? findAShareStock(name);
    const finalName = matched?.name ?? name.trim();
    const finalSymbol = matched?.code ?? normalizeAShareCode(symbol.trim());
    if (!finalName || !quantity || !currentPrice) { toast.error("请至少填写名称、数量、当前价格"); return; }
    try {
      await createHolding(user.id, {
        name: finalName,
        symbol: finalSymbol || undefined,
        assetClass: matched ? "stock" : assetClass,
        industry: matched ? industry.trim() || "A股" : industry.trim() || null,
        quantity: Number(quantity),
        currentPrice: Number(currentPrice),
        costBasis: costBasis ? Number(costBasis) : 0,
        goalId: goalId === "__none__" ? null : goalId,
      });
      toast.success("持仓已加入你的账本");
      resetForm();
      setAddOpen(false);
      invalidate();
    } catch (err: any) {
      toast.error(err?.message ?? "保存失败");
    }
  };

  const handleParseCsv = async () => {
    if (!csvText.trim()) { toast.error("请粘贴 CSV 内容或按下方格式录入"); return; }
    setCsvParsing(true);
    try {
      const parsed = await parseHoldingsCsv(csvText);
      if (!parsed.length) { toast.error("Agent 解析后没有拿到有效持仓"); return; }
      setCsvPreview(parsed);
    } catch (err: any) {
      toast.error(err?.message ?? "解析失败");
    } finally {
      setCsvParsing(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!user || !csvPreview?.length) return;
    try {
      const n = await bulkCreateHoldings(user.id, csvPreview);
      toast.success(`已导入 ${n} 条持仓`);
      setCsvOpen(false); setCsvText(""); setCsvPreview(null);
      invalidate();
    } catch (err: any) {
      toast.error(err?.message ?? "导入失败");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!user) return;
    if (!confirm(`删除持仓「${name}」吗？`)) return;
    try {
      await deleteHolding(user.id, id);
      toast.success("已删除");
      invalidate();
    } catch (err: any) {
      toast.error(err?.message ?? "删除失败");
    }
  };

  const handleCatalogSync = async () => {
    setCatalogSyncing(true);
    try {
      const result = await apiPost<{ imported: number; summary: Array<{ method: string; rows: number; error?: string }> }>("/api/v1/instruments/sync", {});
      const failed = result.summary.filter((item) => item.error);
      toast.success(`资产目录已更新，写入 ${result.imported.toLocaleString()} 条标的${failed.length ? `，${failed.length} 个数据源待重试` : ""}`);
    } catch (err: any) {
      toast.error(err?.message ?? "资产目录同步失败");
    } finally {
      setCatalogSyncing(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">  资产</p>
          <h1 className="mt-2 text-3xl font-semibold">你的账本 · 全部持仓</h1>
          <p className="mt-2 text-sm text-muted-foreground">财务健康指标全部按当前持仓实时计算，服务端只返回你自己的数据。</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
          <Button variant="outline" className="w-full rounded-sm sm:w-auto" onClick={handleCatalogSync} disabled={catalogSyncing} title="同步 A 股、基金、指数、港股、美股基础资料">
            <RefreshCw className={`size-4 ${catalogSyncing ? "animate-spin" : ""}`} />{catalogSyncing ? "同步中…" : "更新资产目录"}
          </Button>
          <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
            <DialogTrigger asChild><Button variant="outline" className="w-full rounded-sm sm:w-auto"><Upload className="size-4" />智能体解析 CSV</Button></DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>粘贴持仓明细，让 Agent 解析</DialogTitle></DialogHeader>
              {!csvPreview ? (
                <>
                  <Textarea rows={10} value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder={`可以直接粘贴表格，例如：\n\n名称,代码,类别,数量,单价,行业\n招商中证白酒,161725,权益基金,1200,1.15,消费\n易方达创新医药,1300,权益基金,5000,0.78,医药\n招商中债,000000,债券基金,3000,1.12,\n余额宝,,货币基金,80000,1,\n`} />
                  <p className="mt-2 text-xs text-muted-foreground">列名可以中英混排、单位不统一，Agent 会智能纠正并合并同一标的多行。</p>
                </>
              ) : (
                <div className="max-h-[420px] overflow-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted"><tr><th className="p-2 text-left">名称</th><th className="p-2 text-left">类别</th><th className="p-2 text-left">行业</th><th className="p-2 text-right">数量</th><th className="p-2 text-right">单价</th></tr></thead>
                    <tbody>
                      {csvPreview.map((h, i) => (
                        <tr key={i} className="border-t border-border"><td className="p-2">{h.name}</td><td className="p-2">{ASSET_CLASS_LABEL[h.assetClass]}</td><td className="p-2 text-muted-foreground">{h.industry ?? "—"}</td><td className="p-2 text-right font-mono">{h.quantity}</td><td className="p-2 text-right font-mono">{h.currentPrice}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <DialogFooter>
                {!csvPreview ? <Button onClick={handleParseCsv} disabled={csvParsing}>{csvParsing ? "Agent 解析中…" : "解析"}</Button> : <>
                  <Button variant="ghost" onClick={() => setCsvPreview(null)}>重新解析</Button>
                  <Button onClick={handleConfirmImport}>确认导入 {csvPreview.length} 条</Button>
                </>}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild><Button className="w-full rounded-sm sm:w-auto"><PlusCircle className="size-4" />手工录入</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>新增持仓</DialogTitle></DialogHeader>
              <div className="grid gap-4">
                <AShareInstrumentPicker
                  name={name}
                  symbol={symbol}
                  symbolLabel="代码（可选）"
                  namePlaceholder="招商中证白酒 / 沪深300ETF / 贵州茅台"
                  symbolPlaceholder="161725 / 600519"
                  onChange={(next) => { setName(next.name); setSymbol(next.symbol); }}
                  onSelect={(instrument) => {
                    const type = instrument.assetType.toLowerCase();
                    setAssetClass(type === "index" ? "index_fund" : type === "bond" ? "bond_fund" : type === "money_market" ? "money_market" : type === "fund" ? "equity_fund" : "stock");
                    setIndustry((current) => current.trim() || instrument.sector || (instrument.market === "HK" ? "港股" : instrument.market === "US" ? "美股" : "A股"));
                  }}
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="space-y-2"><Label>资产类别</Label>
                    <Select value={assetClass} onValueChange={(v) => setAssetClass(v as AssetClass)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CLASS_OPTIONS.map((c) => <SelectItem key={c} value={c}>{ASSET_CLASS_LABEL[c]}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label htmlFor="holding-industry">行业（权益类可选）</Label><Input id="holding-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="消费 / 医药 / 科技" /></div>
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="space-y-2"><Label htmlFor="holding-quantity">持有数量 / 份额</Label><Input id="holding-quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="holding-price">当前单价 / 净值</Label><Input id="holding-price" type="number" value={currentPrice} onChange={(e) => setCurrentPrice(e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="holding-cost">成本（可选）</Label><Input id="holding-cost" type="number" value={costBasis} onChange={(e) => setCostBasis(e.target.value)} /></div>
                </div>
                <div className="space-y-2"><Label>关联目标（可选）</Label>
                  <Select value={goalId} onValueChange={setGoalId}>
                    <SelectTrigger><SelectValue placeholder="选择一个目标" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">未关联</SelectItem>
                      {goals.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter><Button variant="ghost" onClick={() => { resetForm(); setAddOpen(false); }}>取消</Button><Button onClick={handleAdd}>保存</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <AssetOverviewPanel metrics={metrics} profile={profile} loading={isLoading} />
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <DrawdownChart metrics={metrics} loading={isLoading} />
        <FinancialHealthReport metrics={metrics} loading={isLoading} />
      </div>
      <ArtifactLibrary embedded />
      <section className="paper-card mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div><p className="eyebrow">持仓明细</p><h2 className="mt-1 text-lg font-semibold">{holdings.length} 笔持仓 · 总市值 ¥{Math.round(metrics?.totalAssets ?? 0).toLocaleString("zh-CN")}</h2></div>
        </div>
        {holdings.length === 0 ? (
          <div className="grid place-items-center p-12 text-center text-sm text-muted-foreground">
            <p>还没有持仓。手工录入一笔，或粘贴任意平台的 CSV，让 Agent 帮你解析。</p>
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="p-4">名称</th><th className="p-4">类别</th><th className="p-4">行业</th><th className="p-4 text-right">数量</th><th className="p-4 text-right">单价</th><th className="p-4 text-right">市值</th><th className="p-4 text-right">占比</th><th className="p-4"></th></tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const ratio = metrics && metrics.totalAssets > 0 ? h.marketValue / metrics.totalAssets : 0;
                  const isTop = metrics?.concentration.topClass === h.assetClass && ratio > 0.1;
                  return (
                    <tr key={h.id} className={`border-t border-border ${isTop ? "border-l-4 border-l-destructive" : ""}`}>
                      <td className="p-4"><div className="font-medium">{h.name}</div><div className="text-xs text-muted-foreground">{h.symbol}</div></td>
                      <td className="p-4">{ASSET_CLASS_LABEL[h.assetClass]}</td>
                      <td className="p-4 text-muted-foreground">{h.industry ?? "—"}</td>
                      <td className="p-4 text-right font-mono">{h.quantity.toLocaleString()}</td>
                      <td className="p-4 text-right font-mono">¥{h.currentPrice.toFixed(2)}</td>
                      <td className="p-4 text-right font-mono">¥{Math.round(h.marketValue).toLocaleString()}</td>
                      <td className="p-4 text-right font-mono">{Math.round(ratio * 100)}%</td>
                      <td className="p-4 text-right"><Button variant="ghost" size="icon" onClick={() => handleDelete(h.id, h.name)}><Trash2 className="size-4 text-muted-foreground" /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default AssetsPage;

function FinancialHealthReport({ metrics, loading }: { metrics: ReturnType<typeof computeHealthMetrics> | null; loading: boolean }) {
  if (loading) return <section className="paper-card grid min-h-48 place-items-center p-6 text-sm text-muted-foreground">正在生成财务健康分析...</section>;
  const topAllocation = metrics?.allocation[0] ?? null;
  const total = Math.round(metrics?.totalAssets ?? 0).toLocaleString("zh-CN");
  const drawdown = Math.round((metrics?.drawdown ?? 0) * 100);
  const goalCoverage = metrics?.goalCoverage == null ? "目标资料不足" : `${Math.round(metrics.goalCoverage * 100)}%`;
  const concentration = topAllocation ? `${topAllocation.label} ${Math.round(topAllocation.ratio * 100)}%` : "暂无配置数据";
  const riskTone = (metrics?.concentration.topClassRatio ?? 0) > 0.4 || (metrics?.drawdown ?? 0) > 0.2 ? "需要关注" : "整体可控";

  return (
    <section className="paper-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">财务报告 · 健康分析</p>
          <h2 className="mt-2 text-lg font-semibold">当前资产画像：{riskTone}</h2>
        </div>
        <span className="rounded border border-border px-2 py-1 font-mono text-xs text-muted-foreground">¥{total}</span>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="border border-border p-3"><p className="text-xs text-muted-foreground">主资产暴露</p><p className="mt-1 font-semibold">{concentration}</p></div>
        <div className="border border-border p-3"><p className="text-xs text-muted-foreground">估算最大回撤</p><p className="mt-1 font-semibold">-{drawdown}%</p></div>
        <div className="border border-border p-3"><p className="text-xs text-muted-foreground">目标覆盖</p><p className="mt-1 font-semibold">{goalCoverage}</p></div>
      </div>
      <p className="mt-5 text-sm leading-6 text-muted-foreground">
        系统按当前持仓、资产类别、目标和风险档案即时生成健康判断。若集中度超过 40% 或回撤超过 20%，资产页会直接提示需要复核的风险来源。
      </p>
    </section>
  );
}
