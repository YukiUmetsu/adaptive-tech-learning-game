import { createContext, useContext } from "react";

/** Application-level view of the signed-in learner. */
export interface AuthUser {
  id: string;
  email: string | null;
}

/** Coarse authentication state used by the UI. */
export type AuthStatus = "loading" | "anonymous" | "authenticated";

/** Options accepted when starting a sign-in. */
export interface SignInOptions {
  /** Internal path to return to after a successful sign-in. */
  returnTo?: string;
  /** Email to pre-fill on the hosted sign-in page. */
  loginHint?: string;
}

/** Auth facade so components never call the WorkOS SDK directly. */
export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Whether a real WorkOS client id is configured. */
  configured: boolean;
  /** Whether the local/test developer sign-in is available. */
  devSignIn: boolean;
  /** Starts sign-in. Resolves for local sign-in; WorkOS redirects the page. */
  signIn: (options?: SignInOptions) => Promise<void>;
  /** Ends the session. */
  signOut: () => Promise<void>;
  /** Returns a bearer token for API calls, or `null` when anonymous. */
  getAccessToken: () => Promise<string | null>;
}

const anonymousFallback: AuthContextValue = {
  status: "anonymous",
  user: null,
  configured: false,
  devSignIn: false,
  signIn: async () => {},
  signOut: async () => {},
  getAccessToken: async () => null,
};

/**
 * Default is an anonymous, no-op session so components can render without a
 * provider (for example in isolated unit tests) instead of crashing.
 */
export const AuthContext = createContext<AuthContextValue>(anonymousFallback);

/** Access the current auth state. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
