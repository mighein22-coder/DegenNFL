import React from 'react';
import { ViewStub } from './ViewStub';

export const MyHistoryView: React.FC = () => (
  <ViewStub
    title="My History"
    summary="Your season, week by week."
    needs={[
      'Week-by-week list of your picks with the spread, the result and the points.',
      'Batch the loads with .in() queries rather than one request per week — the NHL app had an N+1 here.',
      'Segment subtotals matching the standings scopes.',
    ]}
  />
);
