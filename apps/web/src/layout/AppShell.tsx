import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../auth/context";
import BitsFlyOverlay from "../components/BitsFlyOverlay";
import BitsHud from "../components/BitsHud";
import FocusRuntime from "../components/FocusRuntime";
import FocusWidget from "../components/FocusWidget";
import PreferencesEffects from "../components/PreferencesEffects";
import { MOBILE_NAV_QUERY, useMediaQuery } from "../hooks/useMediaQuery";
import { useSignOut } from "../hooks/useSignOut";
import { flushAuxiliary } from "../state/syncAuxiliary";
import { refreshWallet, resetWallet } from "../state/wallet";
import LearningTracksNav from "./LearningTracksNav";
import MobileTabBar from "./MobileTabBar";

/** Generic account glyph used when the provider has no profile picture. */
function AccountIcon() {
  return (
    <svg
      className="account-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19.5c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
    </svg>
  );
}

/** Settings gear glyph used in the header in place of the old audio toggle. */
function SettingsIcon() {
  return (
    <svg
      className="settings-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default function AppShell() {
  const { status, user } = useAuth();
  const handleSignOut = useSignOut();
  const isMobileNav = useMediaQuery(MOBILE_NAV_QUERY);

  useEffect(() => {
    if (status === "authenticated") {
      void refreshWallet();
    } else if (status === "anonymous") {
      resetWallet();
    }
  }, [status]);

  // Returning online is a natural boundary to flush queued auxiliary work.
  // No polling timer is introduced.
  useEffect(() => {
    const handleOnline = () => {
      void flushAuxiliary();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  return (
    <div className={`app-shell${isMobileNav ? " app-shell--mobile" : ""}`}>
      <PreferencesEffects />
      <FocusRuntime />
      <header className="app-header">
        <NavLink to="/" className="app-brand">
          Adaptive Learning
        </NavLink>
        {isMobileNav ? (
          <div className="app-header-actions">
            {status === "authenticated" ? <BitsHud size="sm" /> : null}
            <NavLink
              to="/settings"
              className="settings-link"
              aria-label="Settings"
              title="Settings"
            >
              <SettingsIcon />
            </NavLink>
          </div>
        ) : (
          <nav aria-label="Primary">
            <NavLink to="/" end>
              Home
            </NavLink>
            <LearningTracksNav />
            <NavLink to="/demo">Demo</NavLink>
            {status === "authenticated" ? (
              <>
                <BitsHud size="sm" />
                <div className="account-menu">
                  <NavLink
                    to="/account"
                    className="account-avatar"
                    aria-label="Account"
                    title={user?.name ?? "Account"}
                  >
                    {user?.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <AccountIcon />
                    )}
                  </NavLink>
                  <button
                    type="button"
                    className="account-signout"
                    onClick={() => void handleSignOut()}
                  >
                    Sign out
                  </button>
                </div>
              </>
            ) : status === "loading" ? (
              <span className="muted auth-loading" role="status">
                Checking session…
              </span>
            ) : (
              <NavLink to="/login" className="auth-sign-in">
                Sign in
              </NavLink>
            )}
            <NavLink
              to="/settings"
              className="settings-link"
              aria-label="Settings"
              title="Settings"
            >
              <SettingsIcon />
            </NavLink>
          </nav>
        )}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <div className="app-footer-brand">
          <span className="app-footer-name">Adaptive Learning</span>
          <span className="app-footer-tagline">
            Build knowledge. Unlock opportunity.
          </span>
        </div>
        <nav className="app-footer-nav" aria-label="Footer">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/tracks">Learning Tracks</NavLink>
          <NavLink to="/demo">Demo</NavLink>
        </nav>
        <p className="app-footer-copy">
          © {new Date().getFullYear()} Adaptive Learning. All rights reserved.
        </p>
      </footer>
      {isMobileNav ? <MobileTabBar /> : null}
      <BitsFlyOverlay />
      <FocusWidget />
    </div>
  );
}
