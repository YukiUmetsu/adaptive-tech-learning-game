import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth/context";
import { resetStoryAcknowledgements } from "../game/persistence/storyAck";
import { resetCyberProfile } from "../game/state/cyberProfile";
import { flushCyberTelemetry } from "../game/state/cyberTelemetry";
import { publishFocusDaily } from "../state/focusDaily";
import { resetWallet } from "../state/wallet";

/**
 * Shared sign-out behaviour.
 *
 * Ends the session, flushes buffered telemetry, clears the cached wallet and
 * Cyber Defense profile, the Focus widget's Daily Mission projection, and local
 * story acknowledgement, then returns home. Used by the app header and the
 * Settings Account section so both paths stay identical.
 */
export function useSignOut(): () => Promise<void> {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  return useCallback(async () => {
    await flushCyberTelemetry();
    await signOut();
    resetWallet();
    resetCyberProfile();
    resetStoryAcknowledgements();
    // The projection is a display cache of another account's mission.
    publishFocusDaily(null);
    navigate("/");
  }, [signOut, navigate]);
}
