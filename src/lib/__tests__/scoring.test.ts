import { describe, it, expect } from 'vitest';
import { hookSpread, gradePick, pointsFor, formatSpread } from '../scoring';

describe('hookSpread', () => {
  it('leaves an already-hooked line exactly as the market set it', () => {
    expect(hookSpread(-3.5)).toBe(-3.5);
    expect(hookSpread(7.5)).toBe(7.5);
    expect(hookSpread(-0.5)).toBe(-0.5);
    expect(hookSpread(14.5)).toBe(14.5);
  });

  it('moves a whole-number line against the favourite', () => {
    // Home favoured by 3 now has to win by 4.
    expect(hookSpread(-3)).toBe(-3.5);
    // Away favoured by 3 now has to win by 4.
    expect(hookSpread(3)).toBe(3.5);
    expect(hookSpread(-7)).toBe(-7.5);
    expect(hookSpread(10)).toBe(10.5);
  });

  it('gives the hook to the home team on a pick’em', () => {
    expect(hookSpread(0)).toBe(-0.5);
  });

  it('refuses a quarter-point line rather than silently rounding it', () => {
    expect(() => hookSpread(-2.25)).toThrow(/whole or half point/);
    expect(() => hookSpread(3.75)).toThrow(/whole or half point/);
  });

  it('refuses non-finite input', () => {
    expect(() => hookSpread(NaN)).toThrow(/finite/);
    expect(() => hookSpread(Infinity)).toThrow(/finite/);
  });

  it('never returns a line that can produce a tie', () => {
    for (let raw = -20; raw <= 20; raw += 0.5) {
      const hooked = hookSpread(raw);
      expect(Math.abs(hooked * 2) % 2).toBe(1);
    }
  });
});

describe('gradePick', () => {
  // Home favoured by 3.5. Home must win by 4+.
  const spread = -3.5;

  it('grades the favourite covering', () => {
    expect(gradePick(27, 20, spread, true)).toBe('WIN');
    expect(gradePick(27, 20, spread, false)).toBe('LOSS');
  });

  it('grades the favourite winning but not covering', () => {
    expect(gradePick(24, 21, spread, true)).toBe('LOSS');
    expect(gradePick(24, 21, spread, false)).toBe('WIN');
  });

  it('grades the favourite losing outright', () => {
    expect(gradePick(17, 20, spread, true)).toBe('LOSS');
    expect(gradePick(17, 20, spread, false)).toBe('WIN');
  });

  it('handles an away favourite (positive spread)', () => {
    // Away favoured by 6.5: away must win by 7+.
    const awayFavoured = 6.5;
    expect(gradePick(10, 24, awayFavoured, false)).toBe('WIN'); // away by 14
    expect(gradePick(10, 24, awayFavoured, true)).toBe('LOSS');
    expect(gradePick(17, 20, awayFavoured, false)).toBe('LOSS'); // away by 3 only
    expect(gradePick(17, 20, awayFavoured, true)).toBe('WIN');
  });

  it('splits correctly on either side of the hook', () => {
    // -3.5: a 3-point home win is a loss, a 4-point home win is a win.
    expect(gradePick(23, 20, -3.5, true)).toBe('LOSS');
    expect(gradePick(24, 20, -3.5, true)).toBe('WIN');
  });

  it('resolves a hooked pick’em on a one-point game', () => {
    expect(gradePick(21, 20, -0.5, true)).toBe('WIN');
    expect(gradePick(20, 21, -0.5, true)).toBe('LOSS');
    expect(gradePick(20, 21, -0.5, false)).toBe('WIN');
  });

  it('exactly one side wins, for every score and every hooked line', () => {
    for (let spr = -14.5; spr <= 14.5; spr += 1) {
      for (let home = 0; home <= 35; home += 7) {
        for (let away = 0; away <= 35; away += 7) {
          const homeResult = gradePick(home, away, spr, true);
          const awayResult = gradePick(home, away, spr, false);
          expect(homeResult).not.toBe(awayResult);
        }
      }
    }
  });

  it('refuses to grade against an unhooked line', () => {
    expect(() => gradePick(24, 21, -3, true)).toThrow(/not hooked/);
    expect(() => gradePick(24, 21, 0, true)).toThrow(/not hooked/);
  });
});

describe('pointsFor', () => {
  it('pays the confidence on a win and nothing on a loss', () => {
    expect(pointsFor('WIN', 5)).toBe(5);
    expect(pointsFor('WIN', 1)).toBe(1);
    expect(pointsFor('LOSS', 5)).toBe(0);
  });

  it('only ever returns integers, so standings never show a half point', () => {
    for (let c = 1; c <= 5; c++) {
      expect(Number.isInteger(pointsFor('WIN', c))).toBe(true);
      expect(Number.isInteger(pointsFor('LOSS', c))).toBe(true);
    }
  });
});

describe('formatSpread', () => {
  it('shows the favourite laying and the underdog taking', () => {
    expect(formatSpread(-3.5, true)).toBe('-3.5');
    expect(formatSpread(-3.5, false)).toBe('+3.5');
    expect(formatSpread(6.5, true)).toBe('+6.5');
    expect(formatSpread(6.5, false)).toBe('-6.5');
  });
});
