import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth/context";
import { resetWallet } from "../state/wallet";

/**
 * Shared sign-out behaviour.
 *
 * Ends the session, clears the cached wallet, and returns home. Used by the app
 * header and the Settings Account section so both paths stay identical.
 */
export function useSignOut(): () => Promise<void> {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  return useCallback(async () => {
    await signOut();
    resetWallet();
    navigate("/");
  }, [signOut, navigate]);
}
