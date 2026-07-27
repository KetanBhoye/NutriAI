import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, clearSession, loadStoredCookie, setUnauthorizedHandler } from './api';
import { clearCache } from './cache';

export interface User {
  id: string;
  name: string;
  email: string;
  role?: string;
  onboarded?: boolean;
  goals?: {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
  };
}

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    const me = await api<{ user: User } | User>('/api/me');
    setUser((me as { user?: User }).user ?? (me as User));
  };

  // On launch: if we have a stored session cookie, confirm it's still valid.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const cookie = await loadStoredCookie();
        if (cookie) {
          await refreshUser();
        }
      } catch {
        await clearSession();
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // A session that expires mid-use bounces to /login instead of dead-ending.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clearSession();
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signIn = async (email: string, password: string) => {
    await api('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      captureCookie: true,
    });
    // The login response doesn't include `onboarded` — only /api/me does, and
    // the root layout's redirect logic depends on that flag being accurate.
    await refreshUser();
  };

  const signUp = async (name: string, email: string, password: string) => {
    await api('/api/auth/signup', {
      method: 'POST',
      body: { name, email, password },
      captureCookie: true,
    });
    await refreshUser();
  };

  const signOut = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore — we clear locally regardless
    }
    await clearSession();
    // Otherwise the next account to sign in would briefly see this one's data.
    await clearCache();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
