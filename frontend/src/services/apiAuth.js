/* ---------------------------------------------------------------------------
   Auth provider that uses YOUR OWN API's auth routes.

     POST /register   { name, email, password }        -> 201, no auth
     POST /login      { email, password }              -> { token, user }
     POST /logout     (Authorization header)           -> 204/200

   Use this when the team decides the backend should own all 14 documented
   routes, calling Cognito server-side (InitiateAuth / AdminCreateUser) rather
   than letting the browser talk to the User Pool directly.

   Trade-off worth a line in the report: this keeps the endpoint list entirely
   yours and hides Cognito behind your API, at the cost of writing and securing
   three routes that a managed service already provides — and of handling token
   refresh yourself, which Amplify does automatically in `cognito` mode.

   Deliberately uses its own fetch rather than importing `apiClient`: apiClient
   imports authService, which imports this file, and that would be a cycle.
   --------------------------------------------------------------------------- */

import { API_BASE_URL } from './config.js';
import { readJSON, writeJSON, remove } from './storage.js';

const SESSION_KEY = 'paperbound.api.session';

async function post(path, body, token = null) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error('Could not reach the API. Is the backend deployed and CORS enabled?');
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    throw new Error(payload?.message ?? `Request failed with status ${response.status}.`);
  }
  return payload;
}

/** Read the claims out of a JWT without verifying it — display purposes only. */
function decode(token) {
  try {
    const [, segment] = token.split('.');
    return JSON.parse(atob(segment.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

function loadSession() {
  const session = readJSON(SESSION_KEY, null);
  if (!session?.token) return null;

  const claims = decode(session.token);
  if (claims?.exp && claims.exp * 1000 < Date.now()) {
    remove(SESSION_KEY);
    return null;
  }
  return session;
}

/* --- Public interface (identical to mockAuth.js and cognitoAuth.js) -------- */

/** POST /register */
export async function register(email, password, name) {
  return post('/register', { name, email, password });
}

/** POST /login — expects { token, user } back. */
export async function login(email, password) {
  const result = await post('/login', { email, password });

  const token = result?.token ?? result?.idToken ?? result?.accessToken;
  if (!token) {
    throw new Error('The API did not return a token. Expected { token, user }.');
  }

  // Prefer the user object the API returns; fall back to the token's claims so
  // this still works if the backend returns only a token.
  const claims = decode(token) ?? {};
  const groups = result?.user?.groups ?? claims['cognito:groups'] ?? claims.groups ?? [];

  writeJSON(SESSION_KEY, {
    token,
    user: {
      sub: result?.user?.id ?? result?.user?.sub ?? claims.sub,
      email: result?.user?.email ?? claims.email ?? email,
      name: result?.user?.name ?? claims.name ?? email,
      groups,
      isAdmin: groups.includes('admins') || result?.user?.isAdmin === true,
    },
  });

  return true;
}

/** POST /logout — tell the server, then drop the local session either way. */
export async function logout() {
  const session = loadSession();
  try {
    if (session) await post('/logout', {}, session.token);
  } catch {
    /* Server-side invalidation failed, but the user still expects to be signed
       out locally. Clearing the token is the part that matters to them. */
  }
  remove(SESSION_KEY);
}

/* --- Verification and password reset ---------------------------------------
   In `api` mode the backend owns auth end to end. If it creates users with
   AdminCreateUser + an admin-set password there is no emailed code at all, so
   these steps do not exist. If your backend does expose them, point these at
   whatever routes it uses — but note that any route added here is a route
   beyond the documented 14, so keep the report in step.
   -------------------------------------------------------------------------- */

const notSupported = (what) => {
  throw new Error(
    `${what} is handled by the backend in api mode. ` +
      'Switch VITE_AUTH_MODE to "cognito" to use the built-in flow, or ask the ' +
      'backend to expose a route for it.'
  );
};

export async function confirmSignUp() {
  return notSupported('Account verification');
}

export async function resendSignUpCode() {
  return notSupported('Resending the verification code');
}

export async function forgotPassword() {
  return notSupported('Password reset');
}

export async function confirmForgotPassword() {
  return notSupported('Password reset');
}

export async function getIdToken() {
  return loadSession()?.token ?? null;
}

export async function getCurrentUser() {
  return loadSession()?.user ?? null;
}
