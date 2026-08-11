/// <reference types="vite/client" />

/**
 * Only public values may be declared here. Everything with a `VITE_` prefix is compiled into code
 * every visitor downloads, so a credential named this way is a published credential.
 */
interface ImportMetaEnv {
  /**
   * Where the API answers. A relative path when it shares the origin with the application, or an
   * absolute origin when it is deployed as its own host. Unset falls back to the relative default.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
