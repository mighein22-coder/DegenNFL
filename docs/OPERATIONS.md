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

### "Set" and "the function can see it" are different claims

Every function that holds the service-role key — `sync-week`,
`admin-activate-week`, `weekly-rollover` — fails closed with a 500 if it cannot
read `VITE_SUPABASE_URL` (or `SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY`.
There are two independent ways to have set a variable and still land there, and
both present identically as *"the site works in the browser, the functions
500"*:

| | What it looks like |
|---|---|
| **Context** | The variable is set for Production but not for Deploy Previews or branch deploys. The preview builds fine and its functions fail. |
| **Scope** | The variable is scoped to **Builds** but not **Functions**. Vite inlines it into the client bundle at build time, so signing in and every page render works — while `process.env` is empty in the Lambda at runtime. |

The scope one is the trap, and `VITE_SUPABASE_URL` is its likeliest victim,
since being a build-time value is its whole job. (Scopes are a Pro/Enterprise
feature. This site is on the free plan, where every variable applies to all
scopes and there is no selector — so on this site, scope is never the answer.)

### Deploy previews never get the service-role key, and should not

**This is not a misconfiguration and there is nothing to fix.** Diagnosed
2026-09-01, after it cost most of an afternoon.

`admin-activate-week` 500s on every deploy preview with
`SUPABASE_SERVICE_ROLE_KEY is not visible to this function`, while
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` reach the same function on the
same deploy. The cause is Netlify's **Sensitive Variable Policy**
(*Project configuration → Environment variables → Site policies*), which exists
for sites connected to **public repositories** — which this one is. It withholds
variables Netlify considers sensitive from *untrusted* deploys, and every Deploy
Preview is untrusted.

That is the correct behaviour and worth keeping. Anyone can open a pull request
against a public repo, and a preview builds and runs their code. The
service-role key bypasses every RLS policy in the schema — the entire security
model of `0001_init.sql` — so a preview holding it would let a stranger's PR
read and rewrite the whole pool.

So: **do not set the policy to "Deploy without restrictions"** to make a preview
work. That trades the schema's security model for a convenience.

To exercise activation, in preference order:

1. **Test on production.** Production is a trusted context and gets the
   variable. This is the normal path.
2. **Approve the specific deploy.** If the policy is "Require approval", a site
   member can approve a deploy and it then builds with sensitive variables.
   Reasonable for your own branch; never approve a fork's PR this way.
3. **Run it locally** with `netlify dev` and a gitignored local env file, which
   is outside Netlify's policy entirely. Note this still writes to the *real*
   Supabase project — "local" describes where the code runs, not which database
   it touches.

`_shared/supabaseEnv.ts` returns a small `diagnostic` alongside the 500 —
counts and one boolean, never a name or a value — which is what identified this.
`supabaseNameCount: 2` with `nearMissPresent: false` is the signature of exactly
this policy: the two public variables arrived, the sensitive one was stripped,
and nothing was misspelled.

`_shared/supabaseEnv.ts` is the single check all three share. It names the
variables actually missing rather than making you guess between them, so the
500 body tells you which dashboard field to go fix. It returns names only,
never values.

Note the deadline this sits in front of: `weekly-rollover` reads the same two
variables. If they are not visible to functions **in production**, the Tuesday
18:00 ET job dies before it does anything and the week silently never opens.
Confirm the production context before the season starts, not on the Tuesday.

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
pool played for money.

Now creating an auth user gets them nothing — but that took more than blocking
the profile insert. An adversarial review found that a signed-up stranger could
still read every member’s email and role, and could insert rows into `weeks`
and `games`. The last one mattered: `activateWeek` seeds the schedule with
`upsert ... ignoreDuplicates`, so a row squatted on a real ESPN event id wins
and the genuine fixture is skipped — squat one with the teams reversed and
every pick on it is graded against an inverted line, with the rollover
reporting no errors. Those policies now require membership, not merely a login.

**Re-running `0001_init.sql` by itself undoes some of this.** It is full of
`create or replace`, so it puts back looser versions of things 0002 and 0003
tightened. Apply the whole sequence, in order, or none of it —
`./supabase/test/run.sh` now re-applies 0001 on its own at the end and fails if
anything reopened.

### Supabase settings this depends on

Authentication → Providers → Email:

* **Enable signup must be ON.** With it off, self-serve signup cannot work at
  all and you are back to creating users by hand.
* **Confirm email** may be either. With it on, `auth.signUp` returns no session,
  so the invite cannot be redeemed at that moment — the member confirms, signs
  in, and is asked for the code once more. That path is deliberate, not a
  workaround.

### Opening the pool: one code for everybody

A code is **reusable**. Mint one, send it to the group email, and everybody
signs themselves up with it. That is one SQL statement for the whole season
rather than one per member, and it is what makes signup genuinely self-serve
instead of making you the bottleneck.

```sql
insert into public.invites (code) values (public.generate_invite_code())
returning code, expires_at;
```

**Not `admin_create_invite()`.** That function gates on `is_admin()`, which reads
`auth.uid()` — and the SQL editor is a superuser session with nobody logged in,
so it refuses with `admin_create_invite: admins only`. The function is for the
Admin panel, where a real admin session exists. From the SQL editor, insert
directly; being a superuser session is exactly what lets you.

Codes are 12 characters and case/space/dash insensitive when redeemed, so it
survives being typed badly. Send it with the site URL; members pick **Create
your account** on the login screen.

**It expires in 14 days unless you say otherwise.** Being uncapped is the
trade: anyone holding the code can join, so it has to shut on its own rather
than depending on you to remember. Set your own window with a second argument:

```sql
insert into public.invites (code, expires_at)
values (public.generate_invite_code(), now() + interval '30 days')
returning code, expires_at;
```

And close it early once everybody is in — the expiry is the safety net, this is
the deliberate act:

```sql
update public.invites set revoked_at = now() where code = 'ABCD1234EFGH';
```

### Inviting one person later

Bind a code to an address. That is what makes it personal — uncapped means
nothing when only one address may use it, and an intercepted code is useless to
anyone else:

```sql
insert into public.invites (code, email)
values (public.generate_invite_code(), 'friend@example.com')
returning code, expires_at;
```

Check first that they are not already a member — `admin_create_invite` does that
for you, a raw insert does not:

```sql
select id, email from public.profiles where lower(email) = 'friend@example.com';
```

This refuses an address that is already a member, so a forgotten password does
not turn into a second account. Send them to **Forgot password?** instead.

### Seeing what is open, and who came in

```sql
select code, email, created_at, expires_at, revoked_at
  from public.invites order by created_at desc;

select c.code, p.name, p.email, c.claimed_at
  from public.invite_claims c
  join public.profiles p on p.id = c.user_id
 order by c.claimed_at desc;
```

### Removing a member

Delete their profile; their claim goes with them and the code stays open for
everyone else. Deleting the auth user from Authentication → Users does the same
thing by cascade.

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

### Opening a week early, to see the sheet before its Tuesday

The Picks screen already asks for the right week — `getCurrentWeekNumber()`
clamps to 1 before the season starts, so out of season `/picks` is looking at
week 1 and showing the "not open yet" state only because no games are seeded.
There is nothing to change on that screen. Activating the week is the whole
fix, and the Admin panel button does it.

**But activation is the only moment the app ever writes a spread, and it never
rewrites one.** Opening week 1 in August does not preview the sheet — it
*freezes* week 1's numbers at August's market, permanently. The Tuesday job
will then find every line already set and leave them alone, and the pool plays
the season against lines that are weeks stale. The Admin panel warns about this
whenever the week's own Tuesday is still in the future.

So an early activation is only safe if you tear it down afterwards. Picks
cascade from games, so two statements clear the week completely:

```sql
-- Deletes the seeded schedule, the frozen lines, and (by cascade) every test
-- pick made against them. Run BEFORE the real Tuesday capture.
delete from public.games where week_id = 'week-2026-01';
delete from public.weeks where id = 'week-2026-01';
```

The next activation — the cron's, or another press of the button — then reseeds
from scratch and prices the lines fresh. Verify with:

```sql
select count(*) from public.games where week_id = 'week-2026-01';  -- expect 0
```

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
