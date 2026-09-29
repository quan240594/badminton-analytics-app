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
