// GitHub-style alerts: a blockquote starting with "[!NOTE]" (TIP, IMPORTANT, WARNING,
// CAUTION) becomes <div class="markdown-alert markdown-alert-note"> with a title.
// Pure markdown-it plugin (no DOM): the server imports it too.

const TITLES = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };
const MARKER_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;

export default function alertsPlugin(md) {
  // Runs right after block parsing: inline content is still raw text, and later
  // core rules (such as the preview's data-line pass) see the final tokens.
  md.core.ruler.after('block', 'alerts', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i];
      if (open.type !== 'blockquote_open' || tokens[i + 1]?.type !== 'paragraph_open') continue;
      const inline = tokens[i + 2];
      const m = inline?.type === 'inline' && MARKER_RE.exec(inline.content);
      if (!m) continue;
      const kind = m[1].toLowerCase();
      let close = i + 1;
      while (tokens[close] && !(tokens[close].type === 'blockquote_close' && tokens[close].level === open.level)) close++;
      if (!tokens[close]) continue;

      open.type = 'alert_open';
      open.tag = 'div';
      open.attrJoin('class', `markdown-alert markdown-alert-${kind}`);
      tokens[close].type = 'alert_close';
      tokens[close].tag = 'div';

      const title = new state.Token('alert_title', 'p', 0);
      title.block = true;
      title.level = open.level + 1;
      title.meta = { kind };
      inline.content = inline.content.slice(m[0].length);
      if (inline.content.trim()) {
        // The paragraph now starts on the line after the marker.
        if (tokens[i + 1].map) tokens[i + 1].map = [tokens[i + 1].map[0] + 1, tokens[i + 1].map[1]];
        tokens.splice(i + 1, 0, title);
      } else {
        tokens.splice(i + 1, 3, title); // the marker was the whole paragraph
      }
    }
  });

  md.renderer.rules.alert_title = (tokens, idx) => `<p class="markdown-alert-title">${TITLES[tokens[idx].meta.kind]}</p>\n`;
}
