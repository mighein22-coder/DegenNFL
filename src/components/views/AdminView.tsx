import React from 'react';
import { ViewStub } from './ViewStub';

export const AdminView: React.FC = () => (
  <ViewStub
    title="Admin Panel"
    summary="Open a week by hand, and set the lines the feed did not supply."
    needs={[
      'A button calling activateWeek(weekNumber) in lib/supabaseService.ts — the manual version of the Tuesday 18:00 ET cron. Safe to press twice: a frozen line is never re-priced.',
      'Invites: createInvite(email?) mints a single-use code, listInvites() shows what is outstanding. Both exist in lib/supabaseService.ts and are admin-only in the database. Until this is built, mint codes from the SQL editor — see docs/OPERATIONS.md.',
      'A list of that week\'s games with no spread, each with an input calling setSpread(gameId, rawSpread). Those games are unpickable until a line exists, so this is the one admin job with a Sunday deadline. Enter the RAW line from the home team\'s point of view — the database hooks it to a half point.',
      'Week status toggle (OPEN / LOCKED / COMPLETED). Note status does NOT control the deadline — final_lock_at is derived from the week id and cannot be moved from a client at all.',
      'Score corrections must go through a server function under the service-role key; the admin\'s own session cannot write those columns either.',
    ]}
  />
);
