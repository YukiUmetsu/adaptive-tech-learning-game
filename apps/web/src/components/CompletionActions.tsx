import { Link } from "react-router-dom";

export interface CompletionAction {
  key: string;
  label: string;
  variant: "primary" | "secondary" | "quiet";
  /** Navigate here. */
  to?: string;
  /** Run this instead of navigating. */
  onClick?: () => void;
  disabled?: boolean;
}

interface CompletionActionsProps {
  actions: CompletionAction[];
}

/**
 * Mode-specific calls to action for the shared completion screen.
 *
 * A mode only supplies different actions; the layout and styling stay shared.
 */
export default function CompletionActions({ actions }: CompletionActionsProps) {
  return (
    <div className="completion-actions">
      {actions.map((action) =>
        action.to ? (
          <Link
            key={action.key}
            to={action.to}
            className={`completion-action ${action.variant}`}
          >
            {action.label}
          </Link>
        ) : (
          <button
            key={action.key}
            type="button"
            className={`completion-action ${action.variant}`}
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ),
      )}
    </div>
  );
}
