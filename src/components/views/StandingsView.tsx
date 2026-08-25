import React from 'react';
import { ViewStub } from './ViewStub';

export const StandingsView: React.FC = () => (
  <ViewStub
    title="Standings"
    summary="Season and per-segment tables."
    needs={[
      'Render computeStandings() from lib/standings.ts — it is already written and tested.',
      'A segment selector over getSegments() (three segments, weeks 1-6 / 7-12 / 13-18) alongside the full-season table.',
      'Competition ranks are already handled by rankStandings(); do not renumber them in the view.',
    ]}
  />
);
