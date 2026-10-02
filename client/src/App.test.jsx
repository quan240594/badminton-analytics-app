import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from './App.jsx';

const signOut = vi.fn();
let mockAuth = { session: null, loading: true, signOut };

vi.mock('./hooks/useAuth.jsx', () => ({ useAuth: () => mockAuth }));
vi.mock('./pages/MatchSimulator.jsx', () => ({ default: () => <div>Match Simulator page</div> }));
vi.mock('./pages/LeagueDaySimulator.jsx', () => ({ default: () => <div>League Day page</div> }));
vi.mock('./pages/Login.jsx', () => ({ default: () => <div>Login page</div> }));
vi.mock('./pages/Register.jsx', () => ({ default: () => <div>Register page</div> }));
vi.mock('./pages/VerifyEmail.jsx', () => ({ default: () => <div>Verify page</div> }));
vi.mock('./pages/Account.jsx', () => ({ default: () => <div>Account page</div> }));

const SIGNED_IN = { session: { user: { email: 'a@b.com' } }, loading: false, signOut };

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

  it.each([
    ['#/register', 'Register page'],
    ['#/verify-email?email=a%40b.com', 'Verify page'],
  ])('renders the auth page for %s when signed out', (hash, text) => {
    mockAuth = { session: null, loading: false, signOut };
    window.location.hash = hash;
    render(<App />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it.each([
    ['#/league-day', 'League Day page', 'League Day Simulator'],
    ['#/nowhere', 'Match Simulator page', 'Match Simulator'],
  ])('renders %s with its nav tab marked active', (hash, text, tab) => {
    mockAuth = SIGNED_IN;
    window.location.hash = hash;
    render(<App />);

    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: tab })).toHaveClass('active');
  });

  it('renders the account page outside the main tabs', () => {
    mockAuth = SIGNED_IN;
    window.location.hash = '#/account';
    render(<App />);

    expect(screen.getByText('Account page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Account' })).toHaveClass('active');
    expect(screen.getByRole('link', { name: 'Match Simulator' })).not.toHaveClass('active');
  });

  it('signs out from the nav', () => {
    mockAuth = SIGNED_IN;
    window.location.hash = '#/';
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for a signed-out user until the redirect to login fires', () => {
    mockAuth = { session: null, loading: false, signOut };
    window.location.hash = '#/league-day';
    const { container } = render(<App />);
    expect(container).toBeEmptyDOMElement();
  });
});
