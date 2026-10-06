import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Ellipsis, LogOut } from 'lucide-react';
import { NAV_ROUTES, isRouteActive, splitNavRoutes } from '../../routes';
import type { Profile } from '../../lib/supabase';

interface SidebarProps {
  profile: Profile | null;
  onSignOut: () => void;
}

/**
 * Desktop sidebar and mobile bottom nav, both driven by NAV_ROUTES so a screen
 * cannot exist in the router and not the navigation.
 *
 * The phone nav is four tabs plus a More sheet that holds the rest and Sign
 * out, which has no other way onto a phone.
 */
export const Sidebar: React.FC<SidebarProps> = ({ profile, onSignOut }) => {
  const isAdmin = profile?.role === 'admin';
  const routes = NAV_ROUTES.filter(r => !r.adminOnly || isAdmin);
  const { primary, more } = splitNavRoutes(isAdmin);

  // The More sheet closes on any navigation and on Escape, so it never sits
  // open over the page it just took you to.
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMoreOpen(false), [pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);
  // More lights up on a page that lives inside it.
  const moreActive = more.some(route => isRouteActive(route, pathname));

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    [
      'flex items-center gap-3 rounded-control px-3 py-2 text-sm transition-colors short:justify-center short:px-0',
      isActive ? 'bg-brand-900/50 text-ink' : 'text-muted hover:bg-surface hover:text-ink'
    ].join(' ');

  return (
    <>
      {/* Desktop. `print:!hidden` carries the important marker deliberately:
          a printed page is wider than the md breakpoint, so `md:flex` is live
          at print time and the two variants would otherwise be a coin toss.

          `short:` (index.css) is a phone turned sideways: wide enough to reach
          md, but under 30rem tall. The 14rem rail would take a quarter of the
          screen there, so it shrinks to an icon rail; the labels stay as
          tooltips and for screen readers. A laptop is never that short. */}
      <nav className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface-sunken p-4 md:flex short:w-14 short:p-2 print:!hidden">
        <div className="mb-6 px-3 short:hidden">
          <span className="font-display text-2xl tracking-wide text-brand-400">
            DegenNFL
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-1">
          {routes.map(route => (
            <NavLink
              key={route.path}
              to={route.path}
              end={route.path === '/'}
              className={linkClass}
              title={route.label}
            >
              <route.icon size={18} aria-hidden />
              <span className="short:sr-only">{route.label}</span>
            </NavLink>
          ))}
        </div>

        {profile && (
          <div className="mt-4 border-t border-line pt-4 short:mt-2 short:pt-2">
            <p className="truncate px-3 text-sm text-ink short:hidden">{profile.name}</p>
            <button
              type="button"
              onClick={onSignOut}
              title="Sign out"
              className="mt-1 flex w-full items-center gap-3 rounded-control px-3 py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-ink short:justify-center short:px-0"
            >
              <LogOut size={18} aria-hidden />
              <span className="short:sr-only">Sign out</span>
            </button>
          </div>
        )}
      </nav>

      {/* Mobile. The sheet and the bar share one height (`3.5rem` tabs plus the
          1px border, plus the home-bar inset); the sheet, the page's bottom
          padding in App.tsx and PwaNotices all clear it by that amount. */}
      {moreOpen && (
        <div className="fixed inset-0 z-20 md:hidden print:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            id="more-menu"
            role="menu"
            onClick={e => e.stopPropagation()}
            className="absolute bottom-[calc(3.75rem+env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] rounded-card border border-line bg-surface-raised p-2 shadow-card"
          >
            {more.map(route => (
              <NavLink
                key={route.path}
                to={route.path}
                role="menuitem"
                className={({ isActive }) =>
                  [
                    'flex min-h-12 items-center gap-3 rounded-control px-4 text-base font-medium transition-colors',
                    isActive ? 'bg-brand-900/50 text-ink' : 'text-muted active:bg-surface'
                  ].join(' ')
                }
              >
                <route.icon size={20} aria-hidden />
                {route.label}
              </NavLink>
            ))}
            <div className="my-1 border-t border-line" />
            <button
              type="button"
              role="menuitem"
              onClick={onSignOut}
              className="flex min-h-12 w-full items-center gap-3 rounded-control px-4 text-base font-medium text-muted transition-colors active:bg-surface"
            >
              <LogOut size={20} aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-line bg-surface-sunken pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:hidden print:hidden">
        {primary.map(route => (
          <NavLink
            key={route.path}
            to={route.path}
            end={route.path === '/'}
            className={({ isActive }) =>
              [
                'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] transition-colors',
                isActive ? 'text-brand-400' : 'text-muted'
              ].join(' ')
            }
          >
            <route.icon size={20} aria-hidden />
            {route.shortLabel}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(open => !open)}
          aria-expanded={moreOpen}
          aria-controls="more-menu"
          className={[
            'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] transition-colors',
            moreOpen || moreActive ? 'text-brand-400' : 'text-muted'
          ].join(' ')}
        >
          <Ellipsis size={20} aria-hidden />
          More
        </button>
      </nav>
    </>
  );
};
