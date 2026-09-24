import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LearningTable from "./LearningTable";

describe("LearningTable", () => {
  it("labels each cell with its column for the mobile card layout", () => {
    render(
      <LearningTable
        type="table"
        columns={[
          { id: "service", label: "Service" },
          { id: "signal", label: "Signal" },
        ]}
        rows={[{ cells: { service: "CloudWatch", signal: "Metrics" } }]}
      />,
    );

    const cells = screen.getAllByRole("cell");
    expect(cells[0]).toHaveAttribute("data-label", "Service");
    expect(cells[1]).toHaveAttribute("data-label", "Signal");
  });
});
