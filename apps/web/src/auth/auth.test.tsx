import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AppShell from "../layout/AppShell";
import { AuthContext, type AuthContextValue } from "./context";
import LocalAuthProvider from "./LocalAuthProvider";
import LoginPage from "../pages/LoginPage";
import { sanitizeReturnTo } from "./returnTo";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: "anonymous",
    user: null,
    configured: true,
    devSignIn: false,
    authError: null,
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    getAccessToken: vi.fn(async () => null),
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/wallet")) {
        return jsonResponse({ user_id: "user-1", bits_balance: 42 });
      }
      return jsonResponse({ certifications: [] });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sanitizeReturnTo", () => {
  it("accepts internal paths", () => {
    expect(sanitizeReturnTo("/tracks")).toBe("/tracks");
    expect(sanitizeReturnTo("/a?b=1#c")).toBe("/a?b=1#c");
  });

  it("rejects off-site and malformed targets", () => {
    expect(sanitizeReturnTo("https://evil.example")).toBeNull();
    expect(sanitizeReturnTo("//evil.example")).toBeNull();
    expect(sanitizeReturnTo("/\\evil.example")).toBeNull();
    expect(sanitizeReturnTo("javascript:alert(1)")).toBeNull();
    expect(sanitizeReturnTo(42)).toBeNull();
  });
});

describe("AppShell authentication UI", () => {
  it("shows a Sign in link when anonymous", () => {
    render(
      <AuthContext.Provider value={authValue()}>
        <MemoryRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<p>Home body</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("shows the account and Sign out when authenticated", async () => {
    const signOut = vi.fn(async () => {});
    render(
      <AuthContext.Provider
        value={authValue({
          status: "authenticated",
          user: { id: "user-1", email: "learner@example.com" },
          signOut,
        })}
      >
        <MemoryRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<p>Home body</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(screen.getByRole("link", { name: "Account" })).toBeInTheDocument();
    expect(screen.queryByText("learner@example.com")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });

  it("replaces the header audio toggle with a Settings gear", () => {
    render(
      <AuthContext.Provider value={authValue()}>
        <MemoryRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<p>Home body</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(
      screen.queryByRole("button", { name: /sound effects/i }),
    ).not.toBeInTheDocument();
  });

  it("navigates to the settings page from the gear", async () => {
    render(
      <AuthContext.Provider value={authValue()}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<p>Home body</p>} />
              <Route path="settings" element={<p>Settings body</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    await userEvent.click(screen.getByRole("link", { name: "Settings" }));

    expect(await screen.findByText("Settings body")).toBeInTheDocument();
  });

  it("shows the provider avatar when one is available", () => {
    render(
      <AuthContext.Provider
        value={authValue({
          status: "authenticated",
          user: {
            id: "user-1",
            email: "learner@example.com",
            name: "Ada Lovelace",
            avatarUrl: "https://example.com/avatar.png",
          },
        })}
      >
        <MemoryRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<p>Home body</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    const account = screen.getByRole("link", { name: "Account" });
    expect(account.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/avatar.png",
    );
    expect(screen.queryByText("learner@example.com")).not.toBeInTheDocument();
  });

  it("never stores an access token in localStorage", async () => {
    render(
      <AuthContext.Provider
        value={authValue({
          status: "authenticated",
          user: { id: "user-1", email: "learner@example.com" },
        })}
      >
        <MemoryRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<p>Home body</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("Home body")).toBeInTheDocument());
    const dump = JSON.stringify(window.localStorage);
    expect(dump).not.toMatch(/Bearer/i);
    expect(dump).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);
  });
});

describe("LoginPage", () => {
  function renderLogin(path: string, auth: AuthContextValue) {
    return render(
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/tracks/aws-soa-c03"
              element={<p>Intended dashboard</p>}
            />
            <Route index element={<p>App home</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
  }

  it("starts WorkOS sign-in with the intended internal route", async () => {
    const signIn = vi.fn(async () => {});
    renderLogin(
      "/login?returnTo=%2Ftracks%2Faws-soa-c03",
      authValue({ signIn }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    expect(signIn).toHaveBeenCalledWith(
      expect.objectContaining({ returnTo: "/tracks/aws-soa-c03" }),
    );
    // WorkOS performs a full-page redirect, so the app must not client-navigate
    // first (that would land on the homepage when the redirect opens out of
    // process, such as in an installed PWA).
    expect(screen.queryByText("Intended dashboard")).toBeNull();
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
  });

  it("sanitizes an off-site returnTo before starting WorkOS sign-in", async () => {
    const signIn = vi.fn(async () => {});
    renderLogin(
      "/login?returnTo=https%3A%2F%2Fevil.example",
      authValue({ signIn }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    expect(signIn).toHaveBeenCalledWith(
      expect.objectContaining({ returnTo: "/" }),
    );
    expect(screen.queryByText("App home")).toBeNull();
  });

  it("redirects an already-authenticated learner to the intended route", () => {
    renderLogin(
      "/login?returnTo=%2Ftracks%2Faws-soa-c03",
      authValue({
        status: "authenticated",
        user: { id: "user-1", email: "learner@example.com" },
      }),
    );

    expect(screen.getByText("Intended dashboard")).toBeInTheDocument();
  });

  it("surfaces a failed sign-in callback", () => {
    renderLogin(
      "/login",
      authValue({ authError: "Sign-in didn't complete." }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign-in didn't complete.",
    );
  });
});

describe("local developer sign-in", () => {
  it("offers a developer session when WorkOS is not configured", async () => {
    render(
      <LocalAuthProvider>
        <MemoryRouter initialEntries={["/login"]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<p>Home</p>} />
          </Routes>
        </MemoryRouter>
      </LocalAuthProvider>,
    );

    const button = await screen.findByRole("button", {
      name: "Continue as local developer",
    });
    await userEvent.click(button);

    await waitFor(() =>
      expect(screen.getByText("Home")).toBeInTheDocument(),
    );
    expect(
      window.sessionStorage.getItem("adaptive-learn.dev-subject"),
    ).toBe("local-user");
    // The dev bearer token is never persisted to localStorage.
    expect(JSON.stringify(window.localStorage)).not.toMatch(/dev:/);
  });
});
