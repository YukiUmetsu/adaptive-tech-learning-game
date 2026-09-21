import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { prefersReducedMotion } from "../lib/motion";
import {
  keepGoing,
  pauseFocus,
  resumeFocus,
  startBreak,
  startFocus,
  useFocus,
  type FocusView,
} from "../state/focus";
import { useFocusDaily } from "../state/focusDaily";
import { useUserPreferences } from "../state/preferences";

const MINUTE = 60_000;
const QUICK_BREAK_MINUTES = [2, 3, 5, 10];
/** Grace period so the pointer can cross the gap between pill and panel. */
const HOVER_CLOSE_DELAY_MS = 260;

function formatMinutes(ms: number): string {
  return `${Math.floor(Math.max(0, ms) / MINUTE)} min`;
}

function formatCompactMinutes(ms: number): string {
  return `${Math.floor(Math.max(0, ms) / MINUTE)}m`;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

type WidgetTone =
  | "focusing"
  | "break"
  | "break_complete"
  | "paused"
  | "reminder"
  | "inactive";

function viewTone(view: FocusView): WidgetTone {
  if (view.reminderDue) {
    return "reminder";
  }
  switch (view.state) {
    case "focusing":
      return "focusing";
    case "break":
      return "break";
    case "break_complete":
      return "break_complete";
    case "idle":
    case "manually_paused":
      return "paused";
    default:
      return "inactive";
  }
}

function viewIcon(view: FocusView): string {
  switch (viewTone(view)) {
    case "focusing":
      return "🧠";
    case "break":
    case "break_complete":
    case "reminder":
      return "☕";
    case "paused":
      return "💤";
    default:
      return "🧠";
  }
}

/** Collapsed text only; the emoji moves into the orb so it is not doubled. */
function collapsedText(view: FocusView): string {
  if (view.reminderDue) {
    return `Break? ${formatCompactMinutes(view.currentFocusMs)}`;
  }
  switch (view.state) {
    case "focusing":
      return formatCompactMinutes(view.currentFocusMs);
    case "break":
      return view.breakComplete
        ? "Break complete"
        : formatClock(view.breakRemainingMs);
    case "break_complete":
      return "Break complete";
    case "idle":
    case "manually_paused":
      return "Paused";
    default:
      return "Focus";
  }
}

function statusLabel(view: FocusView): string {
  switch (viewTone(view)) {
    case "focusing":
      return "Focusing";
    case "break":
      return "On a break";
    case "break_complete":
      return "Break complete";
    case "reminder":
      return "Break suggested";
    case "paused":
      return "Paused";
    default:
      return "Ready";
  }
}

function heroLabel(view: FocusView): string {
  switch (viewTone(view)) {
    case "focusing":
      return "Focus time";
    case "break":
      return "Break ends in";
    case "break_complete":
      return "Break complete";
    case "paused":
      return "Paused";
    default:
      return "Ready to focus";
  }
}

function heroValue(view: FocusView): string {
  switch (viewTone(view)) {
    case "focusing":
      return formatMinutes(view.currentFocusMs);
    case "break":
      return formatClock(view.breakRemainingMs);
    case "break_complete":
      return "Resume";
    case "paused":
      return formatMinutes(view.todayActiveMs);
    default:
      return "0 min";
  }
}

/** Progress of the current state toward its natural completion. */
function ringProgress(view: FocusView, breakAfterMinutes: number, breakDurationMinutes: number): number {
  switch (view.state) {
    case "focusing": {
      const target = breakAfterMinutes * MINUTE;
      return target > 0 ? Math.min(1, view.currentFocusMs / target) : 0;
    }
    case "break": {
      const total = breakDurationMinutes * MINUTE;
      return total > 0 ? 1 - Math.min(1, view.breakRemainingMs / total) : 0;
    }
    case "break_complete":
      return 1;
    default:
      return 0;
  }
}

function FocusRing({ progress, large = false }: { progress: number; large?: boolean }) {
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    <svg
      className={`focus-ring${large ? " focus-ring--large" : ""}`}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="focus-ring-track" cx="20" cy="20" r={radius} />
      <circle
        className="focus-ring-value"
        cx="20"
        cy="20"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
      />
    </svg>
  );
}

/**
 * Floating Focus widget.
 *
 * Lives in the app shell so it survives navigation. Collapsed by default and
 * never blocks learning. Expansion is pointer- and keyboard-driven in React
 * state (not CSS `:hover`), with a grace period so the pointer can travel from
 * the pill into the panel without it closing. The timer text is not a live
 * region, so screen readers are not flooded.
 */
