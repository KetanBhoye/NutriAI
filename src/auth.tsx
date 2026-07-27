import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, clearSession, loadStoredCookie } from './api';

export interface User {
  id: string;
  name: string;
  email: string;
  role?: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On launch: if we have a stored session cookie, confirm it's still valid.
  useEffect(() => {
    (async () => {
      try {
        const cookie = await loadStoredCookie();
        if (cookie) {
          const me = await api<{ user: User }>('/api/me');
          setUser(me.user ?? null);
        }
      } catch {
        await clearSession();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = async (email: string, password: string) => {
    const res = await api<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      captureCookie: true,
    });
    setUser(res.user);
  };

  const signOut = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore — we clear locally regardless
    }
    await clearSession();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
