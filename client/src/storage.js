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

export function saveDraft(docId, draft) {
  safe(() => localStorage.setItem(DRAFT_PREFIX + docId, JSON.stringify({ ...draft, savedAt: Date.now() })));
}

export function loadDraft(docId) {
  return safe(() => JSON.parse(localStorage.getItem(DRAFT_PREFIX + docId)), null);
}

export function clearDraft(docId) {
  safe(() => localStorage.removeItem(DRAFT_PREFIX + docId));
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
};

let prefs = { ...DEFAULT_PREFS, ...safe(() => JSON.parse(localStorage.getItem(PREF_KEY)), {}) };

export function getPrefs() {
  return prefs;
}

export function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  safe(() => localStorage.setItem(PREF_KEY, JSON.stringify(prefs)));
  return prefs;
}
