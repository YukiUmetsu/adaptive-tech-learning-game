import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { HealthResponse } from "../hooks/useHealth";
import HealthStatus from "./HealthStatus";

const loaded: HealthResponse = {
  status: "ok",
  service: "adaptive-learn-api",
  version: "0.1.0",
  database: "ok",
  uptime_seconds: 12,
  timestamp: "2026-09-18T00:00:00Z",
};

describe("HealthStatus", () => {
  it("shows a loading message", () => {
    render(<HealthStatus state={{ status: "loading" }} />);

    expect(screen.getByRole("status")).toHaveTextContent("Checking API");
  });

  it("renders operational data", () => {
    render(<HealthStatus state={{ status: "loaded", data: loaded }} />);

    expect(screen.getByText("adaptive-learn-api")).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("12s")).toBeInTheDocument();
  });

  it("renders an error message", () => {
    render(<HealthStatus state={{ status: "error", message: "boom" }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});
