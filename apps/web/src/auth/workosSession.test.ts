import { beforeEach, describe, expect, it } from "vitest";

import {
  hasPersistedWorkosSession,
  workosRefreshTokenKey,
} from "./workosSession";

beforeEach(() => {
  window.localStorage.clear();
  // Expire any cookies set by earlier tests.
  document.cookie = "workos-has-session=; max-age=0; path=/";
});

describe("workosRefreshTokenKey", () => {
  it("matches the SDK's namespaced refresh-token key", () => {
    expect(workosRefreshTokenKey("client_123")).toBe(
      "workos:refresh-token:client_123",
    );
  });
});

describe("hasPersistedWorkosSession", () => {
  it("is false with no persisted material", () => {
    expect(hasPersistedWorkosSession("client_123")).toBe(false);
  });

  it("detects the devMode refresh token in localStorage", () => {
    window.localStorage.setItem(
      workosRefreshTokenKey("client_123"),
      "refresh-token",
    );
    expect(hasPersistedWorkosSession("client_123")).toBe(true);
  });

  it("detects a first-party session cookie", () => {
    document.cookie = "workos-has-session=client_123; path=/";
    expect(hasPersistedWorkosSession("client_123")).toBe(true);
  });

  it("treats any session marker as a recovery signal", () => {
    // The SDK validates the client id on refresh; the recovery check only
    // decides whether trying is worthwhile.
    document.cookie = "workos-has-session=client_other; path=/";
    expect(hasPersistedWorkosSession("client_123")).toBe(true);
  });
});
