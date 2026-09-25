import { afterEach, describe, expect, it, vi } from "vitest";

import { clearStaleServiceWorkers } from "./serviceWorker";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clearStaleServiceWorkers", () => {
  it("is a safe no-op when the browser has no service worker support", () => {
    expect("serviceWorker" in navigator).toBe(false);
    expect(() => clearStaleServiceWorkers()).not.toThrow();
  });

  it("unregisters existing workers and clears cache storage", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistrations: () => Promise.resolve([{ unregister }]) },
    });
    const remove = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", {
      keys: () => Promise.resolve(["workbox-precache", "app-shell"]),
      delete: remove,
    });

    clearStaleServiceWorkers();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith("workbox-precache");
    expect(remove).toHaveBeenCalledWith("app-shell");

    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });
});
