import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { isAuthCallback } from './lib/authRedirect';
import { supabase } from './lib/supabase';
import { useAuth } from './hooks/useAuth';
import { Sidebar } from './components/layout/Sidebar';
import { PUBLIC_ROUTES } from './routes';

import { LoginView } from './components/views/LoginView';
import { AuthCallbackView } from './components/views/AuthCallbackView';
import { DashboardView } from './components/views/DashboardView';
import { StandingsView } from './components/views/StandingsView';
import { ResultsView } from './components/views/ResultsView';
import { TeamStatsView } from './components/views/TeamStatsView';
import { MyHistoryView } from './components/views/MyHistoryView';
import { SettingsView } from './components/views/SettingsView';
import { AdminView } from './components/views/AdminView';
import { ViewStub } from './components/views/ViewStub';

/**
 * App shell: auth gate, routing, and the layout chrome. Nothing else.
 *
 * Views are driven by the URL, so every screen is linkable and the back button
 * works. `/auth/callback` is a real route rather than something the SPA
 * fallback swallows — password reset links dead-ended in the NHL app until it
 * was made one.
 */
const App: React.FC = () => {
  const { user, profile, loading } = useAuth();
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
        <Route path={PUBLIC_ROUTES.login} element={<LoginView onLogin={signIn} />} />
        <Route path="*" element={<Navigate to={PUBLIC_ROUTES.login} replace />} />
      </Routes>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar profile={profile} onSignOut={signOut} />

      <main className="flex-1 p-4 pb-20 md:p-8 md:pb-8">
        <Routes>
          <Route path="/" element={<DashboardView />} />
          <Route
            path="/picks"
            element={
              /* PicksView needs a week, its games and the member's picks. Wiring
                 that up is the next task — see TASKS.md. The component itself
                 carries the per-game locking model. */
              <ViewStub
                title="Weekly Picks"
                summary="Pick five games against the spread, ranked 1-5."
                needs={[
                  'Load the current week (getCurrentWeek), its games (getGamesForWeek) and the member’s picks (getPicksForWeek), then render the existing PicksView with them.',
                  'Wire onSave to savePicks() — it sends only the unlocked picks; save_picks preserves the locked ones.',
                  'Build the confidence selector described in the TODO inside PicksView.tsx.'
                ]}
              />
            }
          />
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
