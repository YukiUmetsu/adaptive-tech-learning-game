import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import SpotTheFaultInteraction from "./SpotTheFaultInteraction";

const elements = [
  { id: "destination", label: "Destination 0.0.0.0/0" },
  { id: "target", label: "Target internet gateway" },
  { id: "association", label: "Associated subnet private-subnet" },
];

describe("SpotTheFaultInteraction", () => {
  it("flags an element with a click", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <SpotTheFaultInteraction
        elements={elements}
        value={[]}
        onChange={onChange}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Target internet gateway/ }),
    );
    expect(onChange).toHaveBeenCalledWith(["target"]);
  });

  it("removes a flagged element", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <SpotTheFaultInteraction
        elements={elements}
        value={["target"]}
        onChange={onChange}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Target internet gateway/ }),
    );
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("exposes the flagged state without relying on color", () => {
    render(
      <SpotTheFaultInteraction
        elements={elements}
        value={["target"]}
        onChange={() => undefined}
      />,
    );

    const flagged = screen.getByRole("button", {
      name: /Target internet gateway/,
    });
    expect(flagged).toHaveAttribute("aria-pressed", "true");
    expect(flagged).toHaveTextContent("flagged as faulty");
  });
});
