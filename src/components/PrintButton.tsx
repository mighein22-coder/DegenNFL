import React from 'react';
import { Printer } from 'lucide-react';
import { Button } from './Button';

/**
 * Hands the current screen to the browser's print dialog.
 *
 * `window.print()` IS the normal Windows printing interface: it opens the
 * browser preview, which hands off to the Windows printer dialog and offers
 * Microsoft Print to PDF alongside real printers. A web page cannot skip the
 * preview or call the Windows dialog directly, so there is nothing more native
 * available and no library worth adding — what gets printed is decided
 * entirely by `src/styles/print.css` and the `print:` utilities on the screen.
 *
 * It hides itself on paper. Every call site would otherwise have to remember
 * to, and a printed page with a Print button on it is the tell that one
 * forgot.
 */
export const PrintButton: React.FC<{ label?: string }> = ({ label = 'Print' }) => (
  <Button
    variant="secondary"
    size="sm"
    className="gap-2 print:hidden"
    onClick={() => window.print()}
  >
    <Printer size={16} aria-hidden />
    {label}
  </Button>
);
