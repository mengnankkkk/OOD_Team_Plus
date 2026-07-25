"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { MotionProps } from "framer-motion";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { Navigate, useLocation } from "@/features/frontend-migration/router";
import TopNavigation from "@/components/desktop/TopNavigation";
import OnboardingGate from "@/components/desktop/OnboardingGate";
import { useAuth } from "@/hooks/useAuth";

type MotionMainProps = ComponentProps<"main"> & MotionProps & { children: ReactNode };
const MotionMain = motion.main as ComponentType<MotionMainProps>;

const MainLayout = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const { user, loading } = useAuth();
  const reduceMotion = useReducedMotion();
  const isAdvisor = location.pathname.startsWith("/advisor");
  const isSettings = location.pathname.startsWith("/settings");
  const enableSlide = !isAdvisor && !isSettings && !reduceMotion;
  const mainClassName = isAdvisor
    ? "min-w-0 flex-1 pb-16 md:min-h-0 md:overflow-hidden"
    : "mx-auto w-full max-w-[1440px] flex-1 px-5 pb-16 pt-8 md:px-10 xl:px-16";

  if (loading) return <div className="grid min-h-screen place-items-center text-muted-foreground">正在唤醒工作台…</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className={`flex flex-col bg-background text-foreground ${isAdvisor ? "min-h-screen md:h-screen md:overflow-hidden" : "min-h-screen"}`}>
      <TopNavigation />
      <OnboardingGate />
      {enableSlide ? (
        <AnimatePresence mode="wait" initial={false}>
          <MotionMain
            key={location.pathname}
            className={`${mainClassName} page-slide-shell`}
            initial={{ opacity: 0, x: 96, scale: 0.985, filter: "blur(8px)" }}
            animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -72, scale: 0.985, filter: "blur(8px)" }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </MotionMain>
        </AnimatePresence>
      ) : (
        <main className={mainClassName}>
          {children}
        </main>
      )}
      {!isAdvisor ? <footer className="border-t border-border px-5 py-4 text-center text-xs text-muted-foreground">
        所有分析仅用于研究与财务规划演示，不构成真实交易指令或收益承诺
      </footer> : null}
    </div>
  );
};

export default MainLayout;
