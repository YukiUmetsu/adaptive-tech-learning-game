import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import MobileNodeConnection from "./MobileNodeConnection";

const nodes = [
  { id: "siem", label: "SIEM", x: 0.1, y: 0.2 },
  { id: "firewall", label: "Firewall logs", x: 0.6, y: 0.2 },
  { id: "endpoint", label: "Endpoint logs", x: 0.6, y: 0.5 },
  { id: "ids", label: "IDS alerts", x: 0.6, y: 0.8 },
];

/** Controlled wrapper so multi-step flows update the shared answer state. */
function Harness({
  initial = [] as string[][],
  disabled = false,
  startNodeId,
}: {
  initial?: string[][];
  disabled?: boolean;
  startNodeId?: string;
}) {
  const [value, setValue] = useState<string[][]>(initial);
  return (
    <MobileNodeConnection
      nodes={nodes}
      value={value}
      disabled={disabled}
      onChange={setValue}
      startNodeId={startNodeId}
    />
  );
}

const summary = () => screen.getByRole("list", { name: "Your connections" });

describe("MobileNodeConnection", () => {
  it("selects a source and offers destinations without the source", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "SIEM" }));

    expect(screen.getByLabelText("Selected source")).toHaveTextContent("SIEM");
    const destinations = screen.getByRole("list", { name: "Connect to" });
    // Self-links are unsupported, so the source is never a destination.
    expect(within(destinations).queryByRole("button", { name: "SIEM" })).toBeNull();
    expect(
      within(destinations).getByRole("button", { name: "Firewall logs" }),
    ).toBeInTheDocument();
  });

  it("pre-selects a question-provided starting source on mobile", () => {
    render(
      <MobileNodeConnection
        nodes={nodes}
        value={[]}
        onChange={vi.fn()}
        startNodeId="siem"
      />,
    );

    expect(screen.getByLabelText("Selected source")).toHaveTextContent("SIEM");
    expect(screen.getByText("Select connection from SIEM.")).toBeInTheDocument();

    // The provided start is never offered as its own destination.
    const destinations = screen.getByRole("list", { name: "Connect to" });
    expect(
      within(destinations).queryByRole("button", { name: "SIEM" }),
    ).toBeNull();
  });

  it("lets the learner change away from the provided start source", async () => {
    const user = userEvent.setup();
    render(<Harness startNodeId="siem" />);

    await user.click(
      screen.getByRole("button", { name: "Choose different source" }),
    );

    expect(
      screen.getByRole("list", { name: "Connect from" }),
    ).toBeInTheDocument();
  });

  it("adds a directed [source, destination] edge", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <MobileNodeConnection nodes={nodes} value={[]} onChange={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: "SIEM" }));
    await user.click(screen.getByRole("button", { name: "Firewall logs" }));

    expect(onChange).toHaveBeenCalledWith([["siem", "firewall"]]);
  });

  it("resets the source and target after each relationship", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "SIEM" }));
    expect(
      screen.getByRole("list", { name: "Connect to" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Firewall logs" }));

    // Back to a fresh "Connect FROM" list, with the added edge confirmed.
    expect(
      screen.getByRole("list", { name: "Connect from" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Selected source")).toBeNull();
    expect(screen.getByText("✓ Connection added")).toBeInTheDocument();
  });

  it("prevents duplicate identical edges", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <MobileNodeConnection
        nodes={nodes}
        value={[["siem", "firewall"]]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "SIEM" }));

    const duplicate = screen.getByRole("button", {
      name: "Firewall logs, already connected",
    });
    expect(duplicate).toBeDisabled();
    await user.click(duplicate);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("supports multiple outgoing edges from one source", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // The source resets after each relationship, so it is reselected each time.
    await user.click(screen.getByRole("button", { name: "SIEM" }));
    await user.click(screen.getByRole("button", { name: "Firewall logs" }));
    await user.click(screen.getByRole("button", { name: "SIEM" }));
    await user.click(screen.getByRole("button", { name: "Endpoint logs" }));
    await user.click(screen.getByRole("button", { name: "SIEM" }));
    await user.click(screen.getByRole("button", { name: "IDS alerts" }));

    const items = within(summary()).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(summary()).toHaveTextContent("Firewall logs");
    expect(summary()).toHaveTextContent("Endpoint logs");
    expect(summary()).toHaveTextContent("IDS alerts");
  });

  it("allows a destination to be reused by a different source", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "SIEM" }));
    await user.click(screen.getByRole("button", { name: "Firewall logs" }));
    // The source reset returns to the full list, so a different source is
    // picked directly for the next relationship.
    await user.click(screen.getByRole("button", { name: "Endpoint logs" }));
    await user.click(screen.getByRole("button", { name: "Firewall logs" }));

    expect(within(summary()).getAllByRole("listitem")).toHaveLength(2);
  });

  it("removes an individual connection with an accessible, icon-only control", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          ["siem", "firewall"],
          ["siem", "endpoint"],
        ]}
      />,
    );

    expect(within(summary()).getAllByRole("listitem")).toHaveLength(2);

    const removeButton = screen.getByRole("button", {
      name: "Remove connection from SIEM to Firewall logs",
    });
    // Icon-only: the glyph is decorative, so the accessible name must come
    // from the button's aria-label.
    expect(removeButton.textContent).toBe("");
    expect(removeButton.querySelector("svg")).not.toBeNull();
    expect(removeButton).toHaveAccessibleName(
      "Remove connection from SIEM to Firewall logs",
    );

    await user.click(removeButton);

    const remaining = within(summary()).getAllByRole("listitem");
    expect(remaining).toHaveLength(1);
    expect(summary()).not.toHaveTextContent("Firewall logs");
  });

  it("confirms an added edge as connected, never as correct", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "SIEM" }));
    await user.click(screen.getByRole("button", { name: "Firewall logs" }));

    expect(screen.getByText("✓ Connection added")).toBeInTheDocument();
    expect(screen.queryByText(/correct/i)).toBeNull();
    expect(screen.queryByText(/expected/i)).toBeNull();
  });

  it("resets the selected source when the question's nodes change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <MobileNodeConnection nodes={nodes} value={[]} onChange={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: "SIEM" }));
    expect(screen.getByLabelText("Selected source")).toBeInTheDocument();

    const nextNodes = [{ id: "alpha", label: "Alpha", x: 0.1, y: 0.1 }];
    rerender(
      <MobileNodeConnection
        nodes={nextNodes}
        value={[]}
        onChange={onChange}
      />,
    );

    expect(screen.queryByLabelText("Selected source")).toBeNull();
    expect(
      screen.getByRole("list", { name: "Connect from" }),
    ).toBeInTheDocument();
  });

  it("is fully operable from the keyboard", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <MobileNodeConnection nodes={nodes} value={[]} onChange={onChange} />,
    );

    await user.tab();
    expect(screen.getByRole("button", { name: "SIEM" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Selected source")).toHaveTextContent("SIEM");

    screen.getByRole("button", { name: "Firewall logs" }).focus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith([["siem", "firewall"]]);
  });

  it("does not allow editing a finalized answer", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <MobileNodeConnection
        nodes={nodes}
        value={[["siem", "firewall"]]}
        disabled
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("button", { name: "SIEM" })).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Remove connection from SIEM to Firewall logs",
      }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "SIEM" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("handles a dense graph without any connection lines", () => {
    const dense = Array.from({ length: 8 }, (_, index) => ({
      id: `n${index}`,
      label: `Node ${index}`,
      x: (index % 2) * 0.5,
      y: index * 0.1,
    }));
    render(
      <MobileNodeConnection nodes={dense} value={[]} onChange={vi.fn()} />,
    );

    expect(document.querySelector("svg")).toBeNull();
    const choices = screen.getByRole("list", { name: "Connect from" });
    expect(within(choices).getAllByRole("button")).toHaveLength(8);
  });
});
