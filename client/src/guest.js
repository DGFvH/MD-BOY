// The "try it" editor on the landing page keeps its text here. When the visitor chooses
// "Save", the draft is marked pending, and the app turns it into a document after sign-in.
const KEY = 'hashlite:guest';

export function loadGuestDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(KEY));
    return typeof draft?.content === 'string' ? draft : null;
  } catch {
    return null;
  }
}

/** false when this browser can't store it (private mode, storage full). */
export function saveGuestDraft(content, { pending = false } = {}) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ content, pending }));
    return true;
  } catch {
    return false;
  }
}

export function clearGuestDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}

/** A draft the visitor asked to save to their account. */
export const pendingGuestDraft = () => {
  const draft = loadGuestDraft();
  return draft?.pending && draft.content.trim() ? draft : null;
};
