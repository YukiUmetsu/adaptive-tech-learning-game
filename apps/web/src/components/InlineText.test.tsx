import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GlossaryTerm } from "../api/types";
import GlossaryProvider from "./GlossaryProvider";
import InlineText from "./InlineText";

const terms: GlossaryTerm[] = [
  { term: "guest memory", definition: "RAM inside the guest operating system." },
];

describe("InlineText", () => {
  it("renders plain text without code markup", () => {
    const { container } = render(<InlineText text="Just plain text" />);

    expect(container.querySelector("code")).toBeNull();
    expect(screen.getByText("Just plain text")).toBeInTheDocument();
  });

  it("renders backticked spans as inline code terms", () => {
    const { container } = render(
      <InlineText text="Publish `mem_used_percent = 78.4` and ship `/var/log/app.log`." />,
    );

    const codes = container.querySelectorAll("code.inline-code");
    expect(codes).toHaveLength(2);
    expect(codes[0]).toHaveTextContent("mem_used_percent = 78.4");
    expect(codes[1]).toHaveTextContent("/var/log/app.log");
    // The backticks themselves are not shown.
    expect(container.textContent).not.toContain("`");
  });

  it("keeps an unmatched backtick as literal text", () => {
    const { container } = render(<InlineText text="broken `span" />);

    expect(container.querySelector("code")).toBeNull();
    expect(screen.getByText("broken `span")).toBeInTheDocument();
  });

  it("highlights glossary terms and reveals the definition on click", () => {
    render(<InlineText text="Check guest memory usage." terms={terms} />);

    const term = screen.getByRole("button", { name: /guest memory/i });
    expect(term).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText("RAM inside the guest operating system."),
    ).not.toBeInTheDocument();

    fireEvent.click(term);

    expect(term).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText("RAM inside the guest operating system."),
    ).toBeInTheDocument();
  });

  it("does not highlight glossary terms inside code spans", () => {
    const { container } = render(
      <InlineText text="`guest memory`" terms={terms} />,
    );

    expect(screen.queryByRole("button", { name: /guest memory/i })).toBeNull();
    expect(container.querySelector("code.inline-code")).toHaveTextContent(
      "guest memory",
    );
  });

  it("can disable terms with an explicit empty override", () => {
    render(<InlineText text="Check guest memory usage." terms={[]} />);

    expect(screen.queryByRole("button", { name: /guest memory/i })).toBeNull();
  });

  it("highlights each term only on its first occurrence in a page", () => {
    const { container } = render(
      <GlossaryProvider terms={terms}>
        <InlineText text="guest memory here" />
        <InlineText text="and guest memory again" />
      </GlossaryProvider>,
    );

    // Only the first occurrence is a highlighted, clickable term.
    expect(
      screen.getAllByRole("button", { name: /guest memory/i }),
    ).toHaveLength(1);
    expect(container.querySelectorAll(".glossary-term-icon")).toHaveLength(1);
    // The later occurrence still reads as text.
    expect(container.textContent).toContain("and guest memory again");
  });

  it("never highlights a term that is the page subject", () => {
    render(
      <GlossaryProvider
        terms={[{ term: "CloudWatch agent", definition: "The agent." }]}
        subject="CloudWatch agent"
      >
        <InlineText text="The CloudWatch agent publishes metrics." />
      </GlossaryProvider>,
    );

    expect(
      screen.queryByRole("button", { name: /CloudWatch agent/ }),
    ).toBeNull();
  });

  it("still highlights sub-terms that are not the page subject", () => {
    render(
      <GlossaryProvider
        terms={terms}
        subject="CloudWatch agent"
      >
        <InlineText text="guest memory is important." />
      </GlossaryProvider>,
    );

    expect(
      screen.getByRole("button", { name: /guest memory/i }),
    ).toBeInTheDocument();
  });
});
