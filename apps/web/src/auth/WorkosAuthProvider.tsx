import { AuthKitProvider, useAuth as useWorkosAuth } from "@workos-inc/authkit-react";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";

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

  const appUser: AuthUser | null = useMemo(
    () => (user ? { id: user.id, email: user.email ?? null } : null),
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
      signIn: startSignIn,
      signOut: endSession,
      getAccessToken: getToken,
    }),
    [isLoading, user, appUser, startSignIn, endSession, getToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Official WorkOS AuthKit provider.
 *
 * `onRedirectCallback` runs after the hosted sign-in redirect and returns the
 * learner to the internal path they started from, validated against the current
 * origin to prevent open redirects.
 */
export default function WorkosAuthProvider({
  clientId,
  children,
}: {
  clientId: string;
  children: ReactNode;
}) {
  return (
    <AuthKitProvider
      clientId={clientId}
      onRedirectCallback={(params) => {
        const state = (params as { state?: unknown } | undefined)?.state;
        const returnTo =
          state && typeof state === "object"
            ? sanitizeReturnTo((state as { returnTo?: unknown }).returnTo)
            : null;
        if (returnTo) {
          window.location.assign(returnTo);
        }
      }}
    >
      <WorkosBridge>{children}</WorkosBridge>
    </AuthKitProvider>
  );
}
