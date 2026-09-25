import { APP_NAME } from './brand.js';

export const WELCOME_TITLE = `Welcome to ${APP_NAME}`;

export const WELCOME_CONTENT = `# ${WELCOME_TITLE}

Write on the left, see it on the right. Everything saves automatically.

- **Ctrl/⌘ + B**, *Ctrl/⌘ + I*, \`Ctrl/⌘ + K\` for bold, italic and links
- Paste or drop images to upload them
- Pick a colour theme from the theme menu (in ⋯ on phones)

## Examples

- [x] Create an account
- [ ] Tick this box in the preview

| Feature | Supported |
| ------- | :-------: |
| Math    | ✅        |
| Diagrams | ✅       |

> [!TIP]
> Callouts start with \`[!NOTE]\`, \`[!TIP]\` or \`[!WARNING]\`.

\`\`\`js
const greet = (name) => \`Hello, \${name}!\`;
\`\`\`

Math: $e^{i\\pi} + 1 = 0$, ==highlights== and emoji :sparkles:

\`\`\`mermaid
flowchart LR
  Write --> Preview --> Share
\`\`\`
`;
