/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_PROXY_TARGET?: string;
  readonly VITE_ASSET_BASE_URL?: string;
  /** WorkOS AuthKit public client id. Empty disables hosted sign-in. */
  readonly VITE_WORKOS_CLIENT_ID?: string;
  /** Explicit opt-in for the local development identity in non-dev builds. */
  readonly VITE_AUTH_DEV_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
