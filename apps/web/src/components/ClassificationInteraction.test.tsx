import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ClassificationInteraction from "./ClassificationInteraction";

const items = [
  { id: "cpu", label: "CPU utilization" },
  { id: "api", label: "API call record" },
];

const categories = [
  { id: "metric", label: "Metric" },
  { id: "log", label: "Log" },
];

describe("ClassificationInteraction", () => {
  it("places a selected item into a category without dragging", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <ClassificationInteraction
        items={items}
        categories={categories}
        value={{}}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "CPU utilization" }));
    await user.click(
      within(screen.getByRole("group", { name: "Metric" })).getByRole("button", {
        name: "Place here",
      }),
    );

    expect(onChange).toHaveBeenCalledWith({ cpu: "metric" });
  });

  it("marks the selected item as pressed", async () => {
    const user = userEvent.setup();
    render(
      <ClassificationInteraction
        items={items}
        categories={categories}
        value={{}}
        onChange={() => undefined}
      />,
    );

    const item = screen.getByRole("button", { name: "CPU utilization" });
    await user.click(item);

    expect(item).toHaveAttribute("aria-pressed", "true");
  });
});
