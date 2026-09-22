/**
 * Beginner-friendly explanations for common Python errors.
 *
 * The original Python exception name is always preserved. A hint is only added
 * when the error is unambiguous; otherwise the raw message is shown unchanged
 * rather than inventing a diagnosis.
 */
import type { PythonExecutionError } from "./protocol";

/** A short, learner-facing explanation. */
export interface FriendlyPythonError {
  /** One-sentence summary shown first. */
  title: string;
  /** The preserved Python message. */
  detail: string;
  /** Optional, safely derived hint. */
  hint?: string;
}

function lineSuffix(error: PythonExecutionError): string {
  return error.line ? ` on line ${error.line}` : "";
}

function syntaxHint(message: string): string | undefined {
  const lower = message.toLowerCase();
  if (lower.includes("expected ':'")) {
    return 'You may be missing ":" at the end of the line.';
  }
  if (lower.includes("unexpected indent")) {
    return "This line is indented more than Python expects.";
  }
  if (lower.includes("expected an indented block")) {
    return "The line after a `:` needs to be indented.";
  }
  if (lower.includes("unterminated string")) {
    return "A string literal is missing its closing quote.";
  }
  if (lower.includes("was never closed")) {
    return "A bracket, parenthesis, or brace was opened but not closed.";
  }
  return undefined;
}

/** Maps a structured Python error to a short explanation. */
export function friendlyPythonError(error: PythonExecutionError): FriendlyPythonError {
  const message = error.message.trim();
  switch (error.type) {
    case "SyntaxError":
    case "IndentationError":
      return {
        title: `Your code has a syntax error${lineSuffix(error)}. Python couldn't parse it.`,
        detail: message,
        hint: syntaxHint(message),
      };
    case "NameError":
      return {
        title: "Python can't find a variable or function that your code uses.",
        detail: message,
        hint: error.suggestion
          ? `Did you mean \`${error.suggestion}\`?`
          : undefined,
      };
    case "TypeError":
      return {
        title: "This operation used a value of an unexpected type.",
        detail: message,
      };
    case "ValueError":
      return {
        title: "A value wasn't accepted by the operation that received it.",
        detail: message,
      };
    case "IndexError":
      return {
        title: "Your code asked for an item that isn't in the sequence.",
        detail: message,
      };
    case "KeyError":
      return {
        title: "Your code asked for a dictionary key that isn't there.",
        detail: message,
      };
    case "ZeroDivisionError":
      return {
        title: "You tried to divide by zero.",
        detail: message,
      };
    case "AttributeError":
      return {
        title: "That value doesn't have the attribute or method you used.",
        detail: message,
      };
    case "MemoryError":
      return {
        title: "Your program ran out of memory.",
        detail: message,
        hint: "Try a smaller data set, or process fewer items at once.",
      };
    case "RecursionError":
      return {
        title: "Your program recursed too deeply.",
        detail: message,
        hint: "Check that a recursive function has a base case that eventually stops.",
      };
    default:
      return {
        title: "Your code started running but hit an error.",
        detail: message ? `${error.type}: ${message}` : error.type,
      };
  }
}
