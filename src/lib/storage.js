// Safe localStorage access.
//
// Why this exists: reading localStorage directly during a React render means a
// single corrupt or truncated value permanently white-screens the app, on every
// launch, until the user wipes their profile or reinstalls. These helpers make
// bad data self-healing instead of fatal.

const drop = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable entirely (private mode, locked profile).
  }
};

/**
 * Read and parse a JSON value. Never throws.
 * Unreadable values are discarded so the app recovers on the next launch.
 */
export const readJson = (key, fallback = null) => {
  let raw;
  try {
    raw = localStorage.getItem(key);
  } catch (err) {
    console.warn(`[storage] cannot access "${key}":`, err);
    return fallback;
  }

  // 'undefined' and 'null' are what a stringified undefined/null leave behind.
  if (raw === null || raw === '' || raw === 'undefined' || raw === 'null') {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (err) {
    console.warn(`[storage] discarding unreadable "${key}":`, err);
    drop(key);
    return fallback;
  }
};

/**
 * Read a JSON array, optionally capped. Always returns an array.
 */
export const readList = (key, limit = Infinity) => {
  const value = readJson(key, []);

  if (!Array.isArray(value)) {
    console.warn(`[storage] "${key}" was not an array; resetting it`);
    drop(key);
    return [];
  }

  return Number.isFinite(limit) ? value.slice(0, limit) : value;
};

/**
 * Write a JSON value. Returns false instead of throwing when the quota is full,
 * so a failed history save can never take down an otherwise successful upload.
 */
export const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`[storage] could not save "${key}":`, err);
    return false;
  }
};

export const STORAGE_KEYS = {
  history: 'dropInvolveHistory',
  contacts: 'dropInvolveContacts',
  session: 'dropInvolveSession',
};
