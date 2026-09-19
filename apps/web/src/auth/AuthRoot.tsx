import { type ReactNode } from "react";

import LocalAuthProvider from "./LocalAuthProvider";
import WorkosAuthProvider from "./WorkosAuthProvider";

const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID?.trim();

/**
 * Chooses the auth provider at the application root.
 *
 * With a WorkOS client id the official AuthKit SDK drives sign-in, session
 * restoration, refresh, and logout. Without one the app stays usable
 * anonymously and developers may opt into the local dev identity.
 */
export default function AuthRoot({ children }: { children: ReactNode }) {
  if (clientId) {
    return <WorkosAuthProvider clientId={clientId}>{children}</WorkosAuthProvider>;
  }
  return <LocalAuthProvider>{children}</LocalAuthProvider>;
}
