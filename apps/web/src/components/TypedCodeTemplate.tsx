import { useMemo, type ReactNode } from "react";

import type { TypedBlankSlot } from "../api/types";
import {
  buildSentinelCode,
  normalizeLanguage,
  splitSentinels,
  type TypedBlankStatus,
} from "../lib/typedBlank";
import { highlightCode, tokenClassName } from "../lib/syntaxHighlight";
import TypedBlankInput from "./TypedBlankInput";

interface TypedCodeTemplateProps {
  language: string;
  template: string;
  slots: TypedBlankSlot[];
  value: Record<string, string>;
  disabled?: boolean;
  statuses?: Record<string, TypedBlankStatus>;
  onChange: (next: Record<string, string>) => void;
}

/**
 * Renders a syntax-highlighted code sample with editable blanks inline.
 *
 * `{{slot_id}}` placeholders are replaced with sentinels before tokenizing the
 * whole sample, so highlighting keeps full syntax context. During rendering the
 * sentinels are split back out and real inputs are placed exactly where they
 * occurred, including inside strings or function arguments. Code is treated as
 * text only and is never evaluated.
 */
export default function TypedCodeTemplate({
  language: rawLanguage,
  template,
  slots,
  value,
  disabled = false,
  statuses,
  onChange,
}: TypedCodeTemplateProps) {
  const language = normalizeLanguage(rawLanguage);
  const slotById = useMemo(
    () => new Map(slots.map((slot) => [slot.id, slot])),
    [slots],
  );
  const { code, slotsBySentinel } = useMemo(
    () => buildSentinelCode(template),
    [template],
  );
  const lines = useMemo(
    () => highlightCode(code, language),
    [code, language],
  );

  const renderBlank = (slotId: string, key: string): ReactNode => {
    const slot = slotById.get(slotId);
    if (!slot) {
      return <span key={key}>{`{{${slotId}}}`}</span>;
    }
    return (
      <TypedBlankInput
        key={key}
        slot={slot}
        value={value[slotId] ?? ""}
        disabled={disabled}
        status={statuses?.[slotId]}
        onChange={(next) => onChange({ ...value, [slotId]: next })}
      />
    );
  };

  return (
    <pre className="typed-code" data-language={language}>
      <code>
        {lines.map((line, lineIndex) => (
          <span className="token-line" key={lineIndex}>
            {line.flatMap((token, tokenIndex) => {
              const parts = splitSentinels(token.content, slotsBySentinel);

              if (parts.length === 1 && parts[0].kind === "text") {
                return [
                  <span
                    key={`${lineIndex}-${tokenIndex}`}
                    className={tokenClassName(token.types)}
                  >
                    {token.content}
                  </span>,
                ];
              }

              return parts.map((part, partIndex) => {
                const key = `${lineIndex}-${tokenIndex}-${partIndex}`;
                if (part.kind === "slot") {
                  return renderBlank(part.slotId, key);
                }
                return (
                  <span key={key} className={tokenClassName(token.types)}>
                    {part.text}
                  </span>
                );
              });
            })}
          </span>
        ))}
      </code>
    </pre>
  );
}
