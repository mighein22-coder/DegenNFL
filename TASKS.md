# Tasks

Seeded from the scaffolding session. **Mike is authoring the real version of
this file** — treat what follows as a starting list, not a plan of record.

Read `PLANNING.md` for why things are shaped the way they are.

---

## Blocking everything downstream

- [ ] **Apply the schema to `degen-NFL-pool` and verify it live.** The
      migration passes 52 assertions against a throwaway Postgres 17, but it
      has not been run against the real project. Nothing else on this list can
      be exercised until it has. See Infrastructure below.

- [X] **Run the ESPN spike.** Done 2026-08-26 — see *What the spike found* in
      `PLANNING.md`. All three questions answered; the third one (lines vanish
      once a game is FINAL) is why capture moved to Tuesday.
      - [X] Odds shape confirmed, including all 14 away-favoured games in weeks
            1–3. `odds[0].spread` is home-relative; `details` names the
            favourite. Pinned by `src/lib/__tests__/espnOdds.test.ts`.
      - [X] Lines exist for future weeks — 48 of 48, a year out.
      - [X] Lines do NOT survive a completed game — 0 of 64.
      - [X] `extractSpread` de-duplicated into
            `netlify/functions/_shared/weekLifecycle.ts`.

- [X] **Confirm the season anchor.** `SEASON_WEEK1_SUNDAY = '2026-09-13'` in
      `src/constants.ts`, mirrored in `season_week1_sunday()` in the migration —
      **change both or neither.** Confirmed against the published schedule: the
      first Sunday is 13 Sep 2026. (The season opens Wed 9 Sep, not Thu 10 —
      the comment said Thursday and has been corrected.)

## Infrastructure

- [X] Create the DegenNFL Supabase project (`degen-NFL-pool`) and apply
      `supabase/migrations/0001_init.sql`.
- [X] Apply `supabase/migrations/0002_scoring_and_activation.sql`.
- [X] Run the verification queries against the live project, not just the test
      harness.
