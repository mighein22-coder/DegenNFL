import { useEffect, useState } from 'react';
import { supabase, type Profile } from '../lib/supabase';
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
        .single();

      if (error) throw error;
      setProfile(data);
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
   * Sign up new user (admin only in production)
   */
  const signUp = async (email: string, password: string, name: string) => {
    try {
      // Create auth user
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password
      });

      if (error) throw error;
      if (!data.user) throw new Error('User creation failed');

      // Create profile. `role` is deliberately not sent: clients have no INSERT
      // privilege on that column (see migration 0002), so it falls through to
      // its DEFAULT of 'member'. Sending it would fail the insert outright.
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: data.user.id,
          email: email.trim().toLowerCase(),
          name: name.trim()
        });

      if (profileError) throw profileError;

      return data;
    } catch (error: any) {
      throw new Error(error.message || 'Signup failed');
    }
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
    refreshProfile,
    isAuthenticated: !!user,
    isAdmin: profile?.role === 'admin'
  };
}
