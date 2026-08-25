/**
 * A snapshot of the auth parameters present in the URL at page load.
 *
 * This module MUST be imported before `lib/supabase`, because supabase-js
 * consumes and then *erases* the URL fragment during its own initialization
 * (`detectSessionInUrl` is on by default). By the time a React component
 * mounts, a recovery link's `#access_token=...&type=recovery` is already gone,
 * so anything reading `window.location.hash` from an effect sees nothing and
 * cannot tell a password reset from an email confirmation.
 *
 * `src/index.tsx` imports this first for exactly that reason.
 *
 * Supabase splits these across the fragment and the query string depending on
 * the configured flow — implicit puts them in the fragment, PKCE in the query —
 * so both are read here.
 */

export interface AuthRedirectParams {
  /** 'recovery' | 'signup' | 'invite' | 'magiclink' | null */
  type: string | null;
  /** Set when the link is expired or already used. */
  errorDescription: string | null;
  /** PKCE flow only. */
  code: string | null;
  /** Implicit flow only — the session arrived in the fragment. */
  hasAccessToken: boolean;
}

/** Exported for testing; call with `window.location` in the browser. */
export function readAuthParams(loc: { hash: string; search: string }): AuthRedirectParams {
  const fragment = new URLSearchParams(loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash);
  const query = new URLSearchParams(loc.search);

  return {
    type: fragment.get('type') ?? query.get('type'),
    errorDescription: fragment.get('error_description') ?? query.get('error_description'),
    code: query.get('code'),
    hasAccessToken: fragment.has('access_token')
  };
}

export const initialAuthParams: AuthRedirectParams =
  typeof window === 'undefined'
    ? { type: null, errorDescription: null, code: null, hasAccessToken: false }
    : readAuthParams(window.location);

/**
 * True when the page was opened from an emailed auth link, in either flow.
 *
 * Checked against the load-time snapshot rather than the live URL, so it stays
 * true after supabase-js has erased the fragment.
 */
export function isAuthCallback(params: AuthRedirectParams = initialAuthParams): boolean {
  return Boolean(params.type || params.code || params.hasAccessToken || params.errorDescription);
}