- [X] Create the Netlify site, point it at this repo, set `VITE_SUPABASE_URL`,
      `VITE_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
      **No `VITE_`-prefixed secrets** — Vite inlines those into the public
      bundle, which is how the NHL app leaked its sync secret.
- [X] **Why `SUPABASE_SERVICE_ROLE_KEY` is missing on deploy previews.**
      Resolved 2026-09-01: nothing is misconfigured. Netlify's Sensitive
      Variable Policy withholds sensitive variables from untrusted deploys on
      sites connected to public repos, and every Deploy Preview is untrusted.
      Correct behaviour — the key bypasses all RLS, and anyone can open a PR
      against a public repo. **Do not "fix" it by loosening the policy.** See
      *Deploy previews never get the service-role key* in `docs/OPERATIONS.md`.
- [ ] **Verify activation works on PRODUCTION, before Tuesday 8 Sep.** Untested,
      and the preview cannot test it — production is a different (trusted)
      context. `weekly-rollover` runs on the same credential, so if production
      cannot read it either, the 8 Sep job dies and week 1 never opens with
      nobody watching. Merging PR #4 deploys the clearer error message, which
      is what makes this a five-second check rather than another afternoon.
- [ ] Configure the subdomain.
- [ ] Allowlist `/auth/callback` in Supabase → Authentication → URL
      Configuration. No app change substitutes for this; password reset
      dead-ends without it.

## Application

- [x] Wire `/picks`. `PicksPage` is the container; `PicksView` stays pure.
      Covers both non-error empty states: a week whose schedule is not captured
      yet, and games the book never opened a line on.
- [x] Self-serve signup gated by invites. `0003_invites.sql` makes
      `redeem_invite()` the only way a profile is created, which closes a real
      hole: with signups enabled anyone could previously sign up and insert
      their own profile, and a profile is membership.
- [ ] Admin UI for invites. `createInvite()`, `revokeInvite()`, `listInvites()`
      and `listInviteClaims()` exist and are admin-only in the database. Less
      urgent than it was: one reusable code covers the whole pool, so the SQL
      path is a single statement for the season rather than one per member.
- [ ] Check the Supabase project has email signups ENABLED. Self-serve signup
      cannot work without it, and nothing in the repo can verify it.
- [ ] Run `/picks` against a real Supabase. It has never been executed — there
      is no `.env.local` in the repo, so it typechecks and builds but has not
      loaded a row. Do this before 8 Sep.
- [ ] Build the real views — each stub under `src/components/views/` lists what
      it needs. Rough order of value: Dashboard, Standings, League Matrix,
      My History, Team Affinity, Settings, Admin.
- [ ] Admin panel: an input calling `setSpread(gameId, rawSpread)` for any game
      that opened without a line. The service function exists; this is the UI
      for it.
      - [x] The `activateWeek(weekNumber)` button — the manual version of the
            Tuesday cron — is built. It warns when the chosen week's own Tuesday
            is still in the future, because activating early freezes that week's
            lines permanently at today's market and the cron will not re-price
            them. Teardown SQL is in `docs/OPERATIONS.md`.
- [ ] Verify `weekly-rollover` against the live project once the schema is
      applied — activate a week, confirm 16 games and 16 hooked spreads, then
      re-run and confirm it changes nothing.
- [ ] Delete `ViewStub.tsx` once the last view is real.

## Testing

- [ ] Integration test for `save_picks` under a *moving* clock — a game locking
      between page load and submit. The unit tests cover the pure logic and
      `supabase/test/01_security.sql` covers the policies, but that race is the
      most likely real-world failure and neither catches it.
- [ ] A test that fails if `SEASON_WEEK1_SUNDAY` and `season_week1_sunday()`
      disagree. It needs a database connection, which is why it does not exist
      yet — but the mismatch would silently move every deadline.

## Later

- [ ] Automated score sync *during* the week. `weekly-rollover` now closes the
      finished week on Tuesday, but between Thursday and Monday scores still
      only move when a member opens the app. That is acceptable — members are
      what drives it, and the Tuesday job is the backstop — but a scheduled
      sync on game days would make results land without anyone watching.
- [ ] Email notifications — pick reminder and post-week results.
- [ ] Adopt the shared tokens in FrozenDegenerates: `node scripts/sync-tokens.mjs
      --push ../FrozenDegenerates`, add a `brand.css` there filling the same
      slots with the `ice` ramp, then rename its `ice-*` classes to `brand-*`.

---

## Done (this session)

- [x] `/picks` wired: `PicksPage` loads the week, its games and the member’s
      picks, renders `PicksView`, and saves through `save_picks`. It also
      triggers `sync-week` after first paint, which is how scores land between
      Tuesdays.
- [x] `GameCard` no longer offers a game with no line. It was showing “line not
      posted” and still accepting the click, which `save_picks` and the RLS
      policy would both have rejected at submit time.
- [x] `getWeekOpensAt()` — the Tuesday a week’s sheet appears, for the screen
      that has to say so. Same instant as the previous week’s rollover for every
      week but the first, which is asserted rather than assumed.
- [x] ESPN spike run and reconciled; every `TODO(spike)` in the schedule and
      sync paths resolved against real payloads.
- [x] **Scoring changed to 4x1 + 1x3.** `picks.confidence` now holds a point
      value, not a rank. The old `unique (user_id, week_id, confidence)` had to
      go — four identical 1s collide on it — and it was quietly also capping a
      sheet at five rows, so `picks_one_bonus_per_week` and
      `picks_enforce_sheet_shape` replace it. That cap matters: `insert` on
      picks is granted to authenticated, so members are not forced through
      `save_picks`.
- [x] **Spreads captured on Tuesday, not at kickoff.** `weekly-rollover`
      (scheduled) and `admin-activate-week` (manual) both call `activateWeek`;
      `sync-week` no longer touches `games.spread`.
- [x] `admin_set_spread` + `game_has_line`: a game with no line is seeded but
      unpickable until an admin supplies one.
- [x] Week rollover moved to Tuesday 18:00 ET.
- [x] Security suite grew 40 → 52 assertions, all passing against Postgres 17.
      Two pre-existing tests were passing for the wrong reason and now fail
      closed on the rule they name.
- [x] 78 unit tests passing; `npm run build` and `npm run typecheck` clean.

## Done (scaffolding session)

- [x] Repo scaffolded from FrozenDegenerates: three-package layout, Vite +
      React 19 + Supabase, `netlify.toml`, `docs/OPERATIONS.md`.
- [x] `supabase/migrations/0001_init.sql` — the schema in its locked-down end
      state, carrying all eight of the NHL app's security migrations forward,
      plus per-game locking and the hooked-spread constraint.
- [x] `supabase/test/` — applies the migration to a throwaway Postgres and runs
      **40 security assertions** against it as a real `authenticated` role.
      All pass.
- [x] `src/lib/scoring.ts` — `hookSpread` / `gradePick`, with the half-point rule
      that removes pushes from the entire system.
- [x] `src/lib/timezone.ts` — NFL week calendar, per-game and weekly locking,
      Tuesday rollover, DST-correct across the November change.
- [x] `src/lib/segments.ts` — 6/6/6 over 18 weeks.
- [x] `src/lib/standings.ts` — ported unchanged (the hooked spread is what let
      it stay unchanged).
- [x] Shared design tokens (`tokens.shared.css` + `brand.css`) with
      `scripts/sync-tokens.mjs`; Tailwind as a real dependency rather than the
      CDN script. Verified through to the built CSS.
- [x] 69 unit tests passing; `npm run build` and `npm run typecheck` clean.
- [x] `scripts/spike-espn.mjs` — the blocked spike, ready to run locally.
