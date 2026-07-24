import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "@/features/frontend-migration/router";
import { Bell, ChevronDown, LogIn, LogOut, User } from "lucide-react";
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

const workspaceEntries: { path: string; label: string }[] = [
  { path: "/query", label: "智能查数" },
  { path: "/analysis", label: "组合分析" },
  { path: "/simulations", label: "分支模拟" },
  { path: "/artifacts", label: "报告产物" },
  { path: "/research", label: "信息搜索" },
  { path: "/rss", label: "RSS 阅读" },
  { path: "/decision-log", label: "决策日志" },
  { path: "/evidence-lab", label: "Evidence Lab" },
];

const adminEntries: { path: string; label: string }[] = [
  { path: "/assets/semantic", label: "语义层管理" },
  { path: "/admin/users", label: "用户管理" },
  { path: "/admin/rss", label: "RSS 源管理" },
  { path: "/admin/system", label: "系统健康" },
];

const TopNavigation = () => {
  const { profile, user, isAnonymous, signOut } = useAuth();
  const { judgeMode } = useDemoMode();
  const { data: alerts = [] } = useAlerts();
  const navigate = useNavigate();
  const location = useLocation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyWrapRef = useRef<HTMLDivElement | null>(null);
  const historyCloseTimer = useRef<number | null>(null);

  const openHistory = () => {
    if (historyCloseTimer.current) window.clearTimeout(historyCloseTimer.current);
    setHistoryOpen(true);
  };
  const scheduleCloseHistory = () => {
    if (historyCloseTimer.current) window.clearTimeout(historyCloseTimer.current);
    historyCloseTimer.current = window.setTimeout(() => setHistoryOpen(false), 180);
  };

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
  const menuEntries = user?.role === "ADMIN" ? [...workspaceEntries, ...adminEntries] : workspaceEntries;
  const historyActive = menuEntries.some((e) => location.pathname.startsWith(e.path));

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const goHistoryEntry = (path: string) => {
    setHistoryOpen(false);
    navigate(path);
  };

  const displayLabel = isAnonymous ? (profile?.displayName || "游客") : (profile?.displayName ?? user?.email ?? "登录中");

  return (
    <>
      <header className={`sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950 text-neutral-100 ${judgeMode ? "border-b-destructive/60" : ""}`}>
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-5 md:px-10 xl:px-16">
          <NavLink to="/" className="flex items-center gap-3">
            <img
              src="/money-whisperer-logo.png"
              alt="Money Whisperer logo"
              className="brand-logo-mark size-10 shrink-0 object-contain"
            />
            <span
              className="brand-wordmark hidden bg-gradient-to-br from-white via-[#fff2bc] to-[#d49b2f] bg-clip-text font-semibold tracking-tight text-transparent drop-shadow-[0_4px_12px_rgba(212,155,47,0.34)] sm:inline-block"
              style={{ filter: "drop-shadow(0 2px 8px rgba(255,255,255,0.18)) drop-shadow(0 8px 16px rgba(0,0,0,0.72))" }}
            >
              Money Whisperer
            </span>
          </NavLink>

          <nav className="ml-auto hidden items-center gap-8 md:flex">
            {navItems.map((item) => (
              <NavLink key={item.path} to={item.path} end={item.path === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><span>{item.label}</span></NavLink>
            ))}

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
                  historyOpen && "open",
                )}
              >
                <span>更多</span>
                <ChevronDown className={cn("relative z-10 size-3.5 transition-transform", historyOpen && "rotate-180")} />
              </button>
              {historyOpen && (
                <div className="absolute left-[calc(50%-10px)] top-full z-50 min-w-[8rem] -translate-x-1/2 pt-1 origin-top animate-in fade-in-0 zoom-in-90 slide-in-from-top-4 duration-500">
                  <div className="overflow-hidden rounded-md bg-popover shadow-xl">
                    <div className="flex flex-col">
                      {menuEntries.map(({ path, label }, idx) => (
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
            <button onClick={() => navigate("/alerts")} className="press-shell press-shell-icon" aria-label="提醒中心">
              <span className="press-outer">
                <span className="press-inner">
                  <Bell className="size-4" />
                </span>
              </span>
              {unreadCount > 0 && <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">{unreadCount > 99 ? "99+" : unreadCount}</span>}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger className="press-shell press-shell-account">
                <span className="press-outer">
                  <span className="press-inner press-inner-account">
                    <span className={`grid size-8 place-items-center rounded-full ${isAnonymous ? "bg-neutral-800/70 text-neutral-300" : "bg-primary/20 text-primary"}`}><User className="size-4" /></span>
                    <span className="hidden max-w-[8rem] truncate lg:inline">{displayLabel}</span>
                    {isAnonymous && <span className="hidden rounded-md bg-neutral-800/80 px-2 py-1 text-[10px] tracking-wide text-neutral-300 lg:inline">游客</span>}
                  </span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {isAnonymous ? "游客模式 · 数据仅保存在当前设备账号" : `用户名：${user?.email ?? "—"}`}
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
