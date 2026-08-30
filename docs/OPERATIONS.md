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

## Installing and checking

There are two packages, and both need installing:

```sh
npm run install_all
```

`npm run typecheck` covers both. The Netlify functions were previously not
typechecked at all — esbuild strips types without checking them, so "it deployed"
never meant "it compiles". They hold the service-role key and write the columns
no client can touch, which is the code least able to afford that. Adding
`netlify/functions/tsconfig.json` surfaced two real errors on the first run.

---

## Applying the schema

Migrations are applied in filename order:

```sh
for m in supabase/migrations/*.sql; do
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$m"
done
```

`0001_init.sql` creates the schema in its locked-down end state.
`0002_scoring_and_activation.sql` moves scoring to 4×1 + 1×3 and adds the
guards that go with it. **0002 refuses to run** against picks holding a
confidence outside {1, 3} — it names the rows rather than letting a constraint
fail halfway through, because a 1..5 rank does not map onto 1/3 scoring by any
rule a migration should invent for you.

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

## Adding members

The pool is invite-only, and that is enforced by the database rather than by
the UI. `redeem_invite()` is the only thing that can create a `profiles` row,
and a profile row **is** membership — standings read it, and picks are foreign
keyed to it. See the header of `supabase/migrations/0003_invites.sql`.

This matters more than it looks. `VITE_SUPABASE_ANON_KEY` is inlined into the
JavaScript every visitor downloads, so anyone can call `auth.signUp` against
the project. Before 0003 they could then insert their own profile and be in a
pool played for money. Now creating an auth user gets them nothing: with no
profile they see one screen asking for a code, and the foreign key on
`picks.user_id` refuses everything else.

### Supabase settings this depends on

Authentication → Providers → Email:

* **Enable signup must be ON.** With it off, self-serve signup cannot work at
  all and you are back to creating users by hand.
* **Confirm email** may be either. With it on, `auth.signUp` returns no session,
  so the invite cannot be redeemed at that moment — the member confirms, signs
  in, and is asked for the code once more. That path is deliberate, not a
  workaround.

### Minting an invite

Until the Admin panel has a button for it, from the SQL editor:

```sql
-- Bound to one address: useless to anyone else who sees the code.
select code from public.admin_create_invite('friend@example.com');

-- Or an open code, to hand over in person.
select code from public.admin_create_invite();

-- Expiring in a week.
select code from public.admin_create_invite('friend@example.com', now() + interval '7 days');
```

Codes are single-use, 12 characters, and case/space/dash insensitive when
redeemed. Send the member the code and the site URL; they pick **Create your
account** on the login screen.

`admin_create_invite` refuses to invite an address that is already a member, so
a forgotten password does not turn into a second account. Send them to **Forgot
password?** instead.

To see what is outstanding:

```sql
select code, email, created_at, expires_at, claimed_by, claimed_at
  from public.invites order by created_at desc;
```

### The first admin

Nobody can create the first profile through the app, because redeeming needs an
invite and minting one needs an admin. Bootstrap it once from the SQL editor,
after creating the auth user in Authentication → Users:

```sql
insert into public.profiles (id, email, name, role)
select id, email, 'Your Name', 'admin' from auth.users where email = 'you@example.com';
```

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

Nothing to do. The `weekly-rollover` scheduled function runs **Tuesday 18:00 ET**
and does the whole handover:

1. grades and closes the week that just finished (Monday Night Football is done
   by then);
2. creates the new week's row, seeds its schedule from ESPN, and **captures and
   freezes every line in it at once**.

After that the sheet is open with numbers on it, and no line in the week moves
again no matter what the market does.

Scores keep landing through the week whenever a member opens the app, which
calls `sync-week`. That is deliberate: results have to appear Thursday, Sunday
and Monday as games finish, not once a week. `sync-week` no longer touches the
spread at all.

#### Why the cron fires twice

Netlify cron expressions are UTC only, and Tuesday 18:00 ET is 22:00 UTC on EDT
but 23:00 UTC on EST. A single fixed hour would drift when DST ends in November,
halfway through the season. So it is scheduled `0 22,23 * * 2` and decides for
itself which firing is the real one. The other is a no-op, as is any re-run: a
line already frozen is never re-priced.

### If the Tuesday job does not run

An admin can do the same thing by hand from the Admin panel, which calls
`activateWeek(weekNumber)` in `src/lib/supabaseService.ts` and reaches the same
code through `admin-activate-week`. Safe to run twice.

### If a line is missing when the week opens

The rollover logs, loudly:

```
[ROLLOVER] Week 12 opened with 1 game(s) missing a line — an admin must set
these: MIN @ TB
```

This happens when the book had the game OFF at capture time. That game is
seeded and visible but **not pickable** — `game_has_line()` blocks it — so
nobody can pick blind against a number that does not exist. You have until
Sunday, not until kickoff.

Fix it from the Admin panel, which calls `setSpread(gameId, rawSpread)`, or
directly:

```sql
-- Pass the RAW line from the HOME team's point of view; the function hooks it.
-- -3 is stored as -3.5, because the half point always goes against the
-- favourite. Admin-only, and it refuses to touch a line already frozen.
select public.admin_set_spread('<game uuid>', -3);
```

Prefer that over an `update`: `games.spread` is not writable by any client
grant, and `admin_set_spread` applies the hook and the "never overwrite"
guard for you.

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
