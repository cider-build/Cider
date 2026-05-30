import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { APIError, auth as authApi, type Me } from "./api";

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({
  children,
  requireAuth = false,
}: {
  children: ReactNode;
  requireAuth?: boolean;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  const refresh = useCallback(async () => {
    try {
      setMe(await authApi.me());
    } catch (err) {
      if (err instanceof APIError && err.status === 401) {
        setMe(null);
      } else {
        throw err;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!loading && requireAuth && !me) {
      // Carry the current path through login so flows like /cli-auth land
      // back where they started after the user signs in.
      const target = `${location.pathname}${location.search}`;
      const next =
        target === "/login"
          ? "/login"
          : `/login?redirect=${encodeURIComponent(target)}`;
      navigate(next, { replace: true });
    }
  }, [loading, requireAuth, me, navigate, location.pathname, location.search]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setMe(null);
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  return (
    <AuthContext.Provider value={{ me, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
