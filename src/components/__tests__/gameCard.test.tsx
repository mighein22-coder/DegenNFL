import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameCard } from '../GameCard';
import type { Game } from '../../types';

/**
 * The record in parentheses on a pick-sheet card (issue #33).
 *
 * The first component test in the repo, and it is here for a specific reason
 * rather than as the start of a policy: the whole content of #33 is "show the
 * record in parentheses", and nothing else in the suite would notice if the
 * parenthetical silently stopped rendering. `computeTeamAffinity` and friends
 * are testable without a DOM because they are pure; this one is not — the
 * requirement IS the markup.
 *
 * `renderToStaticMarkup` rather than a testing library: it needs no new
 * dependency, no jsdom environment and no cleanup, and what is being asserted
 * is output, not interaction. There is nothing to click here.
 */

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    weekId: 'week-2026-03',
    homeTeamId: 'PHI',
    awayTeamId: 'DAL',
    startTime: '2026-09-27T17:00:00Z',
    status: 'SCHEDULED',
    spread: -3.5,
    ...overrides
  };
}

const RECORDS = { PHI: '2-0', DAL: '1-1' };

describe('GameCard team records', () => {
  it('shows each team’s record in parentheses', () => {
    const html = renderToStaticMarkup(
      <GameCard game={game()} locked={false} records={RECORDS} />
    );
    expect(html).toContain('(2-0)');
    expect(html).toContain('(1-1)');
  });

  it('renders a tie as the three-part record ESPN sends', () => {
    // NFL games can tie. The pool cannot — every spread is hooked — so the
    // third component exists here and nowhere else in the app.
    const html = renderToStaticMarkup(
      <GameCard game={game()} locked={false} records={{ PHI: '1-1-1', DAL: '1-1' }} />
    );
    expect(html).toContain('(1-1-1)');
  });

  it('shows no parenthetical at all when the records are unavailable', () => {
    // The ESPN fetch failing costs the record and nothing else. An empty
    // "(—)" would claim to know something the card does not.
    const html = renderToStaticMarkup(<GameCard game={game()} locked={false} records={null} />);
    expect(html).not.toContain('(');
    // The card itself is unharmed: the teams and the line are still on it.
    expect(html).toContain('Philadelphia');
    expect(html).toContain('Dallas');
  });

  it('omits the parenthetical for a team the records map has no entry for', () => {
    const html = renderToStaticMarkup(
      <GameCard game={game()} locked={false} records={{ PHI: '2-0' }} />
    );
    expect(html).toContain('(2-0)');
    // DAL is missing from the map rather than present and empty.
    expect(html).not.toContain('()');
  });

  it('still shows records on a locked card', () => {
    // A locked card is the record of a pick already made, and the team's
    // season did not stop when the pick did.
    const html = renderToStaticMarkup(
      <GameCard
        game={game({ status: 'FINAL', homeScore: 27, awayScore: 20 })}
        locked
        selectedTeamId="PHI"
        confidence={3}
        records={RECORDS}
      />
    );
    expect(html).toContain('(2-0)');
  });
});
