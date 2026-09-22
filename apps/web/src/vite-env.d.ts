/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_PROXY_TARGET?: string;
  readonly VITE_ASSET_BASE_URL?: string;
  /** WorkOS AuthKit public client id. Empty disables hosted sign-in. */
  readonly VITE_WORKOS_CLIENT_ID?: string;
  /** Optional custom AuthKit authentication domain (defaults to api.workos.com). */
  readonly VITE_WORKOS_API_HOSTNAME?: string;
  /** Explicit opt-in for the local development identity in non-dev builds. */
  readonly VITE_AUTH_DEV_MODE?: string;
  /**
   * Optional dedicated origin that hosts the Python sandbox page (for example
   * `https://python-sandbox.example.com`). When unset, the sandbox runs on the
   * app origin; learner Python is still given no JavaScript bridge, so it
   * cannot reach site storage, files, or the network.
   */
  readonly VITE_PYTHON_SANDBOX_ORIGIN?: string;
  /** Maximum Python/WASM heap in MiB. Defaults to 384. */
  readonly VITE_PYTHON_MAX_MEMORY_MB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
