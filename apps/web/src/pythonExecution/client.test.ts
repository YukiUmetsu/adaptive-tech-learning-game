import { afterEach, describe, expect, it, vi } from "vitest";

import { PythonExecutionClient } from "./client";
import type { ExecutionLimits } from "./limits";
import type { ClientMessage, RunnerMessage } from "./protocol";
import type { PythonTransport } from "./transport";

const TEST_LIMITS: ExecutionLimits = {
  timeoutMs: 1000,
  maxSourceBytes: 20000,
  maxStdoutBytes: 16000,
  maxTests: 50,
  maxResultBytes: 512000,
  maxMemoryBytes: 384 * 1024 * 1024,
};

class FakeTransport implements PythonTransport {
  readonly origin = "https://sandbox.example";
  started = false;
  terminated = false;
  readonly messages: ClientMessage[] = [];
  private readonly listeners = new Set<(message: RunnerMessage) => void>();

  start(): Promise<void> {
    this.started = true;
    return Promise.resolve();
  }

  post(message: ClientMessage): void {
    this.messages.push(message);
  }

  subscribe(listener: (message: RunnerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: RunnerMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}

function makeClient(limits: ExecutionLimits = TEST_LIMITS) {
  const transports: FakeTransport[] = [];
  let counter = 0;
  const client = new PythonExecutionClient({
    limits,
    idleTimeoutMs: 0,
    newId: () => `req-${++counter}`,
    transportFactory: () => {
      const transport = new FakeTransport();
      transports.push(transport);
      return transport;
    },
  });
  return { client, transports };
}

const INPUT = {
  source: "def square(x):\n    return x * x\n",
  entrypoint: "square",
  tests: [{ type: "call" as const, args: [2], expected: 4 }],
};

afterEach(() => {
  vi.useRealTimers();
});

describe("PythonExecutionClient", () => {
  it("does not start the runtime until the first run", async () => {
    const { client, transports } = makeClient();
    expect(transports).toHaveLength(0);

    const promise = client.run(INPUT);
    await vi.waitFor(() => expect(transports[0]?.messages.length ?? 0).toBe(1));
    expect(transports[0].started).toBe(true);

    const requestId = (transports[0].messages[0] as { requestId: string }).requestId;
    transports[0].emit({
      type: "PYTHON_RESULT",
      requestId,
      result: {
        executionId: requestId,
        status: "passed",
        tests: [{ name: "square(2)", passed: true }],
      },
    });
    await expect(promise).resolves.toMatchObject({ status: "passed" });
    client.dispose();
  });

  it("sends only execution data, never credentials or application state", async () => {
    const { client, transports } = makeClient();
    const promise = client.run(INPUT);
    await vi.waitFor(() => expect(transports[0].messages).toHaveLength(1));

    const message = transports[0].messages[0] as unknown as Record<string, unknown>;
    expect(Object.keys(message).sort()).toEqual(
      [
        "entrypoint",
        "limits",
        "packages",
        "requestId",
        "source",
        "tests",
        "type",
      ].sort(),
    );
    const serialized = JSON.stringify(message).toLowerCase();
    for (const forbidden of ["authorization", "token", "bearer", "cookie", "device"]) {
      expect(serialized).not.toContain(forbidden);
    }

    client.dispose();
    await promise;
  });

  it("drops packages that are not on the allowlist", async () => {
    const { client, transports } = makeClient();
    const promise = client.run({
      ...INPUT,
      packages: ["numpy", "seaborn", "micropip", "numpy"],
    });
    await vi.waitFor(() => expect(transports[0].messages).toHaveLength(1));

    const message = transports[0].messages[0] as unknown as {
      packages: string[];
    };
    expect(message.packages).toEqual(["numpy"]);

    client.dispose();
    await promise;
  });

  it("terminates and recovers after a timeout", async () => {
    vi.useFakeTimers();
    const { client, transports } = makeClient({ ...TEST_LIMITS, timeoutMs: 500 });

    const first = client.run(INPUT);
    await vi.advanceTimersByTimeAsync(0);
    expect(transports).toHaveLength(1);
    expect(transports[0].messages).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(600);
    expect(await first).toMatchObject({ status: "timeout" });
    expect(transports[0].terminated).toBe(true);

    // A later run creates a fresh runtime and succeeds.
    const second = client.run(INPUT);
    await vi.advanceTimersByTimeAsync(0);
    expect(transports).toHaveLength(2);
    expect(transports[1].terminated).toBe(false);
    const requestId = (transports[1].messages[0] as { requestId: string }).requestId;
    transports[1].emit({
      type: "PYTHON_RESULT",
      requestId,
      result: { executionId: requestId, status: "passed", tests: [] },
    });
    await expect(second).resolves.toMatchObject({ status: "passed" });
    client.dispose();
  });

  it("surfaces a runner error from the sandbox", async () => {
    const { client, transports } = makeClient();
    const promise = client.run(INPUT);
    await vi.waitFor(() => expect(transports[0].messages).toHaveLength(1));
    const requestId = (transports[0].messages[0] as { requestId: string }).requestId;
    transports[0].emit({
      type: "PYTHON_RUNNER_ERROR",
      requestId,
      error: { type: "RunnerError", message: "sandbox died" },
    });
    await expect(promise).resolves.toMatchObject({
      status: "runner_error",
      error: { type: "RunnerError", message: "sandbox died" },
    });
    client.dispose();
  });

  it("ignores messages for unknown executions", async () => {
    const { client, transports } = makeClient();
    const promise = client.run(INPUT);
    await vi.waitFor(() => expect(transports[0].messages).toHaveLength(1));
    transports[0].emit({
      type: "PYTHON_RESULT",
      requestId: "someone-elses-request",
      result: { executionId: "someone-elses-request", status: "passed" },
    });

    const requestId = (transports[0].messages[0] as { requestId: string }).requestId;
    transports[0].emit({
      type: "PYTHON_RESULT",
      requestId,
      result: { executionId: requestId, status: "passed" },
    });
    await expect(promise).resolves.toMatchObject({ status: "passed" });
    client.dispose();
  });

  it("rejects oversized source and empty test sets without starting the runtime", async () => {
    const { client, transports } = makeClient({ ...TEST_LIMITS, maxSourceBytes: 10 });
    const oversized = await client.run({ ...INPUT, source: "x = 1\n" + "x = 1\n" });
    expect(oversized.status).toBe("runner_error");

    const noTests = await client.run({ ...INPUT, tests: [] });
    expect(noTests.status).toBe("runner_error");

    expect(transports).toHaveLength(0);
    client.dispose();
  });

  it("serializes runs and rejects a concurrent request", async () => {
    const { client, transports } = makeClient();
    const first = client.run(INPUT);
    await vi.waitFor(() => expect(transports[0].messages).toHaveLength(1));

    const second = await client.run(INPUT);
    expect(second.status).toBe("runner_error");
    expect(transports[0].messages).toHaveLength(1);

    client.dispose();
    await first;
  });

  it("reclaims the runtime on dispose and refuses further runs", async () => {
    const { client, transports } = makeClient();
    const first = client.run(INPUT);
    await vi.waitFor(() => expect(transports[0].messages).toHaveLength(1));

    client.dispose();
    await expect(first).resolves.toMatchObject({ status: "runner_error" });
    expect(transports[0].terminated).toBe(true);

    const after = await client.run(INPUT);
    expect(after.status).toBe("runner_error");
    expect(transports).toHaveLength(1);
  });

  it("records only aggregate telemetry without source or output", async () => {
    const events: unknown[] = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent).detail);
    };
    window.addEventListener("adaptive-learn:python-execution", listener);

    const { client, transports } = makeClient();
    const promise = client.run(INPUT);
    await vi.waitFor(() => expect(transports[0].messages).toHaveLength(1));
    const requestId = (transports[0].messages[0] as { requestId: string }).requestId;
    transports[0].emit({
      type: "PYTHON_RESULT",
      requestId,
      result: {
        executionId: requestId,
        status: "failed",
        stdout: "secret output",
        tests: [
          { name: "square(2)", passed: true },
          { name: "square(3)", passed: false },
        ],
      },
    });
    await promise;

    window.removeEventListener("adaptive-learn:python-execution", listener);
    expect(events).toHaveLength(1);
    const detail = events[0] as Record<string, unknown>;
    expect(detail.kind).toBe("python_execution_failed");
    expect(detail.testCount).toBe(2);
    expect(detail.passedCount).toBe(1);
    expect(JSON.stringify(detail)).not.toContain("secret output");
    client.dispose();
  });
});
