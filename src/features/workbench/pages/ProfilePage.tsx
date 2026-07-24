import { useEffect, useState } from "react";
import { useNavigate } from "@/features/frontend-migration/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { updateProfile } from "@/services/profileService";
import { toast } from "sonner";
import { LogIn, LogOut, Target } from "lucide-react";
import type { RiskLevel } from "@/types/app/user";

const riskLevels: { value: RiskLevel; label: string }[] = [
  { value: "R1", label: "R1 · 稳健保本" },
  { value: "R2", label: "R2 · 谨慎型" },
  { value: "R3", label: "R3 · 平衡型" },
  { value: "R4", label: "R4 · 成长型" },
  { value: "R5", label: "R5 · 进取型" },
];

const ProfilePage = () => {
  const { user, profile, isAnonymous, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [age, setAge] = useState<string>("");
  const [household, setHousehold] = useState<string>("");
  const [monthlyIncome, setMonthlyIncome] = useState<string>("");
  const [monthlyExpense, setMonthlyExpense] = useState<string>("");
  const [liabilities, setLiabilities] = useState<string>("");
  const [emergencyMonths, setEmergencyMonths] = useState<string>("6");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("R3");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName ?? "");
    setAge(profile.age ? String(profile.age) : "");
    setHousehold(profile.household ?? "");
    setMonthlyIncome(profile.monthlyIncome !== null ? String(profile.monthlyIncome) : "");
    setMonthlyExpense(profile.monthlyExpense !== null ? String(profile.monthlyExpense) : "");
    setLiabilities(profile.liabilities !== null ? String(profile.liabilities) : "");
    setEmergencyMonths(String(profile.emergencyTargetMonths ?? 6));
    setRiskLevel(profile.riskLevel);
    setNotes(profile.behaviorNotes ?? "");
  }, [profile]);

  const parseNumber = (val: string) => (val.trim() === "" ? null : Number(val));

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await updateProfile(user.id, {
        displayName: displayName.trim() || undefined,
        age: age ? Number(age) : null,
        household: household || null,
        monthlyIncome: parseNumber(monthlyIncome),
        monthlyExpense: parseNumber(monthlyExpense),
        liabilities: parseNumber(liabilities),
        emergencyTargetMonths: Number(emergencyMonths) || 6,
        riskLevel,
        behaviorNotes: notes || null,
      });
      await refreshProfile();
      toast.success("财务档案已保存");
    } catch (err: any) {
      toast.error(err?.message ?? "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">我的</p>
          <h1 className="mt-2 text-3xl font-semibold">个人财务档案</h1>
          <p className="mt-2 text-sm text-muted-foreground">你的档案只对当前账号可见，服务端按用户切分数据，Agent 生成建议前会以此为准。</p>
        </div>
        {isAnonymous ? (
          <Button variant="outline" onClick={() => navigate("/login")} className="rounded-sm"><LogIn className="size-4" />绑定邮箱账号</Button>
        ) : (
          <Button variant="outline" onClick={() => { void signOut(); }} className="rounded-sm"><LogOut className="size-4" />退出登录</Button>
        )}
      </div>

      {isAnonymous && (
        <div className="mb-6 rounded-md border border-dashed border-border bg-card/60 px-5 py-4 text-sm text-muted-foreground">
          当前为游客模式，你在本页保存的资料、以及在其他页面录入的资产、建议与提醒，均存在到当前浏览器的临时账号上。如需跨设备同步或长期保留，可以后续绑定邮箱账号。
        </div>
      )}

      <section className="paper-card p-6 md:p-8">
        <p className="eyebrow">基本信息</p>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="profile-display-name">称呼</Label><Input id="profile-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="想让我怎么称呼你" /></div>
          <div className="space-y-2"><Label htmlFor="profile-age">年龄</Label><Input id="profile-age" type="number" value={age} onChange={(e) => setAge(e.target.value)} placeholder="例如 28" /></div>
          <div className="space-y-2 md:col-span-2"><Label htmlFor="profile-household">家庭责任 / 状况</Label><Input id="profile-household" value={household} onChange={(e) => setHousehold(e.target.value)} placeholder="例如 单身 / 已婚有孩 / 赡养父母" /></div>
        </div>

        <p className="eyebrow mt-8">现金流与负债</p>
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          <div className="space-y-2"><Label htmlFor="profile-income">月度收入（元）</Label><Input id="profile-income" type="number" value={monthlyIncome} onChange={(e) => setMonthlyIncome(e.target.value)} placeholder="20000" /></div>
          <div className="space-y-2"><Label htmlFor="profile-expense">月度必要支出（元）</Label><Input id="profile-expense" type="number" value={monthlyExpense} onChange={(e) => setMonthlyExpense(e.target.value)} placeholder="10000" /></div>
          <div className="space-y-2"><Label htmlFor="profile-liabilities">负债余额（元）</Label><Input id="profile-liabilities" type="number" value={liabilities} onChange={(e) => setLiabilities(e.target.value)} placeholder="0" /></div>
        </div>

        <p className="eyebrow mt-8">风险画像</p>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label>风险等级</Label>
            <Select value={riskLevel} onValueChange={(v) => setRiskLevel(v as RiskLevel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{riskLevels.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label htmlFor="profile-emergency-months">期望的应急金月数</Label><Input id="profile-emergency-months" type="number" value={emergencyMonths} onChange={(e) => setEmergencyMonths(e.target.value)} placeholder="6" /></div>
          <div className="space-y-2 md:col-span-2"><Label htmlFor="profile-notes">补充说明（可选）</Label><Textarea id="profile-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="例如：受不了 15% 以上的账面回撤 / 喜欢分批投入 / 计划三年后置换房产" /></div>
        </div>

        <div className="mt-8 flex items-center justify-end gap-3">
          <Button onClick={handleSave} disabled={saving} className="h-11 rounded-sm px-8">{saving ? "保存中…" : "保存财务档案"}</Button>
        </div>
      </section>

      <section className="paper-card mt-6 flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="eyebrow">财务目标</p>
          <p className="mt-1 text-sm text-muted-foreground">你的购房、应急金、教育金等目标单独成档，不限数量，可随时增删改。</p>
        </div>
        <Button variant="outline" onClick={() => navigate("/goals")} className="rounded-sm"><Target className="size-4" />打开个人目标档案</Button>
      </section>

      <section className="paper-card mt-6 p-6 md:p-8">
        <p className="eyebrow">账号</p>
        <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
          <div>
            <p className="text-muted-foreground">账号类型</p>
            <p className="mt-1 font-medium">{isAnonymous ? "游客账号（仅当前浏览器）" : "邮箱账号：" + (user?.email ?? "—")}</p>
          </div>
          <div><p className="text-muted-foreground">账号创建于</p><p className="mt-1 font-medium">{profile ? new Date(profile.createdAt).toLocaleDateString("zh-CN") : "—"}</p></div>
        </div>
      </section>
    </div>
  );
};

export default ProfilePage;
