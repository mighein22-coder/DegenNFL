# Tasks

Seeded from the scaffolding session. **Mike is authoring the real version of
this file** — treat what follows as a starting list, not a plan of record.

Read `PLANNING.md` for why things are shaped the way they are.

---

## Blocking everything downstream

- [ ] **Run the ESPN spike.** `node scripts/spike-espn.mjs 8` on a machine with
      open network access (the scaffolding session was blocked from reaching
      `site.api.espn.com`). Answer the three questions in the script header,
      then reconcile every `TODO(spike)` in `netlify/functions/nfl-schedule.ts`
      and `sync-week.ts`. Nothing that touches real games can be trusted until
      this is done.
      - [ ] Confirm the odds shape, and **test a game where the AWAY team is
            favoured** — that is where the sign gets silently inverted.
      - [ ] Confirm whether lines exist for future weeks.
      - [ ] Confirm whether lines survive a completed game.
      - [ ] Once settled, de-duplicate `extractSpread` into
            `netlify/functions/_shared/`.

- [ ] **Confirm the season anchor.** `SEASON_WEEK1_SUNDAY = '2026-09-13'` in
      `src/constants.ts` assumes the season opens Thursday 10 September 2026.
      It is mirrored in `season_week1_sunday()` in the migration — **change both
      or neither.**

## Infrastructure

- [ ] Create the DegenNFL Supabase project; apply `supabase/migrations/0001_init.sql`.
- [ ] Run the verification queries at the bottom of that migration against the
      live project, not just the test harness.
- [ ] Create the Netlify site, point it at this repo, set `VITE_SUPABASE_URL`,
      `VITE_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
      **No `VITE_`-prefixed secrets** — Vite inlines those into the public
      bundle, which is how the NHL app leaked its sync secret.
- [ ] Configure the subdomain.
- [ ] Allowlist `/auth/callback` in Supabase → Authentication → URL
      Configuration. No app change substitutes for this; password reset
      dead-ends without it.

## Application

- [ ] Wire `/picks`: load week + games + picks, render the existing `PicksView`,
      wire `onSave` to `savePicks()`. The per-game locking model is already in
      the component; this is plumbing.
- [ ] Build the real views — each stub under `src/components/views/` lists what
      it needs. Rough order of value: Dashboard, Standings, League Matrix,
      My History, Team Affinity, Settings, Admin.
- [ ] Seeding a week's schedule from the Admin panel (`syncScheduleForWeek`).
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

- [ ] Automated score sync on a schedule. Today scores only move when a member
      opens the app.
- [ ] Self-serve signup gated by invites.
- [ ] Email notifications — pick reminder and post-week results.
- [ ] Adopt the shared tokens in FrozenDegenerates: `node scripts/sync-tokens.mjs
      --push ../FrozenDegenerates`, add a `brand.css` there filling the same
      slots with the `ice` ramp, then rename its `ice-*` classes to `brand-*`.

---

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
