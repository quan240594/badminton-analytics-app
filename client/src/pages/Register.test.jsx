import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Register from './Register.jsx';

const signUp = vi.fn();
vi.mock('../hooks/useAuth.jsx', () => ({ useAuth: () => ({ signUp }) }));

describe('Register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '';
  });

  it('rejects mismatched passwords without calling signUp', async () => {
    render(<Register />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it('rejects a password shorter than 8 characters without calling signUp', async () => {
    render(<Register />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });

    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form'));

    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it('signs up and redirects to the verify-email page on success', async () => {
    signUp.mockResolvedValue({ error: null });
    render(<Register />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(signUp).toHaveBeenCalledWith('a@b.com', 'password123'));
    expect(window.location.hash).toBe('#/verify-email?email=a%40b.com');
  });

  it('shows the error message returned by signUp', async () => {
    signUp.mockResolvedValue({ error: { message: 'Email already registered' } });
    render(<Register />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Email already registered')).toBeInTheDocument();
  });
});
