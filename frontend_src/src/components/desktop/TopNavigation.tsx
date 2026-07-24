import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronDown, ClipboardList, FlaskConical, Layers, Link2, LogIn, LogOut, Table2, User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useAlerts } from "@/hooks/useAlerts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const navItems: { path: string; label: string }[] = [
  { path: "/", label: "首页" },
  { path: "/assets", label: "资产" },
  { path: "/advisor", label: "顾问" },
  { path: "/watchlist", label: "持仓观测" },
];

const historyEntries: { path: string; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { path: "/decision-log", label: "决策日志", Icon: ClipboardList },
  { path: "/evidence-lab", label: "Evidence Lab", Icon: FlaskConical },
];

const semanticEntries: { path: string; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { path: "/assets/semantic/domains", label: "领域管理", Icon: Layers },
  { path: "/assets/semantic/tables", label: "表管理", Icon: Table2 },
  { path: "/assets/semantic/foreign-keys", label: "外键管理", Icon: Link2 },
];

const TopNavigation = () => {
  const { profile, user, isAnonymous, signOut } = useAuth();
  const { judgeMode } = useDemoMode();
  const { data: alerts = [] } = useAlerts();
  const navigate = useNavigate();
  const location = useLocation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [semanticOpen, setSemanticOpen] = useState(false);
  const semanticWrapRef = useRef<HTMLDivElement | null>(null);
  const historyWrapRef = useRef<HTMLDivElement | null>(null);
  const semanticCloseTimer = useRef<number | null>(null);
  const historyCloseTimer = useRef<number | null>(null);

  const openSemantic = () => {
    if (semanticCloseTimer.current) window.clearTimeout(semanticCloseTimer.current);
    setSemanticOpen(true);
  };
  const scheduleCloseSemantic = () => {
    if (semanticCloseTimer.current) window.clearTimeout(semanticCloseTimer.current);
    semanticCloseTimer.current = window.setTimeout(() => setSemanticOpen(false), 180);
  };
  const openHistory = () => {
    if (historyCloseTimer.current) window.clearTimeout(historyCloseTimer.current);
    setHistoryOpen(true);
  };
  const scheduleCloseHistory = () => {
    if (historyCloseTimer.current) window.clearTimeout(historyCloseTimer.current);
    historyCloseTimer.current = window.setTimeout(() => setHistoryOpen(false), 180);
  };

  useEffect(() => {
    if (!semanticOpen) return;
    const onDown = (e: MouseEvent) => {
      if (semanticWrapRef.current && !semanticWrapRef.current.contains(e.target as Node)) {
        setSemanticOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSemanticOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [semanticOpen]);

  useEffect(() => {
    if (!historyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (historyWrapRef.current && !historyWrapRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHistoryOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [historyOpen]);

  const unreadCount = alerts.filter((a) => a.status === "unread").length;
  const historyActive = historyEntries.some((e) => location.pathname.startsWith(e.path));
  const semanticActive = location.pathname.startsWith("/assets/semantic");

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const goHistoryEntry = (path: string) => {
    setHistoryOpen(false);
    navigate(path);
  };

  const goSemanticEntry = (path: string) => {
    setSemanticOpen(false);
    navigate(path);
  };

  const displayLabel = isAnonymous ? (profile?.displayName || "游客") : (profile?.displayName ?? user?.email ?? "登录中");

  return (
    <>
      <header className={`sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950 text-neutral-100 ${judgeMode ? "border-b-destructive/60" : ""}`}>
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-5 md:px-10 xl:px-16">
          <NavLink to="/" className="flex items-center gap-3"><img src="https://b.ux-cdn.com/uxarts/20260723/6c0b917fe63b40afa9e1651719b9712f.png" alt="Money Whisperer logo" className="size-10 shrink-0 object-contain" /><span className="hidden font-semibold tracking-tight text-white sm:inline">Money Whisperer</span></NavLink>

          <nav className="ml-auto hidden items-center gap-8 md:flex">
            {navItems.map((item) => (
              <NavLink key={item.path} to={item.path} end={item.path === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>{item.label}</NavLink>
            ))}

            <div
              ref={semanticWrapRef}
              className="relative"
              onMouseEnter={openSemantic}
              onMouseLeave={scheduleCloseSemantic}
            >
              <button
                type="button"
                onClick={() => setSemanticOpen((o) => !o)}
                className={cn(
                  "nav-link inline-flex items-center gap-1.5",
                  semanticActive && "active",
                  semanticOpen && "text-primary",
                )}
              >
                语义层
                <ChevronDown className={cn("size-3.5 transition-transform", semanticOpen && "rotate-180")} />
              </button>
              {semanticOpen && (
                <div className="absolute left-[calc(50%-10px)] top-full z-50 min-w-[8rem] -translate-x-1/2 pt-1 origin-top animate-in fade-in-0 zoom-in-90 slide-in-from-top-4 duration-500">
                  <div className="overflow-hidden rounded-md bg-popover shadow-xl">
                    <div className="flex flex-col">
                      {semanticEntries.map(({ path, label }, idx) => (
                        <button
                          key={path}
                          onClick={() => goSemanticEntry(path)}
                          className={cn(
                            "px-0 py-2.5 text-center text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-primary",
                            idx > 0 && "border-t border-border/40",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div
              ref={historyWrapRef}
              className="relative"
              onMouseEnter={openHistory}
              onMouseLeave={scheduleCloseHistory}
            >
              <button
                type="button"
                onClick={() => setHistoryOpen((o) => !o)}
                className={cn(
                  "nav-link inline-flex items-center gap-1.5",
                  historyActive && "active",
                  historyOpen && "text-primary",
                )}
              >
                历史记录
                <ChevronDown className={cn("size-3.5 transition-transform", historyOpen && "rotate-180")} />
              </button>
              {historyOpen && (
                <div className="absolute left-[calc(50%-10px)] top-full z-50 min-w-[8rem] -translate-x-1/2 pt-1 origin-top animate-in fade-in-0 zoom-in-90 slide-in-from-top-4 duration-500">
                  <div className="overflow-hidden rounded-md bg-popover shadow-xl">
                    <div className="flex flex-col">
                      {historyEntries.map(({ path, label }, idx) => (
                        <button
                          key={path}
                          onClick={() => goHistoryEntry(path)}
                          className={cn(
                            "px-0 py-2.5 text-center text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-primary",
                            idx > 0 && "border-t border-border/40",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </nav>

          <div className="ml-4 flex items-center gap-4">
            <button onClick={() => navigate("/alerts")} className="relative rounded-full border border-neutral-800 bg-neutral-900 p-2 transition-colors hover:border-primary" aria-label="提醒中心">
              <Bell className="size-4 text-neutral-300" />
              {unreadCount > 0 && <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">{unreadCount > 99 ? "99+" : unreadCount}</span>}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100">
                <div className={`grid size-7 place-items-center rounded-full ${isAnonymous ? "bg-neutral-800 text-neutral-400" : "bg-primary/20 text-primary"}`}><User className="size-4" /></div>
                <span className="hidden max-w-[8rem] truncate lg:inline">{displayLabel}</span>
                {isAnonymous && <span className="hidden rounded-sm bg-neutral-800 px-1.5 py-0.5 text-[10px] tracking-wide text-neutral-400 lg:inline">游客</span>}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {isAnonymous ? "游客模式 · 数据仅保存在当前设备账号" : user?.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/profile")}>个人财务档案</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/goals")}>个人目标档案</DropdownMenuItem>
                <DropdownMenuSeparator />
                {isAnonymous ? (
                  <DropdownMenuItem onClick={() => navigate("/login")}>
                    <LogIn className="size-4" />绑定邮箱账号
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive"><LogOut className="size-4" />退出登录</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {judgeMode && <div className="mx-auto max-w-[1440px] border-t border-destructive/30 bg-destructive/5 px-5 py-1.5 text-xs text-destructive md:px-10 xl:px-16">评委视图 · Pandadata 路由、Skill 运行、DAG、风控拦截原因均已展开</div>}
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-card/95 px-2 backdrop-blur md:hidden">
        {navItems.map((item) => (
          <NavLink key={item.path} to={item.path} end={item.path === "/"} className={({ isActive }) => `py-3 text-center text-xs ${isActive ? "text-primary" : "text-muted-foreground"}`}>{item.label}</NavLink>
        ))}
      </nav>
    </>
  );
};

export default TopNavigation;
