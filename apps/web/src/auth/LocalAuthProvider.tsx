import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  AuthContext,
  type AuthContextValue,
  type AuthUser,
  type SignInOptions,
} from "./context";
import { setAccessTokenProvider } from "./token";

/**
 * Key for the local developer subject.
 *
 * `sessionStorage` (not `localStorage`) is deliberate: real access tokens are
 * never persisted by the app, and the local dev identity should not outlive the
 * browser session.
 */
const DEV_SUBJECT_KEY = "adaptive-learn.dev-subject";

/** Hostnames where the developer sign-in is safe to offer. */
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function isLocalHost(): boolean {
  try {
    return DEV_HOSTS.has(window.location.hostname);
  } catch {
    return false;
  }
}

/**
 * Local dev sign-in is available in dev builds, on a localhost hostname (so a
 * production build served with `vite preview` still works locally), or with an
 * explicit opt-in. It is never shown on a real deployed domain, and the API
 * still rejects `dev:` tokens unless it is itself running in local/test mode.
 */
const devSignInEnabled =
  import.meta.env.DEV ||
  import.meta.env.VITE_AUTH_DEV_MODE === "true" ||
  isLocalHost();

function readDevSubject(): string | null {
  try {
    return window.sessionStorage.getItem(DEV_SUBJECT_KEY);
  } catch {
    return null;
  }
}

/**
 * Auth provider used when no WorkOS client id is configured.
 *
 * Production builds without WorkOS configuration stay anonymous for real users;
 * developers can opt into an explicit `dev:<subject>` bearer token that the API
 * accepts only in local/test environments.
 */
export default function LocalAuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [subject, setSubject] = useState<string | null>(() => readDevSubject());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(false);
  }, []);

  const user: AuthUser | null = useMemo(
    () => (subject ? { id: subject, email: null } : null),
    [subject],
  );

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const current = readDevSubject();
    return current ? `dev:${current}` : null;
  }, []);

  const signIn = useCallback(async (options?: SignInOptions): Promise<void> => {
    if (!devSignInEnabled) {
      return;
    }
    const next = options?.loginHint?.trim() || "local-user";
    try {
      window.sessionStorage.setItem(DEV_SUBJECT_KEY, next);
    } catch {
      // Storage unavailable: keep the in-memory session only.
    }
    setSubject(next);
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      window.sessionStorage.removeItem(DEV_SUBJECT_KEY);
    } catch {
      // ignore
    }
    setSubject(null);
  }, []);

  // Register during render so the first child effects can attach a bearer
  // token; see WorkosAuthProvider for why an effect-only registration is racy.
  setAccessTokenProvider(getAccessToken);
  useEffect(() => {
    return () => setAccessTokenProvider(null);
  }, []);

  const value: AuthContextValue = useMemo(
    () => ({
      status: loading ? "loading" : subject ? "authenticated" : "anonymous",
      user,
      configured: false,
      devSignIn: devSignInEnabled,
      authError: null,
      signIn,
      signOut,
      getAccessToken,
    }),
    [loading, subject, user, signIn, signOut, getAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
