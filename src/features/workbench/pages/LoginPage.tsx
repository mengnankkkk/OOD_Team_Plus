import { useState } from "react";
import Image from "next/image";
import { Navigate, useNavigate } from "@/features/frontend-migration/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { FlaskConical } from "lucide-react";
import LanguageSelector from "@/components/desktop/LanguageSelector";
import { useLocale, useTranslations } from "next-intl";
import type { AppLocale } from "@/i18n/config";

const LoginPage = () => {
  const { session, loading, signInWithPassword, signUpWithPassword } = useAuth();
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <div className="grid min-h-screen place-items-center text-muted-foreground">{common("actions.loading")}</div>;
  if (session) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    if (mode === "signin") {
      const { error } = await signInWithPassword(username.trim(), password, locale);
      if (error) toast.error(error.message ?? t("login.error"));
      else navigate("/", { replace: true });
    } else {
      const { error } = await signUpWithPassword(username.trim(), password, displayName.trim() || undefined, locale);
      if (error) toast.error(error.message ?? t("register.error"));
      else {
        toast.success(t("register.success"));
        const { error: signInErr } = await signInWithPassword(username.trim(), password, locale);
        if (signInErr) toast.error(t("register.signInAgain"));
        else navigate("/", { replace: true });
      }
    }
    setSubmitting(false);
  };

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[3fr_2fr]">
      <div className="hidden flex-col justify-between border-r border-border bg-card p-12 lg:flex">
        <div className="flex items-center gap-3">
          <Image src="/money-whisperer-logo.png" alt="Money Whisperer logo" width={40} height={40} className="size-10 shrink-0 object-contain" priority />
          <span className="font-semibold tracking-tight">Money Whisperer</span>
        </div>
        <div>
          <p className="eyebrow">{t("login.eyebrow")}</p>
          <h1 className="mt-6 max-w-md text-4xl font-semibold leading-tight">{t("login.title")}</h1>
          <p className="mt-6 max-w-md text-muted-foreground">{common("metadata.description")}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground"><FlaskConical className="size-4 text-primary" /> {t("disclaimer")}</div>
      </div>

      <div className="flex items-center justify-center p-8">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
          <div className="flex justify-end"><LanguageSelector /></div>
          <div>
            <p className="eyebrow">{mode === "signin" ? t("login.eyebrow") : t("register.eyebrow")}</p>
            <h2 className="mt-2 text-2xl font-semibold">{mode === "signin" ? t("login.title") : t("register.title")}</h2>
          </div>

          {mode === "signup" && (
            <div className="space-y-2">
              <Label htmlFor="displayName">{t("account.displayName")}</Label>
              <Input id="displayName" placeholder={t("account.displayNamePlaceholder")} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="username">{t("account.username")}</Label>
            <Input id="username" type="text" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]{3,32}" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t("account.usernamePlaceholder")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{t("account.password")}</Label>
            <Input id="password" type="password" required minLength={10} maxLength={128} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("account.passwordPlaceholder")} />
          </div>

          <Button type="submit" className="h-11 w-full rounded-sm" disabled={submitting}>
            {submitting ? common("actions.loading") : mode === "signin" ? t("login.submit") : t("register.submit")}
          </Button>

          <button type="button" className="w-full text-sm text-muted-foreground hover:text-primary" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? t("login.switchToSignup") : t("register.switchToLogin")}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
