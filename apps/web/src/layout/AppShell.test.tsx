import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "../auth/context";
import AppShell from "./AppShell";

const originalMatchMedia = window.matchMedia;

function stubViewport(mobile: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: mobile && query.includes("max-width: 640px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function authValue(): AuthContextValue {
  return {
    status: "authenticated",
    user: { id: "user-1", email: "learner@example.com", name: "Ada" },
    configured: true,
    devSignIn: false,
    authError: null,
    signIn: async () => {},
    signOut: async () => {},
    getAccessToken: async () => null,
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function renderShell() {
  return render(
    <AuthContext.Provider value={authValue()}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<p>Home body</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/wallet")) {
        return jsonResponse({ device_id: "d", bits_balance: 42 });
      }
      return jsonResponse({ certifications: [] });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

describe("AppShell mobile navigation shell", () => {
  it("uses a bottom tab bar with the primary destinations on mobile", () => {
    stubViewport(true);
    renderShell();

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toHaveClass("mobile-tabbar");
    expect(within(nav).getByRole("link", { name: /Home/ })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(nav).getByRole("link", { name: /Tracks/ })).toHaveAttribute(
      "href",
      "/tracks",
    );
    // The bulky desktop account menu is not rendered on mobile; settings stays
    // reachable from the compact top bar.
    expect(
      screen.queryByRole("button", { name: "Sign out" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("keeps the full desktop header nav off mobile", () => {
    stubViewport(false);
    renderShell();

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).not.toHaveClass("mobile-tabbar");
    expect(within(nav).getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(
      within(nav).getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Tracks")).not.toBeInTheDocument();
  });
});
