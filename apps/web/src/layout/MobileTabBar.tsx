import { NavLink } from "react-router-dom";

import { useAuth } from "../auth/context";
import { useDailyMissionHref } from "../hooks/useDailyMissionHref";

interface Tab {
  id: string;
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
  const dailyMissionHref = useDailyMissionHref();

  const tabs: Tab[] = [
    { id: "home", to: "/", label: "Home", icon: "🏠", end: true },
    { id: "tracks", to: "/tracks", label: "Tracks", icon: "🗺️" },
    // Signed-in learners get today's mission instead of the public demo; the
    // label stays short to match the other tab-bar destinations. The id keeps
    // the key unique when the fallback href equals the Tracks tab.
    status === "authenticated"
      ? { id: "daily", to: dailyMissionHref, label: "Daily", icon: "✨" }
      : { id: "demo", to: "/demo", label: "Demo", icon: "✨" },
    { id: "account", to: "/account", label: accountLabel, icon: "👤" },
  ];

  return (
    <nav className="mobile-tabbar" aria-label="Primary">
      {tabs.map((tab) => (
        <NavLink key={tab.id} to={tab.to} end={tab.end} className="mobile-tab">
          <span className="mobile-tab-icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span className="mobile-tab-label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
