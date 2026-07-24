"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { useState } from "react";
import { FrontendAuthProvider } from "./auth";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DemoModeProvider } from "@/hooks/useDemoMode";

export function FrontendProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange><QueryClientProvider client={queryClient}><FrontendAuthProvider><DemoModeProvider><TooltipProvider>{children}</TooltipProvider></DemoModeProvider></FrontendAuthProvider><Toaster /></QueryClientProvider></ThemeProvider>;
}
