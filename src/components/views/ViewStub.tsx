import React from 'react';
import { Construction } from 'lucide-react';

/**
 * Placeholder for a screen that has not been built yet.
 *
 * This repo is a scaffold: the schema, the scoring, the locking and the design
 * system are real and tested, but most screens are not written. Rather than
 * ship ten empty files that look finished, each unbuilt view renders this and
 * states plainly what it still needs.
 *
 * Delete this component once the last view is real.
 */
interface ViewStubProps {
  title: string;
  /** What this screen is for, in a sentence. */
  summary: string;
  /** What building it actually requires. Be specific — this is the handoff. */
  needs: string[];
}

export const ViewStub: React.FC<ViewStubProps> = ({ title, summary, needs }) => (
  <section className="mx-auto max-w-2xl">
    <header className="mb-6">
      <h1 className="font-display text-4xl tracking-wide text-ink">{title}</h1>
      <p className="mt-2 text-muted">{summary}</p>
    </header>

    <div className="rounded-card border border-line bg-surface p-6">
      <p className="mb-4 flex items-center gap-2 font-display text-lg tracking-wide text-brand-400">
        <Construction size={20} aria-hidden />
        Not built yet
      </p>
      <ul className="space-y-2 text-sm text-muted">
        {needs.map(need => (
          <li key={need} className="flex gap-2">
            <span aria-hidden className="text-faint">
              &bull;
            </span>
            {need}
          </li>
        ))}
      </ul>
    </div>
  </section>
);
