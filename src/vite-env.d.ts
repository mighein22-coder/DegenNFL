/// <reference types="vite/client" />

/**
 * Typed environment. Only VITE_-prefixed variables reach the browser, and Vite
 * inlines them into the public bundle — so anything declared here is public by
 * construction. Never add a secret. The NHL app shipped a sync secret this way
 * and it was readable in the deployed JS.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
