/* ---------------------------------------------------------------------------
   Real AWS Cognito authentication provider.

   TO ACTIVATE:
     1) npm install aws-amplify   (already a dependency of this project)
     2) fill VITE_COGNITO_USER_POOL_ID / VITE_COGNITO_CLIENT_ID / VITE_COGNITO_REGION
        in your .env
     3) set VITE_AUTH_MODE=cognito

   Nothing else in the app changes — `authService.js` picks this module up and
   every component keeps calling the same five functions.

   Note on the imports: kept as dynamic imports (literal specifiers, so Vite
   still resolves and code-splits them normally) purely so `aws-amplify` is
   only ever pulled into a loaded chunk when this provider is actually used.
   --------------------------------------------------------------------------- */

import { COGNITO } from './config.js';

let configured = false;

async function amplifyAuth() {
  const core = await import('aws-amplify');
  const auth = await import('aws-amplify/auth');

  if (!configured) {
    if (!COGNITO.userPoolId || !COGNITO.userPoolClientId) {
      throw new Error(
        'Cognito is not configured. Set VITE_COGNITO_USER_POOL_ID and ' +
          'VITE_COGNITO_CLIENT_ID in your .env file.'
      );
    }
    core.Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: COGNITO.userPoolId,
          userPoolClientId: COGNITO.userPoolClientId,
        },
      },
    });
    configured = true;
  }

  return auth;
}

/* --- Public interface (mirrors mockAuth.js) -------------------------------- */

export async function register(email, password, name) {
  const auth = await amplifyAuth();
  return auth.signUp({
    username: email,
    password,
    options: { userAttributes: { email, name } },
  });
}

/**
 * Enter the code Cognito emailed after sign-up.
 *
 * A pool with email verification switched on (which is how ours is configured)
 * leaves the account UNCONFIRMED until this runs. Without this step, self
 * sign-up dead-ends: the account exists but can never sign in.
 */
export async function confirmSignUp(email, code) {
  const auth = await amplifyAuth();
  return auth.confirmSignUp({ username: email, confirmationCode: String(code).trim() });
}

/** Email the verification code again. */
export async function resendSignUpCode(email) {
  const auth = await amplifyAuth();
  return auth.resendSignUpCode({ username: email });
}

/** Start a password reset. Cognito emails a code. */
export async function forgotPassword(email) {
  const auth = await amplifyAuth();
  return auth.resetPassword({ username: email });
}

/** Finish a password reset with the emailed code and the new password. */
export async function confirmForgotPassword(email, code, newPassword) {
  const auth = await amplifyAuth();
  return auth.confirmResetPassword({
    username: email,
    confirmationCode: String(code).trim(),
    newPassword,
  });
}

export async function login(email, password) {
  const auth = await amplifyAuth();
  const { isSignedIn, nextStep } = await auth.signIn({ username: email, password });

  // Amplify does not always throw when sign-in is incomplete — a forced
  // password reset, MFA, or an unconfirmed account comes back as
  // `isSignedIn: false` with a `nextStep` instead. Left unchecked, the caller
  // would treat this as a successful login with no session behind it.
  if (!isSignedIn) {
    if (nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
      const err = new Error('This account has not been verified yet.');
      err.name = 'UserNotConfirmedException';
      throw err;
    }
    throw new Error(
      `Sign-in did not complete (${nextStep?.signInStep ?? 'unknown next step'}). ` +
        'Contact whoever created your account — it likely needs a password reset or extra verification step this app does not yet support.'
    );
  }

  return isSignedIn;
}

export async function logout() {
  const auth = await amplifyAuth();
  await auth.signOut();
}

/**
 * The ID token is what API Gateway's Cognito Authorizer validates. Amplify
 * refreshes it automatically from the refresh token when it is close to expiry,
 * so always fetch it fresh rather than caching it yourself.
 */
export async function getIdToken() {
  // Must never throw: apiClient calls this before EVERY request, including the
  // public ones (GET /products). A signed-out visitor, or a half-filled .env,
  // has to degrade to "no token" rather than break the catalogue.
  try {
    const auth = await amplifyAuth();
    const session = await auth.fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  try {
    const auth = await amplifyAuth();
    const session = await auth.fetchAuthSession();
    const claims = session.tokens?.idToken?.payload;
    if (!claims) return null;
    const groups = claims['cognito:groups'] ?? [];
    return {
      sub: claims.sub,
      email: claims.email,
      name: claims.name ?? claims.email,
      groups,
      isAdmin: groups.includes('admins'),
    };
  } catch {
    return null; // not signed in
  }
}
