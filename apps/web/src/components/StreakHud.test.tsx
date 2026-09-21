import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import StreakHud from "./StreakHud";

describe("StreakHud", () => {
  it("shows an illuminated streak when today is active", () => {
    render(
      <StreakHud
        streak={{ current: 12, longest: 20, activeToday: true, lastActiveDay: "2026-09-20" }}
      />,
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("day streak")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/12 day study streak, active today/),
    ).toBeInTheDocument();
  });

  it("stays quiet but positive when today is pending", () => {
    render(
      <StreakHud
        streak={{ current: 4, longest: 9, activeToday: false, lastActiveDay: "2026-09-19" }}
      />,
    );
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(/study today to keep it/)).toBeInTheDocument();
    expect(screen.queryByText(/lost/i)).not.toBeInTheDocument();
  });

  it("invites a fresh start instead of shaming a broken streak", () => {
    render(
      <StreakHud
        streak={{ current: 0, longest: 14, activeToday: false, lastActiveDay: null }}
      />,
    );
    expect(screen.getByText("start a streak today")).toBeInTheDocument();
    expect(screen.queryByText(/lost/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 day streak/)).not.toBeInTheDocument();
  });
});
