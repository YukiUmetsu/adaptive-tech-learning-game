import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  Choice,
  FixedNode,
  ReconstructionSlot,
} from "../api/types";
import ReconstructionInteraction from "./ReconstructionInteraction";

const fixedNodes: FixedNode[] = [
  { id: "metric", label: "Metric crosses threshold", position: "start" },
];

const pieces: Choice[] = [
  { id: "alarm", label: "CloudWatch alarm" },
  { id: "sns", label: "SNS topic" },
  { id: "operator", label: "Operator notification" },
  { id: "cloudtrail", label: "CloudTrail" },
];

const slots: ReconstructionSlot[] = [
  { id: "slot_1" },
  { id: "slot_2" },
  { id: "slot_3" },
];

function linear(
  value: { placements: Record<string, string>; edges: string[][] } = {
    placements: {},
    edges: [],
  },
  onChange = vi.fn(),
) {
  return render(
    <ReconstructionInteraction
      layout="linear"
      fixedNodes={fixedNodes}
      pieces={pieces}
      slots={slots}
      value={value}
      onChange={onChange}
    />,
  );
}

describe("ReconstructionInteraction (linear)", () => {
  it("renders provided context, empty slots, and a plain palette", () => {
    linear();

    expect(screen.getByText("Metric crosses threshold")).toBeInTheDocument();
    expect(screen.getAllByText("Drop component")).toHaveLength(3);
    for (const piece of pieces) {
      expect(
        screen.getByRole("button", { name: piece.label }),
      ).toBeInTheDocument();
    }
  });

  it("does not put (distractor) or answer metadata in piece labels", () => {
    linear();

    for (const piece of pieces) {
      const button = screen.getByRole("button", { name: piece.label });
      expect(button).toHaveTextContent(piece.label);
      expect(button.textContent?.toLowerCase()).not.toContain("distractor");
    }
  });

  it("places a component with tap-select then tap-slot", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    linear({ placements: {}, edges: [] }, onChange);

    await user.click(
      screen.getByRole("button", { name: "CloudWatch alarm" }),
    );
    await user.click(screen.getByRole("button", { name: "Slot 1: empty" }));

    expect(onChange).toHaveBeenCalledWith({
      placements: { slot_1: "alarm" },
      edges: [],
    });
  });

  it("places a component with drag and drop", () => {
    const onChange = vi.fn();
    linear({ placements: {}, edges: [] }, onChange);

    const dataTransfer = {
      getData: () => "piece:alarm",
      setData: () => undefined,
    };
    fireEvent.drop(screen.getByRole("button", { name: "Slot 2: empty" }), {
      dataTransfer,
    });

    expect(onChange).toHaveBeenCalledWith({
      placements: { slot_2: "alarm" },
      edges: [],
    });
  });

  it("replaces a placed component", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    linear({ placements: { slot_1: "alarm" }, edges: [] }, onChange);

    await user.click(screen.getByRole("button", { name: "SNS topic" }));
    await user.click(
      screen.getByRole("button", { name: "Slot 1: CloudWatch alarm" }),
    );

    expect(onChange).toHaveBeenCalledWith({
      placements: { slot_1: "sns" },
      edges: [],
    });
  });

  it("removes a placed component", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    linear({ placements: { slot_1: "alarm" }, edges: [] }, onChange);

    await user.click(
      screen.getByRole("button", {
        name: "Remove CloudWatch alarm from slot 1",
      }),
    );

    expect(onChange).toHaveBeenCalledWith({ placements: {}, edges: [] });
  });

  it("removes a placed component when the slot is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    linear({ placements: { slot_1: "alarm" }, edges: [] }, onChange);

    await user.click(
      screen.getByRole("button", { name: "Slot 1: CloudWatch alarm" }),
    );

    expect(onChange).toHaveBeenCalledWith({ placements: {}, edges: [] });
  });

  it("removes a placed piece from the palette but leaves distractors", () => {
    linear({ placements: { slot_1: "alarm", slot_2: "sns" }, edges: [] });

    expect(
      screen.queryByRole("button", { name: "CloudWatch alarm" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "SNS topic" })).toBeNull();
    // `CloudTrail` is a plausible distractor and stays available.
    expect(
      screen.getByRole("button", { name: "CloudTrail" }),
    ).toBeInTheDocument();
  });
});

