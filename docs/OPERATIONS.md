# Operations

How to run, deploy and look after DegenNFL. For architecture see `PLANNING.md`.

---

## Environment variables

Set in the Netlify dashboard, not in the repo.

| Variable | Where it goes | Secret? |
|---|---|---|
| `VITE_SUPABASE_URL` | client bundle | No — public by construction |
| `VITE_SUPABASE_ANON_KEY` | client bundle | No — public by construction |
| `SUPABASE_SERVICE_ROLE_KEY` | functions only | **Yes.** Never `VITE_`-prefixed. |

Anything prefixed `VITE_` is **inlined into the JavaScript every visitor
downloads**. The NHL app shipped a `VITE_SYNC_WEEK_SECRET` this way, which meant
its service-role-backed sync endpoint was effectively unauthenticated — anyone
could read the secret out of the bundle. `sync-week` here authenticates the
caller's Supabase access token instead, so there is no shared secret to
configure. Do not reintroduce one.

Locally, `src/.env.local` (gitignored) holds the two public values. Copy
`src/.env.example`.

---

## Applying the schema

There is one migration, and it creates everything:

```sh
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init.sql
```

Then run the verification queries commented at the bottom of that file against
the live project. They confirm:

1. no client role can write a scoring column
2. no unexpected permissive policy survives under some other name
3. the derived lock is Sunday 13:00 ET for all 18 weeks
4. no stored spread can produce a tie

Do not skip (2). The NHL app's review found policies that had been "fixed" while
an older, permissive policy under a different name still applied.

### Testing schema changes before applying them

```sh
./supabase/test/run.sh
```

Applies the migration to a throwaway local Postgres and runs 40 assertions
against it, each playing an ordinary member with a SQL console. Every attack in
that file worked at some point in the NHL app's history. Override connection
settings from the environment:

```sh
PGHOST=/tmp PGPORT=5432 PGUSER=postgres ./supabase/test/run.sh
```

Run it after **any** change to the migration. A `FAIL` line is a real hole.

---

## Deploying

Netlify builds all three packages:

```
npm --prefix src ci && npm --prefix netlify/functions ci && npm --prefix src run build
```

Publish directory `src/dist`, functions from `netlify/functions`. The SPA
fallback redirect in `netlify.toml` is what makes `/auth/callback` reachable —
without it, password reset links dead-end.

### Supabase auth configuration

Allowlist `/auth/callback` under **Authentication → URL Configuration**. No
application change substitutes for this. Verify password reset end to end
against the deployed site after any change here.

---

## Running a season

### Before week 1

1. Set `SEASON` and `SEASON_WEEK1_SUNDAY` in `src/constants.ts`.
2. Set the same date in `season_week1_sunday()` in the migration and apply it.
   **These are two independent sources of the same truth and nothing checks
   them against each other.** A mismatch silently moves every deadline: the UI
   would show one lock time and the database would enforce another.
3. Confirm with verification query (3) that all 18 locks land on a Sunday at
   13:00 ET, including after the November DST change.

### Each week

Weeks seed themselves — the row is created the first time any member opens the
app in a new week, and the database derives its number and deadline from the id.
Schedules do not: an admin syncs a week's games from the Admin panel.

Scores move when a member opens the app, which calls `sync-week`. That function
also **freezes each game's line at kickoff** — after which the line never moves
again, and every member is graded against the same number.

### If a line is missing at kickoff

`sync-week` reports `No line available for X @ Y at kickoff` in its `errors`
array. Picks on that game cannot be graded until a line exists. Set it directly
with the service-role key — it is not writable any other way, by anyone:

```sql
update public.games
   set spread = -3.5,                    -- must end in .5; the CHECK enforces it
       spread_captured_at = now()
 where id = '<game uuid>' and spread is null;
```

Then re-run the sync. Note the `and spread is null` guard: never overwrite a
line that has already been frozen.

### Closing a week

`sync-week` marks a week `COMPLETED` once every game is `FINAL`, no picks are
`PENDING`, and it reported no errors. A completed week is skipped on subsequent
syncs — settled results are not re-graded.

---

## Design tokens

`src/styles/tokens.shared.css` is shared byte-for-byte with FrozenDegenerates.

```sh
node scripts/sync-tokens.mjs --check ../FrozenDegenerates   # report drift
node scripts/sync-tokens.mjs --push  ../FrozenDegenerates   # ours wins
node scripts/sync-tokens.mjs --pull  ../FrozenDegenerates   # theirs wins
```

`src/styles/brand.css` is per-app and is never synced — it is what makes the two
sites siblings rather than clones. Commit token changes in **both** repos.
