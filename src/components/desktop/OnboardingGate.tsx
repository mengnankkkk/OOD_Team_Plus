"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet, apiPost } from "@/features/frontend-migration/api";
import { useAuth } from "@/hooks/useAuth";
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

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

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
  const [open, setOpen] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [profileForm, setProfileForm] = useState<OnboardingProfile>(initialProfile);
  const [goalForm, setGoalForm] = useState<OnboardingGoal>(initialGoal);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [saving, setSaving] = useState(false);

  const needsOnboarding = Boolean(user && !loading && profile && !profile.onboardingCompleted);
  const currentQuestion = questions[questionIndex];
  const progress = step === 0 ? ((questionIndex + 1) / Math.max(questions.length, 1)) * 100 : step === 1 ? 66 : 100;

  useEffect(() => {
    if (!needsOnboarding) {
      setOpen(false);
      return;
    }
    setOpen(true);
  }, [needsOnboarding]);

  useEffect(() => {
    if (!open || questions.length > 0) return;
    setLoadingQuestions(true);
    void apiGet<{ version: number; questions: Question[] }>("/api/v1/risk-questionnaire")
      .then((result) => setQuestions(result.questions))
      .catch((error) => toast.error(error instanceof Error ? error.message : "问卷加载失败"))
      .finally(() => setLoadingQuestions(false));
  }, [open, questions.length]);

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
    return "设置第一个理财目标";
  }, [step]);

  const updateProfile = <K extends keyof OnboardingProfile>(key: K, value: OnboardingProfile[K]) => {
    setProfileForm((current) => ({ ...current, [key]: value }));
  };

  const updateGoal = <K extends keyof OnboardingGoal>(key: K, value: OnboardingGoal[K]) => {
    setGoalForm((current) => ({ ...current, [key]: value }));
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
    if (Number(profileForm.monthlyExpense) > Number(profileForm.monthlyIncome)) {
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
    if (!goalForm.targetDate) {
      toast.error("请设置目标日期");
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (!validateGoal() || !user) return;
    setSaving(true);
    try {
      await apiPost("/api/v1/onboarding/complete", {
        answers,
        profile: {
          displayName: profileForm.displayName.trim() || undefined,
          age: profileForm.age ? Number(profileForm.age) : null,
          household: profileForm.household.trim() || null,
          monthlyIncome: profileForm.monthlyIncome.trim(),
          monthlyExpense: profileForm.monthlyExpense.trim(),
          liabilities: profileForm.liabilities.trim(),
          emergencyTargetMonths: Number(profileForm.emergencyTargetMonths),
          investmentAmount: profileForm.investmentAmount.trim(),
          horizon: profileForm.horizon,
          maxDrawdown: profileForm.maxDrawdown,
        },
        goal: {
          name: goalForm.name.trim(),
          targetAmount: goalForm.targetAmount.trim(),
          targetDate: goalForm.targetDate,
          priority: goalForm.priority,
          assetPreference: goalForm.assetPreference,
        },
      });
      await refreshProfile();
      setOpen(false);
      toast.success("建档完成，接下来 Agent 会按你的目标和风险等级工作");
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
                为了避免给出不适合你的建议，需要先完成一次适当性测评和一个目标设置。问卷不会决定收益，只用于控制建议的风险边界。
              </DialogDescription>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 sm:mt-6">
            {["风险测评", "财务档案", "投资目标"].map((label, index) => (
              <div key={label} className="flex min-w-0 flex-1 items-center gap-2">
                <div className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${step > index ? "bg-primary text-primary-foreground" : step === index ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-muted text-muted-foreground"}`}>
                  {step > index ? <Check className="size-4" /> : index + 1}
                </div>
                <span className={`truncate text-xs ${step === index ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</span>
                {index < 2 ? <div className="h-px flex-1 bg-border" /> : null}
              </div>
            ))}
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted sm:mt-4"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
        </DialogHeader>

        <div data-testid="onboarding-content" className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-6 md:px-8">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">STEP {step + 1} / 3</p>
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
        </div>

        <div className="z-10 flex shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-4 md:px-8">
          <Button variant="ghost" onClick={() => step === 0 ? undefined : step === 1 ? setStep(0) : setStep(1)} disabled={saving || step === 0}>
            <ChevronLeft className="size-4" />上一步
          </Button>
          {step < 2 ? (
            <Button onClick={() => { if (step === 0) nextQuestion(); else if (validateProfile()) setStep(2); }} disabled={saving || loadingQuestions || !currentQuestion}>
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
