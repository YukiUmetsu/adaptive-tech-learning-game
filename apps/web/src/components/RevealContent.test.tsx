import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import RevealContent from "./RevealContent";
import {
  PROMPT_KIND_META,
  promptAccessibleName,
  promptWords,
} from "../state/learningVocabulary";

describe("RevealContent", () => {
  it("renders a short prose reveal", () => {
    render(<RevealContent reveal={{ type: "text", text: "Records API activity." }} />);
    expect(screen.getByText("Records API activity.")).toBeInTheDocument();
  });

  it("renders backticked code terms in prose as inline code", () => {
    const { container } = render(
      <RevealContent
        reveal={{
          type: "text",
          text: "Publish `mem_used_percent = 78.4` and ship `/var/log/app.log`.",
        }}
      />,
    );

    const codes = container.querySelectorAll("code.inline-code");
    expect(codes).toHaveLength(2);
    expect(codes[0]).toHaveTextContent("mem_used_percent = 78.4");
    expect(codes[1]).toHaveTextContent("/var/log/app.log");
  });

  it("renders a sequence with directional arrows", () => {
    const { container } = render(
      <RevealContent reveal={{ type: "sequence", items: ["Alpha", "Beta", "Gamma"] }} />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(container.querySelectorAll(".reveal-sequence-arrow")).toHaveLength(2);
  });

  it("renders bullets as a list", () => {
    render(<RevealContent reveal={{ type: "bullets", items: ["one", "two"] }} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders keywords as compact clue chips", () => {
    const { container } = render(
      <RevealContent
        reveal={{ type: "keywords", items: ['who changed it', "API call"] }}
      />,
    );
    expect(container.querySelectorAll(".reveal-chip")).toHaveLength(2);
    expect(screen.getByText("who changed it")).toBeInTheDocument();
  });

  it("renders a comparison with titled columns", () => {
    render(
      <RevealContent
        reveal={{
          type: "comparison",
          columns: [
            { title: "CloudTrail", items: ["API activity"] },
            { title: "CloudWatch", items: ["Metrics / logs"] },
          ],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "CloudTrail" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CloudWatch" })).toBeInTheDocument();
    expect(screen.getByText("API activity")).toBeInTheDocument();
    expect(screen.getByText("Metrics / logs")).toBeInTheDocument();
  });

  it("renders a table reveal with accessible column headers", () => {
    render(
      <RevealContent
        reveal={{
          type: "table",
          columns: [
            { id: "constraint", label: "Constraint" },
            { id: "allows", label: "Allows" },
            { id: "rejects", label: "Rejects" },
            { id: "meaning", label: "Meaning" },
          ],
          rows: [
            {
              cells: {
                constraint: "~> 1.2.3",
                allows: "1.2.9",
                rejects: "1.3.0",
                meaning: "Patch updates within 1.2",
              },
            },
            {
              cells: {
                constraint: "= 1.2.3",
                allows: "1.2.3",
                rejects: "1.2.4",
                meaning: "Exact version",
              },
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["Constraint", "Allows", "Rejects", "Meaning"]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("~> 1.2.3")).toBeInTheDocument();
    expect(screen.getByText("Exact version")).toBeInTheDocument();
  });

  it("scales the comparison grid by column count", () => {
    const columns = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        title: `Column ${index + 1}`,
        items: [`item ${index + 1}`],
      }));

    const two = render(
      <RevealContent reveal={{ type: "comparison", columns: columns(2) }} />,
    );
    expect(two.container.querySelector(".reveal-comparison")).toHaveClass(
      "comparison-grid--cols-2",
    );

    const three = render(
      <RevealContent reveal={{ type: "comparison", columns: columns(3) }} />,
    );
    expect(three.container.querySelector(".reveal-comparison")).toHaveClass(
      "comparison-grid--cols-3",
    );

    const six = render(
      <RevealContent reveal={{ type: "comparison", columns: columns(6) }} />,
    );
    const sixGrid = six.container.querySelector(".reveal-comparison");
    expect(sixGrid).toHaveClass("comparison-grid--cols-many");
    expect(sixGrid).toHaveAttribute("data-columns", "6");
    expect(six.container.querySelectorAll(".reveal-comparison-column")).toHaveLength(6);
  });
});

describe("prompt vocabulary", () => {
  it("maps every authored kind to an icon and stable class", () => {
    const kinds = Object.keys(PROMPT_KIND_META);
    expect(kinds).toEqual([
      "what",
      "when",
      "connects_to",
      "not_this",
      "exam_clue",
      "mental_model",
      "action",
      "look_for",
    ]);
    for (const meta of Object.values(PROMPT_KIND_META)) {
      expect(meta.icon.length).toBeGreaterThan(0);
      expect(meta.className.length).toBeGreaterThan(0);
    }
  });

  it("uses the authored words without duplicating the leading icon", () => {
    expect(promptWords({ kind: "what", label: "❓ WHAT?" })).toBe("WHAT?");
    expect(promptAccessibleName({ kind: "exam_clue", label: "🎯 EXAM CLUE" })).toBe(
      "EXAM CLUE",
    );
  });

  it("falls back to the shared name when a label is empty", () => {
    expect(promptWords({ kind: "mental_model", label: "" })).toBe("Mental model");
  });
});
