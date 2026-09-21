import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import MultipleResponseInteraction from "./MultipleResponseInteraction";

const choices = [
  { id: "A", label: "EventBridge polling" },
  { id: "B", label: "Composite alarm to SNS" },
  { id: "C", label: "Composite alarm rule" },
  { id: "D", label: "Delete the alarms" },
];

describe("MultipleResponseInteraction", () => {
  it("adds and removes selections as checkboxes", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <MultipleResponseInteraction
        choices={choices}
        requiredSelections={2}
        value={[]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /Composite alarm to SNS/ }));
    expect(onChange).toHaveBeenCalledWith(["B"]);

    await user.click(screen.getByRole("checkbox", { name: /Composite alarm rule/ }));
    expect(onChange).toHaveBeenCalledWith(["C"]);
  });

  it("blocks selecting more than the required count and says why", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <MultipleResponseInteraction
        choices={choices}
        requiredSelections={2}
        value={["B", "C"]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /EventBridge polling/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Deselect an answer first/)).toBeInTheDocument();
  });

  it("keeps the requirement out of the visible chrome", () => {
    render(
      <MultipleResponseInteraction
        choices={choices}
        requiredSelections={2}
        value={["B"]}
        onChange={() => undefined}
      />,
    );

    // No extra hint or running count; the authored instruction carries that.
    expect(screen.queryByText(/selected/)).toBeNull();
    expect(screen.queryByText(/Select exactly/)).toBeNull();
    // It is still available to assistive technology.
    expect(
      screen.getByRole("group", { name: "Choose 2 answers" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Composite alarm to SNS/ }),
    ).toBeChecked();
  });
});
