import type { Metadata } from "next";
import { getLocale, getMessages } from "next-intl/server";

import "./globals.css";
import "../frontend-migrated.css";
import "../workbench.css";
import { FrontendProviders } from "@/features/frontend-migration/query-provider";

import type { AppLocale } from "@/i18n/config";
import { loadMessages } from "@/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale() as AppLocale;
  const messages = await loadMessages(locale);
  return {
    title: messages.common.metadata.title,
    description: messages.common.metadata.description,
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale() as AppLocale;
  const messages = await getMessages();
  return (
    <html lang={locale} suppressHydrationWarning data-scroll-behavior="smooth">
      <body><FrontendProviders locale={locale} messages={messages}>{children}</FrontendProviders></body>
    </html>
  );
}
