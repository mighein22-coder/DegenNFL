import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { isAuthCallback } from './lib/authRedirect';
import { supabase } from './lib/supabase';
import { useAuth } from './hooks/useAuth';
import { Sidebar } from './components/layout/Sidebar';
import { PUBLIC_ROUTES } from './routes';

import { LoginView } from './components/views/LoginView';
import { AuthCallbackView } from './components/views/AuthCallbackView';
import { PicksPage } from './components/views/PicksPage';
import { RedeemInviteView } from './components/views/RedeemInviteView';
import { DashboardView } from './components/views/DashboardView';
import { StandingsView } from './components/views/StandingsView';
import { ResultsView } from './components/views/ResultsView';
import { TeamStatsView } from './components/views/TeamStatsView';
import { MyHistoryView } from './components/views/MyHistoryView';
import { SettingsView } from './components/views/SettingsView';
import { AdminView } from './components/views/AdminView';

/**
 * App shell: auth gate, routing, and the layout chrome. Nothing else.
 *
 * Views are driven by the URL, so every screen is linkable and the back button
 * works. `/auth/callback` is a real route rather than something the SPA
 * fallback swallows — password reset links dead-ended in the NHL app until it
 * was made one.
 */
const App: React.FC = () => {
  const {
    user,
    profile,
    loading,
    profileError,
    pendingRedeemError,
    signUp,
    redeem,
    refreshProfile
  } = useAuth();
  const navigate = useNavigate();

  // Captured at load, before supabase-js erases the URL fragment.
  const [handlingAuthLink, setHandlingAuthLink] = useState(() => isAuthCallback());

  useEffect(() => {
    if (handlingAuthLink && window.location.pathname !== PUBLIC_ROUTES.authCallback) {
      navigate(PUBLIC_ROUTES.authCallback, { replace: true });
    }
  }, [handlingAuthLink, navigate]);

  const finishAuthLink = useCallback(() => {
    setHandlingAuthLink(false);
    // Strip the auth parameters; the gate below then decides where they land.
    window.history.replaceState({}, '', '/');
    navigate('/', { replace: true });
  }, [navigate]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    // LoginView renders the message; rethrow rather than swallowing it.
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    navigate(PUBLIC_ROUTES.login, { replace: true });
  }, [navigate]);

  if (handlingAuthLink) {
    return <AuthCallbackView onDone={finishAuthLink} />;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route
          path={PUBLIC_ROUTES.login}
          element={<LoginView onLogin={signIn} onSignUp={signUp} />}
        />
        <Route path="*" element={<Navigate to={PUBLIC_ROUTES.login} replace />} />
      </Routes>
    );
  }

  // The profile LOOKUP failed — not the same as having no profile. Showing the
  // invite screen here would tell an existing member, on a dropped connection,
  // that they are not in the pool; and their real code would then be refused
  // with "you are already a member", stranding them on it.
  if (profileError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-ink">Could not load your account.</p>
        <p className="max-w-md font-mono text-sm text-faint">{profileError}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => void refreshProfile()}
            className="rounded-control border border-line px-4 py-2 text-ink hover:bg-surface-raised"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={signOut}
            className="rounded-control px-4 py-2 text-muted underline"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // Signed in, but not a member yet: they confirmed an email without redeeming
  // an invite, or mistyped the code. A profile IS membership since 0003, so
  // there is nothing of the pool to show them until they have one. Without
  // this the shell rendered with a null profile and quietly half-worked.
  if (!profile) {
    return (
      <RedeemInviteView
        email={user.email ?? ''}
        initialError={pendingRedeemError}
        onRedeem={redeem}
        onSignOut={signOut}
      />
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar profile={profile} onSignOut={signOut} />

      <main className="flex-1 p-4 pb-20 md:p-8 md:pb-8">
        <Routes>
          <Route path="/" element={<DashboardView />} />
          <Route path="/picks" element={<PicksPage />} />
          <Route path="/matrix" element={<ResultsView />} />
          <Route path="/affinity" element={<TeamStatsView />} />
          <Route path="/standings" element={<StandingsView />} />
          <Route path="/history" element={<MyHistoryView />} />
          <Route path="/settings" element={<SettingsView />} />
          {profile?.role === 'admin' && <Route path="/admin" element={<AdminView />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
