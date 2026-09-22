import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { LearningTextReveal } from "../lib/learningElements";
import {
  optionalProgressiveTextReveal,
  progressiveTextReveal,
} from "../test/progressiveTextFixture";
import ProgressiveText from "./ProgressiveText";

/** A stateful harness so a click actually reveals the span. */
function Harness({
  reveal = progressiveTextReveal,
  initialRevealed = [] as string[],
  disabled = false,
  complete = false,
  onComplete,
}: {
  reveal?: LearningTextReveal;
  initialRevealed?: string[];
  disabled?: boolean;
  complete?: boolean;
  onComplete?: () => void;
}) {
  const [revealed, setRevealed] = useState<string[]>(initialRevealed);
  return (
    <ProgressiveText
      reveal={reveal}
      interaction={{
        revealedElementIds: revealed,
        onRevealElement: (id) => setRevealed((prev) => [...prev, id]),
        disabled,
        complete,
        onComplete,
      }}
    />
  );
}

describe("ProgressiveText", () => {
  it("renders the surrounding sentence before any reveal", () => {
    const { container } = render(<Harness />);

    const paragraph = container.querySelector(".progressive-text");
    expect(paragraph).not.toBeNull();
    expect(paragraph).toHaveTextContent("Security groups are");
    expect(paragraph).toHaveTextContent("while network ACLs are");
  });

  it("keeps the hidden phrase out of the DOM and accessibility tree", () => {
    const { container } = render(<Harness />);

    expect(screen.queryByText("stateful")).toBeNull();
    expect(screen.queryByText("stateless")).toBeNull();

    const buttons = container.querySelectorAll(".progressive-text-reveal");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      // The answer leaks nowhere: not in text, label, title, or data.
      expect(button.textContent).toBe("");
      expect(button.getAttribute("aria-label")).not.toMatch(/stateful|stateless/);
      expect(button).not.toHaveAttribute("title");
      expect(button.getAttribute("aria-describedby")).toBeNull();
    }
    expect(
      screen.queryByRole("button", { name: /stateful|stateless/i }),
    ).toBeNull();
  });

  it("gives each control a useful, non-leaking accessible label", () => {
    render(<Harness />);

    expect(
      screen.getByRole("button", { name: "Reveal hidden phrase 1 of 2" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reveal hidden phrase 2 of 2" }),
    ).toBeInTheDocument();
  });

  it("reveals only the clicked span", async () => {
    render(<Harness />);

    await userEvent.click(
      screen.getByRole("button", { name: "Reveal hidden phrase 1 of 2" }),
    );

    expect(screen.getByText("stateful")).toBeInTheDocument();
    expect(screen.queryByText("stateless")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Reveal hidden phrase 2 of 2" }),
    ).toBeInTheDocument();
  });

  it("reveals multiple spans independently, in any order", async () => {
    render(<Harness />);

    await userEvent.click(
      screen.getByRole("button", { name: "Reveal hidden phrase 2 of 2" }),
    );
    expect(screen.getByText("stateless")).toBeInTheDocument();
    expect(screen.queryByText("stateful")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Reveal hidden phrase 1 of 2" }),
    );
    expect(screen.getByText("stateful")).toBeInTheDocument();
    expect(screen.getByText("stateless")).toBeInTheDocument();
  });

  it("reveals all spans in read-only review", () => {
    const { container } = render(
      <Harness
        initialRevealed={["span:sg-state", "span:nacl-state"]}
        disabled
      />,
    );

    expect(screen.getByText("stateful")).toBeInTheDocument();
    expect(screen.getByText("stateless")).toBeInTheDocument();
    expect(container.querySelectorAll(".progressive-text-reveal")).toHaveLength(
      0,
    );
  });

  it("activates a span with the keyboard", async () => {
    render(<Harness />);

    const button = screen.getByRole("button", {
      name: "Reveal hidden phrase 1 of 2",
    });
    button.focus();
    expect(button).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("stateful")).toBeInTheDocument();
  });

  it("does not expose the hidden phrase through the accessible name", () => {
    render(<Harness />);

    const control = screen.getByRole("button", {
      name: "Reveal hidden phrase 1 of 2",
    });
    const accessibleName = control.getAttribute("aria-label") ?? "";
    expect(accessibleName).not.toContain("stateful");
  });

  it("keeps controls inline inside the paragraph for natural wrapping", () => {
    const { container } = render(<Harness />);

    const paragraph = container.querySelector("p.progressive-text");
    const buttons = container.querySelectorAll("button.progressive-text-reveal");
    expect(paragraph).not.toBeNull();
    expect(buttons).toHaveLength(2);
    // Each control is a direct inline child of the sentence, never a block
    // wrapper that would need a desktop-only layout.
    for (const button of buttons) {
      expect(button.parentElement).toBe(paragraph);
      expect(button.tagName).toBe("BUTTON");
    }
  });

  it("completes an all-optional reveal on an explicit action", async () => {
    const onComplete = vi.fn();
    render(
      <Harness
        reveal={optionalProgressiveTextReveal}
        onComplete={onComplete}
      />,
    );

    // The multi-word optional phrase is hidden until revealed.
    expect(screen.queryByText("outbound internet access")).toBeNull();

    const mark = screen.getByRole("button", { name: "Mark as reviewed" });
    await userEvent.click(mark);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("hides the explicit action once complete or when spans are required", () => {
    const { rerender } = render(
      <Harness
        reveal={optionalProgressiveTextReveal}
        complete
        onComplete={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Mark as reviewed" }),
    ).toBeNull();

    rerender(<Harness onComplete={() => {}} />);
    expect(
      screen.queryByRole("button", { name: "Mark as reviewed" }),
    ).toBeNull();
  });
});
