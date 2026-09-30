import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';

const AuthContext = createContext(null);

// Wraps supabase-js auth so the rest of the app only deals with a plain
// session/user + a handful of action functions, never the SDK directly.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    }).catch(() => setLoading(false));

    // Keeps state in sync with token refreshes, sign-outs in other tabs, etc.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const signUp = (email, password) => supabase.auth.signUp({ email, password });

  // type: 'signup' matches the confirmation flow started by signUp() above.
  const verifySignupCode = (email, code) =>
    supabase.auth.verifyOtp({ email, token: code, type: 'signup' });

  const resendSignupCode = (email) => supabase.auth.resend({ type: 'signup', email });

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password });

  const signOut = () => supabase.auth.signOut();

  const updatePassword = (password) => supabase.auth.updateUser({ password });

  // app_metadata (unlike user_metadata) can only be written by the service-role
  // key (see scripts/admin/set-admin-role.mjs), never by the user themselves -
  // safe to trust client-side for gating the admin-only "Fetch data" controls.
  const isAdmin = session?.user?.app_metadata?.role === 'admin';

  // Memoized so consumers don't re-render on every AuthProvider render - only
  // when session/loading actually change (the action functions are stable).
  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      isAdmin,
      loading,
      signUp,
      verifySignupCode,
      resendSignupCode,
      signIn,
      signOut,
      updatePassword,
    }),
    [session, loading, isAdmin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
