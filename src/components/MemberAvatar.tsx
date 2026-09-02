import React from 'react';

/**
 * A member's mark, next to their name.
 *
 * `profiles.avatar` is free text and is null for everybody who has not set one
 * — nothing in signup or `redeem_invite` fills it. So the fallback is not an
 * edge case, it is the normal case, and it has to look deliberate: the
 * member's initials on a tint derived from their own name, which is stable
 * across sessions and distinct enough at a glance to scan a standings table by.
 */
interface MemberAvatarProps {
  name: string;
  /** Whatever the member put in the field — an emoji, initials, a short word. */
  avatar?: string | null;
  size?: 'sm' | 'md';
}

/** Stable hue from a name. Not a design token: it identifies a person, not a state. */
function hueFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360;
  }
  return hash;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const MemberAvatar: React.FC<MemberAvatarProps> = ({ name, avatar, size = 'md' }) => {
  const label = avatar?.trim() || initials(name);
  const dimensions = size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm';

  return (
    <span
      aria-hidden
      className={`${dimensions} flex shrink-0 items-center justify-center rounded-full font-display tracking-wide text-ink`}
      style={{ backgroundColor: `oklch(0.4 0.08 ${hueFor(name)})` }}
    >
      {label}
    </span>
  );
};
