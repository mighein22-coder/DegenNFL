/**
 * Which layout the League Matrix uses on a phone: a card per member, or the
 * same grid the laptop shows, scrolling sideways. Remembered per browser, like
 * the display mode, because it is a preference about this device's screen.
 *
 * Only phones ever read it. From `md` up the grid is the only layout, so the
 * choice cannot change anything on a laptop or on paper.
 */
export type MatrixLayout = 'cards' | 'grid';

export const MATRIX_LAYOUT_KEY = 'degennfl-matrix-layout';

/** Cards unless the member has chosen the grid. Storage can throw (private mode); it is optional. */
export function readMatrixLayout(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): MatrixLayout {
  try {
    return storage?.getItem(MATRIX_LAYOUT_KEY) === 'grid' ? 'grid' : 'cards';
  } catch {
    return 'cards';
  }
}

export function writeMatrixLayout(
  layout: MatrixLayout,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage()
): void {
  try {
    storage?.setItem(MATRIX_LAYOUT_KEY, layout);
  } catch {
    // Not saved; the choice still holds for this visit.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
