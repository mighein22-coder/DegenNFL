import React from 'react';
import { Button } from './Button';

/**
 * The chrome every data screen shares: a heading, a load failure, a wait.
 *
 * Small on purpose. The point is not to abstract the screens — it is that a
 * failed load looked different on every screen that hand-rolled one, and the
 * heading vanished on the ones that returned early, so a member who lost their
 * connection could not tell which page they were on.
 */

interface PageHeaderProps {
  title: string;
  /** One line saying what this screen is for, or where the week stands. */
  subtitle?: React.ReactNode;
  /** Controls that belong beside the title — a week or segment selector. */
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions }) => (
  <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 className="font-display text-4xl tracking-wide text-ink">{title}</h1>
      {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

interface ErrorNoteProps {
  /** What failed, in the app's words. */
  message: string;
  /** The underlying message, shown verbatim — it is usually the useful part. */
  detail?: string | null;
  onRetry?: () => void;
}

export const ErrorNote: React.FC<ErrorNoteProps> = ({ message, detail, onRetry }) => (
  <div className="rounded-card border border-loss bg-surface-sunken p-6">
    <p className="text-ink">{message}</p>
    {detail && <p className="mt-2 font-mono text-sm text-faint">{detail}</p>}
    {onRetry && (
      <Button variant="secondary" className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    )}
  </div>
);

export const LoadingNote: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <p className="text-muted">{label}</p>
);

/** A neutral panel for a state that is not an error — an empty week, no history yet. */
export const EmptyNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-card border border-line bg-surface-sunken p-6 text-muted">
    {children}
  </div>
);
