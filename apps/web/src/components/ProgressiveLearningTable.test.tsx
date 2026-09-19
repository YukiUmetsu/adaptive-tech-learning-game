import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import RevealContent from "./RevealContent";
import ProgressiveLearningTable from "./ProgressiveLearningTable";
import {
  cellTableReveal,
  columnTableReveal,
  rowTableReveal,
} from "../test/progressiveTableFixture";
import type { LearningTableReveal } from "../lib/learningElements";

function Harness({
  reveal,
  initialRevealed = [],
  disabled = false,
}: {
  reveal: LearningTableReveal;
  initialRevealed?: string[];
  disabled?: boolean;
}) {
  const [revealed, setRevealed] = useState<string[]>(initialRevealed);
  return (
    <ProgressiveLearningTable
      reveal={reveal}
      interaction={{
        revealedElementIds: revealed,
        onRevealElement: (id) => setRevealed((prev) => [...prev, id]),
        disabled,
      }}
    />
  );
}

describe("ProgressiveLearningTable — static compatibility", () => {
  it("renders a static table without progressive controls", () => {
    const staticReveal: LearningTableReveal = {
      type: "table",
      columns: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      rows: [{ cells: { a: "one", b: "two" } }],
    };

    render(<RevealContent reveal={staticReveal} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ProgressiveLearningTable — row mode", () => {
  it("shows the table and given column immediately without leaking hidden values", () => {
    render(<Harness reveal={rowTableReveal} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("CloudWatch")).toBeInTheDocument();
    expect(screen.getByText("CloudTrail")).toBeInTheDocument();
    // Hidden values are not in the accessibility tree before reveal.
    expect(screen.queryByText("Operational monitoring")).toBeNull();
    expect(screen.queryByText("API auditing")).toBeNull();
  });

  it("reveals only the clicked row", async () => {
    render(<Harness reveal={rowTableReveal} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Reveal row CloudWatch" }),
    );

    expect(screen.getByText("Operational monitoring")).toBeInTheDocument();
    expect(screen.getByText("Metrics, logs, alarms")).toBeInTheDocument();
    expect(screen.queryByText("API auditing")).toBeNull();
    expect(screen.queryByText("Who performed which AWS API action")).toBeNull();
  });

  it("restores an already revealed row from progress", () => {
    render(<Harness reveal={rowTableReveal} initialRevealed={["row:cloudwatch"]} />);

    expect(screen.getByText("Operational monitoring")).toBeInTheDocument();
    expect(screen.queryByText("API auditing")).toBeNull();
  });

  it("keeps table semantics with row and column headers", () => {
    render(<Harness reveal={rowTableReveal} />);

    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getAllByRole("rowheader")).toHaveLength(2);
  });

  it("activates a reveal with the keyboard", async () => {
    render(<Harness reveal={rowTableReveal} />);

    const button = screen.getByRole("button", {
      name: "Reveal row CloudWatch",
    });
    button.focus();
    expect(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    expect(screen.getByText("Operational monitoring")).toBeInTheDocument();
  });
});

describe("ProgressiveLearningTable — column mode", () => {
  it("does not offer reveal controls for initially visible columns", () => {
    render(<Harness reveal={columnTableReveal} />);

    expect(screen.getByText("Security group")).toBeInTheDocument();
    expect(screen.getByText("ENI / resource")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reveal column Control/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reveal column Scope/ })).toBeNull();
  });

  it("reveals only the clicked column", async () => {
    render(<Harness reveal={columnTableReveal} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Reveal column Stateful?" }),
    );

    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
    // The rules column is still hidden.
    expect(screen.queryByText("Allow rules only")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Reveal column Rules" }),
    ).toBeInTheDocument();
  });

  it("restores an already revealed column from progress", () => {
    render(
      <Harness reveal={columnTableReveal} initialRevealed={["column:rules"]} />,
    );

    expect(screen.getByText("Allow rules only")).toBeInTheDocument();
    expect(screen.queryByText("Yes")).toBeNull();
  });
});

describe("ProgressiveLearningTable — cell mode", () => {
  it("shows given cells and hides the rest", () => {
    render(<Harness reveal={cellTableReveal} />);

    // policy column and the explicitly given cell.
    expect(screen.getByText("Weighted")).toBeInTheDocument();
    expect(screen.getByText("Latency")).toBeInTheDocument();
    expect(screen.getByText("Traffic splitting")).toBeInTheDocument();
    expect(screen.queryByText("Configured weights")).toBeNull();
    expect(screen.queryByText("Multi-Region performance")).toBeNull();
  });

  it("reveals only the clicked cell", async () => {
    render(<Harness reveal={cellTableReveal} />);

    await userEvent.click(
      screen.getByRole("button", {
        name: "Reveal Selection basis for Weighted",
      }),
    );

    expect(screen.getByText("Configured weights")).toBeInTheDocument();
    // Same row, other cell, and same column, other row all stay hidden.
    expect(screen.queryByText("Supported")).toBeNull();
    expect(screen.queryByText("Lowest AWS network latency")).toBeNull();
  });

  it("restores given and revealed cells together", () => {
    render(
      <Harness reveal={cellTableReveal} initialRevealed={["cell:latency:health"]} />,
    );

    expect(screen.getByText("Traffic splitting")).toBeInTheDocument();
    expect(screen.getAllByText("Supported")).toHaveLength(1);
    expect(screen.queryByText("Configured weights")).toBeNull();
  });

  it("disables reveal controls when the node is locked", () => {
    render(<Harness reveal={cellTableReveal} disabled />);

    const button = screen.getByRole("button", {
      name: "Reveal Selection basis for Weighted",
    });
    expect(button).toBeDisabled();
  });
});

describe("ProgressiveLearningTable — accessibility", () => {
  it("does not expose hidden values as text", () => {
    const { container } = render(<Harness reveal={cellTableReveal} />);

    expect(container.textContent).not.toContain("Configured weights");
    expect(container.textContent).not.toContain("Lowest AWS network latency");
  });

  it("keeps the given cell rendered as a cell, not a button", () => {
    render(<Harness reveal={cellTableReveal} />);

    const given = screen.getByText("Traffic splitting");
    expect(within(given.closest("td")!).queryByRole("button")).toBeNull();
  });
});
