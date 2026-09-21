/* ---------------------------------------------------------------------------
   Sign up — delegates to Cognito's signUp (or the mock provider).

   Our pool has email verification switched on, so sign-up returns
   nextStep.signUpStep === 'CONFIRM_SIGN_UP' and the account stays UNCONFIRMED
   until the emailed code is entered. This page hands straight off to /confirm,
   which is what makes self sign-up actually complete.
   --------------------------------------------------------------------------- */

import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import shared from './pages.module.css';

export default function Register() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirm) {
      setError('Those passwords do not match.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await signUp(form.email, form.password, form.name);

      // A pool with email verification on leaves the account UNCONFIRMED.
      // Send them straight to the code screen — anything else dead-ends here.
      if (result?.nextStep?.signUpStep === 'CONFIRM_SIGN_UP' || result?.isSignUpComplete === false) {
        navigate('/confirm', {
          replace: true,
          state: { ...location.state, email: form.email },
        });
        return;
      }

      navigate('/login', { replace: true, state: { ...location.state, email: form.email } });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className={`page ${shared.narrow}`}>
      <div className={shared.formCard}>
        <h1>Create an account</h1>
        <p className="muted">You'll need one to buy, but not to browse.</p>

        {error && <div className="alert alert--error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" value={form.name} onChange={update('name')} required />
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={form.email}
              onChange={update('email')}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={update('password')}
              required
            />
            <p className={shared.hint}>
              At least 8 characters. Cognito's default policy also wants an uppercase letter,
              a number, and a symbol.
            </p>
          </div>

          <div className="field">
            <label htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={update('confirm')}
              required
            />
          </div>

          <button type="submit" className={`btn ${shared.fullWidthBtn}`} disabled={submitting}>
            {submitting ? 'Creating your account…' : 'Create account'}
          </button>
        </form>

        <p className={shared.formFoot}>
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
