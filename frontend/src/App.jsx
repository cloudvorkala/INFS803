import { Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { CartProvider } from './context/CartContext.jsx';
import Header from './components/Header.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Catalogue from './pages/Catalogue.jsx';
import ProductDetail from './pages/ProductDetail.jsx';
import Cart from './pages/Cart.jsx';
import Checkout from './pages/Checkout.jsx';
import Orders from './pages/Orders.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ConfirmAccount from './pages/ConfirmAccount.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import Admin from './pages/Admin.jsx';
import NotFound from './pages/NotFound.jsx';
import CrashTest from './pages/CrashTest.jsx';
import { USE_MOCK_API, AUTH_MODE } from './services/config.js';
import styles from './App.module.css';

export default function App() {
  // Resetting the boundary on navigation means a broken page recovers when the
  // user goes somewhere else, instead of being stuck until they hit reload.
  const { pathname } = useLocation();

  return (
    <AuthProvider>
      <CartProvider>
        <div className={styles.shell}>
          <Header />

          {(USE_MOCK_API || AUTH_MODE === 'mock') && (
            <div className={styles.devBanner}>
              Running against {USE_MOCK_API ? 'the mock API' : 'the live API'}
              {' · '}
              {AUTH_MODE === 'mock' ? 'mock auth' : null}
              {AUTH_MODE === 'cognito' ? 'AWS Cognito' : null}
              {AUTH_MODE === 'api' ? 'your API auth routes' : null}. Set{' '}
              <code>VITE_API_BASE_URL</code> and <code>VITE_AUTH_MODE</code> in{' '}
              <code>.env</code> to point at the deployed stack.
            </div>
          )}

          <main className={styles.main}>
            <ErrorBoundary resetKey={pathname}>
            <Routes>
              <Route path="/" element={<Catalogue />} />
              <Route path="/books/:id" element={<ProductDetail />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/confirm" element={<ConfirmAccount />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />

              <Route
                path="/cart"
                element={
                  <ProtectedRoute>
                    <Cart />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/checkout"
                element={
                  <ProtectedRoute>
                    <Checkout />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/orders"
                element={
                  <ProtectedRoute>
                    <Orders />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute adminOnly>
                    <Admin />
                  </ProtectedRoute>
                }
              />

              {/* Deliberately throws, so graceful degradation can be shown
                  rather than described. Demo builds only — a build pointed at
                  a real API never registers this route. */}
              {USE_MOCK_API && <Route path="/__crash-test" element={<CrashTest />} />}

              <Route path="*" element={<NotFound />} />
            </Routes>
            </ErrorBoundary>
          </main>

          <footer className={styles.footer}>
            <div className={styles.footerInner}>
              <span>Paperbound — INFS803 Assignment 2, Option B</span>
              <span className="muted">React client layer · three-tier cloud application</span>
            </div>
          </footer>
        </div>
      </CartProvider>
    </AuthProvider>
  );
}
