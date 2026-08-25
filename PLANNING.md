# DegenNFL — Planning

An NFL against-the-spread confidence pool, sibling to the NHL pool that runs at
[FrozenDegenerates](https://github.com/mighein22-coder/FrozenDegenerates)
("IcePick"). Separate repo, separate Supabase project, separate Netlify site,
hosted on a subdomain of the same domain.

This document covers **why the app is shaped the way it is**. For what still
needs doing see `TASKS.md`; for running it see `docs/OPERATIONS.md`.

---

## What this repo currently is

A scaffold, not a working pool. Honestly:

| Area | State |
|---|---|
| Database schema + security model | **Real.** Applied to a live Postgres and attacked; 40 assertions pass. |
| Scoring (`src/lib/scoring.ts`) | **Real**, unit tested. |
| Week calendar, locking, segments | **Real**, unit tested (69 tests total). |
| Design tokens + Tailwind pipeline | **Real**, verified through to the built CSS. |
| NFL schedule / odds ingestion | **Stub.** Unverified — see *The open spike* below. |
| Most screens | **Stubs** that state what they need. |
| `PicksView` | Locking model is real; it is not yet wired to data. |

---

## Inheritance

The NHL app is the reference, and most of it carries over unchanged: React 19 +
Vite, Supabase for auth and data, Netlify for hosting and functions, the same
three-package layout (`/`, `src/`, `netlify/functions/`), the same
`computeStandings` with its points → wins → name tiebreaker and competition
ranks, the same pick model (five games, confidence 1–5, no duplicates).

The security model carries over *deliberately and completely*. FrozenDegenerates
reached its current state over eight migrations, most written after a review
found a live hole — a member could rewrite their own scores, or a logged-out
visitor could rewrite a final score, or a member could move their own deadline
and re-submit a perfect sheet against known results. `supabase/migrations/0001_init.sql`
creates this schema **already in that end state**, with each guard commented
back to the migration that earned it. It is not a permissive schema awaiting
hardening.

## What is genuinely different

Two decisions make this a rewrite rather than a rename.

### 1. Picks lock per game, plus a weekly final lock

The NHL pool played one game day and had one deadline: Saturday 10:00 ET. The
NFL runs Thursday to Monday, so this pool locks twice over:

* **Per game**, at that game's own kickoff.
* **Per week**, at Sunday 13:00 ET, which closes the sheet regardless.

A pick is writable only while both are open. Consequences worth knowing:

* A Thursday-night pick locks days before the rest of the sheet.
* International games kicking at ~09:30 ET close before the Sunday lock — this
  falls out of the per-game rule with no special case, which is the main
  argument for it.
* **A confidence value spent on a locked game is spent for the week.** Lock 3 in
  on Thursday and 3 is gone; the selector must not offer it again.
* **A partial sheet is a normal state**, not an error. `save_picks` accepts one
  and replaces only the still-open rows.

That last point is the one that reshaped code rather than config: the NHL app's
`save_picks` RPC deleted a member's whole week and re-inserted it, which under
per-game locking would rewrite already-locked picks — exactly what the locks
exist to prevent. The rewritten version refuses to touch a locked pick, and
treats a sheet that omits locked picks as correct rather than as a deletion.

### 2. Games are picked against the spread — and every spread is hooked

Picks are graded against a line, not on who won outright. The line lives on
`games.spread`, expressed from the **home** team's point of view (negative =
home favoured), and it is frozen at kickoff so every member is graded against
one number.

**Every stored spread ends in a half point.** A line of `-3` is hooked to `-3.5`
before it is ever written; the half point always goes *against* the favourite,
so the rule is one sentence a member can be told. A pick'em (`0`) resolves to
home `-0.5` by convention.

This is the highest-leverage decision in the app, because of what it removes:

* no `PUSH` result to thread through the schema, the scoring and the UI
* `points_earned` stays an **integer** — standings never show 27.5
* `gradePick` has two branches instead of three
* `src/lib/standings.ts` ported across **completely untouched**

It is enforced twice: in `hookSpread()` at capture time, and as a `CHECK`
constraint on `games.spread`. The constraint is the one that actually
guarantees it — a bug in the sync function would otherwise produce a season of
quiet ties nobody notices until a payout is disputed. With the constraint, it is
a failed insert instead.

The cost, stated plainly: the pool is not playing the real market line. That is
the trade — half a point of accuracy for the elimination of every push.

### Smaller differences

