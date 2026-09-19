import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import HomePage from "./HomePage";

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe("HomePage", () => {
  it("leads with the hero message and primary calls to action", () => {
    renderHome();

    expect(
      screen.getByRole("heading", {
        name: /Cloud certification prep that finally keeps you engaged/i,
      }),
    ).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Start Free Demo/ })).toHaveAttribute(
      "href",
      "/demo",
    );
    expect(
      screen.getByRole("link", { name: "Try a Quick Quiz" }),
    ).toHaveAttribute("href", "/certifications");
  });

  it("explains the three-step loop", () => {
    renderHome();

    expect(
      screen.getByRole("heading", {
        name: /From confusion to certification, one node at a time/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Explore the domain" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Play adaptive quizzes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Reinforce weak spots" }),
    ).toBeInTheDocument();
  });

  it("compares passive tools with adaptive learning", () => {
    renderHome();

    expect(
      screen.getByRole("heading", { name: "Passive study tools" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Adaptive Learning" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Visual, interactive knowledge maps")).toBeInTheDocument();
  });

  it("links the available certification and marks planned ones as WIP", () => {
    renderHome();

    expect(
      screen.getByRole("link", { name: /AWS Certified CloudOps Engineer/ }),
    ).toHaveAttribute("href", "/certifications/aws-soa-c03");
    expect(
      screen.getByRole("link", { name: /AWS Certified Generative AI Developer/ }),
    ).toHaveAttribute("href", "/certifications/aws-aip-c01");
    expect(screen.getAllByText("WIP").length).toBeGreaterThan(0);
  });

  it("ends with a demo call to action", () => {
    renderHome();

    expect(
      screen.getByRole("heading", {
        name: "Start learning with AWS CloudOps today.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Launch Demo/ }),
    ).toHaveAttribute("href", "/demo");
  });
});
