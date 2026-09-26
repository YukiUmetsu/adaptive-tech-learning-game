import { useMemo, type ReactNode } from "react";

import { highlightCode, tokenClassName } from "../lib/syntaxHighlight";
import InlineText from "./InlineText";

export type QuestionPromptBlock =
  | { kind: "text"; text: string }
  | { kind: "code"; language: string; code: string };

interface QuestionPromptProps {
  text: string;
  level?: 1 | 2 | 3;
  className?: string;
}

const FENCE = /```([A-Za-z0-9_+#.-]*)[ \t]*\n([\s\S]*?)```/g;

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
 */
export default function QuestionPrompt({
  text,
  level = 2,
  className,
}: QuestionPromptProps) {
  const blocks = useMemo(() => parseQuestionPrompt(text), [text]);
  let headingRendered = false;
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

  return <div className="question-prompt-content">{nodes}</div>;
}