* **Weeks are canonical 1–18**, identified `week-2026-08`, rather than the NHL
  app's `week-YYYY-MM-DD` Saturday. Because NFL weeks are exactly seven days
  apart, the whole calendar derives from one anchor (`SEASON_WEEK1_SUNDAY`), and
  the deadline derives from the week id — the NHL app's 0008 rule applied to the
  new key. A member cannot move their own deadline without changing a primary
  key they do not control.
* **Segments are 6 / 6 / 6** over 18 weeks. `segments.ts` got simpler: no
  calendar enumeration, just arithmetic.
* **32 teams with bye weeks.** Four to six teams are idle each week; a team with
  no game is not missing data. This mostly affects the team-stats screens.
* **The week rolls over Tuesday 06:00 ET**, after Monday Night Football has been
  scored — not at the Sunday lock, so members see their locked sheet and the
  results landing rather than a week they cannot pick yet.

---

## The open spike

**`netlify/functions/nfl-schedule.ts` is unverified and must not be trusted yet.**

There is no free official NFL API equivalent to the NHL one the sibling app
uses. The candidate is ESPN's undocumented scoreboard endpoint. The session that
built this scaffold could not reach `site.api.espn.com` — the environment's
network egress policy denied it — so the parsing was written from the endpoint's
reported shape and **has never been run against a real payload**.

Run `node scripts/spike-espn.mjs 8` on a machine with open network access and
reconcile every `TODO(spike)`. Three questions decide the design:

1. Does `competitions[0].odds[]` carry a spread, and in what shape? A
   `details: "KC -3.5"` string needs the abbreviation resolved to home or away
   before its sign means anything — **test a game where the away team is
   favoured**, the case most likely to be silently inverted.
2. Is the line present for *future* weeks? The pick sheet needs to show one.
3. Does the line survive once a game is FINAL?

Question 3 already has a pessimistic answer baked in: the schema stores the line
rather than re-fetching it. That is correct either way, and doubly so given
hooking — a stored, hooked line is the pool's own number, not the market's.

---

## Shared design with FrozenDegenerates

Design should flow to both sites. The mechanism chosen is the cheapest one that
works: **one file, copied**, with a script to do the copying.

* `src/styles/tokens.shared.css` — semantic slots only (`--color-brand-*`,
  `--color-surface`, `--color-win`…). Nothing in it names a sport or a hue.
  Kept byte-identical in both repos.
* `src/styles/brand.css` — per-app. DegenNFL fills the brand ramp with turf
  green; FrozenDegenerates keeps its ice blue. This is the *only* file that
  differs, and it is what makes the two sites read as siblings rather than
  clones.
* `scripts/sync-tokens.mjs --check|--push|--pull ../FrozenDegenerates`

Rejected: a private npm package (every tweak becomes a publish and two bumps)
and a git submodule (genuinely painful under OneDrive sync).

Two consequences accepted up front:

* **Tailwind is a real dependency here, not the CDN script.** The NHL app
  configures its theme inside an inline `<script>` on `cdn.tailwindcss.com`,
  which cannot read a shared CSS file and ships an unminified runtime compiler.
  A deliberate divergence — the shared-token mechanism does not work otherwise.
* **Components use semantic names from day one** (`bg-brand-500`, never
  `bg-ice-500`). FrozenDegenerates adopts the same tokens later by aliasing its
  `ice-*` ramp onto `brand-*` — mechanical, and not a prerequisite for anything
  here.

---

## Verifying the security model

The guards in `0001_init.sql` are the whole security model, and a migration
whose policies have only ever been *read* is one you are trusting on vibes. So:

```sh
./supabase/test/run.sh
```

applies the migration to a throwaway Postgres and runs 40 assertions against it,
each playing a member with nothing but the anon key and a SQL console. Every
attack in there worked at some point in the NHL app's history. Run it after any
change to the migration.

---

## Assumptions to confirm

* The rules that reached this repo came through a planning conversation, not
  from the DegenNFL `CLAUDE.md` itself. Where that file disagrees, **it wins**.
* Pick'em hooking to home −0.5 is a convention, not a derivation. Away −0.5
  would be equally defensible.
* `SEASON_WEEK1_SUNDAY = 2026-09-13` assumes the 2026 season opens Thursday
  10 September. Confirm against the published schedule.
* The season anchor is mirrored in **two** places — `src/constants.ts` and
  `season_week1_sunday()` in the migration. They compute independently on
  purpose; nothing will catch a mismatch automatically.
