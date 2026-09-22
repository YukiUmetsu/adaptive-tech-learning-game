/**
 * Sandbox page entry point.
 *
 * This page is loaded inside the hidden iframe created by
 * [`IframePythonTransport`]. It owns the Web Worker that runs Pyodide, relays
 * validated messages between the parent app and that worker, and holds no
 * application state, credentials, or API access of its own.
 *
 * It only accepts messages from the `appOrigin` query parameter and only posts
 * messages back to that origin.
 */
import {
  isClientMessage,
  isRunnerMessage,
  type ClientMessage,
  type RunnerMessage,
} from "../pythonExecution/protocol";

const params = new URLSearchParams(window.location.search);
const expectedAppOrigin = parseOrigin(params.get("appOrigin"));

// The sandbox is only meaningful when embedded by the app. When opened
// directly (window.parent === window) it refuses to relay anything.
const isFramed = window.parent !== window;

const worker = isFramed
  ? new Worker(new URL("./pythonWorker.ts", import.meta.url), {
      type: "module",
    })
  : null;

/** Accepts only absolute http(s) origins. */
function parseOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function postToApp(message: RunnerMessage): void {
  if (!isFramed || !expectedAppOrigin) {
    return;
  }
  window.parent.postMessage(message, expectedAppOrigin);
}

worker?.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (isRunnerMessage(event.data)) {
    postToApp(event.data);
  }
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isFramed || !worker || !expectedAppOrigin) {
    return;
  }
  if (event.origin !== expectedAppOrigin) {
    return;
  }
  if (event.source !== window.parent) {
    return;
  }
  if (!isClientMessage(event.data)) {
    return;
  }
  const message: ClientMessage = event.data;
  worker.postMessage(message);
});

postToApp({ type: "PYTHON_READY" });
