import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import OrderingInteraction from "./OrderingInteraction";

const items = [
  { id: "a", label: "First step" },
  { id: "b", label: "Second step" },
  { id: "c", label: "Third step" },
];

describe("OrderingInteraction", () => {
  it("moves an item up with the keyboard-accessible control", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <OrderingInteraction
        items={items}
        value={["a", "b", "c"]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Move Second step up" }));

    expect(onChange).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("disables moving the first item up and the last item down", () => {
    render(
      <OrderingInteraction
        items={items}
        value={["a", "b", "c"]}
        onChange={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Move First step up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Third step down" }),
    ).toBeDisabled();
  });
});