export default function FocusWidget() {
  const preferences = useUserPreferences();
  const view = useFocus();
  const daily = useFocusDaily();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hoverCloseTimer = useRef<number | null>(null);
  const reduced = prefersReducedMotion();
  const enabled = preferences.focus.enabled;

  const cancelHoverClose = () => {
    if (hoverCloseTimer.current !== null) {
      window.clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
  };

  useEffect(() => () => cancelHoverClose(), []);

  useEffect(() => {
    if (!enabled) {
      setExpanded(false);
      setHovered(false);
    }
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  const open = expanded || hovered;
  const tone = viewTone(view);
  const progress = ringProgress(
    view,
    preferences.focus.breakAfterMinutes,
    preferences.focus.breakDurationMinutes,
  );
  const showBreakComplete =
    view.state === "break_complete" ||
    (view.state === "break" && view.breakComplete);
  const dailyPercent =
    daily && daily.total > 0
      ? Math.round((daily.completed / daily.total) * 100)
      : 0;

  const continueMission = () => {
    if (daily) {
      navigate(`/tracks/${daily.trackId}/daily`);
    }
  };

  return (
    <aside
      className={`focus-widget focus-widget--${tone}${
        open ? " focus-widget--open" : ""
      }${reduced ? " focus-widget--reduced" : ""}`}
      aria-label="Focus tracker"
      onMouseEnter={() => {
        cancelHoverClose();
        setHovered(true);
      }}
      onMouseLeave={() => {
        cancelHoverClose();
        hoverCloseTimer.current = window.setTimeout(() => {
          hoverCloseTimer.current = null;
          setHovered(false);
        }, HOVER_CLOSE_DELAY_MS);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setExpanded(false);
          setHovered(false);
        }
      }}
    >
      <button
        type="button"
        className="focus-widget-collapsed"
        data-testid="focus-widget-toggle"
        aria-expanded={open}
        aria-controls="focus-widget-panel"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="focus-widget-orb" aria-hidden="true">
          <FocusRing progress={progress} />
          <span className="focus-widget-orb-icon">{viewIcon(view)}</span>
        </span>
        <span className="focus-widget-collapsed-label">
          {collapsedText(view)}
        </span>
        {daily ? (
          <span
            className="focus-widget-daily-badge"
            aria-label={`Daily Mission ${daily.completed} of ${daily.total} complete`}
          >
            <span aria-hidden="true">⚡</span> {daily.completed}/{daily.total}
          </span>
        ) : null}
      </button>

      <div id="focus-widget-panel" className="focus-widget-panel">
        <header className="focus-widget-head">
          <span className="focus-widget-title">Focus</span>
          <span className="focus-widget-status">{statusLabel(view)}</span>
        </header>

        <div className="focus-widget-hero">
          <div className="focus-widget-hero-orb" aria-hidden="true">
            <FocusRing progress={progress} large />
            <span className="focus-widget-hero-icon">{viewIcon(view)}</span>
          </div>
          <div className="focus-widget-hero-copy">
            <p className="focus-widget-hero-label">{heroLabel(view)}</p>
            <p className="focus-widget-hero-value">{heroValue(view)}</p>
          </div>
        </div>

        <dl className="focus-widget-metrics">
          <div className="focus-widget-metric">
            <dt>Today</dt>
            <dd>{formatMinutes(view.todayActiveMs)}</dd>
          </div>
          <div className="focus-widget-metric">
            <dt>Current focus</dt>
            <dd>{formatMinutes(view.currentFocusMs)}</dd>
          </div>
          <div className="focus-widget-metric">
            <dt>Breaks</dt>
            <dd>{formatMinutes(view.todayBreakMs)}</dd>
          </div>
        </dl>

        {daily ? (
          <section className="focus-widget-daily" aria-label="Daily Mission">
            <div className="focus-widget-daily-head">
              <span className="focus-widget-section-title">Daily Mission</span>
              <span className="focus-widget-daily-count">
                {daily.completed} / {daily.total}
              </span>
            </div>
            <div
              className="focus-widget-daily-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={daily.total}
              aria-valuenow={daily.completed}
              aria-label="Daily Mission progress"
            >
              <span style={{ width: `${dailyPercent}%` }} />
            </div>
            {daily.nextTitle ? (
              <p className="focus-widget-next">
                <span className="focus-widget-next-label">Next</span>
                {daily.nextTitle}
                {daily.nextMinutes != null ? (
                  <span className="muted"> · ~{daily.nextMinutes} min</span>
                ) : null}
              </p>
            ) : null}
            <button
              type="button"
              className="primary focus-widget-continue"
              onClick={continueMission}
            >
              Continue Mission
            </button>
          </section>
        ) : null}

        {view.reminderDue ? (
          <section
            className="focus-widget-reminder"
            aria-label="Break suggestion"
          >
            <p>
              You&apos;ve been focused for{" "}
              {Math.floor(view.currentFocusMs / MINUTE)} minutes.
            </p>
            <div className="focus-widget-actions">
              <button type="button" className="primary" onClick={() => startBreak()}>
                Take {preferences.focus.breakDurationMinutes} min break
              </button>
              <button type="button" onClick={keepGoing}>
                Keep going
              </button>
            </div>
          </section>
        ) : null}

        <div className="focus-widget-actions">
          {view.state === "focusing" ? (
            <>
              <button type="button" onClick={() => startBreak()}>
                ☕ Take a break
              </button>
              <button type="button" onClick={pauseFocus}>
                ⏸ Pause
              </button>
            </>
          ) : null}

          {view.state === "break" && !view.breakComplete ? (
            <button type="button" className="primary" onClick={resumeFocus}>
              Resume now
            </button>
          ) : null}

          {showBreakComplete ? (
            <button type="button" className="primary" onClick={resumeFocus}>
              Resume
            </button>
          ) : null}

          {view.state === "idle" || view.state === "manually_paused" ? (
            <button type="button" className="primary" onClick={resumeFocus}>
              Resume
            </button>
          ) : null}

          {view.state === "inactive" ? (
            <button type="button" className="primary" onClick={startFocus}>
              Start focusing
            </button>
          ) : null}
        </div>

        {view.state === "focusing" ? (
          <div
            className="focus-widget-break-options"
            aria-label="Quick break lengths"
          >
            {QUICK_BREAK_MINUTES.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => startBreak(minutes)}
              >
                {minutes} min
              </button>
            ))}
          </div>
        ) : null}

        {view.state === "focusing" &&
        !view.reminderDue &&
        view.nextBreakInMs != null ? (
          <p className="focus-widget-hint">
            Next break suggested in ~
            {Math.max(1, Math.ceil(view.nextBreakInMs / MINUTE))} min
          </p>
        ) : null}

        <Link className="focus-widget-settings" to="/settings#focus">
          <span aria-hidden="true">⚙</span> Focus settings
        </Link>
      </div>
    </aside>
  );
}
