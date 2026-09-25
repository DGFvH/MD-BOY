// Colour themes, shared by the app and the editor on the home page. Each theme is a set of
// tokens in markdown.css (data-theme="…"); the choice is kept with the other preferences.
import { getPrefs, setPref } from './storage.js';

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export const THEMES = [
  { id: 'auto', label: 'System', icon: 'auto' },
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
  { id: 'sepia', label: 'Sepia', icon: 'paper' },
  { id: 'contrast', label: 'High contrast', icon: 'contrast' },
];

export function currentTheme() {
  const theme = getPrefs().theme;
  return THEMES.some((t) => t.id === theme) ? theme : 'auto';
}

export function isDark() {
  const theme = currentTheme();
  return theme === 'dark' || theme === 'contrast' || (theme === 'auto' && darkQuery.matches);
}

export function applyTheme() {
  const theme = currentTheme();
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  // Keep data-theme accurate for CSS that only needs light/dark.
  if (theme === 'auto' && darkQuery.matches) document.documentElement.dataset.theme = 'dark';
}

export function setTheme(theme) {
  setPref('theme', theme);
  applyTheme();
}

/** Runs fn when the system switches between light and dark. */
export function onSystemThemeChange(fn) {
  darkQuery.addEventListener('change', fn);
}

/** Menu items for showMenu(): one per theme, the current one checked. */
export function themeMenuItems(onPick) {
  const cur = currentTheme();
  return THEMES.map((t) => ({ label: t.label, icon: t.icon, checked: cur === t.id, onClick: () => onPick(t.id) }));
}
