# DegenNFL

> **Stub.** Mike is authoring the real version of this file. The rules recorded
> below reached this repo through a planning conversation, not from an
> authoritative rules sheet — **where Mike's version disagrees, it wins.**

## Project

NFL against-the-spread confidence pool. TypeScript, Vite + React 19, Supabase
backend, deployed on Netlify. Sibling to the NHL pool in FrozenDegenerates.

Always verify `npm run build` passes locally before committing.

## Instructions

- Read `PLANNING.md` at the start of every new conversation.
- Check `TASKS.md` before starting work; mark completed tasks immediately and
  add newly discovered ones.
- After implementing a fix, commit AND push in the same flow unless told
  otherwise.
- When fixing bugs, check for existing bad data that needs cleanup — a code fix
  alone rarely resolves a state issue.

## Rules of the pool

- Five picks a week, confidence 1–5, no duplicates.
- Picked **against the spread**, not straight up.
- Every stored spread is hooked to a half point, so every pick is a win or a
  loss. There is no push state anywhere in the system, and points are integers.
- Picks lock **per game at that game's kickoff**, plus a whole-sheet final lock
  at **Sunday 1:00 PM ET**.
- 18 weeks, three six-week segments.

## Things that will bite you

- **`games.spread` must always end in `.5`.** Enforced by `hookSpread()` and by
  a `CHECK` constraint. Removing either reintroduces ties, which nothing in the
  schema, the scoring or the UI can represent.
- **The season anchor lives in two places** — `SEASON_WEEK1_SUNDAY` in
  `src/constants.ts` and `season_week1_sunday()` in the migration. They compute
  independently on purpose. Change both or neither.
- **Never add a `VITE_`-prefixed secret.** Vite inlines those into the public
  bundle. The NHL app leaked its sync secret exactly this way.
- **Deadlines are derived, never stored from client input.** See the header of
  `supabase/migrations/0001_init.sql` before touching anything in `weeks`.
- Run `./supabase/test/run.sh` after any change to the migration.

## Commands shortcut (if seen as the only word in a prompt)

1. `nb` — new branch for feature development
2. `commit` — commit current changes with a good message
3. `ppr` — push changes
4. `cpr` — create a pull request
5. `mpr` — merge the current PR (squash by default)
6. `back` — switch to main and pull
7. `cleanup` — delete the merged feature branch locally and remotely
