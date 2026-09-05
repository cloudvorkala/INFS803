/* ---------------------------------------------------------------------------
   Enter the verification code emailed after sign-up.

   This screen is what makes self sign-up actually work. Our Cognito pool has
   email verification switched on, so a new account sits UNCONFIRMED until this
   code is entered — without this page the account exists but can never sign in.

   Reached from Register (after sign-up) and from Login (when Cognito reports
   UserNotConfirmedException for someone who never finished).
   --------------------------------------------------------------------------- */

import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import * as auth from '../services/authService.js';
import { AUTH_MODE } from '../services/config.js';
import { MOCK_CONFIRMATION_CODE } from '../services/mockAuth.js';
import shared from './pages.module.css';

export default function ConfirmAccount() {
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState(location.state?.email ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await auth.confirmSignUp(email, code);
      navigate('/login', {
        replace: true,
        state: { ...location.state, verified: true, email },
      });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError('');
    setNotice('');
    try {
      await auth.resendSignUpCode(email);
      setNotice(`A new code is on its way to ${email}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className={`page ${shared.narrow}`}>
      <div className={shared.formCard}>
        <h1>Verify your email</h1>
        <p className="muted">
          We sent a six-digit code to{' '}
          {email ? <strong>{email}</strong> : 'the address you signed up with'}. Enter it
          below to finish setting up your account.
        </p>

        {error && <div className="alert alert--error">{error}</div>}
        {notice && <div className="alert alert--success">{notice}</div>}

        <form onSubmit={handleSubmit}>
          {!location.state?.email && (
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="code">Verification code</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
            />
          </div>

          <button
            type="submit"
            className={`btn ${shared.fullWidthBtn}`}
            disabled={submitting || code.length < 6}
          >
            {submitting ? 'Verifying…' : 'Verify and continue'}
          </button>
        </form>

        <p className={shared.formFoot}>
          Didn't get it?{' '}
          <button
            type="button"
            className={shared.linkButton}
            onClick={handleResend}
            disabled={resending || !email}
          >
            {resending ? 'Sending…' : 'Send a new code'}
          </button>
        </p>

        {AUTH_MODE === 'mock' && (
          <div className="alert alert--info">
            <strong>Demo mode.</strong> No email is actually sent — the code is always{' '}
            <code>{MOCK_CONFIRMATION_CODE}</code>. With real Cognito this is a random
            six-digit code sent to the address.
          </div>
        )}

        <p className={shared.formFoot}>
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
