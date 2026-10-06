import { describe, expect, it } from 'vitest';
import { MATRIX_LAYOUT_KEY, readMatrixLayout, writeMatrixLayout } from '../matrixLayout';

const store = (initial?: string) => {
  const data = new Map<string, string>(initial ? [[MATRIX_LAYOUT_KEY, initial]] : []);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value)
  };
};

const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  }
};

describe('matrix layout preference', () => {
  it('defaults to cards', () => {
    expect(readMatrixLayout(store())).toBe('cards');
  });

  it('reads back a saved grid, and treats anything unrecognised as cards', () => {
    const s = store();
    writeMatrixLayout('grid', s);
    expect(readMatrixLayout(s)).toBe('grid');
    expect(readMatrixLayout(store('sideways'))).toBe('cards');
  });

  it('survives storage that throws, in both directions', () => {
    expect(readMatrixLayout(throwing)).toBe('cards');
    expect(() => writeMatrixLayout('grid', throwing)).not.toThrow();
  });
});
