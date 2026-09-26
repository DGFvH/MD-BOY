// The "try it" editor on the landing page keeps its text here. When the visitor chooses
// "Save", the draft is marked pending, and the app turns it into a document after sign-in.
// Tool pages (e.g. /mermaid-editor) keep their own text under KEY:<page>, so they don't
// overwrite each other; "Save" always hands the text over under KEY.
const KEY = 'hashlite:guest';
const keyFor = (page) => (page ? `${KEY}:${page}` : KEY);

export function loadGuestDraft(page) {
  try {
    const draft = JSON.parse(localStorage.getItem(keyFor(page)));
    return typeof draft?.content === 'string' ? draft : null;
  } catch {
    return null;
  }
}

/** false when this browser can't store it (private mode, storage full). */
export function saveGuestDraft(content, { pending = false, page } = {}) {
  try {
    localStorage.setItem(keyFor(page), JSON.stringify({ content, pending }));
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
