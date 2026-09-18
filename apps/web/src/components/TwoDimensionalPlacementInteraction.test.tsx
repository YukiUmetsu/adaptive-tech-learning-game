import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import TwoDimensionalPlacementInteraction from "./TwoDimensionalPlacementInteraction";

const xAxis = {
  id: "cost",
  label: "Cost",
  low_label: "Lower cost",
  high_label: "Higher cost",
};

const yAxis = {
  id: "recovery",
  label: "Recovery",
  low_label: "Slower recovery",
  high_label: "Faster recovery",
};

const items = [
  { id: "backup", label: "Backup and restore" },
  { id: "multi_site", label: "Multi-site" },
];

describe("TwoDimensionalPlacementInteraction", () => {
  it("places an item when its palette button is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <TwoDimensionalPlacementInteraction
        xAxis={xAxis}
        yAxis={yAxis}
        items={items}
        value={{}}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Backup and restore" }));

    expect(onChange).toHaveBeenCalledWith({
      backup: { x: 0.5, y: 0.5 },
    });
  });

  it("sets the item id when a palette item starts being dragged", () => {
    render(
      <TwoDimensionalPlacementInteraction
        xAxis={xAxis}
        yAxis={yAxis}
        items={items}
        value={{}}
        onChange={() => undefined}
      />,
    );

    const setData = vi.fn();
    fireEvent.dragStart(
      screen.getByRole("button", { name: "Backup and restore" }),
      { dataTransfer: { setData } },
    );

    expect(setData).toHaveBeenCalledWith(
      "text/plain",
      "placement-item:backup",
    );
  });

  it("nudges a placed marker with the arrow keys", () => {
    const onChange = vi.fn();

    render(
      <TwoDimensionalPlacementInteraction
        xAxis={xAxis}
        yAxis={yAxis}
        items={items}
        value={{ backup: { x: 0.5, y: 0.5 } }}
        onChange={onChange}
      />,
    );

    const marker = screen.getByRole("button", {
      name: "Backup and restore on Cost and Recovery",
    });

    fireEvent.keyDown(marker, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({
      backup: { x: 0.52, y: 0.5 },
    });

    fireEvent.keyDown(marker, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith({
      backup: { x: 0.5, y: 0.52 },
    });
  });

  it("shows both axis endpoints", () => {
    render(
      <TwoDimensionalPlacementInteraction
        xAxis={xAxis}
        yAxis={yAxis}
        items={items}
        value={{}}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByText("Lower cost")).toBeInTheDocument();
    expect(screen.getByText("Higher cost")).toBeInTheDocument();
    expect(screen.getByText("Slower recovery")).toBeInTheDocument();
    expect(screen.getByText("Faster recovery")).toBeInTheDocument();
  });
});
