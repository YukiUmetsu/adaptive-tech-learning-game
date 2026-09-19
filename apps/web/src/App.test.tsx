import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { clearCatalogCache } from "./hooks/useCatalog";

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
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
      screen.getByRole("heading", { name: "Adaptive Learning" }),
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
});
