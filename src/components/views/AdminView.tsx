import React from 'react';
import { ViewStub } from './ViewStub';

export const AdminView: React.FC = () => (
  <ViewStub
    title="Admin Panel"
    summary="Seed a week's schedule and correct what needs correcting."
    needs={[
      'Sync a week\'s games via syncScheduleForWeek() in lib/supabaseService.ts.',
      'Week status toggle (OPEN / LOCKED / COMPLETED). Note status does NOT control the deadline — final_lock_at is derived from the week id and cannot be moved from a client at all.',
      'Score and line corrections must go through a server function under the service-role key; the admin\'s own session cannot write those columns either.',
    ]}
  />
);
