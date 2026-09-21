import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "../auth/context";
import { getPreferences, resetPreferences } from "../state/preferences";
import { isSoundMuted } from "../state/sound";
import SettingsPage from "./SettingsPage";

function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: "authenticated",
    user: { id: "user-1", email: "learner@example.com", name: "Ada Lovelace" },
    configured: true,
    devSignIn: false,
    authError: null,
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    getAccessToken: vi.fn(async () => null),
    ...overrides,
  };
}

function renderSettings(auth: AuthContextValue = authValue()) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/" element={<p>App home</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

/** Scopes queries to one settings section by its heading. */
function section(title: string) {
  const heading = screen.getByRole("heading", { name: title });
  const root = heading.closest("section");
  if (!root) {
    throw new Error(`section not found: ${title}`);
  }
  return within(root);
}

beforeEach(() => {
  window.localStorage.clear();
  resetPreferences();
});

describe("SettingsPage", () => {
  it("renders every settings section and the section navigation", () => {
    renderSettings();

    for (const title of [
      "Study",
      "Focus & Breaks",
      "Audio & Feedback",
      "Accessibility",
      "Gamification",
      "Account",
      "Privacy & Data",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }

    expect(screen.getByRole("link", { name: "Focus & Breaks" })).toHaveAttribute(
      "href",
      "#focus",
    );
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(nav).getAllByRole("link")).toHaveLength(7);
  });

  it("exposes deep-link anchors for every section", () => {
    renderSettings();

    for (const id of [
      "study",
      "focus",
      "audio",
      "accessibility",
      "gamification",
      "account",
      "privacy",
    ]) {
      expect(document.getElementById(id)).toBeInTheDocument();
    }
  });

  it("updates and persists the Daily Mission target length", async () => {
    renderSettings();

    await userEvent.click(section("Study").getByRole("radio", { name: "25 min" }));

    const stored = JSON.parse(
      window.localStorage.getItem("adaptive-learn.user-preferences.v1") ?? "{}",
    );
    expect(stored.study.dailyMissionMinutes).toBe(25);
  });

  it("stores Focus preferences even though the tracker is not built yet", async () => {
    renderSettings();

    await userEvent.click(
      section("Focus & Breaks").getByRole("checkbox", { name: /Focus tracker/ }),
    );
    await userEvent.click(
      section("Focus & Breaks").getByRole("radio", { name: "15 min" }),
    );

    const stored = JSON.parse(
      window.localStorage.getItem("adaptive-learn.user-preferences.v1") ?? "{}",
    );
    expect(stored.focus.enabled).toBe(true);
    expect(stored.focus.breakAfterMinutes).toBe(15);
  });

  it("keeps the existing audio behaviour behind the Sound effects setting", async () => {
    renderSettings();

    expect(isSoundMuted()).toBe(false);
    await userEvent.click(
      section("Audio & Feedback").getByRole("checkbox", { name: /Sound effects/ }),
    );

    expect(isSoundMuted()).toBe(true);
    expect(
      section("Audio & Feedback").getByRole("checkbox", {
        name: /Answer feedback sounds/,
      }),
    ).toBeDisabled();
  });

  it("updates accessibility preferences", async () => {
    renderSettings();

    await userEvent.click(
      section("Accessibility").getByRole("checkbox", { name: /Reduced motion/ }),
    );
    await userEvent.click(
      section("Accessibility").getByRole("radio", { name: "Minimal" }),
    );

    const stored = JSON.parse(
      window.localStorage.getItem("adaptive-learn.user-preferences.v1") ?? "{}",
    );
    expect(stored.accessibility.reducedMotion).toBe(true);
    expect(stored.accessibility.animationIntensity).toBe("minimal");
  });

  it("offers gamification toggles and keeps the unavailable one disabled", () => {
    renderSettings();

    const gamification = section("Gamification");
    expect(
      gamification.getByRole("checkbox", { name: /Companion reactions/ }),
    ).toBeDisabled();
    expect(
      gamification.getByRole("checkbox", { name: /Reward animations/ }),
    ).toBeEnabled();
    expect(
      gamification.getByRole("checkbox", { name: /Bits animations/ }),
    ).toBeEnabled();
  });

  it("requires confirmation before resetting preferences", async () => {
    renderSettings();
    window.localStorage.setItem("adaptive-learn.learning-progress", "keep-me");

    await userEvent.click(
      section("Accessibility").getByRole("checkbox", { name: /Reduced motion/ }),
    );
    expect(getPreferences().accessibility.reducedMotion).toBe(true);

    await userEvent.click(
      screen.getByRole("button", { name: "Reset local preferences" }),
    );
    // Nothing is reset until the confirmation is accepted.
    expect(getPreferences().accessibility.reducedMotion).toBe(true);

    await userEvent.click(
      screen.getByRole("button", { name: "Reset preferences" }),
    );

    expect(getPreferences().accessibility.reducedMotion).toBe(false);
    expect(
      window.localStorage.getItem("adaptive-learn.user-preferences.v1"),
    ).toBeNull();
    expect(window.localStorage.getItem("adaptive-learn.learning-progress")).toBe(
      "keep-me",
    );
  });

  it("can cancel a reset", async () => {
    renderSettings();

    await userEvent.click(
      section("Accessibility").getByRole("checkbox", { name: /Reduced motion/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Reset local preferences" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(getPreferences().accessibility.reducedMotion).toBe(true);
  });

  it("shows account information and signs out", async () => {
    const signOut = vi.fn(async () => {});
    renderSettings(authValue({ signOut }));

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("learner@example.com")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalled();
  });
});
