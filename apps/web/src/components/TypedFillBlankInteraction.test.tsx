import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import TypedFillBlankInteraction from "./TypedFillBlankInteraction";

const slots = [
  {
    id: "sg_behavior",
    label: "Security group behavior",
    placeholder: "Type...",
  },
  {
    id: "nacl_behavior",
    label: "Network ACL behavior",
    placeholder: "Type...",
  },
];

describe("TypedFillBlankInteraction", () => {
  it("renders the sentence and one inline input per slot", () => {
    render(
      <TypedFillBlankInteraction
        text="Security groups are {{sg_behavior}}, while network ACLs are {{nacl_behavior}}."
        slots={slots}
        value={{}}
        onChange={() => undefined}
      />,
    );

    expect(
      screen.getByText(/Security groups are/, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(
      screen.getByRole("textbox", { name: "Security group behavior" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Network ACL behavior" }),
    ).toBeInTheDocument();
  });

  it("uses the authored placeholder", () => {
    render(
      <TypedFillBlankInteraction
        text="An explicit {{result}} overrides an Allow."
        slots={[{ id: "result", label: "Result", placeholder: "Type your answer" }]}
        value={{}}
        onChange={() => undefined}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Result" }),
    ).toHaveAttribute("placeholder", "Type your answer");
  });

  it("updates only the edited slot", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState<Record<string, string>>({
        nacl_behavior: "stateless",
      });
      return (
        <TypedFillBlankInteraction
          text="Security groups are {{sg_behavior}}, while network ACLs are {{nacl_behavior}}."
          slots={slots}
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }

    render(<Harness />);

    const sg = screen.getByRole("textbox", {
      name: "Security group behavior",
    });
    await user.type(sg, "stateful");

    expect(sg).toHaveValue("stateful");
    expect(
      screen.getByRole("textbox", { name: "Network ACL behavior" }),
    ).toHaveValue("stateless");
    expect(onChange).toHaveBeenLastCalledWith({
      nacl_behavior: "stateless",
      sg_behavior: "stateful",
    });
  });

  it("keeps the learner's text visible and disables inputs after submission", () => {
    render(
      <TypedFillBlankInteraction
        text="An explicit {{result}} overrides an Allow."
        slots={[{ id: "result", label: "Result", placeholder: "Type..." }]}
        value={{ result: "Deny" }}
        disabled
        onChange={() => undefined}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Result" });
    expect(input).toHaveValue("Deny");
    expect(input).toBeDisabled();
  });
});
