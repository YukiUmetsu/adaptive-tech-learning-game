import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getFocusView,
  recordStudyActivity,
  resetFocusState,
  startBreak,
} from "../state/focus";
import { publishFocusDaily, resetFocusDaily } from "../state/focusDaily";
import {
  resetPreferences,
  updatePreferences,
  type FocusPreferences,
} from "../state/preferences";
import { restoreMatchMedia, setReducedMotion } from "../test/matchMedia";
import FocusWidget from "./FocusWidget";

const T0 = new Date("2026-09-20T10:00:00").getTime();
const MINUTE = 60_000;

function enableFocus(overrides: Partial<FocusPreferences> = {}): void {
  updatePreferences({
    focus: {
      enabled: true,
      autoDetectStudy: true,
      breakReminders: true,
      breakAfterMinutes: 25,
      breakDurationMinutes: 5,
      idleTimeoutMinutes: 30,
      ...overrides,
    },
  });
}

function renderWidget() {
  return render(
    <MemoryRouter>
      <FocusWidget />
    </MemoryRouter>,
  );
}

function renderWidgetWithRoutes() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<FocusWidget />} />
        <Route path="/tracks/:trackId/daily" element={<p>Daily mission page</p>} />
        <Route path="/settings" element={<p>Settings page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function expand(): void {
  fireEvent.click(screen.getByTestId("focus-widget-toggle"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetPreferences();
  resetFocusState();
  resetFocusDaily();
});

afterEach(() => {
  resetFocusState();
  resetFocusDaily();
  restoreMatchMedia();
  vi.useRealTimers();
});

describe("FocusWidget", () => {
  it("is hidden while Focus is disabled", () => {
    updatePreferences({ focus: { enabled: false } });
    renderWidget();
    expect(screen.queryByTestId("focus-widget-toggle")).not.toBeInTheDocument();
  });

  it("shows whenever Focus is enabled", () => {
    enableFocus();
    recordStudyActivity("reveal");
    renderWidget();

    expect(screen.getByTestId("focus-widget-toggle")).toBeInTheDocument();
    expect(getFocusView().state).toBe("focusing");
  });

  it("shows Current focus while collapsed", () => {
    enableFocus();
    recordStudyActivity("reveal");
    vi.advanceTimersByTime(16 * MINUTE);

    renderWidget();

    expect(screen.getByTestId("focus-widget-toggle")).toHaveTextContent("16m");
  });

  it("expands on click and shows Today / Current focus / Breaks", () => {
    enableFocus();
    recordStudyActivity("reveal");
    vi.advanceTimersByTime(MINUTE);

    renderWidget();
    const toggle = screen.getByTestId("focus-widget-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    expand();

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Current focus")).toBeInTheDocument();
    expect(screen.getByText("Breaks")).toBeInTheDocument();
  });

  it("collapses on Escape and links to Focus settings", () => {
    enableFocus();
    renderWidget();
    expand();
    expect(screen.getByTestId("focus-widget-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    expect(
      screen.getByRole("link", { name: /Focus settings/ }),
    ).toHaveAttribute("href", "/settings#focus");

    fireEvent.keyDown(screen.getByLabelText("Focus tracker"), { key: "Escape" });
    expect(screen.getByTestId("focus-widget-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("stays open while the pointer travels from the pill into the panel", () => {
    enableFocus();
    renderWidget();
    const widget = screen.getByLabelText("Focus tracker");

    fireEvent.mouseEnter(widget);
    expect(screen.getByTestId("focus-widget-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // Leaving starts a short grace period instead of closing immediately.
    fireEvent.mouseLeave(widget);
    expect(screen.getByTestId("focus-widget-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // Re-entering (for example over the panel) cancels the close.
    act(() => {
      vi.advanceTimersByTime(120);
    });
    fireEvent.mouseEnter(widget);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("focus-widget-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("closes hover only after the grace period", () => {
    enableFocus();
    renderWidget();
    const widget = screen.getByLabelText("Focus tracker");

    fireEvent.mouseEnter(widget);
    fireEvent.mouseLeave(widget);
    expect(screen.getByTestId("focus-widget-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("focus-widget-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("shows a paused collapsed state", () => {
    enableFocus();
    recordStudyActivity("reveal");
    // Pause through the widget to exercise the control.
    renderWidget();
    expand();
    fireEvent.click(screen.getByRole("button", { name: /Pause/ }));

    expect(screen.getByTestId("focus-widget-toggle")).toHaveTextContent("Paused");
    expect(getFocusView().state).toBe("manually_paused");
  });

  it("starts and resumes focus from the panel", () => {
    enableFocus();
    renderWidget();
    expand();

    fireEvent.click(screen.getByRole("button", { name: "Start focusing" }));
    expect(getFocusView().state).toBe("focusing");

    fireEvent.click(screen.getByRole("button", { name: /Pause/ }));
    expect(getFocusView().state).toBe("manually_paused");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(getFocusView().state).toBe("focusing");
  });

  it("takes a break and resumes from it", () => {
    enableFocus();
    recordStudyActivity("reveal");
    renderWidget();
    expand();

    fireEvent.click(screen.getByRole("button", { name: "☕ Take a break" }));
    expect(getFocusView().state).toBe("break");
    expect(screen.getByTestId("focus-widget-toggle")).toHaveTextContent("☕");

    fireEvent.click(screen.getByRole("button", { name: "Resume now" }));
    expect(getFocusView().state).toBe("focusing");
  });

  it("supports quick break lengths", () => {
    enableFocus();
    recordStudyActivity("reveal");
    renderWidget();
    expand();

    fireEvent.click(screen.getByRole("button", { name: "2 min" }));
    expect(getFocusView().state).toBe("break");
    expect(getFocusView().breakRemainingMs).toBe(2 * MINUTE);
  });

  it("shows a gentle break suggestion and honours Keep going", () => {
    enableFocus({ breakAfterMinutes: 10, idleTimeoutMinutes: 30 });
    recordStudyActivity("reveal");
    vi.setSystemTime(T0 + 21 * MINUTE);

    renderWidget();
    expect(screen.getByTestId("focus-widget-toggle")).toHaveTextContent(
      "Break? 21m",
    );

    expand();
    expect(
      screen.getByText(/You've been focused for 21 minutes/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));

    expect(getFocusView().reminderDue).toBe(false);
  });

  it("shows Daily Mission progress and continues the mission", () => {
    enableFocus();
    renderWidgetWithRoutes();

    act(() => {
      publishFocusDaily({
        trackId: "aws-soa-c03",
        completed: 2,
        total: 4,
        nextTitle: "NAT Gateway troubleshooting",
        nextMinutes: 4,
      });
    });

    expect(
      screen.getByLabelText("Daily Mission 2 of 4 complete"),
    ).toBeInTheDocument();

    expand();
    expect(screen.getByText("NAT Gateway troubleshooting")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue Mission" }));
    expect(screen.getByText("Daily mission page")).toBeInTheDocument();
  });

  it("respects reduced motion", () => {
    setReducedMotion(true);
    enableFocus();
    const { container } = renderWidget();

    expect(container.querySelector(".focus-widget--reduced")).not.toBeNull();
  });

  it("keeps the break countdown visible while on a break", () => {
    enableFocus({ breakDurationMinutes: 5 });
    recordStudyActivity("reveal");
    startBreak(5);
    vi.advanceTimersByTime(2 * MINUTE + 46_000);

    renderWidget();

    expect(screen.getByTestId("focus-widget-toggle")).toHaveTextContent("2:14");
  });
});
