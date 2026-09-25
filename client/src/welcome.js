import { APP_NAME } from './brand.js';

export const WELCOME_TITLE = `Welcome to ${APP_NAME}`;

export const WELCOME_CONTENT = `# ${WELCOME_TITLE}

${APP_NAME} is a simple Markdown editor that lives in your browser. Everything you write is **saved automatically** to your account.

## The basics

- Write Markdown in the editor and see it formatted in the preview, side by side on a wide screen.
- Use the toolbar, or keyboard shortcuts like **Ctrl/⌘ + B**, *Ctrl/⌘ + I* and \`Ctrl/⌘ + K\`.
- Save a point in the *version history* with **Save version now** in the ⋯ menu, or press **Ctrl/⌘ + S** on a keyboard.
- Organise documents in folders: drag a document onto a folder, or use its ⋯ menu to move it.
- Paste or drop images into the editor to upload them.

## Things you can write

### Callouts, highlights and emoji

> [!TIP]
> Start a quote with \`[!NOTE]\`, \`[!TIP]\`, \`[!IMPORTANT]\`, \`[!WARNING]\` or \`[!CAUTION]\`.

Make words ==stand out==, and add emoji with shortcodes like \`:sparkles:\` :sparkles:

### Task lists

- [x] Create an account
- [ ] Write your first document
- [ ] Tick off a task by tapping or clicking its checkbox in the preview

### Tables

| Feature        | Supported |
| -------------- | :-------: |
| Tables         | ✅        |
| Footnotes      | ✅        |
| Math           | ✅        |
| Diagrams       | ✅        |

### Code with syntax highlighting

\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

### Math

Inline math like $e^{i\\pi} + 1 = 0$, or a block:

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

### Diagrams

\`\`\`mermaid
flowchart LR
  Write --> Preview --> Share
\`\`\`

### Quotes and footnotes

> Simplicity is the ultimate sophistication.[^1]

[^1]: Often attributed to Leonardo da Vinci.

---

Feel free to edit or delete this document. Happy writing! ✍️
`;
