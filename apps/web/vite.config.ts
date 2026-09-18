import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

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
    ],
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
