import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { api, clearSession, loadStoredCookie, setUnauthorizedHandler } from './api';
import { clearCache } from './cache';
import { clearStoredUser, isSessionRejected, readStoredUser, writeStoredUser } from './session';

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
  signUp: (name: string, email: string, password: string, acceptedTerms: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/** How often to re-check a session we couldn't verify because we were offline. */
const RETRY_MS = 15_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // The launch check couldn't reach the server. The cookie is still good — we
  // just don't know who it belongs to yet.
  const [unverified, setUnverified] = useState(false);

  // Stable identity: screens subscribe to goal changes with this as a
  // dependency, and a fresh function each render would re-subscribe forever.
  const refreshUser = useCallback(async () => {
    const me = await api<{ user: User } | User>('/api/me');
    const next = (me as { user?: User }).user ?? (me as User);
    setUser(next);
    setUnverified(false);
    // Kept so the next launch can render signed-in before the network answers.
    void writeStoredUser(next);
  }, []);

  // On launch: if we have a stored session cookie, confirm it's still valid.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const cookie = await loadStoredCookie();
        if (!cookie) return;

        // Show the last known profile first. Offline, this is the whole of what
        // we'll get; online it's replaced a moment later by the real answer.
        const remembered = await readStoredUser();
        if (remembered && !cancelled) setUser(remembered);

        await refreshUser();
      } catch (e) {
        // Only the server can end a session. A request that never arrived —
        // no internet, DNS, a timeout — says nothing about whether the cookie
        // is still good, and signing out on it would be unrecoverable: the
        // cookie is gone even once the connection comes back.
        if (!isSessionRejected(e)) {
          if (!cancelled) setUnverified(true);
          return;
        }
        await clearSession();
        await clearStoredUser();
        if (!cancelled) setUser(null);
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

  // Someone who was offline at launch and had no remembered profile is sitting
  // on the login screen with a perfectly valid cookie. Foregrounding the app is
  // the cheapest signal that the connection may be back, so retry there and let
  // AuthGate walk them in — rather than making them type a password they
  // already gave us.
  useEffect(() => {
    if (!unverified) return;
    const attempt = () => {
      // A success clears `unverified` inside refreshUser itself, which tears
      // this effect down.
      void refreshUser().catch((e) => {
        if (!isSessionRejected(e)) return;
        setUnverified(false);
        void clearSession();
        void clearStoredUser();
        setUser(null);
      });
    };
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') attempt();
    });
    // ...and while they sit there, in case the connection returns without the
    // app ever leaving the foreground. Stops the moment the retry resolves
    // either way, so it can't poll forever.
    const timer = setInterval(attempt, RETRY_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [unverified, refreshUser]);

  // A session that expires mid-use bounces to /login instead of dead-ending.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clearSession();
      void clearStoredUser();
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

  const signUp = async (
    name: string,
    email: string,
    password: string,
    acceptedTerms: boolean
  ) => {
    await api('/api/auth/signup', {
      method: 'POST',
      // Only sent when actually true: the server records the policy version
      // against the account, and a field that is always present would make
      // "did they agree?" unanswerable.
      body: { name, email, password, ...(acceptedTerms ? { accepted_terms: true } : {}) },
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
    await clearStoredUser();
    setUser(null);
    setUnverified(false);
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
