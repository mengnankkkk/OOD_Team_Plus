import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const AuthCallbackPage = () => {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    navigate(session ? "/" : "/login", { replace: true });
  }, [session, loading, navigate]);

  return <div className="grid min-h-screen place-items-center text-muted-foreground">正在完成登录…</div>;
};

export default AuthCallbackPage;
