import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AnimatedCheck from "./AnimatedCheck";

describe("AnimatedCheck", () => {
  it("draws a ring and a check mark", () => {
    const { container } = render(<AnimatedCheck />);
    expect(container.querySelector(".animated-check-ring")).toBeInTheDocument();
    expect(container.querySelector(".animated-check-mark")).toBeInTheDocument();
  });

  it("is exposed as an image when labelled", () => {
    const { container } = render(<AnimatedCheck label="Correct" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("Correct");
  });

  it("is decorative when the parent announces success", () => {
    const { container } = render(<AnimatedCheck label={null} />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});
