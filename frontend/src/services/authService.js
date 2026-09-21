/* ---------------------------------------------------------------------------
   Authentication facade.

   The rest of the app imports ONLY from this file. It picks the provider based
   on VITE_AUTH_MODE, so swapping mock auth for real Cognito never touches a
   single component. This is the seam that makes the "Cognito-ready" claim in
   the report true rather than aspirational.
   --------------------------------------------------------------------------- */

import { AUTH_MODE } from './config.js';
import * as mock from './mockAuth.js';
import * as cognito from './cognitoAuth.js';
import * as apiAuth from './apiAuth.js';

const PROVIDERS = { mock, cognito, api: apiAuth };
const provider = PROVIDERS[AUTH_MODE] ?? mock;

export const authMode = AUTH_MODE;

/** Create an account. Resolves once the user pool has accepted the sign-up. */
export const register = (email, password, name) =>
  provider.register(email, password, name);

/** Sign in. Resolves to `true` when the session is established. */
export const login = (email, password) => provider.login(email, password);

/** Sign out and clear the local session. */
export const logout = () => provider.logout();

/** Current ID token (JWT) for the Authorization header, or null. */
export const getIdToken = () => provider.getIdToken();

/** Current user's claims ({ sub, email, name, groups, isAdmin }) or null. */
export const getCurrentUser = () => provider.getCurrentUser();

/* --- Account verification and password reset ------------------------------ */

/** Enter the code emailed after sign-up. Required before the account can sign in. */
export const confirmSignUp = (email, code) => provider.confirmSignUp(email, code);

/** Email the verification code again. */
export const resendSignUpCode = (email) => provider.resendSignUpCode(email);

/** Start a password reset — sends a code to the address. */
export const forgotPassword = (email) => provider.forgotPassword(email);

/** Finish a password reset using the emailed code. */
export const confirmForgotPassword = (email, code, newPassword) =>
  provider.confirmForgotPassword(email, code, newPassword);

/** True when the live provider supports the code-based flows above. */
export const supportsSelfService = AUTH_MODE !== 'api';
