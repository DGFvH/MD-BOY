// The "try it" editor on the landing page: a plain textarea with a live preview.
// The renderer (markdown-it, KaTeX, highlight.js) loads after the page, so it never slows
// down the first paint. Nothing leaves the browser until the visitor chooses "Save".
import { loadGuestDraft, saveGuestDraft } from './guest.js';

const input = document.getElementById('try-input');
const preview = document.getElementById('try-preview');
const save = document.getElementById('try-save');

if (input && preview && save) {
  const draft = loadGuestDraft();
  if (draft?.content) input.value = draft.content;

  let render = null;
  let timer = 0;
  let frame = 0;
  const dark = matchMedia('(prefers-color-scheme: dark)');

  const update = () => {
    if (!render) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => render(input.value));
  };

  const store = () => {
    clearTimeout(timer);
    timer = 0;
    saveGuestDraft(input.value);
  };
  input.addEventListener('input', () => {
    update();
    clearTimeout(timer);
    timer = setTimeout(store, 400);
  });
  // Leaving within the pause after typing still keeps the text.
  addEventListener('pagehide', () => timer && store());

  save.addEventListener('click', () => {
    clearTimeout(timer);
    timer = 0; // or pagehide would store it again without the "pending" mark
    saveGuestDraft(input.value, { pending: true });
    location.href = '/app';
  });

  import('./landing-preview.js')
    .then(({ renderInto }) => {
      render = (text) => renderInto(preview, text, dark.matches);
      update();
    })
    .catch(() => {
      // Offline or a new deploy: the static preview in the page stays.
    });
}
