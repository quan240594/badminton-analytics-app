import { useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';

function emailFromHash(hash) {
  const query = hash.split('?')[1] ?? '';
  return new URLSearchParams(query).get('email') ?? '';
}

export default function VerifyEmail() {
  const { verifySignupCode, resendSignupCode } = useAuth();
  const initialEmail = useMemo(() => emailFromHash(window.location.hash), []);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    const { error: verifyError } = await verifySignupCode(email, code.trim());
    setSubmitting(false);

    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    // A verified session is now active; App.jsx's auth gate takes it from here.
    window.location.hash = '#/';
  };

  const handleResend = async () => {
    setError(null);
    setNotice(null);
    const { error: resendError } = await resendSignupCode(email);
    if (resendError) setError(resendError.message);
    else setNotice('A new code has been sent.');
  };

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>Verify your email</h1>
        <p className="subtitle">Enter the 6-digit code we emailed you to activate your account.</p>
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>
          Verification code
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
          />
        </label>
        {error && <p className="error">{error}</p>}
        {notice && <p className="auth-notice">{notice}</p>}
        <button type="submit" className="simulate-btn" disabled={submitting}>
          {submitting ? 'Verifying...' : 'Verify'}
        </button>
        <button type="button" className="link-btn" onClick={handleResend}>
          Resend code
        </button>
      </form>
    </div>
  );
}
