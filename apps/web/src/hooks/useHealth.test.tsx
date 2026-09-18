import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useHealth } from "./useHealth";

const body = {
  status: "ok",
  service: "adaptive-learn-api",
  version: "0.1.0",
  database: "ok",
  uptime_seconds: 5,
  timestamp: "2026-09-18T00:00:00Z",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useHealth", () => {
  it("loads health data from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(body)),
    );

    const { result } = renderHook(() => useHealth());

    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    if (result.current.state.status === "loaded") {
      expect(result.current.state.data.service).toBe("adaptive-learn-api");
    }
  });

  it("treats a 503 body as degraded data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ ...body, status: "degraded", database: "unavailable" }, 503),
      ),
    );

    const { result } = renderHook(() => useHealth());

    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    if (result.current.state.status === "loaded") {
      expect(result.current.state.data.status).toBe("degraded");
    }
  });

  it("reports network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    const { result } = renderHook(() => useHealth());

    await waitFor(() => expect(result.current.state.status).toBe("error"));
  });
});
