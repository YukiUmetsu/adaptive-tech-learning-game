import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { AuthContext, type AuthContextValue } from "./auth/context";
import { clearCatalogCache } from "./hooks/useCatalog";

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

function renderAuthenticatedAt(path: string) {
  const auth: AuthContextValue = {
    status: "authenticated",
    user: { id: "user-1", email: "learner@example.com", name: "Ada" },
    configured: true,
    devSignIn: false,
    authError: null,
    signIn: async () => {},
    signOut: async () => {},
    getAccessToken: async () => null,
  };
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  clearCatalogCache();
  // The app shell refreshes the authoritative Bits balance on mount.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/wallet")) {
        return jsonResponse({ device_id: "device", bits_balance: 0 });
      }
      return jsonResponse({ certifications: [] });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App routing", () => {
  it("renders the home page at the root", () => {
    renderAt("/");

    expect(
      screen.getByRole("heading", {
        name: /Cloud certification prep that finally keeps you engaged/i,
      }),
    ).toBeInTheDocument();
  });

  it("renders the demo page at /demo", async () => {
    renderAt("/demo");

    expect(
      await screen.findByRole("heading", { name: "Try the demo" }),
    ).toBeInTheDocument();
  });

  it("renders the not-found page for unknown routes", () => {
    renderAt("/missing");

    expect(
      screen.getByRole("heading", { name: "Not found" }),
    ).toBeInTheDocument();
  });

  it("requires sign-in for learning pages", async () => {
    renderAt("/tracks/aws-soa-c03/domains/domain-1/learn");

    expect(
      await screen.findByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
  });

  it("requires sign-in for the settings page", async () => {
    renderAt("/settings");

    expect(
      await screen.findByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
  });

  it("lets a signed-out visitor view the Cyber Defense page", () => {
    renderAt("/game");

    expect(
      screen.getByRole("heading", { name: /protect systems/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /sign in to play/i }),
    ).toBeInTheDocument();
  });

  it("requires sign-in to play a Cyber Defense mission", async () => {
    renderAt("/game/missions/ddos-basics");

    expect(
      await screen.findByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
  });

  it("renders the settings page at /settings for an authenticated learner", () => {
    renderAuthenticatedAt("/settings");

    expect(
      screen.getByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
  });

  it("renders the Learning Tracks page at /tracks with the new title", async () => {
    renderAt("/tracks");

    expect(
      await screen.findByRole("heading", { name: "Learning Tracks" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Learning Tracks · Adaptive Learning");
  });

  it("redirects legacy /certifications links to /tracks", async () => {
    renderAt("/certifications/aws-soa-c03");

    // The dashboard for the track renders after the redirect, not a 404.
    expect(
      await screen.findByRole("heading", { name: "Certification not found" }),
    ).toBeInTheDocument();
  });
});
