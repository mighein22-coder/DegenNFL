import { describe, expect, it } from 'vitest';
import { NAV_ROUTES, isRouteActive, splitNavRoutes } from '../../routes';

describe('splitNavRoutes', () => {
  it('shows four tabs to a member and puts every other route behind More', () => {
    const { primary, more } = splitNavRoutes(false);
    expect(primary.map(r => r.path)).toEqual(['/', '/picks', '/matrix', '/standings']);
    expect(more.map(r => r.path)).toEqual(['/affinity', '/history', '/settings']);
  });

  it('adds Admin to More for an admin, never to the tabs', () => {
    const { primary, more } = splitNavRoutes(true);
    expect(primary).toHaveLength(4);
    expect(more.map(r => r.path)).toContain('/admin');
  });

  it('leaves no route unreachable: tabs plus More are exactly the visible routes', () => {
    for (const isAdmin of [false, true]) {
      const { primary, more } = splitNavRoutes(isAdmin);
      const visible = NAV_ROUTES.filter(r => !r.adminOnly || isAdmin);
      expect([...primary, ...more].map(r => r.path).sort()).toEqual(
        visible.map(r => r.path).sort()
      );
    }
  });
});

describe('isRouteActive', () => {
  const settings = NAV_ROUTES.find(r => r.path === '/settings')!;
  const dashboard = NAV_ROUTES.find(r => r.path === '/')!;

  it('matches the route and pages beneath it, not a path that merely shares a prefix', () => {
    expect(isRouteActive(settings, '/settings')).toBe(true);
    expect(isRouteActive(settings, '/settings/password')).toBe(true);
    expect(isRouteActive(settings, '/settings-old')).toBe(false);
  });

  it('does not treat every path as beneath the dashboard', () => {
    expect(isRouteActive(dashboard, '/')).toBe(true);
    expect(isRouteActive(dashboard, '/picks')).toBe(false);
  });
});
