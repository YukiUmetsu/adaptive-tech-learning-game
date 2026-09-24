import { afterEach, describe, expect, it } from "vitest";

import { sandboxOrigin } from "./config";
import { IframePythonTransport } from "./iframeTransport";
import type { RunnerMessage } from "./protocol";

function resultMessage(requestId: string): RunnerMessage {
  return {
    type: "PYTHON_RESULT",
    requestId,
    result: { executionId: requestId, status: "passed" },
  };
}

describe("IframePythonTransport origin and message validation", () => {
  let transport: IframePythonTransport | null = null;

  afterEach(() => {
    transport?.terminate();
    transport = null;
    document.querySelectorAll("iframe").forEach((frame) => frame.remove());
  });

  function start() {
    transport = new IframePythonTransport();
    const ready = transport.start();
    const iframe = document.querySelector("iframe");
    if (!iframe) {
      throw new Error("sandbox iframe was not created");
    }
    const received: RunnerMessage[] = [];
    transport.subscribe((message) => received.push(message));
    return { ready, iframe, received };
  }

  it("ignores messages from an unexpected origin", async () => {
    const { ready, iframe, received } = start();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: resultMessage("req-1"),
        origin: "https://evil.example",
        source: iframe.contentWindow,
      }),
    );
    await Promise.resolve();
    expect(received).toHaveLength(0);

    // A wrong-origin READY must not complete startup either.
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "PYTHON_READY" },
        origin: "https://evil.example",
        source: iframe.contentWindow,
      }),
    );
    await Promise.resolve();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "PYTHON_READY" },
        origin: sandboxOrigin(),
        source: iframe.contentWindow,
      }),
    );
    await expect(ready).resolves.toBeUndefined();
  });

  it("ignores messages from a different window", async () => {
    const { ready, received } = start();
    window.dispatchEvent(
      new MessageEvent("message", {
        data: resultMessage("req-1"),
        origin: sandboxOrigin(),
        source: window,
      }),
    );
    expect(received).toHaveLength(0);

    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "PYTHON_READY" },
        origin: sandboxOrigin(),
        source: iframe.contentWindow,
      }),
    );
    await ready;
  });

  it("delivers validated messages and rejects malformed payloads", async () => {
    const { ready, iframe, received } = start();
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "PYTHON_READY" },
        origin: sandboxOrigin(),
        source: iframe.contentWindow,
      }),
    );
    await ready;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: resultMessage("req-1"),
        origin: sandboxOrigin(),
        source: iframe.contentWindow,
      }),
    );
    expect(received).toHaveLength(1);

    // Malformed message on the correct origin must be dropped.
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "PYTHON_RESULT", requestId: "req-1" },
        origin: sandboxOrigin(),
        source: iframe.contentWindow,
      }),
    );
    expect(received).toHaveLength(1);
  });
});
