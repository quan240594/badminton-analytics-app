import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fails fast with a clear cause instead of every auth call rejecting with an opaque network error.
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY - see client/.env.example.');
}

// supabase-js validates the URL eagerly and throws at import time on an empty
// string, which would crash every test/CI run that doesn't inject real env vars
// (e.g. a coverage step with no VITE_SUPABASE_* secrets) - fall back to an inert
// placeholder so import always succeeds; only real network calls would fail.
// Single shared client: supabase-js persists the session in localStorage itself,
// so one instance per tab is all auth state needs (no server-side sessions here).
export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder-anon-key');
