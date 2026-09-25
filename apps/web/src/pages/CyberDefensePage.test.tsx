import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import CyberDefensePage from "./CyberDefensePage";
import { AuthContext, type AuthContextValue } from "../auth/context";
import {
  recordMissionResult,
  resetGameProgress,
} from "../game/persistence/gameProgress";

beforeEach(() => {
  window.localStorage.clear();
  resetGameProgress();
});

function authValue(status: "anonymous" | "authenticated"): AuthContextValue {
  return {
    status,
    user:
      status === "authenticated"
        ? { id: "user-1", email: "learner@example.com", name: "Ada" }
        : null,
    configured: status === "authenticated",
    devSignIn: false,
    authError: null,
    signIn: async () => {},
    signOut: async () => {},
    getAccessToken: async () => null,
  };
}

function renderPage(status: "anonymous" | "authenticated" = "authenticated") {
  return render(
    <AuthContext.Provider value={authValue(status)}>
      <MemoryRouter>
        <CyberDefensePage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("CyberDefensePage", () => {
  it("lists the MVP missions", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { name: /protect systems/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Protect the Storefront")).toBeInTheDocument();
    expect(screen.getByText("Seal the Query")).toBeInTheDocument();
    expect(screen.getByText("Boss: Botnet DDoS")).toBeInTheDocument();
  });

  it("shows the unlock requirement for the locked boss mission", () => {
    renderPage();

    const bossLink = screen.getByText("Boss: Botnet DDoS").closest("a");
    expect(bossLink).toHaveAttribute("aria-disabled", "true");
  });

  it("summarizes campaign progress", () => {
    renderPage();

    expect(screen.getByText("Systems secured")).toBeInTheDocument();
    expect(screen.getByText("Stars earned")).toBeInTheDocument();
    expect(screen.getByText("Threat types")).toBeInTheDocument();
    expect(screen.getByText("0 of 5 cleared")).toBeInTheDocument();
  });

  it("renders a threat glyph for each card", () => {
    const { container } = renderPage();

    expect(
      container.querySelectorAll(".cyber-threat-glyph").length,
    ).toBeGreaterThan(0);
    expect(container.querySelector(".cyber-mission-card.is-boss")).not.toBeNull();
  });

  it("points the primary call to action at the first mission", () => {
    renderPage();

    expect(
      screen.getByRole("link", { name: /start first mission/i }),
    ).toHaveAttribute("href", "/game/missions/ddos-basics");
  });

  it("advances the call to action once a mission is cleared", () => {
    recordMissionResult("ddos-basics", {
      completed: true,
      stars: 3,
      health: 90,
    });

    renderPage();

    expect(
      screen.getByRole("link", { name: /continue mission/i }),
    ).toHaveAttribute("href", "/game/missions/sql-injection");
    expect(screen.getByText("1 of 5 cleared")).toBeInTheDocument();
  });

  it("lets a signed-out visitor browse but sends them to sign in to play", () => {
    renderPage("anonymous");

    // The page is still viewable: mission content and stats render.
    expect(screen.getByText("Protect the Storefront")).toBeInTheDocument();
    expect(screen.getByText("Systems secured")).toBeInTheDocument();

    const cta = screen.getByRole("link", { name: /sign in to play/i });
    expect(cta).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fgame%2Fmissions%2Fddos-basics",
    );
    expect(
      screen.getByText(/account is required to play/i),
    ).toBeInTheDocument();
  });
});
