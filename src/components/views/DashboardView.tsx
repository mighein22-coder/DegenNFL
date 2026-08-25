import React from 'react';
import { ViewStub } from './ViewStub';

export const DashboardView: React.FC = () => (
  <ViewStub
    title="Dashboard"
    summary="Where the week stands: your sheet, the deadline, and the top of the table."
    needs={[
      'A \'this week\' panel showing which of your five picks are locked and which are still open — under per-game locking these are different states, not one.',
      'Two countdowns: the next kickoff among your unlocked games, and the Sunday 13:00 ET final lock.',
      'A call to action that reflects the real state: no picks / partially submitted / complete / locked.',
      'Top few standings rows via computeStandings() in lib/standings.ts.',
    ]}
  />
);
