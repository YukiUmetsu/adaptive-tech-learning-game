import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import NodeConnectionInteraction from "./NodeConnectionInteraction";

const nodes = [
  { id: "alarm", label: "CloudWatch alarm", x: 0.1, y: 0.2 },
  { id: "sns", label: "SNS topic", x: 0.6, y: 0.2 },
  { id: "operator", label: "Operator", x: 0.6, y: 0.8 },
];

/** Controls the measured panel width (jsdom reports `0` by default). */
function setClientWidth(width: number): void {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
}

function resetClientWidth(): void {
  // Shadowing `Element.prototype.clientWidth` on HTMLElement is removable.
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
}

afterEach(resetClientWidth);

/** Holds the answer so it can be checked across responsive layout changes. */
function Harness() {
  const [value, setValue] = useState<string[][]>([]);
  return (
    <NodeConnectionInteraction nodes={nodes} value={value} onChange={setValue} />
  );
}

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

  it("renders the mobile builder for a narrow panel and the graph for a wide one", async () => {
    setClientWidth(400);
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);

    // Narrow: tap builder, no connection lines.
    expect(document.querySelector(".graph")).toBeNull();
    expect(screen.getByRole("list", { name: "Connect from" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "CloudWatch alarm" }));
    await user.click(screen.getByRole("button", { name: "SNS topic" }));
    expect(
      within(screen.getByRole("list", { name: "Your connections" })).getByText(
        "SNS topic",
      ),
    ).toBeInTheDocument();

    unmount();

    // Wide: positioned graph with the same accessible node names.
    setClientWidth(1000);
    render(
      <NodeConnectionInteraction
        nodes={nodes}
        value={[["alarm", "sns"]]}
        onChange={vi.fn()}
      />,
    );
    expect(document.querySelector(".graph")).not.toBeNull();
    expect(
      screen.getByRole("list", { name: "Connections" }),
    ).toHaveTextContent("SNS topic");
  });

  it("ignores the mobile starting source on the desktop graph", () => {
    setClientWidth(1000);
    render(
      <NodeConnectionInteraction
        nodes={nodes}
        value={[]}
        onChange={vi.fn()}
        startNodeId="alarm"
      />,
    );

    expect(document.querySelector(".graph")).not.toBeNull();
    // Desktop keeps the original graph with no node pre-selected.
    expect(
      screen.getByRole("button", { name: "CloudWatch alarm" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("preserves the answer across desktop → mobile → desktop resizes", async () => {
    setClientWidth(1000);
    const user = userEvent.setup();
    render(<Harness />);

    // Build an edge in the desktop graph.
    expect(document.querySelector(".graph")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "CloudWatch alarm" }));
    await user.click(screen.getByRole("button", { name: "SNS topic" }));
    expect(
      screen.getByRole("list", { name: "Connections" }),
    ).toHaveTextContent("SNS topic");

    // Narrow the panel: mobile builder shows the same edge.
    act(() => {
      setClientWidth(400);
      window.dispatchEvent(new Event("resize"));
    });
    expect(document.querySelector(".graph")).toBeNull();
    expect(
      within(screen.getByRole("list", { name: "Your connections" })).getByText(
        "SNS topic",
      ),
    ).toBeInTheDocument();

    // Widen again: the desktop graph still has it.
    act(() => {
      setClientWidth(1000);
      window.dispatchEvent(new Event("resize"));
    });
    expect(document.querySelector(".graph")).not.toBeNull();
    expect(
      screen.getByRole("list", { name: "Connections" }),
    ).toHaveTextContent("SNS topic");
  });
});
