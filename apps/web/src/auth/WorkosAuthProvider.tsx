import { AuthKitProvider, useAuth as useWorkosAuth } from "@workos-inc/authkit-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

import {
  AuthContext,
  type AuthContextValue,
  type AuthUser,
  type SignInOptions,
} from "./context";
import { sanitizeReturnTo } from "./returnTo";
import { setAccessTokenProvider } from "./token";
import { isFirstPartyAuthHost, sanitizeWorkosApiHostname } from "./workosHostname";
import { hasPersistedWorkosSession } from "./workosSession";

/** Storage key for the one-shot cross-tab session recovery attempt. */
const RECOVERY_ATTEMPT_KEY = "adaptive-learn.workos-recovery-attempted";

/** Bridges the WorkOS SDK into the project auth facade. */
function WorkosBridge({
  clientId,
  children,
}: {
  clientId: string;
  children: ReactNode;
}) {
  const { isLoading, user, getAccessToken, signIn, signOut } = useWorkosAuth();

  // The SDK strips the OAuth query string quickly, so read it once on the first
  // render. This is how we detect a callback that failed to establish a session
  // and capture the provider's error code/reason (never any token material).
  const [callback] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return {
        hadCode: params.has("code"),
        error: params.get("error"),
        errorDescription: params.get("error_description"),
      };
    } catch {
      return { hadCode: false, error: null, errorDescription: null };
    }
  });

  const authError = useMemo(() => {
    if (isLoading || user) {
      return null;
    }
    if (callback.error) {
      return `WorkOS rejected sign-in (${callback.error}${
        callback.errorDescription ? `: ${callback.errorDescription}` : ""
      }).`;
    }
    if (callback.hadCode) {
      return "Sign-in didn't complete. Make sure the WorkOS redirect URI matches this exact app origin and that sign-in started from the app. See the browser console for AuthKit details.";
    }
    return null;
  }, [isLoading, user, callback]);

  useEffect(() => {
    if (authError) {
      // No secrets are logged: only the provider error code and a short reason.
      console.error("[auth]", authError, callback);
    }
  }, [authError, callback]);

  // Cross-tab recovery. When sign-in completes in another window (an installed
  // PWA opens the WorkOS navigation in a new tab) the original window never saw
  // the callback. Once it can see persisted session material, reload once so
  // the SDK restores the session on initialize. The sessionStorage guard keeps
  // an invalid session from causing a reload loop.
  useEffect(() => {
    if (isLoading || user) {
      return;
    }
    const attempted = () => {
      try {
        return window.sessionStorage.getItem(RECOVERY_ATTEMPT_KEY) === "1";
      } catch {
        return true;
      }
    };
    const maybeRecover = () => {
      if (attempted()) {
        return;
      }
      if (document.visibilityState === "hidden") {
        return;
      }
      if (!hasPersistedWorkosSession(clientId)) {
        return;
      }
      try {
        window.sessionStorage.setItem(RECOVERY_ATTEMPT_KEY, "1");
      } catch {
        // If the guard cannot be stored, still attempt one recovery.
      }
      window.location.reload();
    };
    window.addEventListener("storage", maybeRecover);
    document.addEventListener("visibilitychange", maybeRecover);
    maybeRecover();
    return () => {
      window.removeEventListener("storage", maybeRecover);
      document.removeEventListener("visibilitychange", maybeRecover);
    };
  }, [isLoading, user, clientId]);

  const appUser: AuthUser | null = useMemo(
    () =>
      user
        ? {
            id: user.id,
            email: user.email ?? null,
            name:
              [user.firstName, user.lastName]
                .filter((part): part is string => Boolean(part))
                .join(" ") || null,
            avatarUrl: user.profilePictureUrl ?? null,
          }
        : null,
    [user],
  );

  const getToken = useCallback(async (): Promise<string | null> => {
    try {
      const token = await getAccessToken();
      return token ?? null;
    } catch {
      // LoginRequiredError or a refresh failure: caller becomes anonymous.
      return null;
    }
  }, [getAccessToken]);

  const startSignIn = useCallback(
    async (options?: SignInOptions): Promise<void> => {
      // WorkOS state round-trips through the redirect; only a sanitized internal
      // path is ever forwarded, and the callback re-validates it.
      const state = options?.returnTo
        ? { returnTo: sanitizeReturnTo(options.returnTo) }
        : undefined;
      await signIn({ state, loginHint: options?.loginHint });
    },
    [signIn],
  );

  const endSession = useCallback(async (): Promise<void> => {
    signOut({ returnTo: window.location.origin });
  }, [signOut]);

  // Register the token getter during render so the first child effects (wallet,
  // Daily Mission, recommendation) can attach a bearer token. React runs child
  // effects before parent effects, so an effect-only registration would let the
  // first protected requests go out unauthenticated. The getter is re-registered
  // every render and cleared only on unmount.
  setAccessTokenProvider(getToken);
  useEffect(() => {
    return () => setAccessTokenProvider(null);
  }, []);
  const value: AuthContextValue = useMemo(
    () => ({
      status: isLoading ? "loading" : user ? "authenticated" : "anonymous",
      user: appUser,
      configured: true,
      devSignIn: false,
      authError,
      signIn: startSignIn,
      signOut: endSession,
      getAccessToken: getToken,
    }),
    [
      isLoading,
      user,
      appUser,
      authError,
      startSignIn,
      endSession,
      getToken,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Official WorkOS AuthKit provider.
 *
 * `onRedirectCallback` runs after the hosted sign-in redirect and returns the
 * learner to the internal path they started from. Navigation is done client-side
 * through React Router rather than a full page reload so the callback does not
 * flash the map.
 *
 * Session persistence depends on the auth host: a first-party custom AuthKit
 * domain restores the session from an httpOnly cookie, while the default
 * `api.workos.com` cannot (the cookie is third-party and the refresh call fails
 * with HTTP 400), so `devMode` persists the refresh token in localStorage
 * instead. Sign-in opened from an installed PWA can also complete in another
 * window; the bridge reloads once when it can see persisted session material.
 */
export default function WorkosAuthProvider({
  clientId,
  children,
}: {
  clientId: string;
  children: ReactNode;
}) {
  // Optional custom AuthKit authentication domain. Defaults to api.workos.com.
  // The app's own host is rejected: pointing AuthKit's API at the static host
  // would send the learner to the SPA fallback instead of the hosted login.
  const configuredHostname = import.meta.env.VITE_WORKOS_API_HOSTNAME;
  const apiHostname = sanitizeWorkosApiHostname(
    configuredHostname,
    window.location.host,
  );
  // The SDK persists the session in an httpOnly cookie only when the auth host
  // is first-party. With the default api.workos.com that cookie is third-party,
  // so the refresh call fails with HTTP 400 and every reload signs the learner
  // out. `devMode` keeps the refresh token in localStorage for this origin
  // instead, which is WorkOS's documented fallback until a custom
  // authentication domain (for example auth.shidenlabs.com) is configured.
  const devMode = !isFirstPartyAuthHost(apiHostname, window.location.host);
  useEffect(() => {
    if (configuredHostname?.trim() && !apiHostname) {
      console.warn(
        "[auth] Ignoring VITE_WORKOS_API_HOSTNAME because it is empty, " +
          "malformed, or points at this app's own host. Falling back to " +
          "api.workos.com. Set it only to a WorkOS AuthKit authentication " +
          "domain.",
      );
    } else if (devMode) {
      console.warn(
        "[auth] No first-party WorkOS authentication domain is configured, " +
          "so the session is persisted in localStorage for this origin. " +
          "Configure a custom AuthKit domain (for example " +
          "auth.shidenlabs.com) and set VITE_WORKOS_API_HOSTNAME to it for " +
          "cookie-based sessions.",
      );
    }
  }, [configuredHostname, apiHostname, devMode]);
  const navigate = useNavigate();

  return (
    <AuthKitProvider
      clientId={clientId}
      apiHostname={apiHostname || undefined}
      devMode={devMode}
      redirectUri={window.location.origin}
      onRedirectCallback={(params) => {
        const rawState = (params as { state?: unknown } | undefined)?.state;
        let state: unknown = rawState;
        if (typeof rawState === "string") {
          try {
            state = JSON.parse(rawState);
          } catch {
            state = undefined;
          }
        }
        const returnTo =
          state && typeof state === "object"
            ? sanitizeReturnTo((state as { returnTo?: unknown }).returnTo)
            : null;
        navigate(returnTo ?? "/", { replace: true });
      }}
    >
      <WorkosBridge clientId={clientId}>{children}</WorkosBridge>
    </AuthKitProvider>
  );
}
