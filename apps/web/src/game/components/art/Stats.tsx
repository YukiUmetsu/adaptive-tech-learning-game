import type { ReactNode } from "react";

/** One attribute shown with an icon and a value. */
export interface Stat {
  icon: ReactNode;
  /** Human-readable name, exposed to assistive tech. */
  label: string;
  value: string;
  tone?: "default" | "cost" | "danger";
}

/**
 * Compact attribute row (icon + value) used by tower cards and hero details.
 * The label is available via `title`/`aria-label`; the icon keeps it scannable.
 */
export default function StatsRow({ stats }: { stats: Stat[] }) {
  return (
    <ul className="game-stats" aria-label="Attributes">
      {stats.map((stat) => (
        <li
          key={stat.label}
          className={`game-stat${stat.tone ? ` is-${stat.tone}` : ""}`}
          title={stat.label}
          aria-label={`${stat.label}: ${stat.value}`}
        >
          <span className="game-stat-icon" aria-hidden="true">
            {stat.icon}
          </span>
          <span className="game-stat-value">{stat.value}</span>
        </li>
      ))}
    </ul>
  );
}
