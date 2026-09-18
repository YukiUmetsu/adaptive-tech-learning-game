import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import App from "./App";

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App routing", () => {
  it("renders the home page at the root", () => {
    renderAt("/");

    expect(
      screen.getByRole("heading", { name: "Adaptive Learning" }),
    ).toBeInTheDocument();
  });

  it("renders the not-found page for unknown routes", () => {
    renderAt("/missing");

    expect(
      screen.getByRole("heading", { name: "Not found" }),
    ).toBeInTheDocument();
  });
});
