/**
 * The service-role Supabase credentials, read once and checked properly.
 *
 * All three functions that hold the service-role key need the same two values
 * and used to each carry their own copy of the check. The copies agreed, which
 * was the problem: they agreed on a message that does not say WHICH of the two
 * is missing.
 *
 * THE FAILURE THIS EXISTS TO MAKE READABLE
 *
 * The first real invocation of `admin-activate-week` returned
 * `Server misconfiguration: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`,
 * which leaves you diffing a dashboard against a doc. It is worth knowing why
 * that state is easy to reach on Netlify, because "the variable is set" and
 * "the function can see it" are genuinely different claims:
 *
 *   CONTEXT. A variable can be set for Production but not for Deploy Previews
 *   or branch deploys. The preview then builds fine and its functions fail.
 *
 *   SCOPE. A variable can be scoped to Builds but not Functions. Vite inlines
 *   it into the client bundle at build time — so the browser half of the app
 *   works perfectly — while `process.env` is empty in the Lambda at runtime.
 *   `VITE_SUPABASE_URL` is the one most likely to be in this state, because
 *   its whole job is to be a build-time value.
 *
 * Both present as "it works in the browser, the function 500s", so the message
 * below names the variables that are actually absent and points at the two
 * settings that explain it.
 */

/** What every service-role function needs to construct its client. */
export interface SupabaseEnv {
  url: string;
  serviceRoleKey: string;
}

/**
 * What the runtime environment looks like, described without naming anything.
 *
 * Deploy-preview function logs do not appear on the project's Functions log
 * page — that page shows production — so a log-only diagnostic is unreadable
 * for exactly the deploy being debugged. This travels in the response instead,
 * which means it must be safe for an unauthenticated caller to see.
 *
 * So it discloses no names and no values, only three counts and a flag. That is
 * enough to separate the three causes that look identical from outside:
 *
 *   supabaseNameCount 0  — nothing is reaching this function at all
 *   nearMissPresent      — a variable differing only in case, whitespace or
 *                          punctuation exists, i.e. the name is mistyped
 *   neither              — the variable is genuinely absent from this context
 */
export interface EnvDiagnostic {
  /** How many variable names contain "supabase", case-insensitively. */
  supabaseNameCount: number;
  /** Total variables visible. A plausible number rules out "empty process.env". */
  totalCount: number;
  /** A name that normalises to SUPABASE_SERVICE_ROLE_KEY but is not equal to it. */
  nearMissPresent: boolean;
}

export type SupabaseEnvResult =
  | { ok: true; env: SupabaseEnv }
  | { ok: false; missing: string[]; message: string; diagnostic: EnvDiagnostic };

/** Strips case, whitespace and separators, so `supabase service-role key ` collides. */
function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Read and validate the service-role credentials.
 *
 * Only variable NAMES ever appear in the returned message — never a value, and
 * never a fragment of one. The names are public knowledge (they are in
 * netlify.toml and docs/OPERATIONS.md); the values are the whole security
 * model, and `SUPABASE_SERVICE_ROLE_KEY` in particular bypasses every RLS
 * policy in the schema.
 */
export function readSupabaseEnv(): SupabaseEnvResult {
  // VITE_-prefixed first, matching how the site is configured today; the
  // unprefixed name is the fallback. The URL is public either way — it is in
  // the client bundle — so there is no secret in preferring one.
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing: string[] = [];
  if (!url) missing.push('VITE_SUPABASE_URL (or SUPABASE_URL)');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length > 0) {
    // Log-only, and NAMES ONLY — never values, and this never reaches the HTTP
    // response. It separates the two states the message above cannot: a
    // variable that is genuinely unset, versus one that is set in the dashboard
    // but did not reach this deploy. Netlify injects env vars into a function's
    // configuration when the deploy is built, so editing a variable does not
    // change a deploy that already exists — it takes a redeploy. An empty list
    // here alongside a working client bundle is that second case.
    const names = Object.keys(process.env);
    const visible = names.filter(name => /SUPABASE/i.test(name)).sort();

    // The log still gets the full names — it is private to the project owner,
    // and on a production deploy it is the fastest read of all.
    console.error(
      `[ENV] SUPABASE-ish names visible to this function: ${
        visible.length > 0 ? visible.join(', ') : '(none)'
      }`
    );

    const wanted = normalise('SUPABASE_SERVICE_ROLE_KEY');
    const diagnostic: EnvDiagnostic = {
      supabaseNameCount: visible.length,
      totalCount: names.length,
      nearMissPresent: names.some(
        name => name !== 'SUPABASE_SERVICE_ROLE_KEY' && normalise(name) === wanted
      )
    };

    return {
      ok: false,
      missing,
      diagnostic,
      message:
        `Server misconfiguration: ${missing.join(' and ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} not visible to this function. ` +
        'In Netlify, check both that the variable is set for THIS deploy context ' +
        '(production / deploy preview / branch deploy) and that its scope ' +
        'includes Functions, not Builds alone.'
    };
  }

  return { ok: true, env: { url: url!, serviceRoleKey: serviceRoleKey! } };
}
