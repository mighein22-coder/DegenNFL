import React from 'react';

/**
 * The one shared control.
 *
 * Every colour here is a semantic token (`brand`, `surface`, `line`, `loss`)
 * rather than a palette name. That is what lets this file be lifted into
 * FrozenDegenerates unchanged — see src/styles/tokens.shared.css. If you find
 * yourself reaching for `bg-green-500` or a raw hex, add a token instead.
 *
 * The one raw name is `text-white` on the FILLED variants, and it is correct
 * there: it sits on a green or red fill in both display modes. Everywhere else
 * text is `text-ink`, which turns brown-black in light mode — `text-white` on a
 * surface would vanish into it.
 */
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading,
  disabled,
  className = '',
  ...props
}) => {
  const baseStyles =
    'font-display tracking-wider uppercase rounded-control transition-all duration-200 ' +
    'flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ' +
    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-canvas';

  const variants = {
    primary:
      'bg-brand-500 hover:bg-brand-400 text-white shadow-glow focus:ring-brand-500 border border-brand-400/20',
    secondary:
      'bg-surface hover:bg-surface-raised text-ink border border-line focus:ring-brand-500',
    danger: 'bg-loss hover:opacity-90 text-white focus:ring-loss',
    ghost: 'bg-transparent hover:bg-ink/5 text-muted hover:text-ink'
  };

  const sizes = {
    // 44px tall on a phone, the smallest target a thumb hits reliably; the
    // desktop height is untouched.
    sm: 'min-h-11 px-3 py-1.5 text-sm md:min-h-0',
    md: 'min-h-11 px-5 py-2.5 text-base md:min-h-0',
    lg: 'px-8 py-3.5 text-lg font-bold'
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
      // After the spread, and a plain OR: a caller's `disabled={false}` must
      // not switch off the loading lock. (It used to come first, so any passed
      // `disabled` overwrote it and a save button stayed tappable mid-save.)
      disabled={isLoading || disabled}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Loading...
        </span>
      ) : (
        children
      )}
    </button>
  );
};
