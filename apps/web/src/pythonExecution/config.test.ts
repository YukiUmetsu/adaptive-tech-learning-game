import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dedicatedSandboxOrigin,
  hasDedicatedSandboxOrigin,
  parseSandboxOrigin,
  sandboxOrigin,
} from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sandbox origin parsing", () => {
  it("accepts only bare http(s) origins", () => {
    expect(parseSandboxOrigin("https://python-sandbox.example.com")).toBe(
      "https://python-sandbox.example.com",
    );
    expect(parseSandboxOrigin("http://localhost:8787")).toBe(
      "http://localhost:8787",
    );
    expect(parseSandboxOrigin("  https://sandbox.example  ")).toBe(
      "https://sandbox.example",
    );
  });

  it("rejects dangerous or malformed values", () => {
    for (const value of [
      undefined,
      "",
      "   ",
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "https://user:pass@sandbox.example",
      "https://sandbox.example/path",
      "https://sandbox.example/?query=1",
      "https://sandbox.example/#fragment",
      "ftp://sandbox.example",
      "not a url",
    ]) {
      expect(parseSandboxOrigin(value)).toBeNull();
    }
  });

  it("defaults to the app origin when nothing is configured", () => {
    expect(dedicatedSandboxOrigin()).toBeNull();
    expect(hasDedicatedSandboxOrigin()).toBe(false);
    expect(sandboxOrigin()).toBe(window.location.origin);
  });

  it("does not treat the app origin itself as a dedicated origin", () => {
    vi.stubEnv("VITE_PYTHON_SANDBOX_ORIGIN", window.location.origin);
    expect(hasDedicatedSandboxOrigin()).toBe(false);
    expect(sandboxOrigin()).toBe(window.location.origin);
  });

  it("recognizes a genuinely distinct origin", () => {
    vi.stubEnv(
      "VITE_PYTHON_SANDBOX_ORIGIN",
      "https://python-sandbox.example.com",
    );
    expect(hasDedicatedSandboxOrigin()).toBe(true);
    expect(sandboxOrigin()).toBe("https://python-sandbox.example.com");
  });
});
