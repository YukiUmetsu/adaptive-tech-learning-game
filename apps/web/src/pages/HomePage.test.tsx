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
    ).toHaveAttribute("href", "/tracks");
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

  it("links the available certifications", () => {
    renderHome();

    expect(
      screen.getByRole("link", { name: /AWS Certified CloudOps Engineer/ }),
    ).toHaveAttribute("href", "/tracks/aws-soa-c03");
    expect(
      screen.getByRole("link", { name: /AWS Certified Generative AI Developer/ }),
    ).toHaveAttribute("href", "/tracks/aws-aip-c01");
    expect(
      screen.getByRole("link", { name: /CompTIA Security\+/ }),
    ).toHaveAttribute("href", "/tracks/comptia-security-plus");
    expect(
      screen.getByRole("link", { name: /Microsoft Certified: Azure Fundamentals/ }),
    ).toHaveAttribute("href", "/tracks/microsoft-az-900");
    // The DevOps placeholder was replaced by a real, available certification.
    expect(screen.queryByText("DevOps Certification")).toBeNull();
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
