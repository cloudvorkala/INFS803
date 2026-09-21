/* ---------------------------------------------------------------------------
   Catches render errors so one broken component doesn't blank the whole app.

   This has to be a class — getDerivedStateFromError and componentDidCatch have
   no hook equivalent. It's the one place in this codebase that isn't a function
   component, and that's a React constraint rather than a style choice.

   What it does NOT catch, because React error boundaries never do:
     · errors inside event handlers  (those pages catch and show them inline)
     · async rejections from fetch   (apiClient turns those into ApiError)
     · errors during server rendering
   Those are already handled where they happen; this is the backstop for the
   unexpected — a bad shape from the API, a null nobody guarded.

   `resetKey` clears the error when it changes. App passes the current path, so
   navigating away recovers instead of leaving the user stuck until they reload.
   --------------------------------------------------------------------------- */

import { Component } from 'react';
import styles from './ErrorBoundary.module.css';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, showDetail: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // In a production system this is where you'd report to CloudWatch RUM or
    // Sentry. Logging keeps it visible in the console for a marker or a dev.
    console.error('Render error caught by ErrorBoundary:', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, showDetail: false });
    }
  }

  render() {
    const { error, showDetail } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="page">
        <div className={styles.panel} role="alert">
          <p className={styles.eyebrow}>Something went wrong</p>
          <h1 className={styles.title}>This page didn't load properly.</h1>
          <p className={styles.body}>
            The rest of the shop is fine — it's just this page. Your cart and your
            account haven't been affected.
          </p>

          <div className={styles.actions}>
            <button
              type="button"
              className="btn"
              onClick={() => window.location.reload()}
            >
              Reload this page
            </button>
            <a href="/" className="btn btn--ghost">
              Back to browsing
            </a>
          </div>

          <button
            type="button"
            className={styles.detailToggle}
            onClick={() => this.setState({ showDetail: !showDetail })}
          >
            {showDetail ? 'Hide technical detail' : 'Show technical detail'}
          </button>

          {showDetail && (
            <pre className={styles.detail}>{error.message || String(error)}</pre>
          )}
        </div>
      </div>
    );
  }
}
