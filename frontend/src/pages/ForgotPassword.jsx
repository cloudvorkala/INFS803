/* ---------------------------------------------------------------------------
   Password reset, in two steps on one screen:
     1. ask for the email  -> the provider emails a code
     2. enter code + new password

   Note the deliberate design choice in step 1: the message is the same whether
   or not the account exists. Saying "no account with that email" would let
   anyone test which addresses are registered, which is an account-enumeration
   leak. Worth a line in the report's security section.
   --------------------------------------------------------------------------- */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as auth from '../services/authService.js';
import { AUTH_MODE } from '../services/config.js';
import { MOCK_CONFIRMATION_CODE } from '../services/mockAuth.js';
import shared from './pages.module.css';

export default function ForgotPassword() {
  const navigate = useNavigate();

  const [step, setStep] = useState('request'); // 'request' | 'reset'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const requestCode = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await auth.forgotPassword(email);
      setStep('reset');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      await auth.confirmForgotPassword(email, code, password);
      navigate('/login', { replace: true, state: { passwordReset: true, email } });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className={`page ${shared.narrow}`}>
      <div className={shared.formCard}>
        <h1>Reset your password</h1>

        {error && <div className="alert alert--error">{error}</div>}

        {step === 'request' ? (
          <>
            <p className="muted">
              Enter your email and we'll send you a code to set a new password.
            </p>
            <form onSubmit={requestCode}>
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
              <button
                type="submit"
                className={`btn ${shared.fullWidthBtn}`}
                disabled={submitting}
              >
                {submitting ? 'Sending…' : 'Send reset code'}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="muted">
              If an account exists for <strong>{email}</strong>, a code is on its way.
              Enter it below with your new password.
            </p>
            <form onSubmit={resetPassword}>
              <div className="field">
                <label htmlFor="code">Reset code</label>
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

              <div className="field">
                <label htmlFor="password">New password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <p className={shared.hint}>
                  At least 8 characters, with an uppercase letter, a number and a symbol.
                </p>
              </div>

              <div className="field">
                <label htmlFor="confirm">Confirm new password</label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className={`btn ${shared.fullWidthBtn}`}
                disabled={submitting}
              >
                {submitting ? 'Updating…' : 'Set new password'}
              </button>
            </form>

            <p className={shared.formFoot}>
              <button
                type="button"
                className={shared.linkButton}
                onClick={() => {
                  setStep('request');
                  setError('');
                }}
              >
                Use a different email
              </button>
            </p>
          </>
        )}

        {AUTH_MODE === 'mock' && step === 'reset' && (
          <div className="alert alert--info">
            <strong>Demo mode.</strong> No email is sent — the code is always{' '}
            <code>{MOCK_CONFIRMATION_CODE}</code>.
          </div>
        )}

        <p className={shared.formFoot}>
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
