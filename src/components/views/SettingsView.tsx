import React, { useState } from 'react';
import { Button } from '../Button';
import { PageHeader } from '../Page';
import { MemberAvatar } from '../MemberAvatar';
import { updatePassword, updateProfile } from '../../lib/supabaseService';
import type { Profile } from '../../lib/supabase';

/**
 * Name, avatar, password.
 *
 * WHAT IS NOT ON THIS SCREEN IS THE INTERESTING PART. `role` is shown and not
 * editable, and that is not a UI decision that could be worked around: the
 * column grant in 0001_init.sql names `name`, `avatar` and `updated_at`, and
 * `role` is absent from it. A member who sent the column anyway would be
 * refused by Postgres, not by this form. The NHL app's equivalent screen was
 * the reason that grant is column-scoped at all.
 *
 * Email is likewise read-only here. It lives in `auth.users` and identifies the
 * account; changing it is an auth flow with a confirmation link, not a text
 * field, and there is nothing worth half-building.
 *
 * The two forms save independently. A failed password change must not discard a
 * name the member already typed, and a shared submit button would do exactly
 * that.
 */

interface SettingsViewProps {
  profile: Profile;
  /** Re-reads the profile so the sidebar picks up a new name immediately. */
  onProfileUpdated: () => Promise<void> | void;
}

/** Supabase's own default minimum. Stated here so the form can say so first. */
const MIN_PASSWORD_LENGTH = 6;

export const SettingsView: React.FC<SettingsViewProps> = ({
  profile,
  onProfileUpdated
}) => (
  <section className="mx-auto max-w-2xl">
    <PageHeader
      title="Settings"
      subtitle="Your name, your avatar and your password."
    />

    <ProfileForm profile={profile} onProfileUpdated={onProfileUpdated} />
    <PasswordForm />

    <div className="mt-6 rounded-card border border-line bg-surface p-6 text-sm text-muted">
      <p>
        Signed in as <span className="text-ink">{profile.email}</span>, as{' '}
        <span className="text-ink">{profile.role}</span>.
      </p>
      <p className="mt-2 text-faint">
        Neither is editable here. Your role is not a column a member may write —
        the database grant does not include it — and your email identifies the
        account itself.
      </p>
    </div>
  </section>
);

const ProfileForm: React.FC<SettingsViewProps> = ({ profile, onProfileUpdated }) => {
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatar ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const trimmedName = name.trim();
  const trimmedAvatar = avatar.trim();
  const changed =
    trimmedName !== profile.name || trimmedAvatar !== (profile.avatar ?? '');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmedName) {
      setError('A name is required — it is what the standings show.');
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateProfile(profile.id, {
        name: trimmedName,
        // Empty means 'no avatar', which is null in the column rather than ''.
        avatar: trimmedAvatar === '' ? null : trimmedAvatar
      });
      await onProfileUpdated();
      setSaved(true);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-card border border-line bg-surface p-6">
      <h2 className="font-display text-xl tracking-wide text-ink">Profile</h2>
      <p className="mt-1 text-sm text-muted">
        Your name is what every other member sees in the standings and the matrix.
      </p>

      <div className="mt-5 flex items-center gap-4">
        <MemberAvatar name={trimmedName || profile.name} avatar={trimmedAvatar} />
        <p className="text-sm text-faint">
          Leave the avatar blank and your initials are used.
        </p>
      </div>

      <label className="mt-5 block">
        <span className="text-sm text-muted">Name</span>
        <input
          type="text"
          value={name}
          maxLength={40}
          onChange={event => setName(event.target.value)}
          className="mt-1.5 w-full rounded-control border border-line bg-surface-sunken px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </label>

      <label className="mt-4 block">
        <span className="text-sm text-muted">Avatar</span>
        <input
          type="text"
          value={avatar}
          maxLength={4}
          placeholder="An emoji, or two letters"
          onChange={event => setAvatar(event.target.value)}
          className="mt-1.5 w-full rounded-control border border-line bg-surface-sunken px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </label>

      {error && <p className="mt-4 text-sm text-loss">{error}</p>}
      {saved && !error && <p className="mt-4 text-sm text-win">Saved.</p>}

      <Button type="submit" className="mt-5" isLoading={saving} disabled={!changed}>
        Save profile
      </Button>
    </form>
  );
};

const PasswordForm: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    // Checked here so the mismatch is caught before the request rather than
    // after a successful change of the wrong password.
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updatePassword(password);
      setPassword('');
      setConfirm('');
      setSaved(true);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-card border border-line bg-surface p-6"
    >
      <h2 className="font-display text-xl tracking-wide text-ink">Password</h2>
      <p className="mt-1 text-sm text-muted">
        Changes immediately, on this session. You stay signed in here.
      </p>

      <label className="mt-5 block">
        <span className="text-sm text-muted">New password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          className="mt-1.5 w-full rounded-control border border-line bg-surface-sunken px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </label>

      <label className="mt-4 block">
        <span className="text-sm text-muted">Confirm</span>
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={event => setConfirm(event.target.value)}
          className="mt-1.5 w-full rounded-control border border-line bg-surface-sunken px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </label>

      {error && <p className="mt-4 text-sm text-loss">{error}</p>}
      {saved && !error && <p className="mt-4 text-sm text-win">Password changed.</p>}

      <Button
        type="submit"
        className="mt-5"
        isLoading={saving}
        disabled={password === '' || confirm === ''}
      >
        Change password
      </Button>
    </form>
  );
};
