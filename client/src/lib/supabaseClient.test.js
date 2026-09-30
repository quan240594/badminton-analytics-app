import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('supabaseClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('logs an error and still exports a usable client when env vars are missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { supabase } = await import('./supabaseClient.js');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Missing VITE_SUPABASE_URL'));
    expect(supabase).toBeDefined();
  });
});
