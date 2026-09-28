import { createContext, useContext, useEffect, useState } from 'react';
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
    });

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

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    signUp,
    verifySignupCode,
    resendSignupCode,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
