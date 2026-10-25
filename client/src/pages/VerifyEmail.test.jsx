import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VerifyEmail from './VerifyEmail.jsx';

const verifySignupCode = vi.fn();
const resendSignupCode = vi.fn();
vi.mock('../hooks/useAuth.jsx', () => ({
  useAuth: () => ({ verifySignupCode, resendSignupCode }),
}));

describe('VerifyEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '#/verify-email?email=a%40b.com';
  });

  it('pre-fills the email from the hash query string', () => {
    render(<VerifyEmail />);
    expect(screen.getByLabelText('Email')).toHaveValue('a@b.com');
  });

  it.each([
    ['no query string', '#/verify-email'],
    ['a query string without an email', '#/verify-email?foo=bar'],
  ])('starts with an empty email for %s', (_case, hash) => {
    window.location.hash = hash;
    render(<VerifyEmail />);
    expect(screen.getByLabelText('Email')).toHaveValue('');
  });

  it('uses the email the user types and trims the code', async () => {
    verifySignupCode.mockResolvedValue({ error: null });
    render(<VerifyEmail />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@b.com' } });
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: ' 123456 ' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Verify' }).closest('form'));

    await waitFor(() => expect(verifySignupCode).toHaveBeenCalledWith('new@b.com', '123456'));
  });

  it('shows an error when the code cannot be resent', async () => {
    resendSignupCode.mockResolvedValue({ error: { message: 'Too many requests' } });
    render(<VerifyEmail />);
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));

    expect(await screen.findByText('Too many requests')).toBeInTheDocument();
    expect(screen.queryByText('A new code has been sent.')).not.toBeInTheDocument();
  });

  it('verifies the code and redirects to the app on success', async () => {
    verifySignupCode.mockResolvedValue({ error: null });
    render(<VerifyEmail />);
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(verifySignupCode).toHaveBeenCalledWith('a@b.com', '123456'));
    await waitFor(() => expect(window.location.hash).toBe('#/'));
  });

  it('shows an error when the code is wrong', async () => {
    verifySignupCode.mockResolvedValue({ error: { message: 'Invalid code' } });
    render(<VerifyEmail />);
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Invalid code')).toBeInTheDocument();
  });

  it('resends the code on request', async () => {
    resendSignupCode.mockResolvedValue({ error: null });
    render(<VerifyEmail />);
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));

    await waitFor(() => expect(resendSignupCode).toHaveBeenCalledWith('a@b.com'));
    expect(await screen.findByText('A new code has been sent.')).toBeInTheDocument();
  });
});
