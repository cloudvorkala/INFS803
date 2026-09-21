/* ---------------------------------------------------------------------------
   Throws on render, on purpose.

   Registered only in demo builds (USE_MOCK_API), so a deployment pointed at a
   real API never exposes it. It exists so the error boundary can be
   demonstrated to a marker rather than just claimed in the report, and so the
   automated tests can prove the app degrades gracefully.
   --------------------------------------------------------------------------- */

export default function CrashTest() {
  throw new Error('Deliberate crash from /__crash-test — the error boundary should catch this.');
}
