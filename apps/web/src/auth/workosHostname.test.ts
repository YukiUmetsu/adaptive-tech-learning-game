import { describe, expect, it } from "vitest";

import {
  isFirstPartyAuthHost,
  sanitizeWorkosApiHostname,
} from "./workosHostname";

describe("sanitizeWorkosApiHostname", () => {
  it("returns undefined when unset or empty", () => {
    expect(sanitizeWorkosApiHostname(undefined, "learn.shidenlabs.com")).toBeUndefined();
    expect(sanitizeWorkosApiHostname("", "learn.shidenlabs.com")).toBeUndefined();
    expect(sanitizeWorkosApiHostname("   ", "learn.shidenlabs.com")).toBeUndefined();
  });

  it("keeps a valid AuthKit host", () => {
    expect(sanitizeWorkosApiHostname("api.workos.com", "learn.shidenlabs.com")).toBe(
      "api.workos.com",
    );
    expect(
      sanitizeWorkosApiHostname("your-app-staging.authkit.app", "learn.shidenlabs.com"),
    ).toBe("your-app-staging.authkit.app");
  });

  it("rejects the app's own host, which would hit the SPA fallback", () => {
    expect(
      sanitizeWorkosApiHostname("learn.shidenlabs.com", "learn.shidenlabs.com"),
    ).toBeUndefined();
    expect(
      sanitizeWorkosApiHostname("https://learn.shidenlabs.com", "learn.shidenlabs.com"),
    ).toBeUndefined();
    expect(
      sanitizeWorkosApiHostname("learn.shidenlabs.com/extra", "learn.shidenlabs.com"),
    ).toBeUndefined();
  });

  it("tolerates a pasted URL, trailing path, and casing", () => {
    expect(sanitizeWorkosApiHostname("https://api.workos.com", "app.example")).toBe(
      "api.workos.com",
    );
    expect(sanitizeWorkosApiHostname("api.workos.com/", "app.example")).toBe(
      "api.workos.com",
    );
    expect(sanitizeWorkosApiHostname(" API.WORKOS.COM ", "app.example")).toBe(
      "api.workos.com",
    );
  });

  it("compares hosts including the port", () => {
    expect(sanitizeWorkosApiHostname("localhost:5173", "localhost:5173")).toBeUndefined();
    expect(sanitizeWorkosApiHostname("localhost:3000", "localhost:5173")).toBe(
      "localhost:3000",
    );
  });
});

describe("isFirstPartyAuthHost", () => {
  it("is true for a custom auth domain under the app domain", () => {
    expect(
      isFirstPartyAuthHost("auth.shidenlabs.com", "learn.shidenlabs.com"),
    ).toBe(true);
    expect(isFirstPartyAuthHost("auth.shidenlabs.com", "shidenlabs.com")).toBe(
      true,
    );
  });

  it("is false for the WorkOS defaults and other registrable domains", () => {
    expect(isFirstPartyAuthHost(undefined, "learn.shidenlabs.com")).toBe(false);
    expect(isFirstPartyAuthHost("api.workos.com", "learn.shidenlabs.com")).toBe(
      false,
    );
    expect(
      isFirstPartyAuthHost("your-env.authkit.app", "learn.shidenlabs.com"),
    ).toBe(false);
  });

  it("ignores an explicit port", () => {
    expect(
      isFirstPartyAuthHost("auth.shidenlabs.com", "learn.shidenlabs.com:443"),
    ).toBe(true);
  });
});
