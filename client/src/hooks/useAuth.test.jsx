import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './useAuth.jsx';

const mockSubscription = { unsubscribe: vi.fn() };

vi.mock('../lib/supabaseClient.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: mockSubscription } })),
      signUp: vi.fn(),
      verifyOtp: vi.fn(),
      resend: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

import { supabase } from '../lib/supabaseClient.js';

function renderUseAuth() {
  return renderHook(() => useAuth(), { wrapper: AuthProvider });
}

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
  });

  it('throws when used outside AuthProvider', () => {
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within an AuthProvider');
  });

  it('starts in a loading state and resolves once the session lookup finishes', async () => {
    const { result } = renderUseAuth();

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
    expect(result.current.user).toBeNull();
  });

  it('exposes the resolved session and derived user', async () => {
    const session = { user: { id: 'u1', email: 'player@example.com' } };
    supabase.auth.getSession.mockResolvedValue({ data: { session } });

    const { result } = renderUseAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.session).toEqual(session);
    expect(result.current.user).toEqual(session.user);
  });

  it('delegates signUp to supabase.auth.signUp', async () => {
    supabase.auth.signUp.mockResolvedValue({ data: {}, error: null });
    const { result } = renderUseAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.signUp('a@b.com', 'password123');
    expect(supabase.auth.signUp).toHaveBeenCalledWith({ email: 'a@b.com', password: 'password123' });
  });

  it('verifies the signup code with type "signup"', async () => {
    supabase.auth.verifyOtp.mockResolvedValue({ data: {}, error: null });
    const { result } = renderUseAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.verifySignupCode('a@b.com', '123456');
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ email: 'a@b.com', token: '123456', type: 'signup' });
  });

  it('delegates signIn and signOut', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    supabase.auth.signOut.mockResolvedValue({ error: null });
    const { result } = renderUseAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.signIn('a@b.com', 'password123');
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.com', password: 'password123' });

    await result.current.signOut();
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });
});
