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

beforeEach(() => {
  clearCatalogCache();
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
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ certifications: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

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
