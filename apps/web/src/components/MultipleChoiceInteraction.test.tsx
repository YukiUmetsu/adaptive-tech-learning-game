import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import MultipleChoiceInteraction from "./MultipleChoiceInteraction";

const choices = [
  { id: "A", label: "CloudTrail data events" },
  { id: "B", label: "CloudWatch agent" },
  { id: "C", label: "Systems Manager Inventory" },
];

describe("MultipleChoiceInteraction", () => {
  it("renders a radio group and reports the chosen id", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <MultipleChoiceInteraction choices={choices} value={null} onChange={onChange} />,
    );

    await user.click(screen.getByRole("radio", { name: /CloudWatch agent/ }));
    expect(onChange).toHaveBeenCalledWith("B");
  });

  it("marks the selected option with radio state", () => {
    render(
      <MultipleChoiceInteraction choices={choices} value="C" onChange={() => undefined} />,
    );

    expect(screen.getByRole("radio", { name: /Systems Manager Inventory/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /CloudTrail data events/ })).not.toBeChecked();
  });

  it("disables every option when disabled", () => {
    render(
      <MultipleChoiceInteraction choices={choices} value="A" disabled onChange={() => undefined} />,
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
  });
});
