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
import { useLocale, useTranslations } from "next-intl";

const riskLevelValues: RiskLevel[] = ["R1", "R2", "R3", "R4", "R5"];

const ProfilePage = () => {
  const t = useTranslations("profile");
  const locale = useLocale();
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
    setRiskLevel(profile.riskLevel ?? "R3");
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
      toast.success(t("saveSuccess"));
    } catch (err: any) {
      toast.error(err?.message ?? t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 className="mt-2 text-3xl font-semibold">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {isAnonymous ? (
          <Button variant="outline" onClick={() => navigate("/login")} className="rounded-sm"><LogIn className="size-4" />{t("bindAccount")}</Button>
        ) : (
          <Button variant="outline" onClick={() => { void signOut(); }} className="rounded-sm"><LogOut className="size-4" />{t("logout")}</Button>
        )}
      </div>

      {isAnonymous && (
        <div className="mb-6 rounded-md border border-dashed border-border bg-card/60 px-5 py-4 text-sm text-muted-foreground">
          {t("guestNotice")}
        </div>
      )}

      <section className="paper-card p-6 md:p-8">
        <p className="eyebrow">{t("basicInfo")}</p>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="profile-display-name">{t("displayName")}</Label><Input id="profile-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t("displayNamePlaceholder")} /></div>
          <div className="space-y-2"><Label htmlFor="profile-age">{t("age")}</Label><Input id="profile-age" type="number" value={age} onChange={(e) => setAge(e.target.value)} placeholder={t("agePlaceholder")} /></div>
          <div className="space-y-2 md:col-span-2"><Label htmlFor="profile-household">{t("household")}</Label><Input id="profile-household" value={household} onChange={(e) => setHousehold(e.target.value)} placeholder={t("householdPlaceholder")} /></div>
        </div>

        <p className="eyebrow mt-8">{t("cashFlow")}</p>
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          <div className="space-y-2"><Label htmlFor="profile-income">{t("monthlyIncome")}</Label><Input id="profile-income" type="number" value={monthlyIncome} onChange={(e) => setMonthlyIncome(e.target.value)} placeholder="20000" /></div>
          <div className="space-y-2"><Label htmlFor="profile-expense">{t("monthlyExpense")}</Label><Input id="profile-expense" type="number" value={monthlyExpense} onChange={(e) => setMonthlyExpense(e.target.value)} placeholder="10000" /></div>
          <div className="space-y-2"><Label htmlFor="profile-liabilities">{t("liabilities")}</Label><Input id="profile-liabilities" type="number" value={liabilities} onChange={(e) => setLiabilities(e.target.value)} placeholder="0" /></div>
        </div>

        <p className="eyebrow mt-8">{t("riskProfile")}</p>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("riskLevel")}</Label>
            <Select value={riskLevel} onValueChange={(v) => setRiskLevel(v as RiskLevel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{riskLevelValues.map((value) => <SelectItem key={value} value={value}>{t(`riskLevels.${value}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label htmlFor="profile-emergency-months">{t("emergencyMonths")}</Label><Input id="profile-emergency-months" type="number" value={emergencyMonths} onChange={(e) => setEmergencyMonths(e.target.value)} placeholder="6" /></div>
          <div className="space-y-2 md:col-span-2"><Label htmlFor="profile-notes">{t("notes")}</Label><Textarea id="profile-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("notesPlaceholder")} /></div>
        </div>

        <div className="mt-8 flex items-center justify-end gap-3">
          <Button onClick={handleSave} disabled={saving} className="h-11 rounded-sm px-8">{saving ? t("saving") : t("save")}</Button>
        </div>
      </section>

      <section className="paper-card mt-6 flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="eyebrow">{t("goalsTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("goalsDescription")}</p>
        </div>
        <Button variant="outline" onClick={() => navigate("/goals")} className="rounded-sm"><Target className="size-4" />{t("openGoals")}</Button>
      </section>

      <section className="paper-card mt-6 p-6 md:p-8">
        <p className="eyebrow">{t("accountTitle")}</p>
        <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
          <div>
            <p className="text-muted-foreground">{t("accountType")}</p>
            <p className="mt-1 font-medium">{isAnonymous ? t("guestAccount") : t("emailAccount", { email: user?.email ?? "—" })}</p>
          </div>
          <div><p className="text-muted-foreground">{t("createdAt")}</p><p className="mt-1 font-medium">{profile ? new Date(profile.createdAt).toLocaleDateString(locale) : "—"}</p></div>
        </div>
      </section>
    </div>
  );
};

export default ProfilePage;
