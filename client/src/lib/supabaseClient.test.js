import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('supabaseClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  // First import of supabase-js is slow on a loaded machine, hence the longer timeout.
  it.each([
    ['missing', '', '', true],
    ['present', 'https://example.supabase.co', 'anon-key', false],
  ])('exports a usable client when env vars are %s, logging an error only if missing', async (_state, url, key, logsError) => {
    vi.stubEnv('VITE_SUPABASE_URL', url);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', key);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { supabase } = await import('./supabaseClient.js');

    expect(supabase).toBeDefined();
    if (logsError) expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Missing VITE_SUPABASE_URL'));
    else expect(errorSpy).not.toHaveBeenCalled();
  }, 20000);
});
