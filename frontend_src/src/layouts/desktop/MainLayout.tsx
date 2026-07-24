import { Outlet, useLocation } from "react-router-dom";
import TopNavigation from "@/components/desktop/TopNavigation";

const MainLayout = () => {
  const location = useLocation();
  const isAdvisor = location.pathname.startsWith("/advisor");
  const mainClassName = isAdvisor ? "" : "mx-auto w-full max-w-[1440px] px-5 pb-16 pt-8 md:px-10 xl:px-16";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNavigation />
      <main className={mainClassName}>
        <Outlet />
      </main>
      <footer className="border-t border-border px-5 py-4 text-center text-xs text-muted-foreground">
        所有分析仅用于研究与财务规划演示，不构成真实交易指令或收益承诺
      </footer>
    </div>
  );
};

export default MainLayout;
