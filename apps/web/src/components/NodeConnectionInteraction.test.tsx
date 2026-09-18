import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import NodeConnectionInteraction from "./NodeConnectionInteraction";

const nodes = [
  { id: "alarm", label: "CloudWatch alarm", x: 0.1, y: 0.2 },
  { id: "sns", label: "SNS topic", x: 0.6, y: 0.2 },
  { id: "operator", label: "Operator", x: 0.6, y: 0.8 },
];

describe("NodeConnectionInteraction", () => {
  it("connects a source to a target with clicks", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <NodeConnectionInteraction nodes={nodes} value={[]} onChange={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: "CloudWatch alarm" }));
    await user.click(screen.getByRole("button", { name: "SNS topic" }));

    expect(onChange).toHaveBeenCalledWith([["alarm", "sns"]]);
  });

  it("lists existing connections with an accessible remove control", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <NodeConnectionInteraction
        nodes={nodes}
        value={[["alarm", "sns"]]}
        onChange={onChange}
      />,
    );

    const connections = screen.getByRole("list", { name: "Connections" });
    expect(connections).toHaveTextContent("CloudWatch alarm");
    expect(connections).toHaveTextContent("SNS topic");

    await user.click(
      screen.getByRole("button", {
        name: "Remove connection CloudWatch alarm to SNS topic",
      }),
    );

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
