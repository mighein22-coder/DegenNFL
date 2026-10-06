import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfidencePicker } from '../ConfidencePicker';

/**
 * The phone control for a pick's worth. What matters is which values it will
 * let a member choose: a 3 spent on a locked game is spent for the week, and
 * the picker must not offer it — shown, but disabled and labelled, never live.
 */
const noop = () => {};

/** The markup of the button for a value. Its text starts right after the opening tag. */
const button = (html: string, label: string) => {
  const found = html.split('</button>').find(chunk => chunk.includes(`>${label}`));
  if (!found) throw new Error(`no ${label} button in: ${html}`);
  return found;
};

// `disabled=""` is the attribute; the bare word also appears in every button's
// `disabled:` utility classes, so a substring check on "disabled" proves nothing.
const DISABLED = 'disabled=""';

describe('ConfidencePicker', () => {
  it('offers both values when the week can hold both', () => {
    const html = renderToStaticMarkup(<ConfidencePicker offered={[1, 3]} onChange={noop} />);
    expect(button(html, '1 pt')).not.toContain(DISABLED);
    expect(button(html, '3 pts')).not.toContain(DISABLED);
    expect(button(html, '3 pts')).toContain('bonus');
  });

  it('disables a value the week cannot hold and says it is used', () => {
    const html = renderToStaticMarkup(<ConfidencePicker offered={[1]} onChange={noop} />);
    expect(button(html, '1 pt')).not.toContain(DISABLED);
    expect(button(html, '3 pts')).toContain(DISABLED);
    expect(button(html, '3 pts')).toContain('used');
  });

  it('marks the current value, and keeps it live even if it is the last of its kind', () => {
    const html = renderToStaticMarkup(<ConfidencePicker value={3} offered={[3]} onChange={noop} />);
    expect(button(html, '3 pts')).toContain('aria-checked="true"');
    expect(button(html, '3 pts')).not.toContain(DISABLED);
    expect(button(html, '1 pt')).toContain('aria-checked="false"');
  });

  it('is a phone control: hidden from md up and on paper, with 44px targets', () => {
    const html = renderToStaticMarkup(<ConfidencePicker offered={[1, 3]} onChange={noop} />);
    expect(html).toContain('md:hidden');
    expect(html).toContain('print:!hidden');
    expect(button(html, '1 pt')).toContain('min-h-11');
  });
});
