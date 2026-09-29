import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';

const signOut = vi.fn();
let mockAuth = { session: null, loading: true, signOut };

vi.mock('./hooks/useAuth.jsx', () => ({ useAuth: () => mockAuth }));
vi.mock('./pages/MatchSimulator.jsx', () => ({ default: () => <div>Match Simulator page</div> }));
vi.mock('./pages/LeagueDaySimulator.jsx', () => ({ default: () => <div>League Day page</div> }));
vi.mock('./pages/Login.jsx', () => ({ default: () => <div>Login page</div> }));
vi.mock('./pages/Register.jsx', () => ({ default: () => <div>Register page</div> }));
vi.mock('./pages/VerifyEmail.jsx', () => ({ default: () => <div>Verify page</div> }));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '';
  });

  it('renders nothing while the session is loading', () => {
    mockAuth = { session: null, loading: true, signOut };
    const { container } = render(<App />);
    expect(container).toBeEmptyDOMElement();
  });

  it('redirects a signed-out user away from a protected page', async () => {
    mockAuth = { session: null, loading: false, signOut };
    window.location.hash = '#/';
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe('#/login'));
  });

  it('renders the matching auth page for a signed-out user', () => {
    mockAuth = { session: null, loading: false, signOut };
    window.location.hash = '#/login';
    render(<App />);
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('redirects a signed-in user away from an auth page', async () => {
    mockAuth = { session: { user: { email: 'a@b.com' } }, loading: false, signOut };
    window.location.hash = '#/login';
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe('#/'));
  });

  it('renders the main app with nav and logout for a signed-in user', () => {
    mockAuth = { session: { user: { email: 'a@b.com' } }, loading: false, signOut };
    window.location.hash = '#/';
    render(<App />);
    expect(screen.getByText('Match Simulator page')).toBeInTheDocument();
    expect(screen.getByText('a@b.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });
});
