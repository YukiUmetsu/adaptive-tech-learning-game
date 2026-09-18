import { NavLink, Outlet } from "react-router-dom";

export default function AppShell() {
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
