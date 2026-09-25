// Google Analytics 4, loaded only after the visitor allows analytics cookies (see consent.js).
// What is sent is trimmed: the address without its query or #fragment (which can hold a
// document id or the text of a #text= link), and no share tokens.
export const GA_ID = import.meta.env.VITE_GA_ID || '';

let loaded = false;

/** The page address to report: origin and path only; share links without their token. */
export function cleanLocation(loc = location) {
  const path = loc.pathname.startsWith('/s/') ? '/s' : loc.pathname;
  return loc.origin + path;
}

export function loadAnalytics() {
  if (loaded || !GA_ID) return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  // gtag.js expects the arguments object itself, not an array.
  window.gtag = function gtag() {
    window.dataLayer.push(arguments); // eslint-disable-line prefer-rest-params
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, {
    page_location: cleanLocation(),
    page_referrer: document.referrer ? cleanLocation(new URL(document.referrer)) : undefined,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.append(script);
}

/** Stops sending (Google's own opt-out flag) and removes the analytics cookies. */
export function stopAnalytics() {
  if (!GA_ID) return;
  window[`ga-disable-${GA_ID}`] = true;
  const host = location.hostname;
  const domains = ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`];
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim();
    if (!/^_ga/.test(name)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`;
    }
  }
}
