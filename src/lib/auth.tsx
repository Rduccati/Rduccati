import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from './api';

export interface User {
  id: number;
  username: string;
  full_name: string;
  role_code: string;
  role_name: string;
  permissions: string[];
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  settings: Record<string, any>;
  reloadSettings: () => Promise<void>;
  login: (u: string, p: string) => Promise<{ must_change_password: boolean }>;
  logout: () => void;
  can: (...perms: string[]) => boolean;
}

const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Record<string, any>>({});

  const reloadSettings = useCallback(async () => {
    try { setSettings(await api.get('/settings')); } catch { /* ignore */ }
  }, []);

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { tokenStore.set(null); setUser(null); });
    if (!tokenStore.get()) { setLoading(false); return; }
    api.get('/auth/me')
      .then(async (r) => { setUser(r.user); await reloadSettings(); })
      .catch(() => tokenStore.set(null))
      .finally(() => setLoading(false));
  }, [reloadSettings]);

  const login = async (username: string, password: string) => {
    const r = await api.post('/auth/login', { username, password });
    tokenStore.set(r.token);
    setUser(r.user);
    await reloadSettings();
    return { must_change_password: r.must_change_password };
  };

  const can = useCallback((...perms: string[]) => {
    if (!user) return false;
    if (user.permissions.includes('*')) return true;
    return perms.some((p) => user.permissions.includes(p));
  }, [user]);

  return <Ctx.Provider value={{ user, loading, settings, reloadSettings, login, logout, can }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
