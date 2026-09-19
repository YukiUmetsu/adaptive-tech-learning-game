import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/context";
import BitsHud from "../components/BitsHud";
import { toggleSoundMuted, useSoundMuted } from "../state/sound";
import { refreshWallet, resetWallet } from "../state/wallet";

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
          <NavLink to="/certifications">Certifications</NavLink>
          <NavLink to="/demo">Demo</NavLink>
          {status === "authenticated" ? (
            <>
              <BitsHud size="sm" />
              <div className="account-menu">
                <NavLink to="/account" className="account-email">
                  {user?.email ?? "Account"}
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
          <NavLink to="/certifications">Certifications</NavLink>
          <NavLink to="/demo">Demo</NavLink>
        </nav>
        <p className="app-footer-copy">
          © {new Date().getFullYear()} Adaptive Learning. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
