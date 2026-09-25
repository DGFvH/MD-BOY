// Product name and tagline, in one place.
export const APP_NAME = 'Hashlite';
export const APP_TAGLINE = 'Write Markdown. See it live. Keep it safe.';

export function pageTitle(prefix) {
  return prefix ? `${prefix} · ${APP_NAME}` : APP_NAME;
}
