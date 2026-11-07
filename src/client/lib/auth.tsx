import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { UserInfo } from "@shared/protocol";
import { type Flags, defaultFlags } from "@shared/flags";
import { api } from "./api";

interface AuthCtx {
  user: UserInfo | null;
  loading: boolean;
  /** Operator feature flags as of the last /api/me; the table page prefers the live copy in its TableView. */
  flags: Flags;
  isAdmin: boolean;
  setUser: (u: UserInfo | null) => void;
  setFlags: (f: Flags) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ user: null, loading: true, flags: defaultFlags(), isAdmin: false, setUser: () => {}, setFlags: () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [flags, setFlags] = useState<Flags>(defaultFlags());
  const [isAdmin, setIsAdmin] = useState(false);
  const refresh = () => api.me().then((r) => { setUser(r.user); setFlags(r.flags); setIsAdmin(r.isAdmin); }).catch(() => setUser(null));
  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);
  // admin status depends on who is logged in
  const setUserAndRefresh = (u: UserInfo | null) => {
    setUser(u);
    if (u) void refresh();
    else setIsAdmin(false);
  };
  const logout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
    setIsAdmin(false);
  };
  return <Ctx.Provider value={{ user, loading, flags, isAdmin, setUser: setUserAndRefresh, setFlags, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
