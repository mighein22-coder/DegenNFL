import React from 'react';
import { ViewStub } from './ViewStub';

export const ResultsView: React.FC = () => (
  <ViewStub
    title="League Matrix"
    summary="Every member's picks for a week, once they are visible."
    needs={[
      'A member x game grid for the selected week.',
      'Cells for other members must stay blank until that GAME locks — not until the week does. RLS already enforces this, so unlocked picks simply will not be in the data.',
      'Show the frozen spread per game; it is what the results were graded against.',
      'Mobile falls back to a per-member card list — the grid does not fit.',
    ]}
  />
);
