import React from 'react';
import { ViewStub } from './ViewStub';

export const TeamStatsView: React.FC = () => (
  <ViewStub
    title="Team Affinity"
    summary="Which teams you back, and how that has worked out."
    needs={[
      'Per-team picked/won/lost counts for the signed-in member, from their pick history.',
      'Bye weeks: 4-6 teams are idle every week and 32 teams play 17 games in 18 weeks. A team with no game is not missing data — do not render it as a gap.',
      'Team records come from the team-records function (W-L or W-L-T; NFL games can tie even though pool picks cannot).',
    ]}
  />
);
