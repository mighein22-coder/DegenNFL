# Tasks

Seeded from the scaffolding session. **Mike is authoring the real version of
this file** — treat what follows as a starting list, not a plan of record.

Read `PLANNING.md` for why things are shaped the way they are.

---

## Blocking everything downstream

- [X] **Apply the schema to `degen-NFL-pool` and verify it live.** Done — see
      Infrastructure below, where all three steps are ticked. The pool is live:
      Week 1 was activated from the Admin panel and its picks display. This
      entry sat unticked long after it was true, claiming the whole list was
      blocked while the app was already serving rows.

- [ ] **Reset the database before Tue 8 Sep 18:00 ET.** Mike's plan as of
      2026-09-02. That deadline is not arbitrary: Week 1 was activated early to
      test, which froze its lines permanently at an early-September market, and
      **the Tuesday cron will not re-price a line that is already set** — it
      will find Week 1 done and leave it alone. So a reset after that moment
      leaves the pool playing Week 1 on stale numbers for real. Teardown SQL is
      in `docs/OPERATIONS.md`.

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
- [X] **Service-role functions work on production.** Fixed 2026-09-01. Two
      independent faults, stacked, which is why it took all afternoon: the
      second was invisible until the first was fixed.
      - [X] `SUPABASE_SERVICE_ROLE_KEY` was never on the `degennfl` site. Now
            set, scopes `builds/functions/runtime`, values for production,
            deploy-preview and branch-deploy.
      - [X] Functions ran `nodejs20.x`; supabase-js needs a native WebSocket,
            which Node has from 22. Raising `NODE_VERSION` did nothing because
            **Netlify reuses function bundles when only config changed** — the
            deploy succeeds and the bundles keep their old runtime.
            `AWS_LAMBDA_JS_RUNTIME=nodejs22.x` (UI/CLI/API only, never
            netlify.toml) plus a source change to force a rebuild fixed it.
      - Verified by an unauthenticated POST to `admin-activate-week` returning
        401 rather than 500/502: the runtime guard passed, the credentials were
        read, the client constructed, and the auth gate answered.
- [ ] **An integration test that constructs a service-role client.** Every
      failure in the sequence above was invisible to `npm run typecheck`,
      `npm run test` and `npm run build`, because nothing in the suite builds a
      client or invokes a function — so all three had to be found in production,
      one at a time, each hidden behind the last. A single test that calls
      `createClient` against the real project and issues one trivial query would
      have caught the runtime fault outright, and caught the missing credential
      as a clear failure rather than a 500. Worth more than any further unit
      tests of pure logic, which is the part already well covered.
- [ ] Tighten `@supabase/supabase-js` in `netlify/functions/package.json`. It
      declares `^2.0.0` while `src` declares `^2.89.0`; the range resolved to
      2.112.4, which requires Node 22 for native WebSocket and broke every
      service-role function on Node 20 with a 502. The committed lockfile plus
      `npm ci` is what actually pins it, so this is about the declared range no
      longer describing what the code needs — `^2.0.0` claims support for
      versions that cannot work.
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
- [X] Check the Supabase project has email signups ENABLED. Confirmed by Mike
      on the project itself — nothing in the repo can verify it, which is why
      this stayed open so long.
- [x] Run `/picks` against a real Supabase. Week 1 picks display after the
      Admin activate-week button was pressed. Confirmed 2026-09-02.
- [ ] **Run the other six screens against a real Supabase.** Same gap `/picks`
      had: they typecheck, build and pass their unit tests, but nothing local
      has loaded a row into them — there is still no `.env.local` in the repo.
      The reads they add over `/picks` are `getAllPicks`, `getProfiles`,
      `getAllWeeks`, `getGamesForWeeks`, `updateProfile` and the `team-records`
      function. Standings and the Matrix are the two to look at first: both
      depend on `picks_select_visible` returning other members' picks only once
      a game has kicked off, which no local test can exercise.
      What the PR #9 deploy preview DID establish, and it is less than it
      sounds: the bundle boots and the login screen renders with no console
      error, which also proves the Supabase env vars are present on that deploy
      (`src/lib/supabase.ts` throws at module load without them). Nothing past
      the login screen was exercised.
