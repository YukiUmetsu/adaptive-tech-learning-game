import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/context";
import BitsFlyOverlay from "../components/BitsFlyOverlay";
import BitsHud from "../components/BitsHud";
import { toggleSoundMuted, useSoundMuted } from "../state/sound";
import { flushAuxiliary } from "../state/syncAuxiliary";
import { refreshWallet, resetWallet } from "../state/wallet";
import LearningTracksNav from "./LearningTracksNav";

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

export default function AppShell() {
  const muted = useSoundMuted();
  const { status, user, signOut } = useAuth();
  const navigate = useNavigate();

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

  const handleSignOut = async () => {
    await signOut();
    resetWallet();
    navigate("/");
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink to="/" className="app-brand">
          Adaptive Learning
        </NavLink>
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
          <button
            type="button"
            className="sound-toggle"
            aria-pressed={muted}
            aria-label={muted ? "Unmute sound effects" : "Mute sound effects"}
            onClick={toggleSoundMuted}
          >
            <span aria-hidden="true">{muted ? "🔇" : "🔊"}</span>
          </button>
        </nav>
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
      <BitsFlyOverlay />
    </div>
  );
}
