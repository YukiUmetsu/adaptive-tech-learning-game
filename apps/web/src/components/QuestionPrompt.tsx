import { useMemo, type ReactNode } from "react";

import { highlightCode, tokenClassName } from "../lib/syntaxHighlight";
import InlineText from "./InlineText";

export type QuestionPromptBlock =
  | { kind: "text"; text: string }
  | { kind: "code"; language: string; code: string };

/**
 * Which slice of a prompt to render.
 *
 * Long typed-code prompts open with a short task sentence and then carry the
 * contract, examples, and constraints. Splitting the two lets the header keep
 * a readable lead while the details sit next to the code they describe.
 */
export type QuestionPromptPart = "full" | "lead" | "details";

interface QuestionPromptProps {
  text: string;
  level?: 1 | 2 | 3;
  className?: string;
  /** Defaults to the whole prompt so existing call sites are unchanged. */
  part?: QuestionPromptPart;
}

export interface QuestionPromptParts {
  /** First sentence, or the whole prompt when it has only one sentence. */
  lead: string;
  /** Everything after the lead, or an empty string when there is none. */
  details: string;
}

const FENCE = /```([A-Za-z0-9_+#.-]*)[ \t]*\n([\s\S]*?)```/g;
const FENCE_START = /```/;

export function parseQuestionPrompt(text: string): QuestionPromptBlock[] {
  const blocks: QuestionPromptBlock[] = [];
  let cursor = 0;

  for (const match of text.matchAll(FENCE)) {
    const index = match.index ?? 0;
    const before = text.slice(cursor, index).trim();
    if (before) {
      blocks.push({ kind: "text", text: before });
    }
    blocks.push({
      kind: "code",
      language: normalizeLanguage(match[1] || "plain"),
      code: match[2].replace(/\n$/, ""),
    });
    cursor = index + match[0].length;
  }

  const tail = text.slice(cursor).trim();
  if (tail) {
    blocks.push({ kind: "text", text: tail });
  }

  return blocks.length > 0 ? blocks : [{ kind: "text", text }];
}

/**
 * Splits a prompt into its lead sentence and the remaining detail prose.
 *
 * The split only fires when a sentence boundary appears before any fenced code
 * block and outside inline `code` spans, so code syntax such as `values[:i]`
 * or a decimal never cuts the lead in half. When no boundary qualifies the
 * whole prompt is the lead and there are no details.
 */
export function splitPrompt(text: string): QuestionPromptParts {
  const trimmed = text.trim();
  const fenceIndex = trimmed.search(FENCE_START);
  const limit = fenceIndex === -1 ? trimmed.length : fenceIndex;
  const breakIndex = firstSentenceBreak(trimmed, limit);
  if (breakIndex <= 0) {
    return { lead: trimmed, details: "" };
  }
  return {
    lead: trimmed.slice(0, breakIndex).trim(),
    details: trimmed.slice(breakIndex).trim(),
  };
}

function firstSentenceBreak(text: string, limit: number): number {
  let inCode = false;
  for (let index = 0; index < limit; index += 1) {
    const char = text[index];
    if (char === "`") {
      inCode = !inCode;
      continue;
    }
    if (inCode || (char !== "." && char !== "!" && char !== "?")) {
      continue;
    }
    let cursor = index + 1;
    if (!/\s/.test(text[cursor] ?? "")) {
      continue;
    }
    // Require the next sentence to open with a capital so decimals and
    // abbreviations inside a clause do not split the lead.
    while (cursor < text.length && /\s/.test(text[cursor])) {
      cursor += 1;
    }
    if (/[A-Z]/.test(text[cursor] ?? "")) {
      return index + 1;
    }
  }
  return -1;
}

function normalizeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  switch (normalized) {
    case "py":
      return "python";
    case "ts":
      return "typescript";
    case "sh":
    case "shell":
      return "bash";
    case "terraform":
    case "tf":
      return "hcl";
    case "":
      return "plain";
    default:
      return normalized;
  }
}

function Heading({
  level,
  className,
  children,
}: {
  level: 1 | 2 | 3;
  className?: string;
  children: ReactNode;
}) {
  if (level === 1) return <h1 className={className}>{children}</h1>;
  if (level === 3) return <h3 className={className}>{children}</h3>;
  return <h2 className={className}>{children}</h2>;
}

function QuestionCodeBlock({
  language,
  code,
}: {
  language: string;
  code: string;
}) {
  const lines = useMemo(() => highlightCode(code, language), [code, language]);

  return (
    <div className="question-code-wrap">
      <span className="question-code-language" aria-hidden="true">
        {language}
      </span>
      <pre
        className="typed-code question-code-block"
        data-language={language}
        aria-label={`${language} code`}
      >
        <code>
          {lines.map((line, lineIndex) => (
            <span className="token-line" key={lineIndex}>
              {line.map((token, tokenIndex) => (
                <span
                  key={`${lineIndex}-${tokenIndex}`}
                  className={tokenClassName(token.types)}
                >
                  {token.content}
                </span>
              ))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/**
 * Renders question prose plus optional Markdown-style fenced code blocks.
 * Inline backticks still use InlineText.
 *
 * `part="lead"` renders only the opening sentence (for a compact header), and
 * `part="details"` renders only the remaining prose (for placing beside the
 * interaction). `part="full"` keeps the original whole-prompt behavior.
 */
export default function QuestionPrompt({
  text,
  level = 2,
  className,
  part = "full",
}: QuestionPromptProps) {
  const { lead, details } = useMemo(() => splitPrompt(text), [text]);
  const rendered = part === "lead" ? lead : part === "details" ? details : text;
  const blocks = useMemo(() => parseQuestionPrompt(rendered), [rendered]);
  // The first text paragraph becomes a heading only when this render includes
  // the lead. Detail prose and fenced code never introduce a heading.
  let headingRendered = part === "details";

  if (part === "details" && !details) {
    return null;
  }

  const nodes: ReactNode[] = [];

  for (const [blockIndex, block] of blocks.entries()) {
    if (block.kind === "code") {
      nodes.push(
        <QuestionCodeBlock
          key={`code-${blockIndex}`}
          language={block.language}
          code={block.code}
        />,
      );
      continue;
    }

    const paragraphs = block.text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
      if (!headingRendered) {
        nodes.push(
          <Heading
            key={`heading-${blockIndex}-${paragraphIndex}`}
            level={level}
            className={className}
          >
            <InlineText text={paragraph} />
          </Heading>,
        );
        headingRendered = true;
      } else {
        nodes.push(
          <p
            key={`text-${blockIndex}-${paragraphIndex}`}
            className="question-prompt-extra"
          >
            <InlineText text={paragraph} />
          </p>,
        );
      }
    }
  }

  const containerClassName =
    part === "details"
      ? "question-prompt-content question-prompt-details"
      : "question-prompt-content";

  return <div className={containerClassName}>{nodes}</div>;
}
