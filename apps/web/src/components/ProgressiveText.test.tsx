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

  it("sizes each hidden mask to the length of its hidden phrase", () => {
    const { container } = render(<Harness />);

    const buttons =
      container.querySelectorAll<HTMLButtonElement>(".progressive-text-reveal");
    // "stateful" (8) and "stateless" (9) reserve different widths.
    expect(buttons[0]?.style.getPropertyValue("--hidden-length")).toBe("8");
    expect(buttons[1]?.style.getPropertyValue("--hidden-length")).toBe("9");

    // The width hint is only a character count; the phrase never enters the DOM.
    expect(container.innerHTML).not.toContain("stateful");
    expect(container.innerHTML).not.toContain("stateless");
  });

  it("reserves more space for a longer hidden phrase", () => {
    const { container } = render(
      <Harness reveal={optionalProgressiveTextReveal} />,
    );

    const button =
      container.querySelector<HTMLButtonElement>(".progressive-text-reveal");
    // "outbound internet access" (24 characters).
    expect(button?.style.getPropertyValue("--hidden-length")).toBe("24");
  });

  it("uses the measured phrase width once measurement is available", () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    // jsdom does not lay out, so fake a 10px-per-character measurement.
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const width = (this.textContent?.length ?? 0) * 10;
      return { width } as unknown as DOMRect;
    };
    try {
      const { container } = render(<Harness />);
      const masks =
        container.querySelectorAll<HTMLElement>(".progressive-text-mask");
      // "stateful" (80px) and "stateless" (90px) reserve their real widths.
      expect(masks[0]?.style.width).toBe("80px");
      expect(masks[1]?.style.width).toBe("90px");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
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
