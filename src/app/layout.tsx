import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Money Whisperer · Supervisor Playground",
  description: "Mastra Supervisor 基础对话闭环",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
