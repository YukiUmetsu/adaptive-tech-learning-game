/**
 * Transport abstraction for the Python runner.
 *
 * The execution client never talks to a Web Worker directly. It talks to a
 * transport, so the runner can live on a dedicated sandbox origin later without
 * changing the client, the React components, or the answer flow.
 */
import type { ClientMessage, RunnerMessage } from "./protocol";

/** One disposable runner endpoint. */
export interface PythonTransport {
  /** Origin the sandbox is expected to report from. */
  readonly origin: string;
  /** Creates the endpoint and resolves once it is ready to accept runs. */
  start(): Promise<void>;
  /** Sends a validated message to the runner. */
  post(message: ClientMessage): void;
  /** Registers a listener for validated runner messages. */
  subscribe(listener: (message: RunnerMessage) => void): () => void;
  /** Tears the endpoint down and reclaims its runtime memory. */
  terminate(): void;
}

/** Creates a fresh, disposable transport. */
export type PythonTransportFactory = () => PythonTransport;
