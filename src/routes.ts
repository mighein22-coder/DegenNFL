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
}

export const NAV_ROUTES: NavRoute[] = [
  { path: '/', label: 'Dashboard', shortLabel: 'Dashboard', icon: LayoutDashboard },
  { path: '/picks', label: 'Weekly Picks', shortLabel: 'Picks', icon: Calendar },
  { path: '/matrix', label: 'League Matrix', shortLabel: 'Matrix', icon: Grid3X3 },
  { path: '/affinity', label: 'Team Affinity', shortLabel: 'Affinity', icon: Heart },
  { path: '/standings', label: 'Standings', shortLabel: 'Standings', icon: Trophy },
  { path: '/history', label: 'My History', shortLabel: 'History', icon: ClipboardList },
  { path: '/settings', label: 'Settings', shortLabel: 'Settings', icon: UserCog },
  { path: '/admin', label: 'Admin Panel', shortLabel: 'Admin', icon: Settings, adminOnly: true }
];

/** Routes rendered outside the authenticated shell. */
export const PUBLIC_ROUTES = {
  login: '/login',
  authCallback: '/auth/callback'
} as const;
