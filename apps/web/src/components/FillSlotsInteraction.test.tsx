import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import FillSlotsInteraction from "./FillSlotsInteraction";

const slots = [
  { id: "destination", label: "Destination" },
  { id: "target", label: "Target" },
];

const options = [
  { id: "all_ipv4", label: "0.0.0.0/0" },
  { id: "nat_gateway", label: "NAT gateway" },
  { id: "internet_gateway", label: "Internet gateway" },
];

describe("FillSlotsInteraction", () => {
  it("places a selected value into a blank", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <FillSlotsInteraction
        slots={slots}
        options={options}
        value={{}}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "NAT gateway" }));
    await user.click(screen.getByRole("button", { name: /Target:/ }));

    expect(onChange).toHaveBeenCalledWith({ target: "nat_gateway" });
  });

  it("requires an option before a blank can be filled", () => {
    render(
      <FillSlotsInteraction
        slots={slots}
        options={options}
        value={{}}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: /Target:/ })).toBeDisabled();
  });

  it("sets the option id when a value starts being dragged", () => {
    render(
      <FillSlotsInteraction
        slots={slots}
        options={options}
        value={{}}
        onChange={() => undefined}
      />,
    );

    const setData = vi.fn();
    fireEvent.dragStart(screen.getByRole("button", { name: "NAT gateway" }), {
      dataTransfer: { setData },
    });

    expect(setData).toHaveBeenCalledWith("text/plain", "nat_gateway");
  });

  it("places a value by dragging it onto a blank", () => {
    const onChange = vi.fn();
    const { container } = render(
      <FillSlotsInteraction
        slots={slots}
        options={options}
        value={{}}
        onChange={onChange}
      />,
    );

    const row = container.querySelector('[data-slot-id="target"]');
    expect(row).not.toBeNull();
    fireEvent.drop(row as Element, {
      dataTransfer: { getData: () => "nat_gateway" },
    });

    expect(onChange).toHaveBeenCalledWith({ target: "nat_gateway" });
  });

  it("clears a filled blank", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <FillSlotsInteraction
        slots={slots}
        options={options}
        value={{ target: "nat_gateway" }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear Target" }));
    expect(onChange).toHaveBeenCalledWith({});
  });
});
