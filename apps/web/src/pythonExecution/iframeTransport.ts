/**
 * Iframe transport for the Python sandbox.
 *
 * The app embeds a dedicated sandbox page in a hidden iframe and speaks the
 * validated message protocol. The sandbox page owns the Web Worker and Pyodide;
 * the app origin never runs learner Python on its own thread.
 *
 * By default the iframe is same-origin, which is convenient but is **not** an
 * origin isolation boundary. Production should set
 * `VITE_PYTHON_SANDBOX_ORIGIN` so the page is served from a dedicated origin
 * with no cookies, tokens, or application storage.
 */
import { appOrigin, sandboxOrigin, sandboxPageUrl } from "./config";
import { isRunnerMessage, type ClientMessage, type RunnerMessage } from "./protocol";
import type { PythonTransport } from "./transport";

/** How long to wait for the sandbox page to announce readiness. */
const READY_TIMEOUT_MS = 20_000;

/** An iframe-hosted Python sandbox. One instance is one disposable runtime. */
export class IframePythonTransport implements PythonTransport {
  readonly origin = sandboxOrigin();

  private iframe: HTMLIFrameElement | null = null;
  private readonly listeners = new Set<(message: RunnerMessage) => void>();
  private readonly appOriginValue = appOrigin();
  private ready: Promise<void> | null = null;
  private readyTimeout: number | null = null;

  start(): Promise<void> {
    if (this.ready) {
      return this.ready;
    }
    this.ready = new Promise<void>((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.title = "Python sandbox";
      iframe.setAttribute("aria-hidden", "true");
      iframe.setAttribute("tabindex", "-1");
      // Deny all permission-policy features and strip the referrer; the
      // sandbox needs none of them.
      iframe.setAttribute("allow", "");
      iframe.referrerPolicy = "no-referrer";
      iframe.style.cssText =
        "position:absolute;width:0;height:0;border:0;visibility:hidden";
      iframe.src = this.buildUrl();

      this.readyTimeout = window.setTimeout(() => {
        this.readyTimeout = null;
        reject(new Error("python_sandbox_ready_timeout"));
      }, READY_TIMEOUT_MS);

      this.pendingReady = () => {
        if (this.readyTimeout !== null) {
          window.clearTimeout(this.readyTimeout);
          this.readyTimeout = null;
        }
        this.pendingReady = null;
        resolve();
      };

      window.addEventListener("message", this.handleWindowMessage);
      document.body.appendChild(iframe);
      this.iframe = iframe;
    });
    return this.ready;
  }

  post(message: ClientMessage): void {
    this.iframe?.contentWindow?.postMessage(message, this.origin);
  }

  subscribe(listener: (message: RunnerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  terminate(): void {
    window.removeEventListener("message", this.handleWindowMessage);
    if (this.readyTimeout !== null) {
      window.clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }
    this.listeners.clear();
    if (this.iframe?.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
    }
    this.iframe = null;
    this.ready = null;
    this.pendingReady = null;
  }

  private pendingReady: (() => void) | null = null;

  private buildUrl(): string {
    const url = new URL(sandboxPageUrl());
    url.searchParams.set("appOrigin", this.appOriginValue);
    return url.href;
  }

  private readonly handleWindowMessage = (event: MessageEvent): void => {
    // Only the configured sandbox origin, only our iframe, only valid messages.
    if (event.origin !== this.origin) {
      return;
    }
    if (!this.iframe || event.source !== this.iframe.contentWindow) {
      return;
    }
    if (!isRunnerMessage(event.data)) {
      return;
    }
    if (event.data.type === "PYTHON_READY") {
      this.pendingReady?.();
      return;
    }
    for (const listener of this.listeners) {
      listener(event.data);
    }
  };
}
