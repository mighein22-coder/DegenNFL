import { describe, it, expect } from 'vitest';
import { extractSpread } from '../../../netlify/functions/_shared/weekLifecycle';
import { hookSpread, formatSpread } from '../scoring';

/**
 * The sign convention, pinned to real payloads.
 *
 * `games.spread` is defined from the HOME team's point of view: negative means
 * home is favoured. ESPN's `odds[0].spread` uses that same convention — but
 * `odds[0].details` does NOT. The string names the FAVOURITE, so for half the
 * league it means the opposite of what it looks like. Reading one as the other
 * inverts the favourite in every away-favoured game, which is a silent way to
 * grade a whole season backwards.
 *
 * Every case below is a real 2026 payload, captured 2026-08-26. They are kept
 * verbatim rather than simplified, because the point is what ESPN actually
 * sends, not what it ought to.
 */

/** Real odds objects, trimmed to the fields the parser reads. */
const HOME_FAVOURITE_HOOKED = { details: 'SEA -3.5', spread: -3.5 }; // NE @ SEA
const HOME_FAVOURITE_WHOLE = { details: 'DET -7', spread: -7 };      // NO @ DET
const AWAY_FAVOURITE_HOOKED = { details: 'BAL -3.5', spread: 3.5 };  // BAL @ IND
const AWAY_FAVOURITE_WHOLE = { details: 'SEA -10', spread: 10 };     // SEA @ ARI

/** A book that never opened the game: an odds object with no line in it. */
const LINE_OFF = { overUnder: 44.5, pointSpread: { home: { close: { line: 'OFF' } } } };

describe('extractSpread', () => {
  it('reads a home favourite as negative', () => {
    expect(extractSpread(HOME_FAVOURITE_HOOKED, 'SEA', 'NE')).toBe(-3.5);
  });

  it('reads an AWAY favourite as positive — the case that inverts silently', () => {
    // "BAL -3.5" with Baltimore away means Indianapolis are +3.5 at home.
    // Reading the string instead of the number would store -3.5 and make the
    // Colts the favourite.
    expect(extractSpread(AWAY_FAVOURITE_HOOKED, 'IND', 'BAL')).toBe(3.5);
  });

  it('agrees with itself when only the details string is present', () => {
    // The fallback path must produce the same number as the numeric one, or
    // a payload missing `spread` would grade the opposite way.
    for (const [odds, home, away] of [
      [HOME_FAVOURITE_HOOKED, 'SEA', 'NE'],
      [HOME_FAVOURITE_WHOLE, 'DET', 'NO'],
      [AWAY_FAVOURITE_HOOKED, 'IND', 'BAL'],
      [AWAY_FAVOURITE_WHOLE, 'ARI', 'SEA']
    ] as const) {
      const fromNumber = extractSpread(odds, home, away);
      const fromString = extractSpread({ details: odds.details }, home, away);
      expect(fromString).toBe(fromNumber);
    }
  });

  it('returns null when the book has the game OFF', () => {
    // Real: 2026 week 3 MIN @ TB. Not an error — the game is seeded without a
    // line and stays unpickable until an admin sets one.
    expect(extractSpread(LINE_OFF, 'TB', 'MIN')).toBeNull();
    expect(extractSpread(null, 'TB', 'MIN')).toBeNull();
  });

  it('refuses a favourite abbreviation matching neither side', () => {
    expect(extractSpread({ details: 'XXX -3.5' }, 'TB', 'MIN')).toBeNull();
  });
});

describe('captured lines, hooked', () => {
  it('pushes a whole home favourite further out, never in', () => {
    const raw = extractSpread(HOME_FAVOURITE_WHOLE, 'DET', 'NO')!;
    expect(raw).toBe(-7);
    expect(hookSpread(raw)).toBe(-7.5); // Detroit lay 7.5, not 6.5
  });

  it('pushes a whole AWAY favourite further out too', () => {
    const raw = extractSpread(AWAY_FAVOURITE_WHOLE, 'ARI', 'SEA')!;
    expect(raw).toBe(10);
    expect(hookSpread(raw)).toBe(10.5); // Seattle lay 10.5 on the road
  });

  it('leaves a line the market already hooked exactly as it is', () => {
    expect(hookSpread(extractSpread(AWAY_FAVOURITE_HOOKED, 'IND', 'BAL')!)).toBe(3.5);
  });

  it('displays the away favourite as the favourite', () => {
    const spread = hookSpread(extractSpread(AWAY_FAVOURITE_HOOKED, 'IND', 'BAL')!);
    expect(formatSpread(spread, true)).toBe('+3.5');  // IND at home
    expect(formatSpread(spread, false)).toBe('-3.5'); // BAL on the road
  });
});
