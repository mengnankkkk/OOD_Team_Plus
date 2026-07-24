import type { Metadata } from "next";

import "./globals.css";
import "../frontend-migrated.css";
import "../workbench.css";
import { FrontendProviders } from "@/features/frontend-migration/query-provider";

export const metadata: Metadata = {
  title: "Money Whisperer · 专业投资顾问",
  description: "面向个人投资者的专业多 Agent 研究、分析与情景模拟工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><FrontendProviders>{children}</FrontendProviders></body>
    </html>
  );
}
