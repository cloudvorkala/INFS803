/* ---------------------------------------------------------------------------
   Thin wrapper over localStorage.

   Falls back to an in-memory Map when storage is unavailable (private windows,
   blocked site data, embedded previews). Every access is guarded so the app
   never white-screens because a browser refused to hand over storage.
   --------------------------------------------------------------------------- */

const memory = new Map();

function available() {
  try {
    const probe = '__paperbound_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const hasLocalStorage = typeof window !== 'undefined' && available();

export function readJSON(key, fallback = null) {
  try {
    const raw = hasLocalStorage ? window.localStorage.getItem(key) : memory.get(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    const raw = JSON.stringify(value);
    if (hasLocalStorage) window.localStorage.setItem(key, raw);
    else memory.set(key, raw);
  } catch {
    /* storage full or unavailable — the app still works, it just won't persist */
  }
}

export function remove(key) {
  try {
    if (hasLocalStorage) window.localStorage.removeItem(key);
    else memory.delete(key);
  } catch {
    /* no-op */
  }
}
