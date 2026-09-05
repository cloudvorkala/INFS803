/* ---------------------------------------------------------------------------
   Quantity control for a cart line.

   Optimistic: the number moves the moment you click, then reconciles with
   whatever the server returns. Without that, every tap waits on a round trip
   and holding down "+" feels broken.

   Capped at the product's stock, so the 409 from the API is a backstop rather
   than the normal way a user discovers the limit.
   --------------------------------------------------------------------------- */

import { useState } from 'react';
import styles from './QuantityStepper.module.css';

export default function QuantityStepper({ value, max, onChange, disabled = false, label }) {
  const [local, setLocal] = useState(value);
  const [busy, setBusy] = useState(false);

  // Re-sync when the server sends back a different number (e.g. another tab).
  // Adjusted during render rather than in an effect — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setLocal(value);
  }

  const commit = async (next) => {
    if (next < 1 || next > max) return;

    // Compare against the SERVER's value, not the optimistic local one. Typing
    // into the box already moved `local`, so comparing to it would make the
    // typed path a no-op and silently never save.
    if (next === value) {
      setLocal(value);
      return;
    }

    setLocal(next); // optimistic
    setBusy(true);
    try {
      await onChange(next);
    } catch {
      setLocal(value); // the caller surfaces the message; roll the number back
    } finally {
      setBusy(false);
    }
  };

  const atMin = local <= 1;
  const atMax = local >= max;

  return (
    <div className={styles.stepper} aria-busy={busy || undefined}>
      <button
        type="button"
        className={styles.button}
        onClick={() => commit(local - 1)}
        disabled={disabled || busy || atMin}
        aria-label={`Decrease quantity of ${label}`}
      >
        −
      </button>

      <label className="sr-only" htmlFor={`qty-${label}`}>
        Quantity of {label}
      </label>
      <input
        id={`qty-${label}`}
        className={styles.value}
        inputMode="numeric"
        value={local}
        disabled={disabled || busy}
        onChange={(e) => {
          const n = e.target.value.replace(/\D/g, '');
          setLocal(n === '' ? '' : Number(n));
        }}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (!n || n < 1) return setLocal(value);
          commit(Math.min(n, max));
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />

      <button
        type="button"
        className={styles.button}
        onClick={() => commit(local + 1)}
        disabled={disabled || busy || atMax}
        aria-label={`Increase quantity of ${label}`}
        title={atMax ? `Only ${max} in stock` : undefined}
      >
        +
      </button>
    </div>
  );
}
