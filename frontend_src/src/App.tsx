import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider, Outlet, ScrollRestoration } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import NotFound from "@/pages/NotFound";
import ScrollToHashElement from "@/components/ScrollToHashElement";
import MainLayout from "@/layouts/desktop/MainLayout";
import HomePage from "@/pages/desktop/HomePage";
import PlaceholderPage from "@/pages/desktop/PlaceholderPage";
import LoginPage from "@/pages/desktop/LoginPage";
import AuthCallbackPage from "@/pages/desktop/AuthCallbackPage";
import ProfilePage from "@/pages/desktop/ProfilePage";
import GoalsPage from "@/pages/desktop/GoalsPage";
import AdvisorPage from "@/pages/desktop/AdvisorPage";
import AssetsPage from "@/pages/desktop/AssetsPage";
import RecommendationDetailPage from "@/pages/desktop/RecommendationDetailPage";
import ProtectedRoute from "@/components/desktop/ProtectedRoute";
import { AuthProvider } from "@/hooks/useAuth";
import { DemoModeProvider } from "@/hooks/useDemoMode";
import EvidenceLabPage from "@/pages/desktop/EvidenceLabPage";
import AlertsPage from "@/pages/desktop/AlertsPage";
import DecisionLogPage from "@/pages/desktop/DecisionLogPage";
import WatchlistPage from "@/pages/desktop/WatchlistPage";
import SemanticDomainsPage from "@/pages/desktop/SemanticDomainsPage";
import SemanticTablesPage from "@/pages/desktop/SemanticTablesPage";
import SemanticColumnsPage from "@/pages/desktop/SemanticColumnsPage";
import SemanticForeignKeysPage from "@/pages/desktop/SemanticForeignKeysPage";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function RootLayout() {
  return <><Outlet /><ScrollRestoration /><ScrollToHashElement /></>;
}

const router = createBrowserRouter(createRoutesFromElements(
  <Route element={<RootLayout />}>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/auth/callback" element={<AuthCallbackPage />} />
    {/* Semantic layer — mock-only pages, no auth needed, mounted outside ProtectedRoute */}
    <Route element={<MainLayout />}>
      <Route path="/assets/semantic" element={<SemanticDomainsPage />} />
      <Route path="/assets/semantic/domains" element={<SemanticDomainsPage />} />
      <Route path="/assets/semantic/tables" element={<SemanticTablesPage />} />
      <Route path="/assets/semantic/tables/:tableId/columns" element={<SemanticColumnsPage />} />
      <Route path="/assets/semantic/foreign-keys" element={<SemanticForeignKeysPage />} />
    </Route>
    <Route element={<ProtectedRoute />}>
      <Route element={<MainLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/advisor" element={<AdvisorPage />} />
        <Route path="/watchlist" element={<WatchlistPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/goals" element={<GoalsPage />} />
        <Route path="/recommendations/:id" element={<RecommendationDetailPage />} />
        <Route path="/evidence-lab" element={<EvidenceLabPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/decision-log" element={<DecisionLogPage />} />
      </Route>
    </Route>
    <Route path="*" element={<NotFound />} />
  </Route>
));

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DemoModeProvider>
          <TooltipProvider><Sonner /><RouterProvider router={router} /></TooltipProvider>
        </DemoModeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
