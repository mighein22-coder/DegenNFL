# DegenNFL

An NFL against-the-spread confidence pool. Pick five games a week, rank them
1–5, and score your confidence when the pick covers.

Sibling to [FrozenDegenerates](https://github.com/mighein22-coder/FrozenDegenerates),
the NHL pool. Separate repo, separate Supabase project, separate Netlify site,
shared design tokens.

> **This is a scaffold, not a running pool.** The schema, scoring, locking and
> design system are real and tested. The NFL schedule ingestion is an unverified
> stub and most screens are placeholders. See `PLANNING.md` for what is real and
> `TASKS.md` for what is next.

## The rules, in short

- **Five picks a week**, confidence 1–5, no duplicates.
- **Against the spread.** Every line the app stores is hooked to a half point
  (`-2.5`, never `-2` or `-3`), so no pick can land on the number. Every pick is
  a win or a loss — there are no pushes and no half points.
- **Picks lock per game at kickoff**, and the whole sheet locks at **Sunday
  1:00 PM ET**. A Thursday-night pick locks days before the rest.
- A confidence value spent on a locked game is spent for the week.
- **18 weeks**, split into three six-week segments, each with its own standings
  alongside the season table.

## Layout

```
package.json          root wrapper — forwards dev/build/test into src/
netlify.toml          builds all three packages
src/                  the Vite + React app (its own package)
  lib/scoring.ts        hookSpread + gradePick — the money logic
  lib/timezone.ts       week calendar and the two locks
  styles/               tokens.shared.css (shared) + brand.css (ours)
netlify/functions/    serverless functions (its own package)
supabase/
  migrations/           0001_init.sql — the schema, already locked down
                        0002_…sql     — 4×1 + 1×3 scoring, and its guards
  test/                 applies it to a throwaway Postgres and attacks it
scripts/
  spike-espn.mjs        run this first — see TASKS.md
  sync-tokens.mjs       keep design tokens in step with the NHL app
```

## Running it

```sh
npm --prefix src install
npm --prefix netlify/functions install
cp src/.env.example src/.env.local     # fill in from the Supabase project

npm run dev          # vite, port 3000
npm run build        # verify this passes before committing
npm run typecheck
npm run test         # 69 unit tests
```

Security tests need a Postgres 16 on hand:

```sh
./supabase/test/run.sh   # 40 assertions against a real database
```

## A note on the security model

`supabase/migrations/0001_init.sql` creates the schema in its **locked-down end
state**. The NHL app got there over eight migrations, most written after a
review found a live hole — members writing their own scores, anonymous visitors
rewriting final scores, members moving their own deadlines. Every guard here is
commented back to the migration that earned it.

Do not relax one without reading that comment, and run `./supabase/test/run.sh`
after any change to it.
