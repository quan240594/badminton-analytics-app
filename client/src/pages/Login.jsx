import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await signIn(email, password);
    setSubmitting(false);

    if (signInError) {
      // Supabase returns this exact message for both unverified and never-confirmed accounts.
      if (signInError.message.toLowerCase().includes('email not confirmed')) {
        window.location.hash = `#/verify-email?email=${encodeURIComponent(email)}`;
        return;
      }
      setError(signInError.message);
      return;
    }

    window.location.hash = '#/';
  };

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>Log in</h1>
        <label>
          <span>Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="simulate-btn" disabled={submitting}>
          {submitting ? 'Logging in...' : 'Log in'}
        </button>
        <p className="auth-switch">
          Need an account? <a href="#/register">Register</a>
        </p>
      </form>
    </div>
  );
}
