// Local, per-browser persistence: unsaved drafts and UI preferences.
// Every access is guarded because storage can be unavailable (private mode, quotas).

const DRAFT_PREFIX = 'hashmark:draft:';
const PREF_KEY = 'hashmark:prefs';

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Stores a draft; false when it could not be stored (storage full or unavailable). */
export function saveDraft(docId, draft) {
  return safe(() => {
    localStorage.setItem(DRAFT_PREFIX + docId, JSON.stringify({ ...draft, savedAt: Date.now() }));
    return true;
  }, false);
}

export function loadDraft(docId) {
  return safe(() => JSON.parse(localStorage.getItem(DRAFT_PREFIX + docId)), null);
}

export function clearDraft(docId) {
  safe(() => localStorage.removeItem(DRAFT_PREFIX + docId));
}

/** Ids of every document that has a draft in this browser. */
export function draftIds() {
  return safe(() => {
    const ids = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(DRAFT_PREFIX)) ids.push(key.slice(DRAFT_PREFIX.length));
    }
    return ids;
  }, []);
}

export function clearAllDrafts() {
  for (const id of draftIds()) clearDraft(id);
}

const DEFAULT_PREFS = {
  theme: 'auto', // auto | light | dark
  view: 'split', // edit | split | preview
  sidebar: true,
  panel: null, // null | outline | history
  lineNumbers: false,
  syncScroll: true,
  collapsed: {}, // folderId -> true
  lastDoc: null,
  hasAccount: false, // someone has signed in from this browser before
};

const stored = safe(() => JSON.parse(localStorage.getItem(PREF_KEY)), null) || {};
// Settings saved before hasAccount existed mean someone used the app in this browser.
let prefs = { ...DEFAULT_PREFS, hasAccount: Object.keys(stored).length > 0, ...stored };

export function getPrefs() {
  return prefs;
}

export function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  safe(() => localStorage.setItem(PREF_KEY, JSON.stringify(prefs)));
  return prefs;
}
