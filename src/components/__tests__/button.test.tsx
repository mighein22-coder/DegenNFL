import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../Button';

/**
 * `Button` used to spread its props AFTER `disabled={isLoading || props.disabled}`,
 * so any `disabled` a caller passed — including `false` — overwrote the loading
 * lock. The pick sheet's Save button passes `disabled={!dirty}`, and a save is
 * dirty by definition, so during a save the button was tappable and a thumb
 * double-tap sent it twice.
 *
 * Markup is what is asserted: a `disabled` attribute on the element.
 */
const isDisabled = (html: string) => /<button[^>]*\sdisabled(=""|\s|>)/.test(html);

describe('Button disabled state', () => {
  it('is enabled by default', () => {
    expect(isDisabled(renderToStaticMarkup(<Button>Save</Button>))).toBe(false);
  });

  it('is disabled when asked to be', () => {
    expect(isDisabled(renderToStaticMarkup(<Button disabled>Save</Button>))).toBe(true);
  });

  it('is disabled while loading', () => {
    expect(isDisabled(renderToStaticMarkup(<Button isLoading>Save</Button>))).toBe(true);
  });

  it('stays disabled while loading even when the caller passes disabled={false}', () => {
    const html = renderToStaticMarkup(
      <Button isLoading disabled={false}>
        Save
      </Button>
    );
    expect(isDisabled(html)).toBe(true);
  });
});
