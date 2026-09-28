import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { familyInsightFixture } from "../test/familyInsightFixture";
import FamilyInsightToolbelt from "./FamilyInsightToolbelt";

beforeEach(() => {
  window.localStorage.clear();
});

describe("FamilyInsightToolbelt", () => {
  it("shows an inviting empty state", () => {
    render(<FamilyInsightToolbelt trackId="dsa-track" insights={[]} />);
    expect(screen.getByText(/patterns you meet/i)).toBeInTheDocument();
  });

  it("lists unlocked families with coarse coverage, never a percentage", () => {
    render(
      <FamilyInsightToolbelt
        trackId="dsa-track"
        insights={[familyInsightFixture()]}
      />,
    );

    expect(screen.getAllByText("Moving Valid Window").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Seen in 2 contexts").length).toBeGreaterThan(0);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/mastered/i)).not.toBeInTheDocument();
    // Internal ids are never rendered.
    expect(
      screen.queryByText("dsa.sliding_window.variable"),
    ).not.toBeInTheDocument();
  });

  it("selects a family and shows its guide", async () => {
    const user = userEvent.setup();
    render(
      <FamilyInsightToolbelt
        trackId="dsa-track"
        insights={[familyInsightFixture()]}
      />,
    );

    // The first family is selected by default, so its guide is visible.
    expect(
      screen.getByText(
        "After repair, the active range satisfies the validity condition.",
      ),
    ).toBeInTheDocument();

    // The authored confusion is shown with resolved titles, not ids.
    expect(screen.getByText(/Moving Valid Window vs Fixed Cumulative State/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Moving Valid Window/ }));
    expect(
      screen.getAllByText(
        "Maintain information about one contiguous active range while its boundaries move.",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("records a local, non-authoritative shown event", () => {
    render(
      <FamilyInsightToolbelt
        trackId="dsa-track"
        insights={[familyInsightFixture()]}
      />,
    );
    const stored = window.localStorage.getItem(
      "adaptive-learn.pending-family-insight.v1",
    );
    expect(stored).toContain("family_insight_shown");
    expect(stored).toContain("dsa-track");
  });

  it("does not claim a context when the family has none authored", () => {
    render(
      <FamilyInsightToolbelt
        trackId="dsa-track"
        insights={[
          familyInsightFixture({
            seen_context_count: 0,
            seen_example_count: 1,
            comparison: null,
          }),
        ]}
      />,
    );
    // Zero contexts must not render as "Seen in 1 context".
    expect(screen.getAllByText("Seen").length).toBeGreaterThan(0);
    expect(screen.queryByText("Seen in 1 context")).not.toBeInTheDocument();
  });
});
