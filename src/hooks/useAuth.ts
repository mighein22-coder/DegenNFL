import { useEffect, useState } from 'react';
import { supabase, type Profile } from '../lib/supabase';
import { redeemInvite } from '../lib/supabaseService';
import type { User } from '@supabase/supabase-js';

/**
 * Authentication hook for managing user sessions with Supabase
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  /**
   * Load user profile from database
   */
  async function loadProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      // A signed-in user with no profile row is a NORMAL state since 0003:
      // they have confirmed an email but not yet redeemed an invite. maybeSingle
      // returns null rather than erroring, and the app shows them the redeem
      // screen. Treating it as an error here is what would strand them.
      if (error) throw error;
      setProfile((data as Profile | null) ?? null);
    } catch (error) {
      console.error('Error loading profile:', error);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Sign in with email and password
   */
  const signIn = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password
      });

      if (error) throw error;
      return data;
    } catch (error: any) {
      throw new Error(error.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Sign out current user
   */
  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error: any) {
      throw new Error(error.message || 'Logout failed');
    }
  };

  /**
   * Sign up, gated by an invite code.
   *
   * Two steps, and they cannot be collapsed into one:
   *
   *   1. `auth.signUp` creates the auth user. This is Supabase's own endpoint
   *      and we cannot gate it — anyone with the public anon key can call it.
   *   2. `redeem_invite` creates the PROFILE, and a profile is what membership
   *      actually is. That step needs a valid code.
   *
   * An auth user with no profile can see nothing and pick nothing: picks are
   * foreign-keyed to profiles, so the database refuses. That is the gate.
   *
   * If the project requires email confirmation, step 1 returns no session, so
   * step 2 cannot run yet — there is no auth.uid() to attach the profile to.
   * `needsConfirmation` says so, and the redeem screen picks it up after they
   * confirm and sign in. This used to insert the profile row directly, which
   * is precisely the hole 0003 closes.
   */
  const signUp = async (
    email: string,
    password: string,
    name: string,
    inviteCode: string
  ): Promise<{ needsConfirmation: boolean }> => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password
      });

      if (error) throw error;
      if (!data.user) throw new Error('User creation failed');

      // No session means the address needs confirming first. Redemption waits.
      if (!data.session) return { needsConfirmation: true };

      await redeemInvite(inviteCode, name);
      await loadProfile(data.user.id);
      return { needsConfirmation: false };
    } catch (error: any) {
      throw new Error(error.message || 'Signup failed');
    }
  };

  /**
   * Redeem an invite for a user who is already signed in without a profile —
   * after confirming an email, or after mistyping the code at signup.
   */
  const redeem = async (inviteCode: string, name: string) => {
    if (!user) throw new Error('Not signed in');
    await redeemInvite(inviteCode, name);
    await loadProfile(user.id);
  };

  /**
   * Re-read the current user's profile from the database. Call after a profile
   * update so the sidebar/dashboard pick up the new name or avatar immediately.
   */
  const refreshProfile = async () => {
    if (!user) return;
    await loadProfile(user.id);
  };

  return {
    user,
    profile,
    loading,
    signIn,
    signOut,
    signUp,
    redeem,
    refreshProfile,
    isAuthenticated: !!user,
    isAdmin: profile?.role === 'admin'
  };
}
