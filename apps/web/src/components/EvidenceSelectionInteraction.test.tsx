import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import EvidenceSelectionInteraction from "./EvidenceSelectionInteraction";

const evidence = [
  { id: "cloudtrail", label: "CloudTrail event history" },
  { id: "cpu", label: "EC2 CPUUtilization" },
  { id: "flow", label: "VPC Flow Logs" },
];

describe("EvidenceSelectionInteraction", () => {
  it("selects and deselects evidence cards", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <EvidenceSelectionInteraction
        evidence={evidence}
        value={[]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /CloudTrail event history/ }));
    expect(onChange).toHaveBeenCalledWith(["cloudtrail"]);
  });

  it("removes an already selected evidence source", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <EvidenceSelectionInteraction
        evidence={evidence}
        value={["cloudtrail", "flow"]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /CloudTrail event history/ }));
    expect(onChange).toHaveBeenCalledWith(["flow"]);
  });

  it("marks selected cards as pressed and announces the count", () => {
    render(
      <EvidenceSelectionInteraction
        evidence={evidence}
        value={["flow"]}
        onChange={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", { name: /VPC Flow Logs/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });
});
