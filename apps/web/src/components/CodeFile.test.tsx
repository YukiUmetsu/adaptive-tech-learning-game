import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CodeAnnotation } from "../api/types";
import { TERRAFORM_CODE } from "../test/codeLearningFixture";
import CodeFile, { type CodeFileReveal } from "./CodeFile";

const annotations: CodeAnnotation[] = [
  {
    id: "terraform-version",
    anchor: { line: 2, text: "required_version" },
    title: "Terraform CLI version",
    explanation: "required_version constrains the Terraform CLI.",
    required: true,
  },
  {
    id: "provider-source",
    anchor: { line: 6, text: "source" },
    title: "Provider source address",
    explanation: "This tells Terraform where the plugin comes from.",
    required: true,
  },
  {
    id: "provider-version",
    anchor: { line: 7, text: "version" },
    title: "Provider version constraint",
    explanation: "This constrains the provider plugin version.",
    required: false,
  },
];

function reveal(overrides: Partial<CodeFileReveal> = {}): CodeFileReveal {
  return {
    type: "code_file",
    filename: "versions.tf",
    language: "hcl",
    code: TERRAFORM_CODE,
    line_numbers: true,
    annotations,
    ...overrides,
  };
}

/** A stateful harness so a click actually reveals the explanation. */
function Harness({
  revealValue = reveal(),
  initialRevealed = [] as string[],
}: {
  revealValue?: CodeFileReveal;
  initialRevealed?: string[];
}) {
  const [revealed, setRevealed] = useState<string[]>(initialRevealed);
  return (
    <CodeFile
      reveal={revealValue}
      interaction={{
        revealedAnnotationIds: revealed,
        onRevealAnnotation: (id) => setRevealed((prev) => [...prev, id]),
      }}
    />
  );
}

describe("CodeFile", () => {
  it("renders the filename and the code before any click", () => {
    render(<Harness />);

    expect(screen.getByText("versions.tf")).toBeInTheDocument();
    expect(screen.getByText("required_version")).toBeInTheDocument();
    expect(screen.getByText("hcl")).toBeInTheDocument();
  });

  it("hides every explanation initially", () => {
    render(<Harness />);

    expect(screen.queryByText("Terraform CLI version")).toBeNull();
    expect(screen.queryByText("Provider source address")).toBeNull();
  });

  it("reveals an explanation when the annotated region is clicked", async () => {
    render(<Harness />);

    await userEvent.click(
      screen.getByRole("button", { name: /Terraform CLI version/ }),
    );

    expect(screen.getByText("Terraform CLI version")).toBeInTheDocument();
    expect(
      screen.getByText("required_version constrains the Terraform CLI."),
    ).toBeInTheDocument();
  });

  it("activates an annotation with the keyboard", async () => {
    render(<Harness />);

    const button = screen.getByRole("button", {
      name: /Terraform CLI version/,
    });
    button.focus();
    expect(button).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-expanded", "true");

    await userEvent.keyboard(" ");
    expect(button).toBeInTheDocument();
  });

  it("reveals multiple independent annotations", async () => {
    render(<Harness />);

    await userEvent.click(
      screen.getByRole("button", { name: /Terraform CLI version/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Provider source address/ }),
    );

    expect(screen.getByText("Terraform CLI version")).toBeInTheDocument();
    expect(screen.getByText("Provider source address")).toBeInTheDocument();
    expect(screen.queryByText("Provider version constraint")).toBeNull();
  });

  it("restores already-revealed annotations from progress", () => {
    render(<Harness initialRevealed={["provider-source"]} />);

    expect(screen.getByText("Provider source address")).toBeInTheDocument();
    expect(screen.queryByText("Terraform CLI version")).toBeNull();
  });

  it("keeps Prism token classes on annotated text", () => {
    render(<Harness />);

    const button = screen.getByRole("button", {
      name: /Terraform CLI version/,
    });
    const tokenSpans = within(button).getAllByText(/required_version/);
    expect(tokenSpans.length).toBeGreaterThan(0);
    expect(tokenSpans[0].className).toContain("token");
  });

  it("still renders annotations when the language is unknown", () => {
    render(<Harness revealValue={reveal({ language: "not-a-language" })} />);

    const button = screen.getByRole("button", {
      name: /Terraform CLI version/,
    });
    expect(button).toBeInTheDocument();
    expect(within(button).getByText("required_version")).toHaveClass("token");
  });
});

describe("CodeFile completion", () => {
  it("requires explicit review when there are no required annotations", async () => {
    const onComplete = vi.fn();
    render(
      <CodeFile
        reveal={reveal({ annotations: [annotations[2]] })}
        interaction={{
          revealedAnnotationIds: [],
          onRevealAnnotation: () => {},
          complete: false,
          onComplete,
        }}
      />,
    );

    const mark = screen.getByRole("button", { name: "Mark as reviewed" });
    await userEvent.click(mark);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not offer mark-as-reviewed when required annotations exist", () => {
    render(
      <CodeFile
        reveal={reveal()}
        interaction={{
          revealedAnnotationIds: ["terraform-version", "provider-source"],
          onRevealAnnotation: () => {},
          complete: true,
          onComplete: () => {},
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Mark as reviewed" })).toBeNull();
  });
});
