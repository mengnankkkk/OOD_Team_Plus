"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { useState } from "react";
import { FrontendAuthProvider } from "./auth";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DemoModeProvider } from "@/hooks/useDemoMode";
import { NextIntlClientProvider } from "next-intl";
import type { AppLocale } from "@/i18n/config";

export function FrontendProviders({ children, locale, messages }: { children: React.ReactNode; locale: AppLocale; messages: Record<string, unknown> }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return <NextIntlClientProvider locale={locale} messages={messages}><ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange><QueryClientProvider client={queryClient}><FrontendAuthProvider><DemoModeProvider><TooltipProvider>{children}</TooltipProvider></DemoModeProvider></FrontendAuthProvider><Toaster /></QueryClientProvider></ThemeProvider></NextIntlClientProvider>;
}
