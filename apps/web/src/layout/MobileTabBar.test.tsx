import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AuthContext, type AuthContextValue } from "../auth/context";
import MobileTabBar from "./MobileTabBar";

function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: "anonymous",
    user: null,
    configured: true,
    devSignIn: false,
    authError: null,
    signIn: async () => {},
    signOut: async () => {},
    getAccessToken: async () => null,
    ...overrides,
  };
}

function renderTabBar(path = "/", auth: AuthContextValue = authValue()) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <MobileTabBar />
        <Routes>
          <Route path="*" element={<p>page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("MobileTabBar", () => {
  it("renders the primary destinations as labeled links", () => {
    renderTabBar();

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toBeInTheDocument();

    for (const [label, href] of [
      ["Home", "/"],
      ["Tracks", "/tracks"],
      ["Demo", "/demo"],
      ["Sign in", "/account"],
    ] as const) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toHaveAttribute(
        "href",
        href,
      );
    }
  });

  it("marks the active destination", () => {
    renderTabBar("/tracks");

    const active = screen.getByRole("link", { name: /Tracks/ });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveClass("active");
  });

  it("labels the account destination by auth status", () => {
    renderTabBar(
      "/",
      authValue({
        status: "authenticated",
        user: { id: "u", email: "learner@example.com" },
      }),
    );

    expect(screen.getByRole("link", { name: /Account/ })).toBeInTheDocument();
  });
});
