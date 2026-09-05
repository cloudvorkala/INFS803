import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import styles from './Header.module.css';

export default function Header() {
  const { user, signOut } = useAuth();
  const { cart } = useCart();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const navClass = ({ isActive }) =>
    isActive ? `${styles.navLink} ${styles.active}` : styles.navLink;

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link to="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true" />
          Paperbound
        </Link>

        <nav className={styles.nav} aria-label="Main">
          <NavLink to="/" end className={navClass}>
            Browse
          </NavLink>
          {user && (
            <NavLink to="/orders" className={navClass}>
              Orders
            </NavLink>
          )}
          {user?.isAdmin && (
            <NavLink to="/admin" className={navClass}>
              Admin
            </NavLink>
          )}
        </nav>

        <div className={styles.actions}>
          <NavLink to="/cart" className={styles.cartLink} aria-label="Cart">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 3h2.2l2.1 12.2a1.6 1.6 0 0 0 1.6 1.3h8.7a1.6 1.6 0 0 0 1.6-1.2L21 8H6"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="10" cy="20" r="1.4" fill="currentColor" />
              <circle cx="17.5" cy="20" r="1.4" fill="currentColor" />
            </svg>
            <span className={styles.cartLabel}>Cart</span>
            {cart.itemCount > 0 && <span className={styles.badge}>{cart.itemCount}</span>}
          </NavLink>

          {user ? (
            <div className={styles.account}>
              <span className={styles.who} title={user.email}>
                {user.name}
              </span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          ) : (
            <div className={styles.account}>
              <Link to="/login" className="btn btn--ghost btn--sm">
                Sign in
              </Link>
              <Link to="/register" className="btn btn--sm">
                Register
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
