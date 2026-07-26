"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, ShieldCheck, Trash2 } from "lucide-react";

import AShareInstrumentPicker from "@/components/desktop/AShareInstrumentPicker";
import type { InstrumentSearchResult } from "@/components/desktop/AShareInstrumentPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet, apiPost } from "@/features/frontend-migration/api";
import { useAuth } from "@/hooks/useAuth";
import { useHoldingsInvalidator } from "@/hooks/useHoldings";
import { horizonFromAnswer, maxDrawdownFromAnswer } from "@/lib/risk-assessment";
import { toast } from "sonner";

type Question = {
  id: string;
  prompt: string;
  helper?: string;
  options: Array<{ value: string; label: string }>;
};

type OnboardingProfile = {
  displayName: string;
  age: string;
  household: string;
  monthlyIncome: string;
  monthlyExpense: string;
  liabilities: string;
  emergencyTargetMonths: string;
  investmentAmount: string;
  horizon: "SHORT" | "MEDIUM" | "LONG";
  maxDrawdown: string;
};

type OnboardingGoal = {
  name: string;
  targetAmount: string;
  targetDate: string;
  priority: "1" | "2" | "3" | "4" | "5";
  assetPreference: "STOCK" | "SECTOR" | "INDEX";
};

type OnboardingHolding = {
  id: string;
  name: string;
  symbol: string;
  assetType: string;
  market?: string;
  sector?: string | null;
  quantity: string;
  cost: string;
};

const initialProfile: OnboardingProfile = {
  displayName: "",
  age: "",
  household: "",
  monthlyIncome: "",
  monthlyExpense: "",
  liabilities: "0",
  emergencyTargetMonths: "6",
  investmentAmount: "",
  horizon: "LONG",
  maxDrawdown: "0.20",
};

const initialGoal: OnboardingGoal = {
  name: "我的首要投资目标",
  targetAmount: "",
  targetDate: "",
  priority: "1",
  assetPreference: "INDEX",
};

function emptyHolding(id: string): OnboardingHolding {
  return { id, name: "", symbol: "", assetType: "stock", quantity: "", cost: "" };
}

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

function normalizeMoney(value: string): string {
  return value.trim().replace(/[,\s，￥¥元]/gu, "");
}

function isValidMoney(value: string, options: { allowZero?: boolean } = {}): boolean {
  const normalized = normalizeMoney(value);
  if (!/^\d+(\.\d{1,2})?$/u.test(normalized)) return false;
  return options.allowZero ? Number(normalized) >= 0 : Number(normalized) > 0;
}

function instrumentTypeForResolve(value: string): "stock" | "fund" | "index" | "bond" | "cash" | "other" {
  const type = value.toLowerCase();
  if (type.includes("index") || type.includes("etf")) return "index";
  if (type.includes("fund")) return "fund";
  if (type.includes("bond")) return "bond";
  if (type.includes("cash") || type.includes("money_market")) return "cash";
  if (type.includes("stock")) return "stock";
  return "other";
}

function Field({ label, htmlFor, required, children }: { label: string; htmlFor?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</Label>
      {children}
    </div>
  );
}

