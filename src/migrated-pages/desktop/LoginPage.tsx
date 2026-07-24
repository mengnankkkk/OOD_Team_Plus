import { useState } from "react";
import { Navigate, useNavigate } from "@/features/frontend-migration/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { FlaskConical } from "lucide-react";

const LoginPage = () => {
  const { session, loading, signInWithPassword, signUpWithPassword } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <div className="grid min-h-screen place-items-center text-muted-foreground">正在唤醒工作台…</div>;
  if (session) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    if (mode === "signin") {
      const { error } = await signInWithPassword(username.trim(), password);
      if (error) toast.error(error.message ?? "登录失败，请核对用户名与密码");
      else navigate("/", { replace: true });
    } else {
      const { error } = await signUpWithPassword(username.trim(), password, displayName.trim() || undefined);
      if (error) toast.error(error.message ?? "注册失败，请稍后重试");
      else {
        toast.success("账号已创建，正在进入工作台");
        const { error: signInErr } = await signInWithPassword(username.trim(), password);
        if (signInErr) toast.error("账号已创建，请使用用户名和密码重新登录");
        else navigate("/", { replace: true });
      }
    }
    setSubmitting(false);
  };

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[3fr_2fr]">
      <div className="hidden flex-col justify-between border-r border-border bg-card p-12 lg:flex">
        <div className="flex items-center gap-3"><span className="seal-mark">财语</span><span className="font-semibold tracking-tight">Money Whisperer</span></div>
        <div>
          <p className="eyebrow">多 Agent 目标理财管家</p>
          <h1 className="mt-6 max-w-md text-4xl font-semibold leading-tight">先看目标，再看市场。<br />让每一条建议都能沿着红线走回它出生的证据。</h1>
          <p className="mt-6 max-w-md text-muted-foreground">登录后，属于你的目标、账本、画像和决策日志将只对你可见 —— 服务端按用户切分数据，评委视图仅显示演示账号。</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground"><FlaskConical className="size-4 text-primary" /> 所有建议均为研究模拟，不构成真实交易指令</div>
      </div>

      <div className="flex items-center justify-center p-8">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
          <div>
            <p className="eyebrow">{mode === "signin" ? "登录" : "创建账号"}</p>
            <h2 className="mt-2 text-2xl font-semibold">{mode === "signin" ? "回到你的财务工作台" : "开启你的目标理财管家"}</h2>
          </div>

          {mode === "signup" && (
            <div className="space-y-2">
              <Label htmlFor="displayName">称呼</Label>
              <Input id="displayName" placeholder="想让我怎么称呼你" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="username">用户名</Label>
            <Input id="username" type="text" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]{3,32}" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="3–32 位字母、数字或下划线" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input id="password" type="password" required minLength={10} maxLength={128} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="10–128 位" />
          </div>

          <Button type="submit" className="h-11 w-full rounded-sm" disabled={submitting}>
            {submitting ? "处理中…" : mode === "signin" ? "登录" : "创建账号并登录"}
          </Button>

          <button type="button" className="w-full text-sm text-muted-foreground hover:text-primary" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? "还没有账号？创建一个" : "已经有账号？直接登录"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
