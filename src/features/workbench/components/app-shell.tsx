"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bell, Blocks, BookOpenText, Boxes, ChartNoAxesCombined, DatabaseZap, FileChartColumn, FlaskConical, Menu, MessageSquareText, Search, X } from "lucide-react";
import { useState } from "react";

const NAV = [
  { href: "/", label: "投资总览", detail: "Portfolio desk", icon: Blocks },
  { href: "/analysis", label: "资产分析", detail: "Health & risk", icon: ChartNoAxesCombined },
  { href: "/query", label: "智能查数", detail: "Semantic SQL", icon: DatabaseZap },
  { href: "/simulations", label: "分支模拟", detail: "Scenario lab", icon: FlaskConical },
  { href: "/artifacts", label: "报告中心", detail: "Charts & files", icon: FileChartColumn },
  { href: "/observatory", label: "自选与提醒", detail: "Signals", icon: Bell },
  { href: "/research", label: "信息雷达", detail: "Search & RSS", icon: Search },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="desk-shell">
      <aside className={`desk-rail ${open ? "is-open" : ""}`}>
        <div className="rail-brand">
          <span className="rail-monogram">MW</span>
          <div><strong>Money Whisperer</strong><small>PERSONAL INVESTMENT OFFICE</small></div>
          <button className="rail-close" onClick={() => setOpen(false)} aria-label="关闭导航"><X size={18} /></button>
        </div>
        <nav className="rail-nav" aria-label="主导航">
          {NAV.map(({ href, label, detail, icon: Icon }, index) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return <Link href={href} key={href} className={active ? "active" : ""} onClick={() => setOpen(false)}>
              <span className="rail-index">0{index + 1}</span><Icon size={17} /><span><b>{label}</b><small>{detail}</small></span>
            </Link>;
          })}
        </nav>
        <div className="rail-footer">
          <div className="rail-pulse"><Activity size={14} /><span>LOCAL ENGINE</span><b>在线</b></div>
          <Link href="/chat" className="rail-lab"><MessageSquareText size={15} /> Supervisor Lab <span>稍后</span></Link>
          <div className="rail-disclaimer">本工具用于研究与情景分析<br />不构成投资建议</div>
        </div>
      </aside>
      <div className="desk-stage">
        <header className="desk-topbar">
          <button className="mobile-menu" onClick={() => setOpen(true)} aria-label="打开导航"><Menu size={20} /></button>
          <div className="market-note"><span className="live-dot" /> 本地投资工作台 <i>数据质量会在每个模块内标注</i></div>
          <div className="top-actions"><BookOpenText size={16} /><span>研究模式</span><div className="avatar">DI</div></div>
        </header>
        <main className="desk-content">{children}</main>
      </div>
      {open ? <button className="rail-scrim" onClick={() => setOpen(false)} aria-label="关闭导航遮罩" /> : null}
    </div>
  );
}