describe("ReconstructionInteraction (graph)", () => {
  const graphFixed: FixedNode[] = [
    {
      id: "alarm",
      label: "CloudWatch alarm",
      position: "start",
      x: 0.5,
      y: 0.15,
    },
  ];
  const graphPieces: Choice[] = [
    { id: "sns", label: "SNS topic" },
    { id: "operator", label: "Operator notification" },
    { id: "eventbridge", label: "EventBridge rule" },
  ];
  const graphSlots: ReconstructionSlot[] = [
    { id: "sns_slot", x: 0.25, y: 0.3 },
    { id: "operator_slot", x: 0.25, y: 0.8 },
    { id: "eventbridge_slot", x: 0.75, y: 0.3 },
  ];

  function graph(
    value: { placements: Record<string, string>; edges: string[][] },
    onChange = vi.fn(),
  ) {
    return render(
      <ReconstructionInteraction
        layout="graph"
        fixedNodes={graphFixed}
        pieces={graphPieces}
        slots={graphSlots}
        value={value}
        onChange={onChange}
      />,
    );
  }

  const placements = {
    sns_slot: "sns",
    operator_slot: "operator",
    eventbridge_slot: "eventbridge",
  };

  it("creates a relationship by dragging a handle onto a target", () => {
    const onChange = vi.fn();
    graph({ placements, edges: [] }, onChange);

    const handle = screen.getByRole("button", {
      name: "Relationship from CloudWatch alarm",
    });
    const target = screen.getByRole("button", {
      name: "Placed component SNS topic; click to remove, drag to move",
    });

    const setData = vi.fn();
    fireEvent.dragStart(handle, { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", "node:alarm");

    fireEvent.drop(target, {
      dataTransfer: { getData: () => "node:alarm" },
    });

    expect(onChange).toHaveBeenCalledWith({
      placements,
      edges: [["alarm", "sns"]],
    });
  });

  it("creates a relationship by tapping a source handle then a target handle", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    graph({ placements, edges: [] }, onChange);

    await user.click(
      screen.getByRole("button", {
        name: "Relationship from CloudWatch alarm",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Relationship from SNS topic" }),
    );

    expect(onChange).toHaveBeenCalledWith({
      placements,
      edges: [["alarm", "sns"]],
    });
  });

  it("moves a placed component to another slot by dragging it", () => {
    const onChange = vi.fn();
    graph({ placements, edges: [] }, onChange);

    const source = screen.getByRole("button", {
      name: "Placed component SNS topic; click to remove, drag to move",
    });
    const target = screen.getByRole("button", {
      name: "Placed component EventBridge rule; click to remove, drag to move",
    });

    const setData = vi.fn();
    fireEvent.dragStart(source, { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", "move:sns");

    fireEvent.drop(target, {
      dataTransfer: { getData: () => "move:sns" },
    });

    expect(onChange).toHaveBeenCalledWith({
      placements: {
        operator_slot: "operator",
        eventbridge_slot: "sns",
      },
      edges: [],
    });
  });

  it("removes a placed component when its body is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    graph({ placements, edges: [] }, onChange);

    await user.click(
      screen.getByRole("button", {
        name: "Placed component SNS topic; click to remove, drag to move",
      }),
    );

    expect(onChange).toHaveBeenCalledWith({
      placements: {
        operator_slot: "operator",
        eventbridge_slot: "eventbridge",
      },
      edges: [],
    });
  });

  it("places a piece by dropping it on an empty graph slot", () => {
    const onChange = vi.fn();
    graph({ placements: {}, edges: [] }, onChange);

    fireEvent.drop(
      screen.getAllByRole("button", {
        name: "Empty slot; drop a component here",
      })[0],
      { dataTransfer: { getData: () => "piece:sns" } },
    );

    expect(onChange).toHaveBeenCalledWith({
      placements: { sns_slot: "sns" },
      edges: [],
    });
  });

  it("removes an existing relationship", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    graph({ placements, edges: [["alarm", "sns"]] }, onChange);

    await user.click(
      screen.getByRole("button", {
        name: "Remove relationship CloudWatch alarm to SNS topic",
      }),
    );

    expect(onChange).toHaveBeenCalledWith({ placements, edges: [] });
  });
});
