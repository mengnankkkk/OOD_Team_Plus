"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, LogIn, LogOut, User } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "@/features/frontend-migration/router";
import { useAuth } from "@/hooks/useAuth";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useAlerts } from "@/hooks/useAlerts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", label: "首页" },
  { path: "/assets", label: "资产" },
  { path: "/advisor", label: "顾问" },
  { path: "/query", label: "智能查数" },
  { path: "/watchlist", label: "持仓观测" },
];

const historyEntries = [
  { path: "/history/artifacts", label: "报告产物" },
  { path: "/history/evidence-lab", label: "证据实验室" },
  { path: "/history/decision-log", label: "决策日志" },
];

const workspaceEntries = [
  { path: "/analysis", label: "组合分析" },
  { path: "/simulations", label: "分支模拟" },
];

const adminEntries = [
  { path: "/assets/semantic", label: "语义层" },
  { path: "/admin/users", label: "用户管理" },
  { path: "/admin/rss", label: "RSS 源管理" },
  { path: "/admin/system", label: "系统健康" },
  { path: "/notification-preference", label: "通知偏好" },
  { path: "/risk-questionnaire", label: "风险问卷" },
];

export default function TopNavigation() {
  const { profile, user, isAnonymous, signOut } = useAuth();
  const { judgeMode } = useDemoMode();
  const { data: alerts = [] } = useAlerts();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const historyWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setMenuOpen(false);
      if (historyWrapRef.current && !historyWrapRef.current.contains(event.target as Node)) setHistoryMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setHistoryMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const unreadCount = alerts.filter((item) => item.status === "unread").length;
  const entries = user?.role === "ADMIN" ? [...workspaceEntries, ...adminEntries] : workspaceEntries;
  const active = entries.some((entry) => location.pathname.startsWith(entry.path));
  const historyActive = location.pathname.startsWith("/history");
  const label = isAnonymous ? (profile?.displayName || "游客") : (profile?.displayName ?? user?.email ?? "登录中");

  return (
    <>
      <header className={`sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950 text-neutral-100 ${judgeMode ? "border-b-destructive/60" : ""}`}>
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-5 md:px-10 xl:px-16">
          <NavLink to="/" className="flex items-center gap-3">
            <Image src="/money-whisperer-logo.png" alt="Money Whisperer logo" width={40} height={40} className="size-10 shrink-0 object-contain" />
            <span className="hidden bg-gradient-to-br from-white via-[#fff2bc] to-[#d49b2f] bg-clip-text font-semibold text-transparent sm:inline-block">Money Whisperer</span>
          </NavLink>

          <nav className="ml-auto hidden items-center gap-8 md:flex">
            {navItems.map((item) => <NavLink key={item.path} to={item.path} end={item.path === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><span>{item.label}</span></NavLink>)}
            <div ref={historyWrapRef} className="relative">
              <button type="button" onClick={() => setHistoryMenuOpen((value) => !value)} className={cn("nav-link inline-flex items-center gap-1.5", historyActive && "active", historyMenuOpen && "open")}>
                <span>历史记录</span><ChevronDown className={cn("size-3.5 transition-transform", historyMenuOpen && "rotate-180")} />
              </button>
              {historyMenuOpen ? (
                <div className="absolute left-1/2 top-full z-50 min-w-[12rem] -translate-x-1/2 pt-1">
                  <div className="overflow-hidden rounded-md bg-popover shadow-xl">
                    <div className="flex flex-col">
                      {historyEntries.map((entry) => <button key={entry.path} onClick={() => { setHistoryMenuOpen(false); navigate(entry.path); }} className="px-3 py-2.5 text-sm text-popover-foreground hover:bg-accent hover:text-primary">{entry.label}</button>)}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <div ref={wrapRef} className="relative">
              <button type="button" onClick={() => setMenuOpen((value) => !value)} className={cn("nav-link inline-flex items-center gap-1.5", active && "active", menuOpen && "open")}>
                <span>更多</span><ChevronDown className={cn("size-3.5 transition-transform", menuOpen && "rotate-180")} />
              </button>
              {menuOpen ? (
                <div className="absolute left-1/2 top-full z-50 min-w-[12rem] -translate-x-1/2 pt-1">
                  <div className="overflow-hidden rounded-md bg-popover shadow-xl">
                    <div className="flex flex-col">
                      {entries.map((entry) => <button key={entry.path} onClick={() => { setMenuOpen(false); navigate(entry.path); }} className="px-3 py-2.5 text-sm text-popover-foreground hover:bg-accent hover:text-primary">{entry.label}</button>)}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </nav>

          <div className="ml-4 flex items-center gap-4">
            <button onClick={() => navigate("/alerts")} className="press-shell press-shell-icon" aria-label="提醒中心">
              <span className="press-outer"><span className="press-inner"><Bell className="size-4" /></span></span>
              {unreadCount > 0 ? <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger className="press-shell press-shell-account">
                <span className="press-outer">
                  <span className="press-inner press-inner-account">
                    <span className={`grid size-8 place-items-center rounded-full ${isAnonymous ? "bg-neutral-800/70 text-neutral-300" : "bg-primary/20 text-primary"}`}><User className="size-4" /></span>
                    <span className="hidden max-w-[8rem] truncate lg:inline">{label}</span>
                    {isAnonymous ? <span className="hidden rounded-md bg-neutral-800/80 px-2 py-1 text-[10px] tracking-wide text-neutral-300 lg:inline">游客</span> : null}
                  </span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground">{isAnonymous ? "游客模式 · 数据仅保存在当前设备账号" : `用户名：${user?.email ?? "—"}`}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/profile")}>个人财务档案</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/goals")}>个人目标档案</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/auth/password")}>修改密码</DropdownMenuItem>
                <DropdownMenuSeparator />
                {isAnonymous ? <DropdownMenuItem onClick={() => navigate("/login")}><LogIn className="size-4" />绑定邮箱账号</DropdownMenuItem> : <DropdownMenuItem onClick={() => void signOut()} className="text-destructive focus:text-destructive"><LogOut className="size-4" />退出登录</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {judgeMode ? <div className="mx-auto max-w-[1440px] border-t border-destructive/30 bg-destructive/5 px-5 py-1.5 text-xs text-destructive md:px-10 xl:px-16">评委视图 · Pandadata 路由、Skill 运行、DAG、风控拦截原因均已展开</div> : null}
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-border bg-card/95 px-2 backdrop-blur md:hidden">
        {navItems.map((item) => <NavLink key={item.path} to={item.path} end={item.path === "/"} className={({ isActive }) => `py-3 text-center text-xs ${isActive ? "text-primary" : "text-muted-foreground"}`}>{item.label}</NavLink>)}
        <NavLink to="/history" className={({ isActive }) => `py-3 text-center text-xs ${isActive ? "text-primary" : "text-muted-foreground"}`}>历史记录</NavLink>
      </nav>
    </>
  );
}
