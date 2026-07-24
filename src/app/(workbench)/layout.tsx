import { Suspense } from "react";

import MainLayout from "@/layouts/desktop/MainLayout";

export default function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="grid min-h-screen place-items-center text-muted-foreground">正在唤醒工作台…</div>}><MainLayout>{children}</MainLayout></Suspense>;
}
