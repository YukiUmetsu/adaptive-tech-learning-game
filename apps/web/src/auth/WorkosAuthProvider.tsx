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

/** Bridges the WorkOS SDK into the project auth facade. */
function WorkosBridge({ children }: { children: ReactNode }) {
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

  useEffect(() => {
    setAccessTokenProvider(getToken);
    return () => setAccessTokenProvider(null);
  }, [getToken]);

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
 * through React Router rather than a full page reload: the SDK only persists the
 * session across reloads on localhost, so reloading would drop the session on
 * other hosts and leave the UI looking signed out.
 */
export default function WorkosAuthProvider({
  clientId,
  children,
}: {
  clientId: string;
  children: ReactNode;
}) {
  // Optional custom AuthKit authentication domain. Defaults to api.workos.com.
  const apiHostname = import.meta.env.VITE_WORKOS_API_HOSTNAME?.trim();
  const navigate = useNavigate();

  return (
    <AuthKitProvider
      clientId={clientId}
      apiHostname={apiHostname || undefined}
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
      <WorkosBridge>{children}</WorkosBridge>
    </AuthKitProvider>
  );
}
