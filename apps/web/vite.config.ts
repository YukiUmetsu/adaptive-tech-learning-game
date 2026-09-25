import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Keeps service-worker registration out of the Python sandbox document.
 *
 * The sandbox is its own HTML entry, but `vite-plugin-pwa` injects the SW
 * registration and manifest into every entry by default. The sandbox must not
 * register the app's service worker (especially when served from a dedicated
 * origin), so its injected PWA tags are stripped.
 */
function excludePythonSandboxFromPwa(): Plugin {
  const strip = (html: string): string =>
    html
      .replace(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/g, "")
      .replace(/<link rel="manifest"[^>]*>/g, "");

  let root = process.cwd();
  let outDir = "dist";

  return {
    name: "exclude-python-sandbox-from-pwa",
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    // Runs after the PWA plugin writes its tags, so this reliably strips them
    // from the sandbox document only.
    closeBundle() {
      const file = resolve(root, outDir, "python-sandbox", "index.html");
      if (!existsSync(file)) {
        return;
      }
      const html = readFileSync(file, "utf8");
      const cleaned = strip(html);
      if (cleaned !== html) {
        writeFileSync(file, cleaned);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Read `.env.local` and the process environment. Process env wins, so CI and
  // Playwright can override the proxy target.
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget =
    env.VITE_API_PROXY_TARGET ?? "http://localhost:8080";

  // Keep API calls same-origin in development so CORS and the web port never
  // matter. The dev/preview server forwards these paths to the API.
  const apiProxy = {
    "/v1": { target: apiProxyTarget, changeOrigin: true },
    "/health": { target: apiProxyTarget, changeOrigin: true },
    "/openapi.json": { target: apiProxyTarget, changeOrigin: true },
  };

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon.svg"],
        workbox: {
          // The Python runtime is large and lazily loaded. Exclude it from the
          // install-time precache so non-Python learners never download it, and
          // keep the SPA navigation fallback away from the sandbox page.
          globIgnores: [
            "**/python-runtime/**",
            "**/python-sandbox/**",
            "**/PythonCodeInteraction-*.js",
            "**/pythonWorker-*.js",
            "**/pythonSandbox-*.js",
            // The shell is fetched from the network (see runtimeCaching below)
            // instead of being pinned in the precache. A precached shell would
            // keep serving hashed asset names that a later deploy has removed,
            // which shows up as a blank page on refresh after a new release.
            "**/index.html",
          ],
          // No precached navigation fallback: navigations are handled by the
          // NetworkFirst route below, so an online client always gets the
          // current shell.
          navigateFallback: null,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              // Serve page loads from the network first so a new deploy is
              // picked up immediately, and fall back to the cached shell only
              // when offline. The Python sandbox is its own document and must
              // not be captured by the app shell.
              urlPattern: ({ request, url }) =>
                request.mode === "navigate" &&
                !url.pathname.startsWith("/python-sandbox/"),
              handler: "NetworkFirst",
              options: {
                cacheName: "app-shell",
                networkTimeoutSeconds: 3,
              },
            },
          ],
        },
        manifest: {
          name: "Adaptive Learning",
          short_name: "AdaptiveLearn",
          description: "Adaptive technical-certification learning game",
          theme_color: "#0f172a",
          background_color: "#0f172a",
          display: "standalone",
          start_url: "/",
          icons: [
            {
              src: "icon.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any",
            },
          ],
        },
      }),
      excludePythonSandboxFromPwa(),
    ],
    build: {
      rollupOptions: {
        // The sandbox is a separate HTML entry so it never inherits the SPA
        // shell, CSP, or service-worker navigation handling.
        input: {
          main: "index.html",
          pythonSandbox: "python-sandbox/index.html",
        },
      },
    },
    server: {
      port: 5173,
      proxy: apiProxy,
    },
    preview: {
      port: 4173,
      proxy: apiProxy,
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
    },
  };
});
