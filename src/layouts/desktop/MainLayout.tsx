"use client";

import { Navigate, useLocation } from "@/features/frontend-migration/router";
import TopNavigation from "@/components/desktop/TopNavigation";
import { useAuth } from "@/hooks/useAuth";

const MainLayout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const { user, loading } = useAuth();
  const isAdvisor = location.pathname.startsWith("/advisor");
  const mainClassName = isAdvisor ? "min-h-0 min-w-0 flex-1 overflow-hidden" : "mx-auto w-full max-w-[1440px] flex-1 px-5 pb-16 pt-8 md:px-10 xl:px-16";

  if (loading) return <div className="grid min-h-screen place-items-center text-muted-foreground">正在唤醒工作台…</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className={`flex flex-col bg-background text-foreground ${isAdvisor ? "h-screen overflow-hidden" : "min-h-screen"}`}>
      <TopNavigation />
      <main className={mainClassName}>
        {children}
      </main>
      {!isAdvisor ? <footer className="border-t border-border px-5 py-4 text-center text-xs text-muted-foreground">
        所有分析仅用于研究与财务规划演示，不构成真实交易指令或收益承诺
      </footer> : null}
    </div>
  );
};

export default MainLayout;