- [x] Build the real views. Every member-facing screen is wired to data:
      Dashboard, Standings, League Matrix, My History, Team Affinity and
      Settings. `ViewStub` is deleted. Admin is real but not finished — the two
      remaining jobs are listed below and on the panel itself.
      - [x] The derivations live in `src/lib/` as pure functions with tests
            (`sheet.ts`, `history.ts`, `affinity.ts`), not inside components.
            `buildHistory` and `computeStandings` are asserted to agree on what
            a segment totals — two code paths over the same week ids, and a
            member seeing one number on their history page and another in the
            table they are ranked by is the failure that would follow.
      - [x] Batched reads. `getGamesForWeeks` is one `.in()` for the whole
            season, which is the N+1 the NHL app's history screen had.
- [ ] Admin panel: an input calling `setSpread(gameId, rawSpread)` for any game
      that opened without a line. The service function exists; this is the UI
      for it.
      - [x] The `activateWeek(weekNumber)` button — the manual version of the
            Tuesday cron — is built. It warns when the chosen week's own Tuesday
            is still in the future, because activating early freezes that week's
            lines permanently at today's market and the cron will not re-price
            them. Teardown SQL is in `docs/OPERATIONS.md`.
- [ ] Verify `weekly-rollover` **on its cron** against the live project. The
      schema is applied and the shared `activateWeek` has now run for real —
      the Admin button seeded Week 1 and froze its lines — so what is left
      unproven is the scheduled trigger itself and the idempotency claim:
      let the Tuesday job fire, confirm 16 games and 16 hooked spreads, then
      confirm a second run changes nothing. The double-fire matters because the
      job is scheduled at BOTH 22:00 and 23:00 UTC to survive the November DST
      change, so it genuinely runs twice every week.

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
- [ ] Admin UI for invites. `createInvite()`, `revokeInvite()`, `listInvites()`
      and `listInviteClaims()` exist and are admin-only in the database. Moved
      here from Application by Mike: one reusable code covers the whole pool, so
      the SQL path is a single statement for the season rather than one per
      member. It buys convenience, not capability.

---

## Done (views session, 2026-09-02)

- [x] Six member-facing screens wired to data, replacing their stubs. Each one
      is a thin container over a pure derivation; nothing aggregates in a
      component.
- [x] `summarizeSheet` — the Dashboard's answer to a question that has no
      yes/no answer under per-game locking. Three picks locked in on Thursday
      and two still open is neither submitted nor unsubmitted, so the status is
      derived (`NOT_OPEN` / `EMPTY` / `PARTIAL` / `COMPLETE` / `LOCKED`) with
      the counts kept alongside. `LOCKED` deliberately outranks `COMPLETE`.
- [x] The Dashboard shows BOTH deadlines. The next kickoff usually bites days
      before the Sunday 13:00 ET lock; showing only the weekly one tells a
      member they can still change a Thursday pick they cannot.
- [x] The Matrix leaves an unrevealed cell blank and says so, rather than
      inventing a reason for it. RLS means an unrevealed pick is not in the
      data at all, and only its owner can tell 'not picked' from 'not shown'.
- [x] Team Affinity lists only teams the member has picked — the bye-week rule.
      A table of 32 would show four to six holes a week that read as missing
      results.
- [x] The Dashboard fires `sync-week` after first paint, as `/picks` does. It
      is the page most often opened, and scores only land because somebody
      opens one.
- [x] `useLoader` / `useNow` — the load-cancel-error-reload shape `PicksPage`
      grew by hand, and a ticking clock so a countdown left open goes down.
- [x] 108 unit tests passing (30 new); `npm run build` and `npm run typecheck`
      clean.

## Done (previous session)

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
