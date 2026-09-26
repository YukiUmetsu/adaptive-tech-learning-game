import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { familyInsightFixture } from "../test/familyInsightFixture";
import StructureComparisonCard from "./StructureComparisonCard";

function comparison() {
  return familyInsightFixture().comparison!;
}

describe("StructureComparisonCard", () => {
  it("shows the seen examples before revealing the shared structure", () => {
    render(<StructureComparisonCard comparison={comparison()} />);

    expect(screen.getByText("Same Skeleton")).toBeInTheDocument();
    expect(screen.getByText("API rate limiting")).toBeInTheDocument();
    expect(screen.getByText("Recent fraud-event window")).toBeInTheDocument();
    // The shared signals are not dumped immediately.
    expect(
      screen.queryByText("candidate solutions are contiguous ranges"),
    ).not.toBeInTheDocument();
  });

  it("reveals signals, rule, and steps progressively", async () => {
    const user = userEvent.setup();
    render(<StructureComparisonCard comparison={comparison()} />);

    await user.click(
      screen.getByRole("button", { name: "Reveal the shared structure" }),
    );
    expect(
      screen.getByText("candidate solutions are contiguous ranges"),
    ).toBeInTheDocument();
    // The core rule is still hidden until the next step.
    expect(
      screen.queryByText(
        "After repair, the active range satisfies the validity condition.",
      ),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reveal the core rule" }));
    expect(
      screen.getByText(
        "After repair, the active range satisfies the validity condition.",
      ),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Show the reusable steps" }),
    );
    expect(screen.getByText("add the new right-side item")).toBeInTheDocument();
  });

  it("is keyboard operable", async () => {
    const user = userEvent.setup();
    render(<StructureComparisonCard comparison={comparison()} />);

    await user.tab();
    expect(
      screen.getByRole("button", { name: "Reveal the shared structure" }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByText("candidate solutions are contiguous ranges"),
    ).toBeInTheDocument();
  });

  it("never renders the internal family id", () => {
    render(<StructureComparisonCard comparison={comparison()} />);
    expect(
      screen.queryByText("dsa.sliding_window.variable"),
    ).not.toBeInTheDocument();
  });
});
