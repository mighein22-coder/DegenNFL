import React from 'react';
import { NavLink } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { NAV_ROUTES } from '../../routes';
import type { Profile } from '../../lib/supabase';

interface SidebarProps {
  profile: Profile | null;
  onSignOut: () => void;
}

/**
 * Desktop sidebar and mobile bottom nav, both driven by NAV_ROUTES so a screen
 * cannot exist in the router and not the navigation.
 */
export const Sidebar: React.FC<SidebarProps> = ({ profile, onSignOut }) => {
  const routes = NAV_ROUTES.filter(r => !r.adminOnly || profile?.role === 'admin');

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    [
      'flex items-center gap-3 rounded-control px-3 py-2 text-sm transition-colors',
      isActive ? 'bg-brand-900/50 text-ink' : 'text-muted hover:bg-surface hover:text-ink'
    ].join(' ');

  return (
    <>
      {/* Desktop. `print:!hidden` carries the important marker deliberately:
          a printed page is wider than the md breakpoint, so `md:flex` is live
          at print time and the two variants would otherwise be a coin toss. */}
      <nav className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface-sunken p-4 md:flex print:!hidden">
        <div className="mb-6 px-3">
          <span className="font-display text-2xl tracking-wide text-brand-400">
            DegenNFL
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-1">
          {routes.map(route => (
            <NavLink key={route.path} to={route.path} end={route.path === '/'} className={linkClass}>
              <route.icon size={18} aria-hidden />
              {route.label}
            </NavLink>
          ))}
        </div>

        {profile && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="truncate px-3 text-sm text-ink">{profile.name}</p>
            <button
              type="button"
              onClick={onSignOut}
              className="mt-1 flex w-full items-center gap-3 rounded-control px-3 py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <LogOut size={18} aria-hidden />
              Sign out
            </button>
          </div>
        )}
      </nav>

      {/* Mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-line bg-surface-sunken md:hidden print:hidden">
        {routes.map(route => (
          <NavLink
            key={route.path}
            to={route.path}
            end={route.path === '/'}
            className={({ isActive }) =>
              [
                'flex flex-1 flex-col items-center gap-1 py-2 text-[11px] transition-colors',
                isActive ? 'text-brand-400' : 'text-muted'
              ].join(' ')
            }
          >
            <route.icon size={20} aria-hidden />
            {route.shortLabel}
          </NavLink>
        ))}
      </nav>
    </>
  );
};
