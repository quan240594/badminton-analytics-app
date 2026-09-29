import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Account from './Account.jsx';

const updatePassword = vi.fn();
vi.mock('../hooks/useAuth.jsx', () => ({ useAuth: () => ({ updatePassword }) }));

function submitPasswordForm(password, confirmPassword) {
  render(<Account />);
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmPassword } });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
}

describe('Account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a password shorter than 8 characters', () => {
    submitPasswordForm('short', 'short');
    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords', () => {
    submitPasswordForm('password123', 'different123');
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('updates the password and shows a success notice', async () => {
    updatePassword.mockResolvedValue({ error: null });
    submitPasswordForm('password123', 'password123');

    await waitFor(() => expect(updatePassword).toHaveBeenCalledWith('password123'));
    expect(await screen.findByText('Password updated.')).toBeInTheDocument();
  });

  it('shows the error message returned by updatePassword', async () => {
    updatePassword.mockResolvedValue({ error: { message: 'Session expired' } });
    submitPasswordForm('password123', 'password123');

    expect(await screen.findByText('Session expired')).toBeInTheDocument();
  });
});
