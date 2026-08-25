import { describe, it, expect } from 'vitest';
import { readAuthParams, isAuthCallback } from '../authRedirect';

/**
 * Supabase splits auth-link parameters across the fragment and the query string
 * depending on the project's configured flow, and erases the fragment during
 * its own init — which is why these are snapshotted at load rather than read
 * from an effect. This pins down the parsing for both shapes.
 */

const loc = (hash = '', search = '') => ({ hash, search });

describe('readAuthParams — implicit flow (fragment)', () => {
  it('reads a recovery link', () => {
    const params = readAuthParams(
      loc('#access_token=abc123&expires_in=3600&token_type=bearer&type=recovery')
    );
    expect(params.type).toBe('recovery');
    expect(params.hasAccessToken).toBe(true);
    expect(params.errorDescription).toBeNull();
    expect(params.code).toBeNull();
  });

  it('reads a signup confirmation, which takes a different branch', () => {
    expect(readAuthParams(loc('#access_token=abc&type=signup')).type).toBe('signup');
  });

  it('reads an expired-link error, with + decoded to spaces', () => {
    const params = readAuthParams(
      loc('#error=access_denied&error_description=Email+link+is+invalid+or+has+expired')
    );
    expect(params.errorDescription).toBe('Email link is invalid or has expired');
    expect(params.hasAccessToken).toBe(false);
  });
});

describe('readAuthParams — PKCE flow (query)', () => {
  it('reads the exchange code', () => {
    const params = readAuthParams(loc('', '?code=some-uuid-code'));
    expect(params.code).toBe('some-uuid-code');
    expect(params.hasAccessToken).toBe(false);
  });

  it('reads type and error from the query string too', () => {
    const params = readAuthParams(loc('', '?type=recovery&error_description=Token+has+expired'));
    expect(params.type).toBe('recovery');
    expect(params.errorDescription).toBe('Token has expired');
  });
});

describe('readAuthParams — edge cases', () => {
  it('returns nulls for a bare URL', () => {
    expect(readAuthParams(loc())).toEqual({
      type: null,
      errorDescription: null,
      code: null,
      hasAccessToken: false
    });
  });

  it('prefers the fragment when a value appears in both', () => {
    expect(readAuthParams(loc('#type=recovery', '?type=signup')).type).toBe('recovery');
  });

  it('tolerates a fragment with no leading hash', () => {
    expect(readAuthParams(loc('type=recovery')).type).toBe('recovery');
  });

  it('does not mistake an empty fragment for an access token', () => {
    expect(readAuthParams(loc('#')).hasAccessToken).toBe(false);
  });
});

describe('isAuthCallback', () => {
  const params = (hash = '', search = '') => readAuthParams({ hash, search });

  it('is false for an ordinary page load', () => {
    expect(isAuthCallback(params())).toBe(false);
  });

  it('is true for a recovery link', () => {
    expect(isAuthCallback(params('#access_token=abc&type=recovery'))).toBe(true);
  });

  it('is true for a PKCE code', () => {
    expect(isAuthCallback(params('', '?code=some-uuid'))).toBe(true);
  });

  it('is true for an expired link, which carries an error but no session', () => {
    expect(isAuthCallback(params('#error_description=Email+link+has+expired'))).toBe(true);
  });

  it('is not fooled by unrelated query parameters', () => {
    expect(isAuthCallback(params('', '?week=2026-10-31'))).toBe(false);
  });
});
