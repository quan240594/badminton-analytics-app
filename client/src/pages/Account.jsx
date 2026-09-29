import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';

export default function Account() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await updatePassword(password);
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setNotice('Password updated.');
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>Account</h1>
        <label>
          <span>New password</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label>
          <span>Confirm new password</span>
          <input
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        {error && <p className="error">{error}</p>}
        {notice && <p className="auth-notice">{notice}</p>}
        <button type="submit" className="simulate-btn" disabled={submitting}>
          {submitting ? 'Updating...' : 'Update password'}
        </button>
        <p className="auth-switch">
          <a href="#/">Back to app</a>
        </p>
      </form>
    </div>
  );
}
