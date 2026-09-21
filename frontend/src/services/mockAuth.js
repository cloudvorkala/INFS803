/* ---------------------------------------------------------------------------
   Mock authentication provider.

   Implements EXACTLY the same interface as `cognitoAuth.js`, so switching to
   real Cognito is a one-line change in `.env` (VITE_AUTH_MODE=cognito) with no
   changes anywhere in the components.

   It even mints a structurally-real (but unsigned) JWT, so the Authorization
   header flow you demonstrate in the report is the same shape as the real one.
   This token is NOT secure and is only ever accepted by the mock API.
   --------------------------------------------------------------------------- */

import { MOCK_SESSION_KEY } from './config.js';
import { readJSON, writeJSON, remove } from './storage.js';

const USERS_KEY = 'paperbound.mock.users';

/* Seeded accounts so the app is usable the moment it starts.
   `admin@paperbound.test` is in the "admins" group and can reach /admin. */
const SEED_USERS = [
  {
    sub: 'usr-admin-0001',
    email: 'admin@paperbound.test',
    password: 'Admin123!',
    name: 'Store Admin',
    groups: ['admins'],
  },
  {
    sub: 'usr-demo-0001',
    email: 'reader@paperbound.test',
    password: 'Reader123!',
    name: 'Demo Reader',
    groups: [],
  },
];

function loadUsers() {
  const stored = readJSON(USERS_KEY, null);
  if (stored && Array.isArray(stored) && stored.length) return stored;
  writeJSON(USERS_KEY, SEED_USERS);
  return SEED_USERS;
}

function saveUsers(users) {
  writeJSON(USERS_KEY, users);
}

/* base64url encode — the same encoding a real JWT uses for its segments. */
function b64url(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build an unsigned token with the same claim set Cognito puts in an ID token.
 * Real Cognito signs the third segment with RS256; we write a placeholder.
 */
function mintIdToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'none', typ: 'JWT' };
  const payload = {
    sub: user.sub,
    email: user.email,
    name: user.name,
    'cognito:groups': user.groups,
    token_use: 'id',
    iat: now,
    exp: now + 60 * 60, // 1 hour, matching Cognito's default ID token lifetime
    iss: 'mock-auth-provider',
  };
  return `${b64url(header)}.${b64url(payload)}.mock-signature`;
}

function toSession(user) {
  return {
    idToken: mintIdToken(user),
    user: {
      sub: user.sub,
      email: user.email,
      name: user.name,
      groups: user.groups,
      isAdmin: user.groups.includes('admins'),
    },
  };
}

function currentSession() {
  const session = readJSON(MOCK_SESSION_KEY, null);
  if (!session?.idToken) return null;
  try {
    const [, payload] = session.idToken.split('.');
    const claims = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    );
    if (claims.exp * 1000 < Date.now()) {
      remove(MOCK_SESSION_KEY);
      return null;
    }
  } catch {
    remove(MOCK_SESSION_KEY);
    return null;
  }
  return session;
}

/* Simulate a little network latency so loading states are visible in the UI. */
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));

/* --- Public interface (mirrors cognitoAuth.js) ----------------------------- */

/* In mock mode the "emailed" verification code is always this. Real Cognito
   sends a random six-digit code; the UI shows this hint only in mock mode. */
export const MOCK_CONFIRMATION_CODE = '123456';

export async function register(email, password, name) {
  await delay();
  const users = loadUsers();
  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('An account with that email already exists.');
  }
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const user = {
    sub: `usr-${Math.random().toString(36).slice(2, 10)}`,
    email,
    password,
    name,
    groups: [],
    // Mirrors a Cognito pool with email verification switched on: the account
    // exists but cannot sign in until the emailed code is entered.
    confirmed: false,
  };
  saveUsers([...users, user]);
  return {
    isSignUpComplete: false,
    userId: user.sub,
    nextStep: { signUpStep: 'CONFIRM_SIGN_UP' },
  };
}

/** Enter the code that was emailed. Mirrors Amplify's confirmSignUp. */
export async function confirmSignUp(email, code) {
  await delay();
  const users = loadUsers();
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error('No account found for that email.');
  if (user.confirmed) return { isSignUpComplete: true };
  if (String(code).trim() !== MOCK_CONFIRMATION_CODE) {
    throw new Error('That code is not correct. Check the email and try again.');
  }
  user.confirmed = true;
  saveUsers(users);
  return { isSignUpComplete: true };
}

/** Send the code again. */
export async function resendSignUpCode(email) {
  await delay();
  const users = loadUsers();
  if (!users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('No account found for that email.');
  }
  return { destination: email };
}

/** Start a password reset — Cognito emails a code. */
export async function forgotPassword(email) {
  await delay();
  const users = loadUsers();
  // Deliberately does NOT reveal whether the account exists: telling an
  // attacker which emails are registered is an account-enumeration leak.
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (user) {
    user.resetPending = true;
    saveUsers(users);
  }
  return { destination: email };
}

/** Finish a password reset with the code and a new password. */
export async function confirmForgotPassword(email, code, newPassword) {
  await delay();
  const users = loadUsers();
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error('No account found for that email.');
  if (String(code).trim() !== MOCK_CONFIRMATION_CODE) {
    throw new Error('That code is not correct. Check the email and try again.');
  }
  if (newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  user.password = newPassword;
  user.resetPending = false;
  user.confirmed = true;
  saveUsers(users);
  return { success: true };
}

export async function login(email, password) {
  await delay();
  const users = loadUsers();
  const user = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
  );
  if (!user) throw new Error('Incorrect email or password.');

  // Same error name Amplify throws, so the UI can branch on it identically.
  if (user.confirmed === false) {
    const err = new Error('Your account is not verified yet. Enter the code we emailed you.');
    err.name = 'UserNotConfirmedException';
    throw err;
  }

  const session = toSession(user);
  writeJSON(MOCK_SESSION_KEY, session);
  return true; // matches Cognito's `isSignedIn`
}

export async function logout() {
  await delay(150);
  remove(MOCK_SESSION_KEY);
}

export async function getIdToken() {
  const session = currentSession();
  return session?.idToken ?? null;
}

export async function getCurrentUser() {
  const session = currentSession();
  return session?.user ?? null;
}
