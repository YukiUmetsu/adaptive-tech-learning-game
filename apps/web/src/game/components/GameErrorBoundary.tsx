import { Component, type ReactNode } from "react";

/**
 * Error boundary for a running mission.
 *
 * The game must never blank the page: if anything throws during render, show a
 * recoverable message and let the player restart instead of staring at an empty
 * screen.
 */
export interface GameErrorBoundaryProps {
  children: ReactNode;
  /** Called before the retry, e.g. to drop a corrupt saved run. */
  onReset?: () => void;
}

interface GameErrorBoundaryState {
  error: Error | null;
}

export default class GameErrorBoundary extends Component<
  GameErrorBoundaryProps,
  GameErrorBoundaryState
> {
  state: GameErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): GameErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error("Cyber Defense mission crashed", error);
  }

  private handleReset = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <section className="cyber-error" role="alert">
          <h1>Mission hit an error</h1>
          <p className="muted">
            Something went wrong while running the mission. Your progress is
            safe.
          </p>
          <button
            type="button"
            className="cyber-primary-button"
            onClick={this.handleReset}
          >
            Restart mission
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
