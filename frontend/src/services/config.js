/* ---------------------------------------------------------------------------
   Runtime configuration, read once from Vite's env at module load.

   Every value here comes from `.env` (see `.env.example`). Nothing in this file
   is a secret — everything Vite exposes with the VITE_ prefix ends up in the
   browser bundle. The Cognito User Pool ID and App Client ID are *designed* to
   be public; the App Client must be created WITHOUT a client secret.
   --------------------------------------------------------------------------- */

const env = import.meta.env;

/** Base URL of the team's RESTful API. Empty string => use the mock API. */
export const API_BASE_URL = (env.VITE_API_BASE_URL || '').replace(/\/$/, '');

/** True while the backend is not wired up yet. */
export const USE_MOCK_API = API_BASE_URL === '';

/**
 * Which auth provider is live:
 *   "mock"    — local, no AWS needed (development default)
 *   "cognito" — the browser talks to a Cognito User Pool directly via Amplify.
 *               /register, /login and /logout are Cognito's, not your API's.
 *   "api"     — your own backend exposes POST /register, /login, /logout and
 *               calls Cognito server-side. All 14 documented routes are yours.
 */
const MODES = ['mock', 'cognito', 'api'];
export const AUTH_MODE = MODES.includes(env.VITE_AUTH_MODE) ? env.VITE_AUTH_MODE : 'mock';

export const COGNITO = {
  userPoolId: env.VITE_COGNITO_USER_POOL_ID || '',
  userPoolClientId: env.VITE_COGNITO_CLIENT_ID || '',
  region: env.VITE_COGNITO_REGION || 'ap-southeast-2',
};

/** Storage key for the mock session. Real Cognito manages its own storage. */
export const MOCK_SESSION_KEY = 'paperbound.mock.session';
export const MOCK_DB_KEY = 'paperbound.mock.db';
