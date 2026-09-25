// Progressive enhancement for the public pages: "Copy" buttons on the guide's Markdown examples.
// Content never depends on this file.
if (navigator.clipboard) {
  for (const fig of document.querySelectorAll('.pair figure:first-child')) {
    const code = fig.querySelector('pre');
    const caption = fig.querySelector('figcaption');
    if (!code || !caption) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy Markdown example');
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        btn.textContent = 'Copied';
      } catch {
        btn.textContent = 'Copy failed';
      }
      setTimeout(() => (btn.textContent = 'Copy'), 1600);
    });
    caption.append(btn);
  }
}
