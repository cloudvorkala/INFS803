/* ---------------------------------------------------------------------------
   Client-side route guard.

   IMPORTANT for the report: this is a *convenience*, not a security control.
   Anyone can edit the JavaScript in their browser and reach these screens. The
   real protection is server-side — the Cognito Authorizer on API Gateway and
   the group check inside each Lambda. This component only spares the user a
   pointless 401.
   --------------------------------------------------------------------------- */

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Loading from './Loading.jsx';

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Checking your session…" />;

  if (!user) {
    // Remember where they were headed so login can bounce them back.
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (adminOnly && !user.isAdmin) {
    return (
      <div className="page">
        <div className="alert alert--error">
          <strong>Admin only.</strong> Your account is not in the <code>admins</code> group.
        </div>
        <p className="muted">
          In production this check is enforced by the Lambda reading the{' '}
          <code>cognito:groups</code> claim — this page is only hiding the UI.
        </p>
      </div>
    );
  }

  return children;
}
