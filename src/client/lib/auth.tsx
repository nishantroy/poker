import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { UserInfo } from "@shared/protocol";
import { api } from "./api";

interface AuthCtx {
  user: UserInfo | null;
  loading: boolean;
  setUser: (u: UserInfo | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ user: null, loading: true, setUser: () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);
  const logout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
  };
  return <Ctx.Provider value={{ user, loading, setUser, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
