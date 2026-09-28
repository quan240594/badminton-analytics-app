import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Login from './Login.jsx';

const signIn = vi.fn();
vi.mock('../hooks/useAuth.jsx', () => ({ useAuth: () => ({ signIn }) }));

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '';
  });

  it('redirects to the app on successful login', async () => {
    signIn.mockResolvedValue({ error: null });
    render(<Login />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(window.location.hash).toBe('#/'));
  });

  it('redirects to verify-email when the account is not yet confirmed', async () => {
    signIn.mockResolvedValue({ error: { message: 'Email not confirmed' } });
    render(<Login />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(window.location.hash).toBe('#/verify-email?email=a%40b.com'));
  });

  it('shows other errors inline without redirecting', async () => {
    signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    render(<Login />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });
});
