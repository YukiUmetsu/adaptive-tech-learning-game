import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { KnowledgeGroup } from "../state/knowledge";
import KnowledgeReinforcement from "./KnowledgeReinforcement";

function group(index: number): KnowledgeGroup {
  return {
    id: `group-${index}`,
    name: `Service ${index}`,
    topics: [`Topic ${index}`],
  };
}

describe("KnowledgeReinforcement", () => {
  it("shows a handful of groups and expands the rest on demand", async () => {
    const groups = Array.from({ length: 8 }, (_, index) => group(index + 1));
    render(<KnowledgeReinforcement groups={groups} />);

    expect(screen.getByText("Service 1")).toBeInTheDocument();
    expect(screen.getByText("Service 6")).toBeInTheDocument();
    expect(screen.queryByText("Service 7")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "+2 more" });
    await userEvent.click(toggle);

    expect(screen.getByText("Service 7")).toBeInTheDocument();
    expect(screen.getByText("Service 8")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show less" }),
    ).toBeInTheDocument();
  });

  it("renders an empty state without topics", () => {
    render(<KnowledgeReinforcement groups={[]} />);

    expect(
      screen.getByText("No topics recorded for this run."),
    ).toBeInTheDocument();
  });
});