export default function OnboardingGate() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const invalidateHoldings = useHoldingsInvalidator();
  const holdingIdRef = useRef(2);
  const refreshedUserIdRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [profileForm, setProfileForm] = useState<OnboardingProfile>(initialProfile);
  const [goalForm, setGoalForm] = useState<OnboardingGoal>(initialGoal);
  const [portfolioForm, setPortfolioForm] = useState<OnboardingHolding[]>([emptyHolding("holding-1")]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [saving, setSaving] = useState(false);

  const profileComplete = Boolean(profile?.onboardingCompleted);
  const needsOnboarding = Boolean(
    user
    && user.role !== "ADMIN"
    && !loading
    && profile
    && !profileComplete,
  );
  const currentQuestion = questions[questionIndex];
  const progress = step === 0 ? ((questionIndex + 1) / Math.max(questions.length, 1)) * 25 : (step + 1) * 25;

  useEffect(() => {
    if (!user || refreshedUserIdRef.current === user.id) return;
    refreshedUserIdRef.current = user.id;
    void refreshProfile().catch(() => undefined);
  }, [refreshProfile, user]);

  useEffect(() => {
    if (!needsOnboarding) {
      setOpen(false);
      return;
    }
    setOpen(true);
  }, [needsOnboarding]);

  useEffect(() => {
    if (!open || profileComplete || questions.length > 0) return;
    setLoadingQuestions(true);
    void apiGet<{ version: number; questions: Question[] }>("/api/v1/risk-questionnaire")
      .then((result) => setQuestions(result.questions))
      .catch((error) => toast.error(error instanceof Error ? error.message : "问卷加载失败"))
      .finally(() => setLoadingQuestions(false));
  }, [open, profileComplete, questions.length]);

  useEffect(() => {
    const displayName = user?.user_metadata?.display_name;
    if (displayName && !profileForm.displayName) {
      setProfileForm((current) => ({ ...current, displayName }));
    }
  }, [profileForm.displayName, user?.user_metadata?.display_name]);

  useEffect(() => {
    const horizonAnswer = answers.holding_horizon;
    const drawdownAnswer = answers.max_drawdown;
    if (!horizonAnswer && !drawdownAnswer) return;
    setProfileForm((current) => ({
      ...current,
      horizon: horizonAnswer ? horizonFromAnswer(horizonAnswer) : current.horizon,
      maxDrawdown: drawdownAnswer ? maxDrawdownFromAnswer(drawdownAnswer) : current.maxDrawdown,
    }));
  }, [answers.holding_horizon, answers.max_drawdown]);

  const stepTitle = useMemo(() => {
    if (step === 0) return "先了解你的风险承受能力";
    if (step === 1) return "补充你的财务基础";
    if (step === 2) return "设置第一个理财目标";
    return "录入你的当前组合";
  }, [step]);

  const updateProfile = <K extends keyof OnboardingProfile>(key: K, value: OnboardingProfile[K]) => {
    setProfileForm((current) => ({ ...current, [key]: value }));
  };

  const updateGoal = <K extends keyof OnboardingGoal>(key: K, value: OnboardingGoal[K]) => {
    setGoalForm((current) => ({ ...current, [key]: value }));
  };

  const updateHolding = (id: string, changes: Partial<OnboardingHolding>) => {
    setPortfolioForm((current) => current.map((holding) => holding.id === id ? { ...holding, ...changes } : holding));
  };

  const addHolding = () => {
    const id = `holding-${holdingIdRef.current++}`;
    setPortfolioForm((current) => [...current, emptyHolding(id)]);
  };

  const removeHolding = (id: string) => {
    setPortfolioForm((current) => current.length > 1 ? current.filter((holding) => holding.id !== id) : current);
  };

  const nextQuestion = () => {
    if (!currentQuestion || !answers[currentQuestion.id]) {
      toast.error("请选择一个答案后继续");
      return;
    }
    if (questionIndex < questions.length - 1) {
      setQuestionIndex((current) => current + 1);
      return;
    }
    setStep(1);
  };

  const validateProfile = () => {
    const required = [
      ["monthlyIncome", "月度收入"],
      ["monthlyExpense", "月度必要支出"],
      ["liabilities", "负债余额"],
      ["investmentAmount", "计划投资金额"],
    ] as const;
    const missing = required.find(([key]) => !profileForm[key].trim());
    if (missing) {
      toast.error(`请填写${missing[1]}`);
      return false;
    }
    if (profileForm.age.trim()) {
      const age = Number(profileForm.age);
      if (!Number.isInteger(age) || age < 18 || age > 100) {
        toast.error("请填写 18-100 之间的整数年龄");
        return false;
      }
    }
    const emergencyMonths = Number(profileForm.emergencyTargetMonths);
    if (!Number.isInteger(emergencyMonths) || emergencyMonths < 1 || emergencyMonths > 36) {
      toast.error("应急金覆盖月数需要在 1-36 之间");
      return false;
    }
    if (!isValidMoney(profileForm.monthlyIncome) || !isValidMoney(profileForm.investmentAmount)) {
      toast.error("月度收入和计划投资金额需要填写大于 0 的有效金额");
      return false;
    }
    if (!isValidMoney(profileForm.monthlyExpense, { allowZero: true }) || !isValidMoney(profileForm.liabilities, { allowZero: true })) {
      toast.error("月度必要支出和负债余额需要填写有效金额");
      return false;
    }
    if (Number(normalizeMoney(profileForm.monthlyExpense)) > Number(normalizeMoney(profileForm.monthlyIncome))) {
      toast.error("月度必要支出不能高于月度收入，请确认后再继续");
      return false;
    }
    return true;
  };

  const validateGoal = () => {
    if (!goalForm.name.trim()) {
      toast.error("请填写目标名称");
      return false;
    }
    if (!goalForm.targetAmount.trim() || Number(goalForm.targetAmount) <= 0) {
      toast.error("请填写有效的目标金额");
      return false;
    }
    if (!isValidMoney(goalForm.targetAmount)) {
      toast.error("目标金额需要填写大于 0 的有效金额");
      return false;
    }
    if (!goalForm.targetDate) {
      toast.error("请设置目标日期");
      return false;
    }
    return true;
  };

  const validatePortfolio = () => {
    if (portfolioForm.some((holding) => !holding.name.trim() || !holding.symbol.trim() || !holding.quantity.trim() || !holding.cost.trim())) {
      toast.error("请完整填写每笔持仓的标的、数量和成本价");
      return false;
    }
    if (portfolioForm.some((holding) => !isValidMoney(holding.quantity) || !isValidMoney(holding.cost, { allowZero: true }))) {
      toast.error("持有数量必须大于 0，持仓成本价不能为负数");
      return false;
    }
    const symbols = portfolioForm.map((holding) => holding.symbol.trim().toUpperCase());
    if (new Set(symbols).size !== symbols.length) {
      toast.error("同一标的请合并为一笔持仓");
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (!user || !validatePortfolio()) return;
    if (!profileComplete && (!validateProfile() || !validateGoal())) return;
    setSaving(true);
    try {
      const resolvedHoldings = await Promise.all(portfolioForm.map(async (holding) => {
        const instrument = await apiPost<InstrumentSearchResult>("/api/v1/instruments/resolve", {
          symbol: holding.symbol.trim(),
          name: holding.name.trim(),
          assetType: instrumentTypeForResolve(holding.assetType),
          market: holding.market,
          sector: holding.sector ?? undefined,
        });
        return {
          instrumentId: instrument.instrumentId,
          quantity: normalizeMoney(holding.quantity),
          cost: normalizeMoney(holding.cost),
        };
      }));
      const portfolio = { id: "portfolio-demo", holdings: resolvedHoldings };
      await apiPost("/api/v1/onboarding/complete", profileComplete ? { portfolio } : {
        answers,
        profile: {
          displayName: profileForm.displayName.trim() || undefined,
          age: profileForm.age ? Number(profileForm.age) : null,
          household: profileForm.household.trim() || null,
          monthlyIncome: normalizeMoney(profileForm.monthlyIncome),
          monthlyExpense: normalizeMoney(profileForm.monthlyExpense),
          liabilities: normalizeMoney(profileForm.liabilities),
          emergencyTargetMonths: Number(profileForm.emergencyTargetMonths),
          investmentAmount: normalizeMoney(profileForm.investmentAmount),
          horizon: profileForm.horizon,
          maxDrawdown: profileForm.maxDrawdown,
        },
        goal: {
          name: goalForm.name.trim(),
          targetAmount: normalizeMoney(goalForm.targetAmount),
          targetDate: goalForm.targetDate,
          priority: goalForm.priority,
          assetPreference: goalForm.assetPreference,
        },
        portfolio,
      });
      await Promise.all([refreshProfile(), invalidateHoldings()]);
      setOpen(false);
      toast.success(profileComplete ? "当前组合已补齐，顾问可以直接开始诊断" : "画像与组合已完成，接下来 Agent 会按你的真实情况工作");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建档失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  if (!needsOnboarding) return null;

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        className="h-[calc(100dvh-1rem)] max-h-[860px] w-[calc(100vw-1rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] [&>button]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b border-border bg-card px-4 pb-3 pt-4 sm:px-6 sm:pb-5 sm:pt-6 md:px-8">
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary sm:size-10"><ShieldCheck className="size-5" /></div>
            <div>
              <DialogTitle className="text-lg sm:text-xl">完成你的专属理财建档</DialogTitle>
              <DialogDescription className="mt-1.5 max-w-2xl leading-5 sm:mt-2 sm:leading-6">
                为了避免给出不适合你的建议，需要把风险画像、投资目标和当前持仓一次填完整。问卷不会决定收益，只用于控制建议的风险边界。
              </DialogDescription>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 sm:mt-6">
            {["风险测评", "财务档案", "投资目标", "当前组合"].map((label, index) => (
              <div key={label} className="flex min-w-0 flex-1 items-center gap-2">
                <div className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${step > index ? "bg-primary text-primary-foreground" : step === index ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-muted text-muted-foreground"}`}>
                  {step > index ? <Check className="size-4" /> : index + 1}
                </div>
                <span className={`truncate text-xs ${step === index ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</span>
                {index < 3 ? <div className="h-px flex-1 bg-border" /> : null}
              </div>
            ))}
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted sm:mt-4"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
        </DialogHeader>

        <div data-testid="onboarding-content" className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-6 md:px-8">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">STEP {step + 1} / 4</p>
            <h2 className="mt-1 text-lg font-semibold">{stepTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">带 <span className="text-destructive">*</span> 的字段为必填项。</p>
          </div>

          {step === 0 ? (
            loadingQuestions ? <div className="grid min-h-60 place-items-center text-sm text-muted-foreground">正在准备适当性测评…</div> : currentQuestion ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>问题 {questionIndex + 1} / {questions.length}</span>
                  <span>请按真实情况作答</span>
                </div>
                <div className="rounded-lg border border-border bg-card p-5 md:p-6">
                  <h3 className="text-base font-semibold leading-7">{currentQuestion.prompt}</h3>
                  {currentQuestion.helper ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{currentQuestion.helper}</p> : null}
                  <div className="mt-5 grid gap-3">
                    {currentQuestion.options.map((option) => {
                      const selected = answers[currentQuestion.id] === option.value;
                      return (
                        <button
                          type="button"
                          key={option.value}
                          onClick={() => setAnswers((current) => ({ ...current, [currentQuestion.id]: option.value }))}
                          className={`flex items-start gap-3 rounded-md border px-4 py-3 text-left text-sm leading-6 transition ${selected ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:border-primary/50 hover:bg-muted/40"}`}
                        >
                          <span className={`mt-1 grid size-4 shrink-0 place-items-center rounded-full border ${selected ? "border-primary bg-primary" : "border-muted-foreground/50"}`}>{selected ? <span className="size-1.5 rounded-full bg-primary-foreground" /> : null}</span>
                          <span>{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : <div className="grid min-h-60 place-items-center text-sm text-destructive">问卷加载失败，请刷新页面重试。</div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="称呼" htmlFor="onboarding-display-name"><Input id="onboarding-display-name" value={profileForm.displayName} onChange={(event) => updateProfile("displayName", event.target.value)} placeholder="例如：小林" /></Field>
              <Field label="年龄" htmlFor="onboarding-age"><Input id="onboarding-age" type="number" min="18" max="100" value={profileForm.age} onChange={(event) => updateProfile("age", event.target.value)} placeholder="例如：28" /></Field>
              <Field label="家庭责任 / 状况" htmlFor="onboarding-household"><Input id="onboarding-household" value={profileForm.household} onChange={(event) => updateProfile("household", event.target.value)} placeholder="例如：已婚，有房贷" /></Field>
              <Field label="应急金覆盖月数" htmlFor="onboarding-emergency" required><Input id="onboarding-emergency" type="number" min="1" max="36" value={profileForm.emergencyTargetMonths} onChange={(event) => updateProfile("emergencyTargetMonths", event.target.value)} /></Field>
              <Field label="月度收入（元）" htmlFor="onboarding-income" required><Input id="onboarding-income" type="number" min="0" value={profileForm.monthlyIncome} onChange={(event) => updateProfile("monthlyIncome", event.target.value)} placeholder="例如：20000" /></Field>
              <Field label="月度必要支出（元）" htmlFor="onboarding-expense" required><Input id="onboarding-expense" type="number" min="0" value={profileForm.monthlyExpense} onChange={(event) => updateProfile("monthlyExpense", event.target.value)} placeholder="例如：10000" /></Field>
              <Field label="负债余额（元）" htmlFor="onboarding-liabilities" required><Input id="onboarding-liabilities" type="number" min="0" value={profileForm.liabilities} onChange={(event) => updateProfile("liabilities", event.target.value)} /></Field>
              <Field label="本次计划投资金额（元）" htmlFor="onboarding-investment" required><Input id="onboarding-investment" type="number" min="1" value={profileForm.investmentAmount} onChange={(event) => updateProfile("investmentAmount", event.target.value)} placeholder="例如：50000" /></Field>
              <Field label="计划持有时间" htmlFor="onboarding-horizon" required>
                <select id="onboarding-horizon" className={selectClass} value={profileForm.horizon} onChange={(event) => updateProfile("horizon", event.target.value as OnboardingProfile["horizon"])}>
                  <option value="SHORT">短线：1 年以内</option><option value="MEDIUM">中线：1-3 年</option><option value="LONG">长线：3 年以上</option>
                </select>
              </Field>
              <Field label="最大可接受回撤" htmlFor="onboarding-drawdown" required>
                <select id="onboarding-drawdown" className={selectClass} value={profileForm.maxDrawdown} onChange={(event) => updateProfile("maxDrawdown", event.target.value)}>
                  <option value="0.10">10% 以内</option><option value="0.20">10%-20%</option><option value="0.30">20%-30%</option><option value="0.40">30% 以上</option>
                </select>
              </Field>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2 rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-6 text-muted-foreground">目标不是为了限制你，而是让 Agent 知道什么时候应该优先保护流动性、什么时候可以考虑长期增配。</div>
              <Field label="目标名称" htmlFor="onboarding-goal-name" required><Input id="onboarding-goal-name" value={goalForm.name} onChange={(event) => updateGoal("name", event.target.value)} placeholder="例如：三年后购房首付" /></Field>
              <Field label="目标金额（元）" htmlFor="onboarding-goal-amount" required><Input id="onboarding-goal-amount" type="number" min="1" value={goalForm.targetAmount} onChange={(event) => updateGoal("targetAmount", event.target.value)} placeholder="例如：300000" /></Field>
              <Field label="目标日期" htmlFor="onboarding-goal-date" required><Input id="onboarding-goal-date" type="date" value={goalForm.targetDate} onChange={(event) => updateGoal("targetDate", event.target.value)} /></Field>
              <Field label="目标优先级" htmlFor="onboarding-goal-priority" required>
                <select id="onboarding-goal-priority" className={selectClass} value={goalForm.priority} onChange={(event) => updateGoal("priority", event.target.value as OnboardingGoal["priority"])}>
                  <option value="1">最高优先</option><option value="2">高</option><option value="3">中</option><option value="4">低</option><option value="5">观察</option>
                </select>
              </Field>
              <Field label="更偏好的投资方向" htmlFor="onboarding-goal-preference" required>
                <select id="onboarding-goal-preference" className={selectClass} value={goalForm.assetPreference} onChange={(event) => updateGoal("assetPreference", event.target.value as OnboardingGoal["assetPreference"])}>
                  <option value="INDEX">宽基指数</option><option value="SECTOR">行业 ETF / 板块</option><option value="STOCK">个股</option>
                </select>
              </Field>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-6 text-muted-foreground">
                请至少录入一笔当前真实持仓。顾问会据此计算集中度、回撤和组合影响，后续可以在资产页继续补充或修改。
              </div>
              {portfolioForm.map((holding, index) => (
                <div key={holding.id} className="rounded-md border border-border bg-card p-4 sm:p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">持仓 {index + 1}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">按当前实际数量与平均成本填写</p>
                    </div>
                    {portfolioForm.length > 1 ? (
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeHolding(holding.id)} aria-label={`删除持仓 ${index + 1}`} title={`删除持仓 ${index + 1}`}>
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    ) : null}
                  </div>
                  <AShareInstrumentPicker
                    idPrefix={`onboarding-${holding.id}`}
                    name={holding.name}
                    symbol={holding.symbol}
                    searchLabel="搜索当前持仓"
                    symbolLabel="代码"
                    onChange={(next) => updateHolding(holding.id, {
                      name: next.name,
                      symbol: next.symbol,
                      assetType: next.stock?.assetType ?? holding.assetType,
                      market: next.stock?.market,
                      sector: next.stock?.sector ?? null,
                    })}
                  />
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="持有数量 / 份额" htmlFor={`onboarding-${holding.id}-quantity`} required>
                      <Input id={`onboarding-${holding.id}-quantity`} type="number" min="0" step="any" value={holding.quantity} onChange={(event) => updateHolding(holding.id, { quantity: event.target.value })} placeholder="例如：100" />
                    </Field>
                    <Field label="持仓成本价" htmlFor={`onboarding-${holding.id}-cost`} required>
                      <Input id={`onboarding-${holding.id}-cost`} type="number" min="0" step="any" value={holding.cost} onChange={(event) => updateHolding(holding.id, { cost: event.target.value })} placeholder="例如：12.50" />
                    </Field>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" className="w-full" onClick={addHolding}>
                <Plus className="size-4" />添加另一笔持仓
              </Button>
            </div>
          ) : null}
        </div>

        <div className="z-10 flex shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-4 md:px-8">
          <Button variant="ghost" onClick={() => step > 0 && setStep((current) => current - 1)} disabled={saving || step === 0 || (profileComplete && step === 3)}>
            <ChevronLeft className="size-4" />上一步
          </Button>
          {step < 3 ? (
            <Button
              onClick={() => {
                if (step === 0) nextQuestion();
                else if (step === 1 && validateProfile()) setStep(2);
                else if (step === 2 && validateGoal()) setStep(3);
              }}
              disabled={saving || (step === 0 && (loadingQuestions || !currentQuestion))}
            >
              {step === 0 && questionIndex < questions.length - 1 ? "下一题" : "进入下一步"}<ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button onClick={() => void submit()} disabled={saving}><Check className="size-4" />{saving ? "保存中…" : "完成建档并进入工作台"}</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
