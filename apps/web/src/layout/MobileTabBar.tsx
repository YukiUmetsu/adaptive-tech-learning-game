import { NavLink } from "react-router-dom";

import { useAuth } from "../auth/context";

interface Tab {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}

/**
 * Bottom tab bar for the mobile shell.
 *
 * Primary destinations live in the thumb zone with icons and labels, matching
 * the common iOS/Android pattern (3–5 persistent destinations, ≥44px targets).
 * Secondary items (account, sign out) stay on their own pages rather than
 * being hidden behind a hamburger menu.
 */
export default function MobileTabBar() {
  const { status } = useAuth();
  const accountLabel = status === "authenticated" ? "Account" : "Sign in";

  const tabs: Tab[] = [
    { to: "/", label: "Home", icon: "🏠", end: true },
    { to: "/tracks", label: "Tracks", icon: "🗺️" },
    { to: "/demo", label: "Demo", icon: "✨" },
    { to: "/account", label: accountLabel, icon: "👤" },
  ];

  return (
    <nav className="mobile-tabbar" aria-label="Primary">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className="mobile-tab">
          <span className="mobile-tab-icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span className="mobile-tab-label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
