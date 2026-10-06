import {
  LayoutDashboard,
  Calendar,
  Trophy,
  Grid3X3,
  Heart,
  ClipboardList,
  Settings,
  UserCog
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The app's navigable routes, in sidebar order.
 *
 * One definition drives both the router and the navigation, so a path cannot
 * exist in one and not the other.
 */
export interface NavRoute {
  path: string;
  label: string;
  /** Shown under the icon in the mobile bottom nav, where space is tight. */
  shortLabel: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /**
   * A tab in the phone bottom nav. Everything else lives in its More sheet:
   * eight tabs do not fit in 375px, and the labels ran into each other.
   */
  primaryMobile?: boolean;
}

export const NAV_ROUTES: NavRoute[] = [
  { path: '/', label: 'Dashboard', shortLabel: 'Dashboard', icon: LayoutDashboard, primaryMobile: true },
  { path: '/picks', label: 'Weekly Picks', shortLabel: 'Picks', icon: Calendar, primaryMobile: true },
  { path: '/matrix', label: 'League Matrix', shortLabel: 'Matrix', icon: Grid3X3, primaryMobile: true },
  { path: '/affinity', label: 'Team Affinity', shortLabel: 'Affinity', icon: Heart },
  { path: '/standings', label: 'Standings', shortLabel: 'Standings', icon: Trophy, primaryMobile: true },
  { path: '/history', label: 'My History', shortLabel: 'History', icon: ClipboardList },
  { path: '/settings', label: 'Settings', shortLabel: 'Settings', icon: UserCog },
  { path: '/admin', label: 'Admin Panel', shortLabel: 'Admin', icon: Settings, adminOnly: true }
];

/**
 * The routes a member can see, split for the phone nav: four tabs, and the rest
 * behind More. Admin-only routes are dropped for everyone else.
 */
export function splitNavRoutes(isAdmin: boolean): { primary: NavRoute[]; more: NavRoute[] } {
  const visible = NAV_ROUTES.filter(r => !r.adminOnly || isAdmin);
  return {
    primary: visible.filter(r => r.primaryMobile),
    more: visible.filter(r => !r.primaryMobile)
  };
}

/** Whether `pathname` is `route` itself or a page beneath it. */
export function isRouteActive(route: NavRoute, pathname: string): boolean {
  return pathname === route.path || (route.path !== '/' && pathname.startsWith(route.path + '/'));
}

/** Routes rendered outside the authenticated shell. */
export const PUBLIC_ROUTES = {
  login: '/login',
  authCallback: '/auth/callback'
} as const;
