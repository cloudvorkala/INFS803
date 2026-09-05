/* ---------------------------------------------------------------------------
   Sign in — delegates to whichever provider authService is wired to.

   If the visitor got here by trying to add a book while signed out, the
   catalogue passes that book along in `location.state.intent`. We say why they
   were interrupted, and finish the job for them after sign-in — otherwise their
   click is silently dropped and the cart looks broken.
   --------------------------------------------------------------------------- */

import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import shared from './pages.module.css';

export default function Login() {
  const { signIn, authMode } = useAuth();
  const { addItem } = useCart();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from || '/';
  const intent = location.state?.intent || null;

  const [email, setEmail] = useState(location.state?.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Set by /confirm and /forgot-password so the user gets told it worked.
  const justVerified = location.state?.verified;
  const justReset = location.state?.passwordReset;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await signIn(email, password);

      // Carry out what they were trying to do before we interrupted them.
      if (intent?.productId) {
        try {
          await addItem(intent.productId, intent.quantity ?? 1);
          navigate('/cart', { replace: true });
          return;
        } catch {
          // Out of stock in the meantime, or the item vanished. Send them on
          // to where they were headed; the cart page will show the real state.
        }
      }

      navigate(from, { replace: true });
    } catch (err) {
      // The account exists but was never verified — send them to the code
      // screen rather than showing an error they cannot act on.
      if (err?.name === 'UserNotConfirmedException') {
        navigate('/confirm', { state: { ...location.state, email } });
        return;
      }
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className={`page ${shared.narrow}`}>
      <div className={shared.formCard}>
        <h1>Sign in</h1>

        {intent ? (
          <p className="muted">
            Sign in to add <strong>{intent.title}</strong> to your cart. We'll put it
            there for you.
          </p>
        ) : (
          <p className="muted">Welcome back.</p>
        )}

        {justVerified && (
          <div className="alert alert--success">
            Email verified. Sign in and you're away.
          </div>
        )}
        {justReset && (
          <div className="alert alert--success">
            Password updated. Sign in with your new one.
          </div>
        )}
        {error && <div className="alert alert--error">{error}</div>}

        <form onSubmit={handleSubmit}>
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

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className={`btn ${shared.fullWidthBtn}`} disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {authMode === 'mock' && (
          <div className="alert alert--info" style={{ marginTop: '1.25rem' }}>
            <strong>Demo accounts</strong>
            <br />
            Reader — <code>reader@paperbound.test</code> / <code>Reader123!</code>
            <br />
            Admin — <code>admin@paperbound.test</code> / <code>Admin123!</code>
          </div>
        )}

        {authMode !== 'api' && (
          <p className={shared.formFoot}>
            <Link to="/forgot-password">Forgot your password?</Link>
          </p>
        )}

        <p className={shared.formFoot}>
          No account yet? <Link to="/register" state={location.state}>Create one</Link>
        </p>
      </div>
    </div>
  );
}
