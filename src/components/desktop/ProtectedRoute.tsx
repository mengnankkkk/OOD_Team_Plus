import { Outlet } from "@/features/frontend-migration/router";
import { useAuth } from "@/hooks/useAuth";

const ProtectedRoute = () => {
  const { session, loading } = useAuth();

  if (loading || !session) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="size-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm">正在唤醒工作台…</p>
        </div>
      </div>
    );
  }

  return <Outlet />;
};

export default ProtectedRoute;
