import { NavLink, Outlet } from "react-router-dom";

import { toggleSoundMuted, useSoundMuted } from "../state/sound";

export default function AppShell() {
  const muted = useSoundMuted();

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
        Phase 1 · AWS SOA-C03 · free demo available
      </footer>
    </div>
  );
}
