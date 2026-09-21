import { useEffect } from "react";

import {
  startFocusRuntime,
  stopFocusRuntime,
  syncFocusRuntime,
} from "../state/focus";
import { useUserPreferences } from "../state/preferences";

/**
 * Owns the Focus engine lifecycle.
 *
 * Mounted once by the app shell and renders nothing. It keeps the engine
 * running even when the floating widget is hidden, so tracking follows the
 * Focus preference rather than the widget's visibility.
 */
export default function FocusRuntime() {
  const preferences = useUserPreferences();

  useEffect(() => {
    startFocusRuntime();
    return () => stopFocusRuntime();
  }, []);

  useEffect(() => {
    syncFocusRuntime();
  }, [
    preferences.focus.enabled,
    preferences.focus.idleTimeoutMinutes,
    preferences.focus.breakAfterMinutes,
    preferences.focus.breakDurationMinutes,
  ]);

  return null;
}
