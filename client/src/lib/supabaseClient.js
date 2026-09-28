import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fails fast with a clear cause instead of every auth call rejecting with an opaque network error.
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY - see client/.env.example.');
}

// Single shared client: supabase-js persists the session in localStorage itself,
// so one instance per tab is all auth state needs (no server-side sessions here).
export const supabase = createClient(url ?? '', anonKey ?? '');
