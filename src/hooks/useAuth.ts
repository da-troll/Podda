import { useState, useEffect, createContext, useContext } from 'react';
import { api, isNativeApp } from '../api';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  notLinked: boolean; // HIVE-1526: signed in to Authentik, but no Podda account is linked
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}

export function useAuthState(): AuthContextType {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [notLinked, setNotLinked] = useState(false);

  useEffect(() => {
    const onNotLinked = () => setNotLinked(true);
    window.addEventListener('podda:not-linked', onNotLinked);
    api.me()
      .then((u) => setUser((u as User) ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    return () => window.removeEventListener('podda:not-linked', onNotLinked);
  }, []);

  const login = async (username: string, password: string) => {
    const u = await api.login(username, password);
    setUser(u as User);
  };

  const logout = async () => {
    const native = (window as any).__poddaAuth;
    if (isNativeApp() && native?.signOut) { await native.signOut(); setUser(null); return; }
    await api.logout();
    // signed in through Authentik on the web: end that session too, or the next load signs back in
    if (user?.authMethod === 'authentik-web') { window.location.href = '/outpost.goauthentik.io/sign_out'; return; }
    setUser(null);
  };

  return { user, loading, notLinked, login, logout };
}

export { AuthContext };
